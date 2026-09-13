import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Sign in — Easy LaTeX",
  description: "Sign in to your private Easy LaTeX workspace.",
};

export default function LoginLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
