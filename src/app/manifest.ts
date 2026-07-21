import type { MetadataRoute } from 'next';
 
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Noctryx AI',
    short_name: 'Noctryx AI',
    description: 'Elite AI-powered learning platform built by Lewis Einstein at Kibabii University.',
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
