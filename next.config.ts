import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fonts/logo are read from disk by the PDF templates; make sure serverless bundles include them.
  outputFileTracingIncludes: { "/api/documents/**": ["./src/assets/**"], "/**": ["./src/assets/**"] },
  serverExternalPackages: ["playwright-core"],
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
