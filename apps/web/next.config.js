// Web serves the lift-and-shifted static pages from public/ and proxies the API
// to the NestJS backend, so every page's relative /api/* fetch works unchanged.
const RAW_API_URL = process.env.API_URL;
const API_URL = RAW_API_URL || 'http://localhost:4101';

// The /api/* proxy destination below is BAKED at build time from API_URL. If
// API_URL is missing on Vercel it silently falls back to localhost (127.0.0.1),
// which Vercel's proxy refuses to reach (x-vercel-error:
// DNS_HOSTNAME_RESOLVED_PRIVATE) so EVERY /api/* 404s — with a green build and no
// signal. Log exactly what we bake so a misconfig is obvious in the Vercel BUILD
// logs. Loud log, NOT a throw: keep deploys unblocked so the running app and its
// runtime logs stay available for debugging.
const isPrivateOrigin = (v) =>
  !v ||
  !/^https?:\/\//.test(v) ||
  /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[?::1\]?|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(v);

console.log(
  `[zora-build] api-proxy VERCEL=${process.env.VERCEL || '0'} VERCEL_ENV=${process.env.VERCEL_ENV || 'none'} ` +
    `API_URL=${RAW_API_URL ? JSON.stringify(RAW_API_URL) : '(unset)'} baked=/api/:path* -> ${API_URL}/api/:path*`,
);
if (process.env.VERCEL && isPrivateOrigin(RAW_API_URL)) {
  console.error(
    '[zora-build] ***** API_URL IS MISSING OR PRIVATE ON VERCEL *****\n' +
      `  baked destination: ${API_URL}/api/:path*\n` +
      '  Vercel refuses to proxy /api/* to a private/localhost host\n' +
      '  (x-vercel-error: DNS_HOSTNAME_RESOLVED_PRIVATE) -> EVERY /api/* WILL 404.\n' +
      '  FIX: set API_URL=https://zora-api.thebrunchcity.com for the *Production*\n' +
      '  environment, then trigger a FRESH build (rewrites bake at build time).\n' +
      '  Verify: apps/web/test/deploy-smoke.sh',
  );
}

// Marketing pages converted to React routes in Phase F (F2: about/help/commission/
// brand/discover). Their static public/*.html twins are deleted, so old links are
// permanently redirected to the clean route. Drop a page's entry here once its own
// .html twin is repointed everywhere. (The apex home has no .html twin to redirect —
// it converted in F4 from public/index.html, which was deleted along with the
// '/'→'/index.html' rewrite, so '/' is now the real React route below.)
const CONVERTED_PAGES = ['about', 'help', 'commission', 'brand', 'discover'];

/** @type {import('next').NextConfig} */
module.exports = {
  async redirects() {
    return CONVERTED_PAGES.map((p) => ({
      source: `/${p}.html`,
      destination: `/${p}`,
      permanent: true,
    }));
  },
  async rewrites() {
    return {
      beforeFiles: [
        // Transparent proxy to the backend — pages keep calling relative /api/*.
        { source: '/api/:path*', destination: `${API_URL}/api/:path*` },
      ],
    };
  },
};
