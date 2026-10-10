import { NextResponse, type NextRequest } from 'next/server';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, randomToken, safeEqual, verifySession } from '@/server/session-token';

const PUBLIC_PAGES = ['/login', '/setup', '/automation-chrome'];
const PUBLIC_API = ['/api/auth/login', '/api/auth/setup', '/api/auth/state', '/api/health'];
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isPublic(pathname: string): boolean {
  if (pathname.startsWith('/api/extension/')) return true; // Bearer connection key instead of a cookie
  if (PUBLIC_API.includes(pathname)) return true;
  return PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

function sameOrigin(req: NextRequest): boolean {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const source = origin ?? referer;
  if (!source || !host) return false;
  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith('/api/');

  // CSRF: same-origin check plus double-submit token on every state-changing request
  // (the extension route authenticates with its Bearer key instead).
  if (isApi && UNSAFE.has(req.method) && !pathname.startsWith('/api/extension/')) {
    const cookieToken = req.cookies.get(CSRF_COOKIE)?.value ?? '';
    const headerToken = req.headers.get(CSRF_HEADER) ?? '';
    if (!sameOrigin(req) || !cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
      return NextResponse.json({ error: 'Security check failed (CSRF). Reload the page and try again.' }, { status: 403 });
    }
  }

  if (!isPublic(pathname)) {
    const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
    if (!session) {
      if (isApi) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
      return NextResponse.redirect(url);
    }
  }

  const res = NextResponse.next();
  if (!req.cookies.get(CSRF_COOKIE)) {
    res.cookies.set(CSRF_COOKIE, randomToken(24), {
      httpOnly: false, // read by the dashboard's fetch helper and sent back as a header
      sameSite: 'strict',
      secure: req.nextUrl.protocol === 'https:',
      path: '/',
    });
  }
  return res;
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
