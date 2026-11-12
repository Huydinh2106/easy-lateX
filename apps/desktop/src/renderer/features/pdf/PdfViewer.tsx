import { FileText, Maximize2, Minus, Plus, X } from "lucide-react";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfViewerJumpTarget {
  page: number;
  x: number;
  y: number;
  nonce: number;
}

interface PdfViewerProps {
  url?: string | undefined;
  stale: boolean;
  onClose(): void;
  onInverseSync?: ((input: { page: number; x: number; y: number }) => void) | undefined;
  jumpTarget?: PdfViewerJumpTarget | null | undefined;
}

// A fresh canvas for each scale prevents a cancelled render from sharing its
// canvas with the next render during zoom or panel resizing.
function PageCanvas({ page, scale, onError }: { page: PDFPageProxy; scale: number; onError(message: string): void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const viewport = page.getViewport({ scale });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(viewport.width * ratio);
    canvas.height = Math.ceil(viewport.height * ratio);
    let disposed = false;
    let task: RenderTask | undefined;
    try {
      task = page.render({ canvas, canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      void task.promise.catch((caught: unknown) => {
        if (!disposed && !(caught instanceof Error && caught.name === "RenderingCancelledException")) {
          onError(caught instanceof Error ? caught.message : "Could not render this page");
        }
      });
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not render this page");
    }
    return () => {
      disposed = true;
      task?.cancel();
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [page, scale, onError]);
  return <canvas ref={canvasRef} aria-hidden="true" />;
}

interface RegionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

function extractLineBoxes(page: PDFPageProxy, textContent: { items?: unknown[] }): RegionBox[] {
  if (!textContent?.items || !Array.isArray(textContent.items)) return [];
  const viewport = page.getViewport({ scale: 1 });
  const rawBoxes: RegionBox[] = [];

  for (const rawItem of textContent.items) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const item = rawItem as { str?: string; transform?: number[]; width?: number; height?: number };
    if (!item.str || !item.str.trim() || !item.transform || !Array.isArray(item.transform)) continue;
    const b = item.transform[1] ?? 0;
    const d = item.transform[3] ?? 10;
    const tx = item.transform[4] ?? 0;
    const ty = item.transform[5] ?? 0;
    const fontHeight = item.height || Math.hypot(b, d) || 12;
    const itemWidth = item.width || 50;

    let left = tx;
    let top = ty;
    let width = itemWidth;
    let height = fontHeight;

    if (typeof viewport.convertToViewportRectangle === "function") {
      const rect = viewport.convertToViewportRectangle([tx, ty, tx + itemWidth, ty + fontHeight]) as unknown[];
      const r0 = typeof rect[0] === "number" ? rect[0] : tx;
      const r1 = typeof rect[1] === "number" ? rect[1] : ty;
      const r2 = typeof rect[2] === "number" ? rect[2] : tx + itemWidth;
      const r3 = typeof rect[3] === "number" ? rect[3] : ty + fontHeight;
      left = Math.min(r0, r2);
      top = Math.min(r1, r3);
      width = Math.abs(r2 - r0);
      height = Math.abs(r3 - r1);
    }

    if (width > 0 && height > 0) {
      rawBoxes.push({ left, top, width, height });
    }
  }

  // Merge items on the same line (similar top, close horizontal distance)
  const lines: RegionBox[] = [];
  const sorted = rawBoxes.sort((a, b) => a.top - b.top || a.left - b.left);
  for (const box of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.top - box.top) < 6 && box.left - (last.left + last.width) < 25) {
      const right = Math.max(last.left + last.width, box.left + box.width);
      const bottom = Math.max(last.top + last.height, box.top + box.height);
      last.left = Math.min(last.left, box.left);
      last.top = Math.min(last.top, box.top);
      last.width = right - last.left;
      last.height = bottom - last.top;
    } else {
      lines.push({ ...box });
    }
  }
  return lines;
}

