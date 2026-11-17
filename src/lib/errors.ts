/** HTTP-mappable error. Lives outside the Next.js-only modules so services, the worker, the CLI and tests can share it. */
export class HttpError extends Error { constructor(public status: number, message: string, public code?: string, public extra?: Record<string, unknown>) { super(message); } }
