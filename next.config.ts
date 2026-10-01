import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Separate build folders let two builds run side by side (e.g. NEXT_DIST_DIR=.next-test). Default: .next
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // Microphone is needed for voice capture on our own origin only.
          { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=()' }
        ]
      },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] }
    ];
  }
};

export default nextConfig;
