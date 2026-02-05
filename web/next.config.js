/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // 配置路径别名，使 Next.js 能正确解析父目录的模块
    config.resolve.alias = {
      ...config.resolve.alias,
      'agent-v2': path.resolve(__dirname, '../src/agent-v2'),
      'cli-v2': path.resolve(__dirname, '../src/cli-v2'),
      'providers': path.resolve(__dirname, '../src/providers'),
    };
    return config;
  },
};

module.exports = nextConfig;
