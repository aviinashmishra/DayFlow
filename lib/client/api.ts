export class ApiError extends Error {
  constructor(public status: number, message: string, public network = false) {
    super(message);
  }
}

/** JSON fetch against our API. Network failures are flagged so callers can queue and retry. */
export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined || method === 'POST' || method === 'PATCH' ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : method === 'POST' ? '{}' : undefined,
      credentials: 'same-origin',
      cache: 'no-store'
    });
  } catch {
    throw new ApiError(0, 'You are offline', true);
  }
  let data: unknown = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error || `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}
