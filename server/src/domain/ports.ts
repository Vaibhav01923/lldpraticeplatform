import { randomUUID } from 'node:crypto';

/** Time, as a dependency, so lifecycle logic and retries are testable without waiting. */
export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

export interface IdGenerator {
  next(): string;
}
export const uuidGenerator: IdGenerator = { next: () => randomUUID() };

export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}
export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
export const consoleLogger: Logger = {
  info: (m, c) => console.log(`[info] ${m}`, c ?? ''),
  warn: (m, c) => console.warn(`[warn] ${m}`, c ?? ''),
  error: (m, c) => console.error(`[error] ${m}`, c ?? ''),
};
