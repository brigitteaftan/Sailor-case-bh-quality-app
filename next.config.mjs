/** @type {import('next').NextConfig} */
const nextConfig = {
  // The computed data files are read from disk at request time; make sure they ship with the server build.
  outputFileTracingIncludes: { "/**": ["./data/computed/**/*.json"] },
};
export default nextConfig;
