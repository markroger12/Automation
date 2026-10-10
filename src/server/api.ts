import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { getSessionUser, type SessionUser } from './auth';
import { writeLog, errorMessage } from './log';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type HandlerCtx<P, Auth extends boolean> = {
  req: NextRequest;
  params: P;
  user: Auth extends true ? SessionUser : SessionUser | null;
};

type RouteOptions = { public?: boolean; admin?: boolean };

/**
 * Wraps a route handler: authentication (unless public), admin check, Zod/ApiError → JSON errors.
 * CSRF is enforced in middleware for every state-changing /api request.
 */
export function route<P = Record<string, string>>(
  handler: (ctx: HandlerCtx<P, true>) => Promise<unknown>,
  opts?: RouteOptions & { public?: false },
): (req: NextRequest, context: { params: Promise<P> }) => Promise<Response>;
export function route<P = Record<string, string>>(
  handler: (ctx: HandlerCtx<P, false>) => Promise<unknown>,
  opts: RouteOptions & { public: true },
): (req: NextRequest, context: { params: Promise<P> }) => Promise<Response>;
export function route<P>(handler: (ctx: HandlerCtx<P, boolean>) => Promise<unknown>, opts: RouteOptions = {}) {
  return async (req: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    try {
      const params = (context?.params ? await context.params : {}) as P;
      let user: SessionUser | null = null;
      if (!opts.public) {
        user = await getSessionUser();
        if (!user) throw new ApiError(401, 'Please sign in.');
        if (opts.admin && user.role !== 'ADMIN') throw new ApiError(403, 'Only an admin can do this.');
      }
      const result = await handler({ req, params, user: user as SessionUser });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.message, details: err.details }, { status: err.status });
      }
      if (err instanceof ZodError) {
        return NextResponse.json({ error: formatZodError(err), details: err.flatten() }, { status: 400 });
      }
      await writeLog({ level: 'ERROR', category: 'SYSTEM', message: `API ${req.method} ${req.nextUrl.pathname} failed: ${errorMessage(err)}` });
      return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
    }
  };
}

export function formatZodError(err: ZodError): string {
  return err.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
    .join('; ');
}

export async function readJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, 'The request body is not valid JSON.');
  }
  return schema.parse(body);
}

export function query(req: NextRequest, key: string): string | undefined {
  const v = req.nextUrl.searchParams.get(key);
  return v === null || v === '' ? undefined : v;
}

export function notFound(what = 'Item'): never {
  throw new ApiError(404, `${what} not found.`);
}
