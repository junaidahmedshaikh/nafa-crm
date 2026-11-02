import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fonts/logo are read from disk by the PDF templates; make sure serverless bundles include them.
  // playwright-core reads browsers.json / package.json / help.json at load time; the file tracer cannot see those, so
  // name them for every route that can generate a PDF (the PDF API, and the document pages whose actions email a PDF).
  outputFileTracingIncludes: {
    "/api/documents/**": ["./src/assets/**", "./node_modules/playwright-core/**/*"],
    "/invoices/**": ["./node_modules/playwright-core/**/*"],
    "/quotations/**": ["./node_modules/playwright-core/**/*"],
    "/proposals/**": ["./node_modules/playwright-core/**/*"],
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
        ],
      },
    ];
  },
};

export default nextConfig;
