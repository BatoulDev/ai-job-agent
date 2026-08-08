import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack otherwise infers the workspace root from the nearest lockfile
  // among ALL ancestor directories, which picks up an unrelated
  // package-lock.json in the Windows user home directory and breaks all
  // route resolution. Pin it to this repo explicitly.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
