import type { Metadata, Viewport } from 'next';
import { Quicksand } from 'next/font/google';
import { Background, IconSprite } from '@/components/Icons';
import './globals.css';

// Quicksand (Google Fonts, variable 300–700), self-hosted by next/font: no layout shift, no third-party request.
const quicksand = Quicksand({ subsets: ['latin'], weight: 'variable', variable: '--font-quicksand', display: 'swap' });

export const metadata: Metadata = {
  title: 'Dayflow',
  description: 'Voice-first task and status tracker for daily work.',
  applicationName: 'Dayflow',
  icons: { icon: '/icons/icon.svg', apple: '/icons/icon-192.png' },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Dayflow' }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0a0e1f'
};

// Apply the saved theme before first paint to avoid a flash.
const themeScript = `try{var t=localStorage.getItem('dayflow.theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={quicksand.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <IconSprite />
        <Background />
        {children}
      </body>
    </html>
  );
}
