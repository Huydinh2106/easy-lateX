import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import { AuthProvider } from "@/components/auth-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: "Projects — Easy LaTeX",
  description: "A calm workspace for creating and continuing LaTeX documents.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
