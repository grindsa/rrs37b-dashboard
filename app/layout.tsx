import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { BuildVersion } from "@/components/BuildVersion";
import { ThemeProvider, themeBootScript } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RRS37",
  applicationName: "RRS37",
  description: "Private infoboard",
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    title: "RRS37",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de" className={`${geistSans.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <ThemeProvider>{children}</ThemeProvider>
        <BuildVersion />
      </body>
    </html>
  );
}