function PdfPage({
  document,
  number,
  scale,
  estimatedSize,
  viewportRef,
  onPageClick,
  highlight
}: {
  document: PDFDocumentProxy;
  number: number;
  scale: number;
  estimatedSize: { width: number; height: number };
  viewportRef: RefObject<HTMLDivElement | null>;
  onPageClick?(event: React.MouseEvent<HTMLDivElement>, pageNumber: number): void;
  highlight?: { x: number; y: number } | null;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [nearby, setNearby] = useState(false);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [textRegions, setTextRegions] = useState<RegionBox[]>([]);
  const [hoverRegion, setHoverRegion] = useState<RegionBox | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setNearby(entry.isIntersecting);
    }, { root: viewportRef.current, rootMargin: "600px 0px" });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [viewportRef]);

  useEffect(() => {
    if (!nearby || page) return;
    let disposed = false;
    void document.getPage(number).then((loaded) => {
      if (!disposed) setPage(loaded);
    }).catch((caught: unknown) => {
      if (!disposed) setError(caught instanceof Error ? caught.message : "Could not load this page");
    });
    return () => { disposed = true; };
  }, [document, number, nearby, page]);

  useEffect(() => {
    if (!page || typeof page.getTextContent !== "function") {
      setTextRegions([]);
      return;
    }
    let disposed = false;
    void page.getTextContent().then((content) => {
      if (!disposed) {
        setTextRegions(extractLineBoxes(page, content));
      }
    }).catch(() => {
      // ignore text content failure
    });
    return () => { disposed = true; };
  }, [page]);

  const size = page?.getViewport({ scale: 1 }) ?? estimatedSize;
  return (
    <div
      ref={frameRef}
      className={`pdf-page${hoverRegion ? " is-hovering-jumpable" : ""}`}
      role="img"
      aria-label={`Page ${number}`}
      data-page-number={number}
      style={{ width: size.width * scale, aspectRatio: `${size.width} / ${size.height}` }}
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const mouseX = (event.clientX - rect.left) / scale;
        const mouseY = (event.clientY - rect.top) / scale;
        const hit = textRegions.find((box) => (
          mouseX >= box.left - 4 &&
          mouseX <= box.left + box.width + 4 &&
          mouseY >= box.top - 2 &&
          mouseY <= box.top + box.height + 2
        ));
        // DEBUG
        setHoverRegion(hit ?? null);
      }}
      onMouseLeave={() => {
        setHoverRegion(null);
      }}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          onPageClick?.(event, number);
        }
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        onPageClick?.(event, number);
      }}
    >
      {nearby && page && !error ? <PageCanvas key={scale} page={page} scale={scale} onError={setError} /> : null}
      {hoverRegion ? (
        <div
          className="pdf-hover-highlight"
          style={{
            left: `${(hoverRegion.left - 2) * scale}px`,
            top: `${(hoverRegion.top - 1) * scale}px`,
            width: `${(hoverRegion.width + 4) * scale}px`,
            height: `${(hoverRegion.height + 2) * scale}px`
          }}
          aria-hidden="true"
        />
      ) : null}
      {highlight ? (
        <>
          <div
            className="pdf-synctex-line-highlight"
            style={{ top: `${highlight.y * scale - 12}px` }}
            aria-hidden="true"
          />
          <div
            className="pdf-synctex-highlight"
            style={{
              left: `${highlight.x * scale}px`,
              top: `${highlight.y * scale}px`
            }}
            aria-hidden="true"
          />
        </>
      ) : null}
      {error ? <div className="pdf-page-message pdf-error">Page {number}: {error}</div> : null}
      {!page && !error ? <div className="pdf-page-message">Page {number}</div> : null}
    </div>
  );
}

