import { GitBranch, HardDrive, TerminalSquare } from "lucide-react";
import type { GitStatus, LatexEngine } from "@easy-latex/shared-types";

interface StatusBarProps {
  file?: string | undefined;
  engine: LatexEngine;
  git: GitStatus;
}

export function StatusBar({ file, engine, git }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span><HardDrive /> Filesystem workspace</span>
      <span>{file ?? "No file selected"}</span>
      <span className="status-spacer" />
      {git.isRepository ? <span><GitBranch /> History available</span> : null}
      <span><TerminalSquare /> {engine}</span>
    </footer>
  );
}
