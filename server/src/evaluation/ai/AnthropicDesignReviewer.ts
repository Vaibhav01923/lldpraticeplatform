import { PermanentEvaluatorError, TransientEvaluatorError } from '../Evaluator';
import type { DesignReviewer, ReviewInput } from './DesignReviewer';
import { ReviewPromptBuilder } from './ReviewPromptBuilder';
import { REVIEW_JSON_SCHEMA, type RawReview } from './reviewSchema';

/** The small slice of the Anthropic SDK this adapter uses, so it can be exercised without the network. */
export interface MessagesApi {
  create(
    body: {
      model: string;
      max_tokens: number;
      system: string;
      messages: { role: 'user'; content: string }[];
      output_config: { format: { type: 'json_schema'; schema: Record<string, unknown> } };
    },
    options?: { signal?: AbortSignal },
  ): Promise<{
    stop_reason: string | null;
    content: { type: string; text?: string }[];
  }>;
}

export interface AnthropicReviewerOptions {
  model: string;
  maxTokens?: number;
}

/**
 * Asks Claude for a structured review. The reply is constrained to a JSON schema at generation time
 * (`output_config.format`), then validated again by the evaluator. Retries and timeouts are owned by the
 * pipeline (construct the SDK client with `maxRetries: 0`), so there is one policy, not two stacked ones.
 */
export class AnthropicDesignReviewer implements DesignReviewer {
  private readonly prompts = new ReviewPromptBuilder();

  constructor(
    private readonly api: MessagesApi,
    private readonly options: AnthropicReviewerOptions,
  ) {}

  get model(): string {
    return this.options.model;
  }

  async review(input: ReviewInput, signal: AbortSignal): Promise<RawReview> {
    const { system, user } = this.prompts.build(input);
    let response: Awaited<ReturnType<MessagesApi['create']>>;
    try {
      response = await this.api.create(
        {
          model: this.options.model,
          max_tokens: this.options.maxTokens ?? 16_000,
          system,
          messages: [{ role: 'user', content: user }],
          output_config: { format: { type: 'json_schema', schema: REVIEW_JSON_SCHEMA } },
        },
        { signal },
      );
    } catch (error) {
      throw classifyApiError(error);
    }

    if (response.stop_reason === 'refusal') throw new PermanentEvaluatorError('The AI reviewer declined to review this submission.');
    if (response.stop_reason === 'max_tokens') throw new TransientEvaluatorError('The AI review was cut off before it finished.');

    const text = response.content.find((b) => b.type === 'text')?.text;
    if (!text) throw new TransientEvaluatorError('The AI reviewer returned no text.');
    try {
      return JSON.parse(text) as RawReview;
    } catch (cause) {
      throw new TransientEvaluatorError('The AI reviewer returned text that was not valid JSON.', { cause });
    }
  }
}

/**
 * Sorts an SDK error into "worth retrying" or "will not get better". Duck-typed on `status` and `name`
 * so it does not depend on which SDK error class was thrown. Messages avoid echoing anything from the
 * upstream response, which could contain internals.
 */
export function classifyApiError(error: unknown): Error {
  const e = error as { status?: number; name?: string } | undefined;
  const status = typeof e?.status === 'number' ? e.status : undefined;
  const name = e?.name ?? '';

  if (name === 'AbortError' || name === 'APIUserAbortError') return error as Error; // the pipeline's own timeout; not ours to classify
  if (status === 401 || status === 403) return new PermanentEvaluatorError('The AI reviewer is not configured correctly (authentication failed).', { cause: error });
  if (status !== undefined && status >= 400 && status < 500 && ![408, 409, 429].includes(status)) {
    return new PermanentEvaluatorError('The AI reviewer rejected the request.', { cause: error });
  }
  if (status === 429) return new TransientEvaluatorError('The AI reviewer is rate limited right now.', { cause: error });
  if (status !== undefined || name.includes('Connection') || name.includes('Timeout')) {
    return new TransientEvaluatorError('The AI reviewer is temporarily unavailable.', { cause: error });
  }
  return new TransientEvaluatorError('The AI reviewer could not be reached.', { cause: error });
}
