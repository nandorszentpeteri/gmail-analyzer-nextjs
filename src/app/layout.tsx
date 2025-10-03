import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from '@/components/auth/AuthProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { ConfirmDialogProvider } from '@/components/ui/ConfirmDialog'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Gmail Analyzer - AI-Powered Email Cleanup',
  description: 'Analyze and clean up your Gmail with AI-powered suggestions',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          <ToastProvider>
            <ConfirmDialogProvider>
              <div className="min-h-screen bg-gray-50">
                <header className="bg-white shadow-sm border-b">
                  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16 items-center">
                      <div className="flex items-center">
                        <h1 className="text-xl font-semibold text-gray-900">
                          📧 Gmail Analyzer
                        </h1>
                      </div>
                    </div>
                  </div>
                </header>
                <main>
                  {children}
                </main>
              </div>
            </ConfirmDialogProvider>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
