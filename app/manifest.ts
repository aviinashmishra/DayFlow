import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Dayflow',
    short_name: 'Dayflow',
    description: 'Voice-first task and status tracker for daily work.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#070a16',
    theme_color: '#0a0e1f',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' }
    ]
  };
}
