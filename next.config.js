const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');

/** @type {import('next').NextConfig | ((phase: string) => import('next').NextConfig)} */
module.exports = (phase) => ({
  // Keep production builds from replacing files used by a running dev server.
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
});
