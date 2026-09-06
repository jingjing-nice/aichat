import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  experimental: {
    proxyClientMaxBodySize: '50mb',
  },
};

export default nextConfig;
