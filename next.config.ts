import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Los justificantes se suben por acciones de servidor (máximo 4 MB por archivo, más el resto del formulario).
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
};

export default nextConfig;
