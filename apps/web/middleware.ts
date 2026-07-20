import { NextRequest, NextResponse } from 'next/server';

/* Replicates the legacy server's page-level routing that express.static can't do:
   white-label tenant routes, the /events/:id redirect, and session-gated /admin.
   Everything else (static pages, assets, /api proxy) is handled outside middleware. */

const API_URL = process.env.API_URL || 'http://localhost:4101';
const ROOT_DOMAIN = process.env.ZORA_ROOT_DOMAIN || 'zora.com';

// Runtime diagnostics. Middleware fetches the API on the edge (tenant redirect,
// /dashboard + /admin gates); when API_URL is wrong those fetches throw and the
// catch blocks below fail closed to login screens with NO signal. Log the
// resolved API_URL once per cold start, and every fetch failure with context, so
// the deployed runtime is debuggable straight from the Vercel logs.
console.log(
  `[zora-mw] init API_URL=${process.env.API_URL ? JSON.stringify(process.env.API_URL) : `(unset -> ${API_URL})`} ROOT_DOMAIN=${ROOT_DOMAIN}`,
);
function logApiFail(where: string, path: string, err: unknown): void {
  console.error(`[zora-mw] ${where} fetch ${API_URL}${path} FAILED: ${err instanceof Error ? err.message : String(err)}`);
}

