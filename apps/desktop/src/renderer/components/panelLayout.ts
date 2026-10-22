import type { AppSettings } from "@easy-latex/shared-types";

export function getPanelLayout(settings: Pick<AppSettings, "explorerWidth" | "pdfWidth" | "problemsHeight">, size: { width: number; height: number }, pdfOpen: boolean) {
  const explorerWidth = Math.min(settings.explorerWidth, Math.max(180, size.width - 426));
  const pdfOverlay = pdfOpen && size.width < explorerWidth + settings.pdfWidth + 432;
  const pdfMaximum = Math.floor(Math.max(360, Math.min(900, pdfOverlay ? size.width * 0.8 : size.width - explorerWidth - 432)));
  const pdfWidth = Math.min(settings.pdfWidth, pdfMaximum);
  const explorerMaximum = Math.floor(Math.max(180, Math.min(420, size.width - 426 - (pdfOpen && !pdfOverlay ? pdfWidth + 6 : 0))));
  const problemsMaximum = Math.floor(Math.max(120, Math.min(480, size.height - 126)));
  const problemsHeight = Math.min(settings.problemsHeight, problemsMaximum);
  return { explorerWidth, explorerMaximum, pdfWidth, pdfMaximum, pdfOverlay, problemsHeight, problemsMaximum };
}
