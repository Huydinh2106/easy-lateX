import { ChevronLeft, ChevronRight, FileText, Maximize2, Minus, Plus, X } from "lucide-react";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfViewerProps {
  url?: string | undefined;
  stale: boolean;
  onClose(): void;
}

export function PdfViewer({ url, stale, onClose }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) { setDocument(null); return; }
    let disposed = false;
    const task = getDocument({ url });
    void task.promise.then((pdf) => {
      if (disposed) return void pdf.destroy();
      setDocument(pdf);
      setPage(1);
      setError(null);
    }).catch((caught: unknown) => {
      if (!disposed) setError(caught instanceof Error ? caught.message : "Could not load the compiled PDF");
    });
    return () => { disposed = true; void task.destroy(); };
  }, [url]);

  useEffect(() => {
    if (!document || !canvasRef.current) return;
    let disposed = false;
    let renderTask: RenderTask | null = null;
    void document.getPage(page).then((pdfPage) => {
      if (disposed || !canvasRef.current) return;
      const viewport = pdfPage.getViewport({ scale: zoom * 1.35 });
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      if (!context) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      renderTask = pdfPage.render({ canvas, canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      return renderTask.promise;
    }).catch((caught: unknown) => {
      if (!disposed && !(caught instanceof Error && caught.name === "RenderingCancelledException")) {
        setError(caught instanceof Error ? caught.message : "Could not render this PDF page");
      }
    });
    return () => { disposed = true; renderTask?.cancel(); };
  }, [document, page, zoom]);

  return (
    <aside className="pdf-panel" aria-label="PDF preview">
      <header className="pdf-toolbar">
        <div className="pdf-title"><FileText aria-hidden="true" /><span>PDF</span>{stale ? <small>Out of date</small> : null}</div>
        <div className="pdf-controls">
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={!document || page === 1} aria-label="Previous page"><ChevronLeft /></button>
          <span>{document ? `${page} / ${document.numPages}` : "—"}</span>
          <button type="button" onClick={() => setPage((value) => Math.min(document?.numPages ?? value, value + 1))} disabled={!document || page === document.numPages} aria-label="Next page"><ChevronRight /></button>
          <button type="button" onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))} aria-label="Zoom out"><Minus /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((value) => Math.min(2, value + 0.1))} aria-label="Zoom in"><Plus /></button>
          <button type="button" onClick={() => setZoom(1)} aria-label="Reset zoom"><Maximize2 /></button>
          <button type="button" onClick={onClose} aria-label="Close PDF preview"><X /></button>
        </div>
      </header>
      <div className="pdf-viewport">
        {!url ? <div className="pdf-empty"><FileText /><strong>No PDF yet</strong><span>Compile the root document to create a preview.</span></div> : null}
        {url && !document && !error ? <div className="pdf-empty"><span className="loader" /><strong>Loading PDF…</strong></div> : null}
        {error ? <div className="pdf-empty pdf-error"><strong>PDF preview failed</strong><span>{error}</span></div> : null}
        <canvas ref={canvasRef} hidden={!document} />
      </div>
    </aside>
  );
}
