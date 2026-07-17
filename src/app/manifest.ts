import type { MetadataRoute } from 'next';
 
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Computer Science Hub AI',
    short_name: 'CS Hub AI',
    description: 'Elite AI-powered learning platform for CS students.',
    start_url: '/',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#39FF14',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      }
    ],
  };
}