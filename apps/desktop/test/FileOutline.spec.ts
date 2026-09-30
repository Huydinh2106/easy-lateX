/* @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutlineItem } from "@easy-latex/latex";
import { FileOutline } from "../src/renderer/features/project/FileOutline";

const outline: OutlineItem[] = [
  { type: "section", title: "Introduction", file: "main.tex", line: 3, column: 1, offset: 20, sourceRange: { start: 20, end: 42 } },
  { type: "subsection", title: "Motivation", file: "main.tex", line: 5, column: 1, offset: 48, sourceRange: { start: 48, end: 71 } },
  { type: "section", title: "Results", file: "main.tex", line: 12, column: 1, offset: 120, sourceRange: { start: 120, end: 137 } }
];

afterEach(cleanup);

describe("FileOutline", () => {
  it("renders a collapsible hierarchy and selects a heading", () => {
    const onSelect = vi.fn();
    render(React.createElement(FileOutline, {
      filePath: "main.tex",
      items: outline,
      height: 260,
      onHeightChange: vi.fn(),
      onSelect
    }));

    expect(screen.getByText("Motivation")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Introduction" }));
    expect(screen.queryByText("Motivation")).toBeNull();
    expect(screen.getByText("Results")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Results, line 12" }));
    expect(onSelect).toHaveBeenCalledWith(outline[2]);
  });

  it("collapses the panel and supports keyboard resizing", () => {
    const onHeightChange = vi.fn();
    render(React.createElement(FileOutline, {
      filePath: "main.tex",
      items: outline,
      height: 260,
      onHeightChange,
      onSelect: vi.fn()
    }));

    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize file outline" }), { key: "ArrowUp" });
    expect(onHeightChange).toHaveBeenCalledWith(280);
    fireEvent.click(screen.getByRole("button", { name: /file outline/i }));
    expect(screen.queryByRole("tree", { name: "Outline of main.tex" })).toBeNull();
  });
});
