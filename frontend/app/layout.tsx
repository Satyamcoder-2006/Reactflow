import { Inter } from 'next/font/google';
import './globals.css';
import { ToastProvider } from '@/lib/context/ToastContext';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
    title: 'ReactFlow - Cloud React Native Development',
    description: 'Build and preview React Native apps in the cloud',
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" className="dark">
            <body className={inter.className}>
                <ToastProvider>{children}</ToastProvider>
            </body>
        </html>
    );
}
