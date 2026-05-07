import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Alpha Copilot',
  description: 'Real-time conversation copilot',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
