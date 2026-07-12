/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship raw TS; Next transpiles them.
  transpilePackages: ['@airtalk/db', '@airtalk/engine'],
}

export default nextConfig
