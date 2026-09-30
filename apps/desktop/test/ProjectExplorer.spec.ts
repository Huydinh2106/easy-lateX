/* @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "@easy-latex/shared-types";
import { ProjectExplorer } from "../src/renderer/features/project/ProjectExplorer";

const files: FileEntry[] = [
  { path: "chapters", name: "chapters", parentPath: "", kind: "directory" },
  { path: "main.tex", name: "main.tex", parentPath: "", kind: "file", size: 10, modifiedAt: 1 }
];

function setup() {
  const props = {
    files,
    selectedPath: "main.tex",
    rootDocument: "main.tex",
    outlineFilePath: "main.tex",
    outlineItems: [],
    onOpen: vi.fn(),
    onCreateFile: vi.fn(() => Promise.resolve(null)),
    onCreateDirectory: vi.fn(() => Promise.resolve(null)),
    onMove: vi.fn((_source: string, target: string) => Promise.resolve(target)),
    onRemove: vi.fn(() => Promise.resolve(true)),
    onImportFiles: vi.fn(() => Promise.resolve([] as string[])),
    onImportFolder: vi.fn(() => Promise.resolve([] as string[])),
    onImportDropped: vi.fn(() => Promise.resolve([] as string[])),
    onSelectOutline: vi.fn()
  };
  render(React.createElement(ProjectExplorer, props));
  return props;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProjectExplorer interactions", () => {
  it("renames and deletes an item from its right-click menu", async () => {
    const props = setup();
    const row = screen.getByText("main.tex").closest('[role="treeitem"]');
    expect(row).not.toBeNull();

    fireEvent.contextMenu(row as HTMLElement, { clientX: 40, clientY: 60 });
    fireEvent.click(screen.getByRole("menuitem", { name: /rename/i }));
    const renameInput = screen.getByLabelText("Rename main.tex");
    fireEvent.change(renameInput, { target: { value: "paper.tex" } });
    fireEvent.submit(renameInput.closest("form") as HTMLFormElement);
    await waitFor(() => expect(props.onMove).toHaveBeenCalledWith("main.tex", "paper.tex"));

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.contextMenu(row as HTMLElement, { clientX: 40, clientY: 60 });
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    await waitFor(() => expect(props.onRemove).toHaveBeenCalledWith("main.tex"));
  });

  it("moves project items and imports local files by dropping them on a folder", async () => {
    const props = setup();
    const source = screen.getByText("main.tex").closest('[role="treeitem"]') as HTMLElement;
    const destination = screen.getByText("chapters").closest('[role="treeitem"]') as HTMLElement;
    const values = new Map<string, string>();
    const internalTransfer = {
      files: [],
      types: ["application/x-easy-latex-project-path"],
      effectAllowed: "none",
      dropEffect: "none",
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? ""
    };
    fireEvent.dragStart(source, { dataTransfer: internalTransfer });
    fireEvent.drop(destination, { dataTransfer: internalTransfer });
    await waitFor(() => expect(props.onMove).toHaveBeenCalledWith("main.tex", "chapters/main.tex"));

    const droppedFile = new File(["notes"], "notes.txt", { type: "text/plain" });
    const externalTransfer = {
      files: [droppedFile],
      types: ["Files"],
      dropEffect: "none",
      getData: () => ""
    };
    fireEvent.drop(destination, { dataTransfer: externalTransfer });
    await waitFor(() => expect(props.onImportDropped).toHaveBeenCalledWith([droppedFile], "chapters"));
  });
});
