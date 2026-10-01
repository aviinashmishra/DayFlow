import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function json(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === 'number' ? { status: init } : init);
}

/**
 * Wraps a route handler: blocks cross-site writes, maps validation and HTTP
 * errors to JSON responses, and hides internal errors.
 */
export function route<A extends unknown[]>(fn: (req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') assertSameOrigin(req);
      return await fn(req, ...rest);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      if (err instanceof ZodError) {
        const first = err.issues[0];
        return json({ error: first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input' }, 400);
      }
      console.error(err);
      return json({ error: 'Something went wrong. Please try again.' }, 500);
    }
  };
}

function assertSameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  if (origin && host && new URL(origin).host !== host) throw new HttpError(403, 'Cross-site request blocked');
  const type = req.headers.get('content-type') || '';
  if (req.method !== 'DELETE' && !type.includes('application/json')) throw new HttpError(415, 'Expected JSON');
}

export async function body<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
  return schema.parse(data);
}
