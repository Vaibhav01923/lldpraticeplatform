import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type ErrorRequestHandler, type Express, type Request } from 'express';
import { z, ZodError } from 'zod';
import type { ApiErrorDto } from '../../../shared/contracts';
import type { PracticeService } from '../application/PracticeService';
import { DomainError } from '../domain/errors';
import type { Logger } from '../domain/ports';
import { silentLogger } from '../domain/ports';

export interface AppMeta {
  aiEnabled: boolean;
  aiModel?: string;
}

export interface CreateAppOptions {
  service: PracticeService;
  meta: AppMeta;
  /** Directory holding the built web client. When present, it is served and used for client-side routes. */
  staticDir?: string;
  logger?: Logger;
}

const LEARNER_ID = /^[A-Za-z0-9_-]{8,64}$/;
const Id = z.string().min(1).max(64);

const DraftBody = z.object({
  baseRevision: z.number().int().min(0),
  draft: z.object({
    format: z.string().min(1).max(40),
    design: z.unknown(),
    assumptions: z.string().max(4000),
    decisions: z.string().max(4000),
    scenarioAnswers: z.record(z.string().max(40), z.string().max(3000)).refine((o) => Object.keys(o).length <= 10, 'Too many scenario answers'),
  }),
});
const StartBody = z.object({ problemId: Id, basedOnAttemptId: Id.optional() });
const PreflightBody = z.object({ format: z.string().min(1).max(40), design: z.unknown() });

/**
 * The HTTP adapter: translate requests into PracticeService calls and errors into responses. No rules live here.
 *
 * Identity is deliberately minimal for a prototype: the browser generates a random learner id and sends it in
 * `X-Learner-Id`. It scopes data, it does not authenticate (see README, Limitations).
 */
export function createApp({ service, meta, staticDir, logger = silentLogger }: CreateAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use(express.json({ limit: '256kb' }));

  const learner = (req: Request): string => {
    const id = req.header('x-learner-id');
    if (!id || !LEARNER_ID.test(id)) throw new DomainError('LEARNER_REQUIRED', 'A valid X-Learner-Id header is required.', 400);
    return id;
  };
  const optionalLearner = (req: Request): string | undefined => {
    const id = req.header('x-learner-id');
    return id && LEARNER_ID.test(id) ? id : undefined;
  };
  const param = (req: Request, name: string): string => Id.parse(req.params[name]);

  const api = express.Router();

  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.get('/meta', (_req, res) => res.json({ ...meta, formats: service.formats() }));

  api.get('/problems', async (req, res) => res.json(await service.listProblems(optionalLearner(req))));
  api.get('/problems/:id', (req, res) => res.json(service.getProblem(param(req, 'id'))));
  api.get('/problems/:id/approaches', async (req, res) => res.json(await service.approaches(learner(req), param(req, 'id'))));
  api.get('/problems/:id/progress', async (req, res) => res.json(await service.progress(learner(req), param(req, 'id'))));

  api.post('/preflight', (req, res) => {
    const body = PreflightBody.parse(req.body);
    res.json(service.preflight(body.format, body.design));
  });

  api.post('/attempts', async (req, res) => {
    const body = StartBody.parse(req.body);
    const { attempt, resumed } = await service.startAttempt(learner(req), body.problemId, body.basedOnAttemptId);
    res.status(resumed ? 200 : 201).json(attempt);
  });
  api.get('/attempts', async (req, res) => {
    const problemId = typeof req.query['problemId'] === 'string' ? Id.parse(req.query['problemId']) : undefined;
    res.json(await service.listAttempts(learner(req), problemId));
  });
  api.get('/attempts/:id', async (req, res) => res.json(await service.getAttempt(learner(req), param(req, 'id'))));
  api.put('/attempts/:id/draft', async (req, res) => {
    const body = DraftBody.parse(req.body);
    res.json(await service.saveDraft(learner(req), param(req, 'id'), { ...body.draft, design: body.draft.design as unknown }, body.baseRevision));
  });
  api.post('/attempts/:id/submit', async (req, res) => res.status(202).json(await service.submit(learner(req), param(req, 'id'))));
  api.post('/attempts/:id/retry', async (req, res) => res.status(202).json(await service.retryEvaluation(learner(req), param(req, 'id'))));
  api.delete('/attempts/:id', async (req, res) => {
    await service.discardDraft(learner(req), param(req, 'id'));
    res.status(204).end();
  });

  api.use((_req, _res, next) => next(new DomainError('NOT_FOUND', 'No such API route.', 404)));
  app.use('/api', api);

  // Built web client, with index.html as the fallback for client-side routes.
  if (staticDir && existsSync(join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: 'index.html', maxAge: '1h' }));
    app.use((req, res, next) => (req.method === 'GET' && !req.path.startsWith('/api') ? res.sendFile(join(staticDir, 'index.html')) : next()));
  }

  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    const send = (status: number, code: string, message: string, details?: unknown) =>
      res.status(status).json({ error: { code, message, ...(details !== undefined ? { details } : {}) } } satisfies ApiErrorDto);

    if (error instanceof DomainError) return send(error.httpStatus, error.code, error.message, error.details);
    if (error instanceof ZodError) {
      return send(400, 'BAD_REQUEST', 'The request was not valid.', error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    // body-parser / http-errors: malformed JSON, payload too large
    const status = (error as { status?: number }).status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return send(status, status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST', status === 413 ? 'The request body is too large.' : 'The request body could not be read.');
    }
    logger.error('Unhandled error', { error: String(error), stack: (error as Error)?.stack });
    return send(500, 'INTERNAL', 'Something went wrong on our side.');
  };
  app.use(onError);

  return app;
}
