import { GitBranch, HardDrive, TerminalSquare, Users } from "lucide-react";
import type { GitStatus, LatexEngine } from "@easy-latex/shared-types";

interface StatusBarProps {
  file?: string | undefined;
  engine: LatexEngine;
  git: GitStatus;
  collaboration?: boolean;
}

export function StatusBar({ file, engine, git, collaboration }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span>{collaboration ? <Users /> : <HardDrive />} {collaboration ? "Collaboration enabled" : "Collaboration off"}</span>
      <span>{file ?? "No file selected"}</span>
      <span className="status-spacer" />
      {git.isRepository ? <span><GitBranch /> History available</span> : null}
      <span><TerminalSquare /> {engine}</span>
    </footer>
  );
}
