/** @type {import('next').NextConfig} */

// Every response gets these — no external scripts/fonts/analytics are
// loaded anywhere in this app (verified: no next/image, no Google Fonts
// link, no third-party <script> tags), so the CSP can stay tight without
// an allowlist of external domains. 'unsafe-inline' on style-src is the one
// deliberate loosening: styled-jsx (used for the per-company/super-admin
// accent color override in components/Layout.js) injects inline <style>
// tags that a stricter policy would block.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "worker-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

module.exports = nextConfig;
