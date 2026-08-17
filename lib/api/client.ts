import type { Envelope } from "./envelope";

/** Browser-side fetch wrapper: unwraps the envelope, throws ApiClientError on error. */
export class ApiClientError extends Error {
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

async function request<T>(method: string, url: string, body?: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...init,
  });
  let env: Envelope<T> | null = null;
  try {
    env = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiClientError(res.status, "bad_response", `non-JSON response (${res.status})`);
  }
  if (!res.ok || env.error) {
    const e = env.error ?? { code: "http_error", message: `request failed (${res.status})` };
    throw new ApiClientError(res.status, e.code, e.message, e.details);
  }
  return env.data as T;
}

export const api = {
  get: <T>(url: string, init?: RequestInit) => request<T>("GET", url, undefined, init),
  post: <T>(url: string, body?: unknown, init?: RequestInit) => request<T>("POST", url, body ?? {}, init),
  patch: <T>(url: string, body?: unknown, init?: RequestInit) => request<T>("PATCH", url, body ?? {}, init),
  del: <T>(url: string, init?: RequestInit) => request<T>("DELETE", url, undefined, init),
};
