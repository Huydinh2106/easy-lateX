import { AlertTriangle, Bug, ChevronDown, ChevronUp, CircleAlert } from "lucide-react";
import type { Diagnostic } from "@easy-latex/shared-types";

interface ProblemsPanelProps {
  diagnostics: Diagnostic[];
  log: string;
  open: boolean;
  onToggle(): void;
  onSelect(diagnostic: Diagnostic): void;
}

export function ProblemsPanel({ diagnostics, log, open, onToggle, onSelect }: ProblemsPanelProps) {
  const errors = diagnostics.filter((item) => item.severity === "error").length;
  const warnings = diagnostics.filter((item) => item.severity === "warning").length;
  return (
    <section className={`problems-panel${open ? " problems-open" : ""}`} aria-label="Compilation problems">
      <button className="problems-heading" type="button" onClick={onToggle} aria-expanded={open}>
        <span>Problems</span>
        <span className="problem-count error-count"><CircleAlert /> {errors}</span>
        <span className="problem-count warning-count"><AlertTriangle /> {warnings}</span>
        {open ? <ChevronDown className="panel-toggle" /> : <ChevronUp className="panel-toggle" />}
      </button>
      {open ? (
        <div className="problems-content">
          <div className="diagnostic-list">
            {diagnostics.length === 0 ? <p className="panel-empty">No compiler problems.</p> : diagnostics.map((diagnostic, index) => (
              <button key={`${diagnostic.severity}-${diagnostic.file ?? "latex"}-${diagnostic.line ?? 0}-${index}`} type="button" onClick={() => onSelect(diagnostic)}>
                {diagnostic.severity === "error" ? <CircleAlert className="diagnostic-error" /> : <AlertTriangle className="diagnostic-warning" />}
                <span className="diagnostic-message">{diagnostic.message}</span>
                <span className="diagnostic-location">{diagnostic.file ?? "LaTeX"}{diagnostic.line ? `:${diagnostic.line}` : ""}</span>
              </button>
            ))}
          </div>
          {log ? <details className="technical-log"><summary><Bug /> Technical log</summary><pre>{log}</pre></details> : null}
        </div>
      ) : null}
    </section>
  );
}
