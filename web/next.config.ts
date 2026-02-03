import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@tavily/core'],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@src': require('path').resolve(__dirname, '../src'),
    }
    return config
  },
}

export default nextConfig
