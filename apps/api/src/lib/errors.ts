/**
 * Application errors.
 *
 * Everything the client sees is a stable code plus a sentence written for a
 * person. Stack traces and driver messages stay in the log; they are useful to
 * an operator and useful to an attacker, and the client is not the operator.
 */

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError(400, 'bad_request', message, details);

export const unauthorized = (message = 'You need to sign in to do that.'): AppError =>
  new AppError(401, 'unauthorized', message);

export const forbidden = (message = 'Your role does not allow that.'): AppError =>
  new AppError(403, 'forbidden', message);

export const notFound = (message = 'That does not exist, or you cannot see it.'): AppError =>
  new AppError(404, 'not_found', message);

export const conflict = (message: string, details?: unknown): AppError =>
  new AppError(409, 'conflict', message, details);

export const tooManyRequests = (message: string): AppError =>
  new AppError(429, 'too_many_requests', message);

export const notImplemented = (message: string): AppError =>
  new AppError(501, 'not_implemented', message);

/**
 * A missing record and a record belonging to another organization return the
 * same 404. Distinguishing them would let a caller confirm that an id exists
 * somewhere in the system.
 */
export const notFoundOrForbidden = notFound;