// Canonical flagship slugs: /events/offshore (the alias) and its real id render
// IN PLACE on the apex via the <EventPage> route — no 302 to the owning organizer.
// Every other apex event id still bounces to its tenant leaf.
const FLAGSHIP_SLUGS = new Set(['offshore', 'offshore-001']);

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

  // Old flagship paths, now deleted, alias to the canonical React routes so the
  // many static links to them (index/discover/dashboards/footer) keep working.
  const FLAGSHIP_ALIAS: Record<string, string> = {
    '/drop-001.html': '/events/offshore',
    '/seatmap.html': '/events/offshore/seats',
  };
  if (FLAGSHIP_ALIAS[pathname]) {
    const url = req.nextUrl.clone();
    url.pathname = FLAGSHIP_ALIAS[pathname];
    url.search = '';
    return NextResponse.redirect(url, 301);
  }

  // Shape-aware white-label tenant routing (PR-F5). The /@handle front door is
  // TWO distinct surfaces:
  //   /@handle            (root) -> the storefront INDEX: the organizer's own
  //                                 multi-event index, rendered by the React
  //                                 /storefront/:handle route.
  //   /@handle/events/:id (leaf) -> the single-event branded page (tenant.html
  //                                 reads handle+id from location itself).
  // Only the /@ / tenant-root handling is touched here; F3's flagship /events
  // branches and F6's /dashboard branch below are left intact.
  //
  // Subdomain root: on a tenant subdomain, "/" IS that organizer's storefront
  // index. Handle it here — middleware runs before next.config's "/"→home
  // rewrite, so this wins.
  if (tenant && pathname === '/') {
    const url = req.nextUrl.clone();
    url.pathname = `/storefront/${tenant}`;
    return NextResponse.rewrite(url);
  }
  const storefrontRoot = pathname.match(/^\/@([^/]+)$/);
  if (storefrontRoot) {
    const url = req.nextUrl.clone();
    url.pathname = `/storefront/${storefrontRoot[1]}`;
    return NextResponse.rewrite(url);
  }
  // The branded single-event leaf: /@handle/events/:id -> the React route
  // /storefront/:handle/events/:id, whose GET TICKET opens the real CheckoutFlow
  // (replaces the retired static public/tenant.html + its app-claim toast).
  const storefrontLeaf = pathname.match(/^\/@([^/]+)\/events\/([^/]+)$/);
  if (storefrontLeaf) {
    const url = req.nextUrl.clone();
    url.pathname = `/storefront/${storefrontLeaf[1]}/events/${storefrontLeaf[2]}`;
    return NextResponse.rewrite(url);
  }
  // Any other deeper /@ path falls back to that organizer's storefront index.
  const anyTenant = pathname.match(/^\/@([^/]+)/);
  if (anyTenant) {
    const url = req.nextUrl.clone();
    url.pathname = `/storefront/${anyTenant[1]}`;
    return NextResponse.rewrite(url);
  }

  // /events/:id -> on a tenant subdomain serve the branded page; on the apex,
  // 302 to the owning organizer's tenant URL (path alias locally).
  const evMatch = pathname.match(/^\/events\/([^/]+)$/);
  if (evMatch) {
    // Canonical flagship: render the <EventPage> route in place on the apex,
    // BEFORE the apex→owner 302 below. (On a tenant subdomain the branded
    // tenant page still wins.)
    if (!tenant && FLAGSHIP_SLUGS.has(evMatch[1])) {
      return NextResponse.next();
    }
    if (tenant) {
      const url = req.nextUrl.clone();
      url.pathname = `/storefront/${tenant}/events/${encodeURIComponent(evMatch[1])}`;
      return NextResponse.rewrite(url);
    }
    try {
      const res = await fetch(`${API_URL}/api/events/${encodeURIComponent(evMatch[1])}`);
      if (!res.ok) console.error(`[zora-mw] events lookup ${API_URL}/api/events/${evMatch[1]} -> HTTP ${res.status}`);
      const ev = res.ok ? await res.json() : null;
      if (ev && ev.organizerHandle) {
        const url = req.nextUrl.clone();
        url.pathname = `/@${ev.organizerHandle}/events/${encodeURIComponent(evMatch[1])}`;
        return NextResponse.redirect(url, 302);
      }
    } catch (err) {
      logApiFail('events', `/api/events/${evMatch[1]}`, err);
    }
    return new NextResponse('Event not found', { status: 404 });
  }

  // /dashboard/* -> organizer-gated seller app (PR-F6/F7). Prefix match so every
  // seller route is covered, but EXEMPT /dashboard/login (the sign-in page must
  // render to anon so an organizer can obtain a session — gating it would loop).
  // Fail-closed: any /api/me error leaves us unauthorized and we rewrite to the
  // login page. Allow a real organizer, or an admin actively impersonating one.
  // (F3 adds its own event branches separately; this only ADDS the /dashboard
  // branch — the orchestrator reconciles.)
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
    if (pathname === '/dashboard/login') return NextResponse.next();
    let allowed = false;
    try {
      const res = await fetch(`${API_URL}/api/me`, {
        headers: { cookie: req.headers.get('cookie') || '' },
      });
      if (!res.ok) console.error(`[zora-mw] dashboard gate ${API_URL}/api/me -> HTTP ${res.status}`);
      const me = await res.json();
      allowed = me.role === 'organizer' || (!!me.isAdmin && !!me.impersonating);
    } catch (err) {
      logApiFail('dashboard-gate', '/api/me', err);
    }
    if (!allowed) {
      const url = req.nextUrl.clone();
      url.pathname = '/dashboard/login';
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  // /admin and /login -> serve the internal staff console or its login based on
  // the API session. Targets are the PR-F9 React routes (the static
  // admin/*.html twins are deleted). Distinct from the organizer /dashboard gate.
  if (pathname === '/admin' || pathname === '/login') {
    let isAdmin = false;
    try {
      const res = await fetch(`${API_URL}/api/me`, { headers: { cookie: req.headers.get('cookie') || '' } });
      if (!res.ok) console.error(`[zora-mw] admin gate ${API_URL}/api/me -> HTTP ${res.status}`);
      const me = await res.json();
      isAdmin = !!me.isAdmin;
    } catch (err) {
      logApiFail('admin-gate', '/api/me', err);
    }
    const url = req.nextUrl.clone();
    url.pathname = isAdmin ? '/admin/dashboard' : '/admin/login';
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

// Run on everything except Next internals and the /api proxy. A narrow matcher
// (e.g. '/@:path*') silently misses multi-segment tenant paths like
// /@handle/events/:id, so we match broadly and let the in-code checks above
// pass through anything irrelevant with NextResponse.next().
export const config = {
  matcher: ['/((?!_next/|api/).*)'],
};
