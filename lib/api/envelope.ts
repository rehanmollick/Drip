import { NextResponse } from "next/server";
import { ZodError } from "zod";

/**
 * One response envelope everywhere: { data, error, meta }. Thrown errors are
 * wrapped by `handle()`; there is exactly one error grammar.
 */
export type ApiError = { code: string; message: string; details?: unknown };
export type Envelope<T> = { data: T | null; error: ApiError | null; meta: Record<string, unknown> };

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function ok<T>(data: T, meta: Record<string, unknown> = {}, init?: ResponseInit) {
  return NextResponse.json<Envelope<T>>({ data, error: null, meta }, init);
}

export function fail(status: number, code: string, message: string, details?: unknown, meta: Record<string, unknown> = {}) {
  return NextResponse.json<Envelope<null>>({ data: null, error: { code, message, details }, meta }, { status });
}

type Handler<Ctx> = (req: Request, ctx: Ctx) => Promise<Response> | Response;

/** Wrap a route handler so every thrown error becomes an enveloped response. */
export function handle<Ctx = unknown>(fn: Handler<Ctx>): Handler<Ctx> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.code, e.message, e.details);
      if (e instanceof ZodError) return fail(400, "invalid_request", "request failed validation", e.issues);
      // Never echo raw internals (paths, db errors, library messages) to the client — log them, say something calm.
      console.error("[api] unhandled", e);
      return fail(500, "internal", "something broke on our side. try again?");
    }
  };
}

/** Parse a JSON body with a Zod schema; throws HttpError(400) on failure. */
export async function parseBody<T>(req: Request, schema: { parse: (v: unknown) => T }): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "body must be JSON");
  }
  return schema.parse(raw);
}
