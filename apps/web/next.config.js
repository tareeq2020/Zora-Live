// Web serves the lift-and-shifted static pages from public/ and proxies the API
// to the NestJS backend, so every page's relative /api/* fetch works unchanged.
const API_URL = process.env.API_URL || 'http://localhost:4101';

// Marketing pages converted to React routes in Phase F (F2: about/help/commission/
// brand/discover). Their static public/*.html twins are deleted, so old links —
// including the ones still living inside not-yet-converted static pages such as
// index.html (which F2 must not touch) — are permanently redirected to the clean
// route. Drop a page's entry here once its own .html twin is repointed everywhere.
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
        // Root serves the legacy homepage (express.static did this via index.html).
        { source: '/', destination: '/index.html' },
        // Transparent proxy to the backend — pages keep calling relative /api/*.
        { source: '/api/:path*', destination: `${API_URL}/api/:path*` },
      ],
    };
  },
};
