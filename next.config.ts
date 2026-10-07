import type { NextConfig } from 'next';
const config: NextConfig = {
  serverExternalPackages: ['playwright', 'pg', 'bullmq', 'ipaddr.js'],
};
export default config;
