/* @vitest-environment jsdom */

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PdfViewer } from "../src/renderer/features/pdf/PdfViewer";

const pdf = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ GlobalWorkerOptions: {}, getDocument: pdf.getDocument }));
vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));

let intersections: { callback: IntersectionObserverCallback; element: Element; disconnect: ReturnType<typeof vi.fn> }[];
let resize: ResizeObserverCallback;
let destroy: ReturnType<typeof vi.fn>;
let renders: { number: number; cancel: ReturnType<typeof vi.fn>; scale: number }[];
let getPage: ReturnType<typeof vi.fn>;

function intersect(number: number, visible = true) {
  const observer = intersections.find(({ element }) => (element as HTMLElement).dataset.pageNumber === String(number));
  if (!observer) throw new Error(`Missing observer for page ${number}`);
  observer.callback([{ isIntersecting: visible, target: observer.element } as IntersectionObserverEntry], {} as IntersectionObserver);
}

async function flushUI(action: () => void) {
  await act(async () => {
    action();
    // Flush the asynchronous PDF page load before checking the canvas render.
    await Promise.resolve();
  });
}

beforeEach(() => {
  intersections = [];
  renders = [];
  destroy = vi.fn().mockResolvedValue(undefined);
  getPage = vi.fn((number: number) => Promise.resolve({
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
      scale,
      convertToViewportRectangle: (rect: number[]) => [(rect[0] ?? 0) * scale, (rect[1] ?? 0) * scale, (rect[2] ?? 0) * scale, (rect[3] ?? 0) * scale]
    }),
    getTextContent: () => Promise.resolve({
      items: [
        { str: "Test paragraph", transform: [12, 0, 0, 12, 100, 150], width: 200, height: 14 }
      ]
    }),
    render: ({ viewport }: { viewport: { scale: number } }) => {
      const cancel = vi.fn();
      renders.push({ number, cancel, scale: viewport.scale });
      return { promise: Promise.resolve(), cancel };
    }
  }));
  pdf.getDocument.mockReset().mockReturnValue({ promise: Promise.resolve({ numPages: 3, getPage }), destroy });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(element: Element) { intersections.push({ callback: this.callback, element, disconnect: this.disconnect }); }
    disconnect = vi.fn();
  });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe = vi.fn();
    disconnect = vi.fn();
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("continuous PDF preview", () => {
  it("lists every page but renders only nearby pages and releases offscreen canvases", async () => {
    const view = render(React.createElement(PdfViewer, { url: "artifact:first", stale: false, onClose: vi.fn() }));
    await screen.findByRole("img", { name: "Page 3" });
    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
    expect(renders).toHaveLength(0);
    await flushUI(() => intersect(1));
    expect(renders.map(({ number }) => number)).toEqual([1]);
    expect(getPage).not.toHaveBeenCalledWith(3);
    await flushUI(() => { intersect(1, false); intersect(2); });
    expect(renders[0]?.cancel).toHaveBeenCalled();
    expect(renders.map(({ number }) => number)).toEqual([1, 2]);
    expect(view.container.querySelectorAll("canvas")).toHaveLength(1);
    view.unmount();
    expect(destroy).toHaveBeenCalledOnce();
    expect(intersections.every(({ disconnect }) => disconnect.mock.calls.length > 0)).toBe(true);
  });

  it("fits to resized width, preserves explicit zoom, and cancels superseded renders", async () => {
    render(React.createElement(PdfViewer, { url: "artifact:first", stale: true, onClose: vi.fn() }));
    await screen.findByRole("img", { name: "Page 1" });
    await flushUI(() => intersect(1));
    await flushUI(() => resize([{ contentRect: { width: 632 } } as ResizeObserverEntry], {} as ResizeObserver));
    expect(renders.at(-1)?.scale).toBe(1);
    expect(renders[0]?.cancel).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await waitFor(() => expect(renders.at(-1)?.scale).toBeCloseTo(1.1));
    await flushUI(() => resize([{ contentRect: { width: 332 } } as ResizeObserverEntry], {} as ResizeObserver));
    expect(renders.at(-1)?.scale).toBeCloseTo(1.1);
    fireEvent.click(screen.getByRole("button", { name: "Fit PDF to width" }));
    await waitFor(() => expect(renders.at(-1)?.scale).toBe(0.5));
    expect(screen.getByText("Out of date")).toBeTruthy();
  });

  it("tracks the reading page while scrolling and offers validated direct navigation", async () => {
    render(React.createElement(PdfViewer, { url: "artifact:first", stale: false, onClose: vi.fn() }));
    const last = await screen.findByRole("img", { name: "Page 3" });
    const viewport = screen.getByRole("region", { name: /PDF pages/ });
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({ top: 0, height: 600 } as DOMRect);
    screen.getAllByRole("img").forEach((frame, index) => {
      vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({ bottom: -100 + index * 800 } as DOMRect);
    });
    fireEvent.scroll(viewport);
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Go to page" });
    expect(input.value).toBe("2");
    last.scrollIntoView = vi.fn();
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(last.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(input.value).toBe("3");
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("3");
    expect(last.scrollIntoView).toHaveBeenCalledOnce();
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("3");
  });

  it("keeps the same reading position when fitting a resized panel", async () => {
    render(React.createElement(PdfViewer, { url: "artifact:first", stale: false, onClose: vi.fn() }));
    await screen.findByRole("img", { name: "Page 3" });
    const viewport = screen.getByRole("region", { name: /PDF pages/ });
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({ top: 0, height: 600 } as DOMRect);
    const pages = screen.getAllByRole<HTMLElement>("img");
    pages.forEach((frame, index) => {
      vi.spyOn(frame, "getBoundingClientRect").mockImplementation(() => {
        const width = Number.parseFloat(frame.style.width);
        const height = width * 800 / 600;
        const top = index * (height + 16) + 16 - viewport.scrollTop;
        return { top, bottom: top + height, height } as DOMRect;
      });
    });
    // Read one quarter down page 2 at scale 1.
    await flushUI(() => resize([{ contentRect: { width: 632 } } as ResizeObserverEntry], {} as ResizeObserver));
    viewport.scrollTop = 16 + 816 + 200;
    fireEvent.scroll(viewport);
    await flushUI(() => resize([{ contentRect: { width: 332 } } as ResizeObserverEntry], {} as ResizeObserver));
    expect(viewport.scrollTop).toBeCloseTo(16 + 416 + 100);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Go to page" }).value).toBe("2");
  });

  it("ignores a late document load after a newer artifact replaces it", async () => {
    let finish!: (document: PDFDocumentProxy) => void;
    const firstDestroy = vi.fn().mockResolvedValue(undefined);
    pdf.getDocument.mockReturnValueOnce({ promise: new Promise<PDFDocumentProxy>((resolve) => { finish = resolve; }), destroy: firstDestroy });
    const view = render(React.createElement(PdfViewer, { url: "artifact:first", stale: false, onClose: vi.fn() }));
    view.rerender(React.createElement(PdfViewer, { url: "artifact:second", stale: false, onClose: vi.fn() }));
    await screen.findByRole("img", { name: "Page 3" });
    await flushUI(() => finish({ numPages: 99, getPage } as unknown as PDFDocumentProxy));
    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(firstDestroy).toHaveBeenCalledOnce();
    view.rerender(React.createElement(PdfViewer, { stale: false, onClose: vi.fn() }));
    expect(screen.getByText("No PDF yet")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows actionable PDF load errors", async () => {
    pdf.getDocument.mockReturnValueOnce({ promise: Promise.reject(new Error("Invalid PDF")), destroy });
    render(React.createElement(PdfViewer, { url: "artifact:broken", stale: false, onClose: vi.fn() }));
    expect(await screen.findByText("Invalid PDF")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("triggers inverse SyncTeX on double click or Cmd-click", async () => {
    const onInverseSync = vi.fn<(input: { page: number; x: number; y: number }) => void>();
    render(React.createElement(PdfViewer, { url: "artifact:first", stale: false, onClose: vi.fn(), onInverseSync }));
    const page2 = await screen.findByRole("img", { name: "Page 2" });
    vi.spyOn(page2, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 20,
      width: 600,
      height: 800
    } as DOMRect);

    // Double click at (110, 220) relative to viewport -> (100, 200) on page
    fireEvent.doubleClick(page2, { clientX: 110, clientY: 220 });
    expect(onInverseSync).toHaveBeenCalledTimes(1);
    const firstCall = onInverseSync.mock.calls[0]?.[0];
    expect(firstCall?.page).toBe(2);
    expect(firstCall?.x).toBeCloseTo(133.93, 1);
    expect(firstCall?.y).toBeCloseTo(267.86, 1);

    // Cmd-click
    fireEvent.click(page2, { metaKey: true, clientX: 110, clientY: 220 });
    expect(onInverseSync).toHaveBeenCalledTimes(2);
  });

  it("handles jumpTarget by rendering highlight marker", async () => {
    const view = render(React.createElement(PdfViewer, {
      url: "artifact:first",
      stale: false,
      onClose: vi.fn(),
      jumpTarget: { page: 1, x: 150, y: 250, nonce: 12345 }
    }));
    await screen.findByRole("img", { name: "Page 1" });
    await waitFor(() => expect(view.container.querySelector(".pdf-synctex-highlight")).not.toBeNull());
    const lineHighlight = view.container.querySelector(".pdf-synctex-line-highlight");
    expect(lineHighlight).not.toBeNull();
  });

  it("centers a source target inside the PDF scroll viewport, including horizontal zoom overflow", async () => {
    const onClose = vi.fn();
    const view = render(React.createElement(PdfViewer, {url: "artifact:first", stale: false, onClose}));
    const frame = await screen.findByRole("img", {name: "Page 3"});
    const viewport = screen.getByRole("region", {name: /PDF pages/});
    await flushUI(() => resize([{contentRect: {width: 632}} as ResizeObserverEntry], {} as ResizeObserver));
    Object.defineProperties(viewport, {clientHeight: {value: 500}, clientWidth: {value: 400}});
    viewport.scrollTop = 300; viewport.scrollLeft = 50;
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({top: 100, left: 100} as DOMRect);
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({top: 700, left: 80} as DOMRect);
    const scrollTo = vi.fn(); viewport.scrollTo = scrollTo;
    view.rerender(React.createElement(PdfViewer, {url: "artifact:first", stale: false, onClose,
      jumpTarget: {page: 3, x: 550, y: 250, nonce: 1}}));
    expect(scrollTo).toHaveBeenCalledWith({top: 900, left: 380, behavior: "smooth"});
    expect(screen.getByRole<HTMLInputElement>('textbox', {name: 'Go to page'}).value).toBe('3');
  });

  it("clears the old source highlight when another PDF replaces the preview", async () => {
    const onClose = vi.fn();
    const view = render(React.createElement(PdfViewer, {url: "artifact:first", stale: false, onClose,
      jumpTarget: {page: 1, x: 150, y: 250, nonce: 1}}));
    await screen.findByRole("img", {name: "Page 1"});
    await waitFor(() => expect(view.container.querySelector('.pdf-synctex-highlight')).not.toBeNull());
    view.rerender(React.createElement(PdfViewer, {url: "artifact:second", stale: false, onClose, jumpTarget: null}));
    await screen.findByRole("img", {name: "Page 1"});
    expect(view.container.querySelector('.pdf-synctex-highlight')).toBeNull();
  });

  it("renders light yellow hover highlight when mouse hovers over jumpable text region and removes on mouse leave", async () => {
    const view = render(React.createElement(PdfViewer, {
      url: "artifact:first",
      stale: false,
      onClose: vi.fn()
    }));
    await screen.findByRole("img", { name: "Page 1" });
    await flushUI(() => intersect(1));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const page1 = screen.getByRole("img", { name: "Page 1" });

    // Moving over blank margin (e.g. x: 10, y: 10) -> no hover highlight
    fireEvent.mouseMove(page1, { clientX: 10, clientY: 10 });
    expect(view.container.querySelector(".pdf-hover-highlight")).toBeNull();

    // Moving over text region (mapped to unscaled 154, 154) -> light yellow hover highlight on that region
    await waitFor(() => {
      fireEvent.mouseMove(page1, { clientX: 115, clientY: 115 });
      const hover = view.container.querySelector(".pdf-hover-highlight");
      expect(hover).not.toBeNull();
    });
    expect(page1.classList.contains("is-hovering-jumpable")).toBe(true);

    // Leaving page -> highlight removed
    fireEvent.mouseLeave(page1);
    expect(view.container.querySelector(".pdf-hover-highlight")).toBeNull();
    expect(page1.classList.contains("is-hovering-jumpable")).toBe(false);
  });
});
