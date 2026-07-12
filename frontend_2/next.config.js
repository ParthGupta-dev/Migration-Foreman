/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // legacy inline scripts assume single-run mount, StrictMode double-invokes effects
};

module.exports = nextConfig;
