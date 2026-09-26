import type { ParseIssueDto } from '../../../shared/contracts';

/** Base class for errors the application expects and can explain to a client. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string, id: string) {
    super('NOT_FOUND', `${what} '${id}' was not found`, 404);
  }
}

/** The request was well-formed but the content is not acceptable. */
export class ValidationError extends DomainError {
  constructor(message: string, readonly issues: ParseIssueDto[] = []) {
    super('VALIDATION_FAILED', message, 422, issues);
  }
}

/** A state-machine rule was violated (e.g. editing a submitted attempt). */
export class InvalidTransitionError extends DomainError {
  constructor(message: string) {
    super('INVALID_STATE', message, 409);
  }
}

/** An autosave arrived based on an out-of-date draft revision. */
export class StaleDraftError extends DomainError {
  constructor(expected: number, received: number) {
    super(
      'STALE_DRAFT',
      `This draft was changed elsewhere (expected revision ${expected}, got ${received}). Reload to continue.`,
      409,
    );
  }
}

export class RetryLimitError extends DomainError {
  constructor(limit: number) {
    super('RETRY_LIMIT', `This attempt has already been evaluated ${limit} times. Start a new attempt instead.`, 429);
  }
}

/** A product rule, e.g. "solutions are revealed only after you have submitted once". */
export class PolicyError extends DomainError {
  constructor(message: string) {
    super('POLICY', message, 403);
  }
}
