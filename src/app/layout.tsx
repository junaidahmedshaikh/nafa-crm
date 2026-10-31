import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "NAFA Business OS", template: "%s · NAFA Business OS" },
  description: "Private internal CRM for NAFA Events & Activations.",
  robots: { index: false, follow: false },
  applicationName: "NAFA CRM",
  appleWebApp: { capable: true, title: "NAFA CRM", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#121214" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} font-sans h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans antialiased text-foreground bg-background">
        {children}
        <Toaster position="top-right" toastOptions={{ classNames: { toast: "!rounded-md !border !border-border" } }} />
      </body>
    </html>
  );
}
