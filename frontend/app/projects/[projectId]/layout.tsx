import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Project workspace — Easy LaTeX",
  description: "An AI-first visual workspace for academic writing.",
};

export default function ProjectWorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
