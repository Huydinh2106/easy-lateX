import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { latexCompletions } from "@easy-latex/latex";

export function completeLatex(context: CompletionContext): CompletionResult | null {
  const token = context.matchBefore(/\\?[A-Za-z]*$/);
  if (!token || (!context.explicit && token.from === token.to)) return null;
  return {
    from: token.from,
    options: latexCompletions.map((item) => ({
      label: item.label,
      detail: item.detail,
      apply: item.apply,
      type: item.label.startsWith("\\") ? "keyword" : "class"
    }))
  };
}
