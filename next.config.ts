import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev server only serves its client scripts to localhost; also allow 127.0.0.1 (local n8n setup)
  allowedDevOrigins: ["127.0.0.1"],
  // Fonts of the invoice PDF are read from disk at runtime (lib/invoice-pdf-fonts.ts)
  outputFileTracingIncludes: {
    "/dashboard/anfragen/\\[id\\]/rechnung/pdf": ["./assets/fonts/**/*"],
  },
  experimental: {
    // Visit photos up to 10 MB are uploaded through a Server Action (plus multipart overhead)
    serverActions: { bodySizeLimit: "11mb" },
    // The proxy buffers dashboard request bodies; keep the same limit
    proxyClientMaxBodySize: "11mb",
  },
};

export default nextConfig;
