/* @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PanelResizer } from "../src/renderer/components/PanelResizer";
import { getPanelLayout } from "../src/renderer/components/panelLayout";

beforeEach(() => {
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 1; }
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("panel resizing", () => {
  it("previews a clamped drag and persists only when capture ends", () => {
    const onChange = vi.fn();
    render(React.createElement(PanelResizer, { label: "Resize PDF", orientation: "vertical", direction: -1, value: 520, minimum: 360, maximum: 900, defaultValue: 520, onChange }));
    const splitter = screen.getByRole("separator", { name: "Resize PDF" });
    splitter.setPointerCapture = vi.fn();
    splitter.hasPointerCapture = vi.fn().mockReturnValue(true);
    splitter.releasePointerCapture = vi.fn((pointerId: number) => { fireEvent.lostPointerCapture(splitter, { pointerId }); });
    fireEvent.pointerDown(splitter, { button: 0, pointerId: 1, clientX: 800 });
    fireEvent.pointerMove(splitter, { pointerId: 2, clientX: 700 });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerMove(splitter, { pointerId: 1, clientX: 700 });
    expect(onChange).toHaveBeenLastCalledWith(620, false);
    fireEvent.pointerMove(splitter, { pointerId: 1, clientX: 0 });
    expect(onChange).toHaveBeenLastCalledWith(900, false);
    fireEvent.pointerUp(splitter, { pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(900, true);
  });

  it("supports directional keyboard resizing, limits, and reset", () => {
    const onChange = vi.fn();
    render(React.createElement(PanelResizer, { label: "Resize Problems", orientation: "horizontal", direction: -1, value: 220, minimum: 120, maximum: 480, defaultValue: 220, onChange }));
    const splitter = screen.getByRole("separator");
    fireEvent.keyDown(splitter, { key: "ArrowUp", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(260, true);
    fireEvent.keyDown(splitter, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith(210, true);
    fireEvent.keyDown(splitter, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(120, true);
    fireEvent.keyDown(splitter, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(480, true);
    fireEvent.doubleClick(splitter);
    expect(onChange).toHaveBeenLastCalledWith(220, true);
  });

  it("keeps source usable when resizing or shrinking the window", () => {
    const settings = { explorerWidth: 232, pdfWidth: 520, problemsHeight: 480 };
    const wide = getPanelLayout(settings, { width: 1400, height: 800 }, true);
    expect(wide.pdfOverlay).toBe(false);
    expect(1400 - wide.explorerWidth - wide.pdfMaximum - 12).toBeGreaterThanOrEqual(420);
    expect(1400 - wide.explorerMaximum - wide.pdfWidth - 12).toBeGreaterThanOrEqual(420);
    const narrow = getPanelLayout(settings, { width: 900, height: 400 }, true);
    expect(narrow.pdfOverlay).toBe(true);
    expect(narrow.problemsHeight).toBe(274);
    expect(narrow.pdfWidth).toBeLessThanOrEqual(900 * 0.8);
    expect(getPanelLayout(settings, { width: 650, height: 400 }, false).explorerWidth).toBe(224);
  });
});
