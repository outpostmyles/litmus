/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root — a stray package-lock.json in $HOME confuses inference.
  turbopack: { root: import.meta.dirname },
}

export default nextConfig
