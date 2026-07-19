// Web serves the lift-and-shifted static pages from public/ and proxies the API
// to the NestJS backend, so every page's relative /api/* fetch works unchanged.
const API_URL = process.env.API_URL || 'http://localhost:4101';

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
