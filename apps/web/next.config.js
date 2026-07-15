// Web serves the lift-and-shifted static pages from public/ and proxies the API
// to the NestJS backend, so every page's relative /api/* fetch works unchanged.
const API_URL = process.env.API_URL || 'http://localhost:4101';

/** @type {import('next').NextConfig} */
module.exports = {
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
