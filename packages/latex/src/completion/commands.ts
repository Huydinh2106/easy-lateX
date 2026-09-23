export interface LatexCompletion {
  label: string;
  detail: string;
  apply: string;
}

export const latexCompletions: readonly LatexCompletion[] = [
  { label: "\\section", detail: "Section heading", apply: "\\section{}" },
  { label: "\\subsection", detail: "Subsection heading", apply: "\\subsection{}" },
  { label: "\\textbf", detail: "Bold text", apply: "\\textbf{}" },
  { label: "\\emph", detail: "Emphasized text", apply: "\\emph{}" },
  { label: "\\cite", detail: "Citation", apply: "\\cite{}" },
  { label: "\\ref", detail: "Cross-reference", apply: "\\ref{}" },
  { label: "\\label", detail: "Label", apply: "\\label{}" },
  { label: "\\includegraphics", detail: "Figure asset", apply: "\\includegraphics{}" },
  { label: "itemize", detail: "Itemized list environment", apply: "\\begin{itemize}\n  \\item \n\\end{itemize}" },
  { label: "enumerate", detail: "Numbered list environment", apply: "\\begin{enumerate}\n  \\item \n\\end{enumerate}" },
  { label: "equation", detail: "Numbered equation environment", apply: "\\begin{equation}\n  \n\\end{equation}" },
  { label: "figure", detail: "Figure environment", apply: "\\begin{figure}\n  \\centering\n  \\includegraphics{}\n  \\caption{}\n  \\label{}\n\\end{figure}" }
];
