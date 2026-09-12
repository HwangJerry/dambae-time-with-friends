import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '흡연장 — 친구와 잠깐',
  description:
    '친구와 목소리를 나누고, 말이 연기가 되어 흩어지는 작은 온라인 흡연장.',
  robots: { index: false, follow: false },
  icons: { icon: '/favicon.svg' },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className="dark">
      <body>{children}</body>
    </html>
  );
}
