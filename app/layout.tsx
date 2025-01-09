import type { Metadata } from "next";
import { Inter } from 'next/font/google'

import "./globals.css";

const inter = Inter({ subsets: ['latin'] })


export const metadata: Metadata = {
  title: "Tipster",
  description: "Tipster is a tool that helps you find the best stocks to invest in for 2025",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={inter.className}>
      <body>{children}</body>
    </html>
  )
}
