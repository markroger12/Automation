import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Blog Automation Studio',
  description: 'Writes SEO articles with ChatGPT and saves them as WordPress drafts.',
  icons: { icon: '/icon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
