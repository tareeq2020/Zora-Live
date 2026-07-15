import { NextRequest, NextResponse } from 'next/server';

/* Replicates the legacy server's page-level routing that express.static can't do:
   white-label tenant routes, the /events/:id redirect, and session-gated /admin.
   Everything else (static pages, assets, /api proxy) is handled outside middleware. */

const API_URL = process.env.API_URL || 'http://localhost:4101';
const ROOT_DOMAIN = process.env.ZORA_ROOT_DOMAIN || 'zora.com';

function tenantHandleFromHost(host: string): string | null {
  const h = host.split(':')[0];
  if (h.endsWith('.' + ROOT_DOMAIN)) {
    const sub = h.slice(0, -('.' + ROOT_DOMAIN).length);
    if (sub && sub !== 'www') return sub;
  }
  return null;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const tenant = tenantHandleFromHost(req.headers.get('host') || '');

  // /@handle and /@handle/events/:id -> branded tenant page (tenant.html reads the
  // handle from location itself).
  if (pathname.startsWith('/@')) {
    const url = req.nextUrl.clone();
    url.pathname = '/tenant.html';
    return NextResponse.rewrite(url);
  }

  // /events/:id -> on a tenant subdomain serve the branded page; on the apex,
  // 302 to the owning organizer's tenant URL (path alias locally).
  const evMatch = pathname.match(/^\/events\/([^/]+)$/);
  if (evMatch) {
    if (tenant) {
      const url = req.nextUrl.clone();
      url.pathname = '/tenant.html';
      return NextResponse.rewrite(url);
    }
    try {
      const ev = await fetch(`${API_URL}/api/events/${encodeURIComponent(evMatch[1])}`).then((r) => (r.ok ? r.json() : null));
      if (ev && ev.organizerHandle) {
        const url = req.nextUrl.clone();
        url.pathname = `/@${ev.organizerHandle}/events/${encodeURIComponent(evMatch[1])}`;
        return NextResponse.redirect(url, 302);
      }
    } catch {}
    return new NextResponse('Event not found', { status: 404 });
  }

  // /admin and /login -> serve dashboard or login based on the API session.
  if (pathname === '/admin' || pathname === '/login') {
    let isAdmin = false;
    try {
      const me = await fetch(`${API_URL}/api/me`, { headers: { cookie: req.headers.get('cookie') || '' } }).then((r) => r.json());
      isAdmin = !!me.isAdmin;
    } catch {}
    const url = req.nextUrl.clone();
    url.pathname = isAdmin ? '/admin/dashboard.html' : '/admin/login.html';
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/events/:path*', '/@:path*', '/admin', '/login'],
};
