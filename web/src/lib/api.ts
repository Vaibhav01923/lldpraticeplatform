import type {
  ApiErrorDto,
  ApproachDto,
  AttemptDto,
  AttemptSummaryDto,
  DraftInputDto,
  FormatInfoDto,
  PreflightDto,
  ProblemDto,
  ProblemListItemDto,
  ProgressDto,
} from '../../../shared/contracts';
import { learnerId } from './learner';

export interface Meta {
  aiEnabled: boolean;
  aiModel?: string;
  formats: FormatInfoDto[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Learner-Id': learnerId() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (Partial<ApiErrorDto> & Record<string, unknown>) | null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? res.statusText, data?.error?.details);
  }
  return data as T;
}

export const api = {
  meta: () => request<Meta>('GET', '/meta'),
  problems: () => request<ProblemListItemDto[]>('GET', '/problems'),
  problem: (id: string) => request<ProblemDto>('GET', `/problems/${id}`),
  approaches: (id: string) => request<ApproachDto[]>('GET', `/problems/${id}/approaches`),
  progress: (id: string) => request<ProgressDto>('GET', `/problems/${id}/progress`),
  preflight: (format: string, design: unknown) => request<PreflightDto>('POST', '/preflight', { format, design }),
  startAttempt: (problemId: string, basedOnAttemptId?: string) => request<AttemptDto>('POST', '/attempts', { problemId, basedOnAttemptId }),
  attempts: () => request<AttemptSummaryDto[]>('GET', '/attempts'),
  attempt: (id: string) => request<AttemptDto>('GET', `/attempts/${id}`),
  saveDraft: (id: string, baseRevision: number, draft: DraftInputDto) => request<AttemptDto>('PUT', `/attempts/${id}/draft`, { baseRevision, draft }),
  submit: (id: string) => request<AttemptDto>('POST', `/attempts/${id}/submit`),
  retry: (id: string) => request<AttemptDto>('POST', `/attempts/${id}/retry`),
  discard: (id: string) => request<void>('DELETE', `/attempts/${id}`),
};
