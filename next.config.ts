import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Fonts/logo are read from disk by the PDF templates; make sure serverless bundles include them.
  // The PDF engine needs files the file tracer cannot see: playwright-core reads browsers.json / package.json /
  // help.json at load time, and @sparticuz/chromium unpacks its brotli archives from its bin/ folder. Name them for
  // every route that can generate a PDF (the PDF API, and the document pages whose actions email a PDF).
  outputFileTracingIncludes: {
    "/api/documents/**": ["./src/assets/**", "./node_modules/playwright-core/**/*", "./node_modules/@sparticuz/chromium/**/*"],
    "/invoices/**": ["./node_modules/playwright-core/**/*", "./node_modules/@sparticuz/chromium/**/*"],
    "/quotations/**": ["./node_modules/playwright-core/**/*", "./node_modules/@sparticuz/chromium/**/*"],
    "/proposals/**": ["./node_modules/playwright-core/**/*", "./node_modules/@sparticuz/chromium/**/*"],
    "/**": ["./src/assets/**"],
  },
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium"],
  turbopack: {
    root: import.meta.dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      // The service worker must always be re-checked by the browser so updates are picked up.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Content-Type", value: "application/javascript; charset=utf-8" }] },
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          // Not a full script policy (Next injects inline scripts); these directives are safe and block framing, plugins and form hijacking.
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