export function PdfViewer({ url, stale, onClose, onInverseSync, jumpTarget }: PdfViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const cancelPageEdit = useRef(false);
  const scrollAnchor = useRef<{ number: number; fraction: number } | null>(null);
  const [loaded, setLoaded] = useState<{ url: string; document: PDFDocumentProxy; size: { width: number; height: number } } | null>(null);
  const [page, setPage] = useState(1);
  const [pageDraft, setPageDraft] = useState("");
  const [editingPage, setEditingPage] = useState(false);
  const [width, setWidth] = useState(480);
  const [manualScale, setManualScale] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<{ page: number; x: number; y: number } | null>(null);
  const document = loaded && loaded.url === url ? loaded.document : null;
  const size = loaded?.size ?? { width: 595, height: 842 };
  const fitScale = Math.max(0.1, (width - 32) / size.width);
  const scale = manualScale ?? fitScale;

  const rememberPosition = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const top = viewport.getBoundingClientRect().top;
    for (const frame of viewport.querySelectorAll<HTMLElement>("[data-page-number]")) {
      const bounds = frame.getBoundingClientRect();
      if (bounds.bottom > top && bounds.height > 0) {
        scrollAnchor.current = { number: Number(frame.dataset.pageNumber), fraction: (top - bounds.top) / bounds.height };
        break;
      }
    }
  };

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const anchor = scrollAnchor.current;
    const frame = anchor && viewport?.querySelector(`[data-page-number="${anchor.number}"]`);
    if (viewport && anchor && frame) {
      const bounds = frame.getBoundingClientRect();
      viewport.scrollTop += bounds.top - viewport.getBoundingClientRect().top + bounds.height * anchor.fraction;
    }
  }, [scale, document]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) { rememberPosition(); setWidth(entry.contentRect.width); }
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setError(null);
    setEditingPage(false);
    setPage(1);
    scrollAnchor.current = null;
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
    if (!url) { setLoaded(null); return; }
    let disposed = false;
    const task = getDocument({ url });
    void task.promise.then(async (pdf) => {
      const first = await pdf.getPage(1);
      const viewport = first.getViewport({ scale: 1 });
      if (!disposed) setLoaded({ url, document: pdf, size: { width: viewport.width, height: viewport.height } });
    }).catch((caught: unknown) => {
      if (!disposed) setError(caught instanceof Error ? caught.message : "Could not load the compiled PDF");
    });
    return () => { disposed = true; void task.destroy(); };
  }, [url]);

  useEffect(() => {
    if (!jumpTarget || !document || !viewportRef.current) { setHighlight(null); return; }
    const viewport = viewportRef.current;
    const frame = viewport.querySelector<HTMLElement>(`[data-page-number="${jumpTarget.page}"]`);
    if (frame) {
      const bounds = frame.getBoundingClientRect();
      const viewportBounds = viewport.getBoundingClientRect();
      const top = Math.max(0, viewport.scrollTop + bounds.top - viewportBounds.top + jumpTarget.y * scale - viewport.clientHeight / 2);
      const left = Math.max(0, viewport.scrollLeft + bounds.left - viewportBounds.left + jumpTarget.x * scale - viewport.clientWidth / 2);
      if (typeof viewport.scrollTo === "function") {
        viewport.scrollTo({ top, left, behavior: "smooth" });
      } else {
        viewport.scrollTop = top;
        viewport.scrollLeft = left;
      }
    } else { setHighlight(null); return; }
    setPage(jumpTarget.page);
    setHighlight({ page: jumpTarget.page, x: jumpTarget.x, y: jumpTarget.y });
    const timer = setTimeout(() => setHighlight(null), 2500);
    return () => clearTimeout(timer);
  }, [jumpTarget, scale, document]);

  const updateCurrentPage = () => {
    rememberPosition();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const readingLine = bounds.top + bounds.height * 0.5;
    const pages = viewport.querySelectorAll<HTMLElement>("[data-page-number]");
    for (const frame of pages) {
      if (frame.getBoundingClientRect().bottom >= readingLine) {
        setPage(Number(frame.dataset.pageNumber));
        break;
      }
    }
  };

  const jumpToPage = () => {
    if (cancelPageEdit.current) { setEditingPage(false); return; }
    const number = Number(pageDraft);
    if (document && Number.isInteger(number) && number >= 1 && number <= document.numPages) {
      viewportRef.current?.querySelector(`[data-page-number="${number}"]`)?.scrollIntoView({ block: "start" });
      setPage(number);
    }
    setEditingPage(false);
  };

  const handlePageClick = (event: React.MouseEvent<HTMLDivElement>, pageNumber: number) => {
    const frame = event.currentTarget;
    const bounds = frame.getBoundingClientRect();
    const clickX = (event.clientX - bounds.left) / scale;
    const clickY = (event.clientY - bounds.top) / scale;
    onInverseSync?.({ page: pageNumber, x: clickX, y: clickY });
  };

  return (
    <aside className="pdf-panel" aria-label="PDF preview">
      <header className="pdf-toolbar">
        <div className="pdf-title" title="SyncTeX: Double-click or ⌘-click PDF to jump to source">
          <FileText aria-hidden="true" />
          <span>PDF</span>
          {stale ? <small>Out of date</small> : null}
        </div>
        <div className="pdf-controls">
          {document ? <div className="pdf-page-control">
            <input aria-label="Go to page" title="Go to page · Scroll to browse all pages" inputMode="numeric" value={editingPage ? pageDraft : page}
              onFocus={() => { cancelPageEdit.current = false; setPageDraft(String(page)); setEditingPage(true); }} onChange={(event) => setPageDraft(event.target.value)}
              onBlur={jumpToPage} onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") { cancelPageEdit.current = true; event.currentTarget.blur(); }
              }} />
            <span>/ {document.numPages}</span>
          </div> : <span>—</span>}
          <button type="button" disabled={!document} onClick={() => { rememberPosition(); setManualScale(Math.max(0.25, scale - 0.1)); }} aria-label="Zoom out" title="Zoom out"><Minus /></button>
          <span className="pdf-zoom-value">{Math.round(scale * 100)}%</span>
          <button type="button" disabled={!document} onClick={() => { rememberPosition(); setManualScale(Math.min(3, scale + 0.1)); }} aria-label="Zoom in" title="Zoom in"><Plus /></button>
          <button type="button" disabled={!document} onClick={() => { rememberPosition(); setManualScale(null); }} aria-label="Fit PDF to width" aria-pressed={manualScale === null} title="Fit to width"><Maximize2 /></button>
          <button type="button" onClick={onClose} aria-label="Close PDF preview" title="Close PDF preview"><X /></button>
        </div>
      </header>
      <div ref={viewportRef} className="pdf-viewport" tabIndex={0} role="region" aria-label="PDF pages · Scroll to browse" onScroll={updateCurrentPage}>
        {!url ? <div className="pdf-empty"><FileText /><strong>No PDF yet</strong><span>Compile the root document to create a preview.</span></div> : null}
        {url && !document && !error ? <div className="pdf-empty"><span className="loader" /><strong>Loading PDF…</strong></div> : null}
        {error ? <div className="pdf-empty pdf-error"><strong>PDF preview failed</strong><span>{error}</span></div> : null}
        {document && !error ? <div className="pdf-pages" key={url}>
          {Array.from({ length: document.numPages }, (_, index) => (
            <PdfPage
              key={index + 1}
              document={document}
              number={index + 1}
              scale={scale}
              estimatedSize={size}
              viewportRef={viewportRef}
              onPageClick={handlePageClick}
              highlight={highlight?.page === index + 1 ? highlight : null}
            />
          ))}
        </div> : null}
      </div>
    </aside>
  );
}
