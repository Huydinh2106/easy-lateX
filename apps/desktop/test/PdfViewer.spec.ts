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
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }),
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
});
