import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Fees Recovery Dashboard | VPS School',
  description:
    'Analytics and management dashboard for school fees recovery — track pending dues by class, category, and student.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="h-screen overflow-hidden flex" style={{ background: 'var(--bg-primary)' }}>
        {children}
      </body>
    </html>
  )
}
