import React, { useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkspacePage from "@/app/projects/[projectId]/page";
import { ApiError } from "@/lib/api";

const state = vi.hoisted(() => ({
  api: {
    createBuild: vi.fn(), createFile: vi.fn(), deleteFile: vi.fn(), downloadFile: vi.fn(),
    getBuild: vi.fn(), getBuildLog: vi.fn(), getBuildPdf: vi.fn(), getFileContent: vi.fn(),
    getFiles: vi.fn(), getLatestBuild: vi.fn(), getOutline: vi.fn(), getProject: vi.fn(),
    moveFile: vi.fn(), saveFile: vi.fn(), setRootFile: vi.fn(), uploadFile: vi.fn()
  },
  editor: { revealLineInCenter: vi.fn(), setPosition: vi.fn(), focus: vi.fn() },
  changeEditor: undefined as undefined | ((value: string) => void),
  auth: { loading: false, user: { uid: "dev" } },
  router: { replace: vi.fn() },
  editorHarnessChange: vi.fn()
}));

vi.mock("next/navigation", () => ({ useParams: () => ({ projectId: "project-1" }), useRouter: () => state.router }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/dynamic", () => ({
  default: () => function FakeEditor(props: { value: string; onChange: (value: string) => void; onMount: (instance: typeof state.editor) => void }) {
    state.changeEditor = props.onChange;
    useEffect(() => props.onMount(state.editor), []);
    return <><textarea aria-label="Code editor" value={props.value} readOnly /><button aria-label="Change code" onClick={() => { state.editorHarnessChange(); props.onChange("\\section{Edited source}"); }}>edit</button></>;
  }
}));
vi.mock("@/components/auth-provider", () => ({ useAuth: () => state.auth }));
vi.mock("@/lib/api", () => {
  class MockApiError extends Error {
    constructor(message: string, readonly status: number, readonly payload?: unknown) { super(message); }
  }
  return { ...state.api, ApiError: MockApiError };
});

const project = {
  id: "project-1", ownerId: "user-1", name: "API project", rootFile: "main.tex",
  latestSuccessfulBuildId: null, createdAt: "2026-09-14T00:00:00Z", updatedAt: "2026-09-14T00:00:00Z"
};
const main = {
  id: "file-1", path: "main.tex", parentPath: "", name: "main.tex", kind: "FILE" as const,
  mimeType: "application/x-tex", currentVersion: 1, createdAt: project.createdAt, updatedAt: project.updatedAt
};

function build(status: "QUEUED" | "SUCCEEDED" | "FAILED") {
  return {
    id: `build-${status}`, projectId: project.id, revisionId: "revision-12345678", rootFile: "main.tex", status,
    exitCode: status === "FAILED" ? 1 : status === "SUCCEEDED" ? 0 : null, durationMs: null,
    errorSummary: status === "FAILED" ? { message: "Undefined control sequence", errors: [{ file: "main.tex", line: 7, message: "Undefined control sequence" }] } : null,
    createdAt: project.createdAt, finishedAt: status === "QUEUED" ? null : project.updatedAt
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.api.getProject.mockResolvedValue(project);
  state.api.getFiles.mockResolvedValue([main]);
  state.api.getFileContent.mockResolvedValue({ path: "main.tex", version: 1, mimeType: main.mimeType, binary: false, content: "\\section{Introduction}" });
  state.api.getLatestBuild.mockResolvedValue(null);
  state.api.getOutline.mockResolvedValue([{ type: "section", title: "Introduction", file: "main.tex", line: 1, column: 1, offset: 0, sourceRange: { start: 0, end: 22 } }]);
  state.api.saveFile.mockResolvedValue({ version: 2, checksum: "a".repeat(64), deduplicated: false });
  state.api.createBuild.mockResolvedValue(build("QUEUED"));
  state.api.getBuild.mockResolvedValue(build("QUEUED"));
  state.api.getBuildPdf.mockResolvedValue(new Blob(["%PDF-test"], { type: "application/pdf" }));
  state.api.getBuildLog.mockResolvedValue("main.tex:7: Undefined control sequence");
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("canonical project workspace", () => {
  it("loads the API file tree, opens content, and navigates from the outline", async () => {
    render(<WorkspacePage />);
    expect(await screen.findByRole("treeitem", { name: /main\.tex/i })).toBeInTheDocument();
    expect(await screen.findByDisplayValue("\\section{Introduction}")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /Introduction/ }));
    await waitFor(() => expect(state.editor.setPosition).toHaveBeenCalledWith({ lineNumber: 1, column: 1 }));
    expect(state.api.getFiles).toHaveBeenCalledWith("project-1");
  });

  it("autosaves first, reports saved state, then switches Compile to PDF Preview", async () => {
    render(<WorkspacePage />);
    const editor = await screen.findByLabelText("Code editor");
    fireEvent.click(screen.getByRole("button", { name: "Change code" }));
    expect(state.editorHarnessChange).toHaveBeenCalled();
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Saved · v2/)).toBeInTheDocument(), { timeout: 2000 });
    fireEvent.click(screen.getByRole("button", { name: /Compile/ }));
    await waitFor(() => expect(state.api.createBuild).toHaveBeenCalledWith("project-1"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Build queued" })).toBeInTheDocument());
    expect(state.api.saveFile.mock.invocationCallOrder[0]).toBeLessThan(state.api.createBuild.mock.invocationCallOrder[0]);
  });

  it("keeps unsaved text and shows a version conflict without compiling", async () => {
    state.api.saveFile.mockRejectedValueOnce(new ApiError("The file changed", 409));
    render(<WorkspacePage />);
    const editor = await screen.findByLabelText("Code editor");
    fireEvent.click(screen.getByRole("button", { name: "Change code" }));
    expect(await screen.findByText("Version conflict", {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByDisplayValue("\\section{Edited source}")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Compile/ }));
    await waitFor(() => expect(state.api.createBuild).not.toHaveBeenCalled());
  });

  it("keeps dirty source visible and reports a bounded network save failure", async () => {
    state.api.saveFile.mockRejectedValue(new Error("Storage temporarily unavailable"));
    render(<WorkspacePage />);
    await screen.findByLabelText("Code editor");
    fireEvent.click(screen.getByRole("button", { name: "Change code" }));
    expect(await screen.findByText("Save failed", {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByDisplayValue("\\section{Edited source}")).toBeInTheDocument();
    await waitFor(() => expect(state.api.saveFile).toHaveBeenCalledTimes(3), { timeout: 6000 });
  }, 8000);

  it("shows a real failed-build log, jumps to its line, and preserves chat state across tabs", async () => {
    state.api.getLatestBuild.mockResolvedValue(build("FAILED"));
    render(<WorkspacePage />);
    await screen.findByLabelText("Code editor");
    fireEvent.change(screen.getByPlaceholderText("Ask the future document agent…"), { target: { value: "Fix this error" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.click(screen.getByRole("button", { name: /PDF Preview/ }));
    expect(await screen.findByText("main.tex:7: Undefined control sequence", { selector: "pre" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /main\.tex:7/ }));
    await waitFor(() => expect(state.editor.setPosition).toHaveBeenCalledWith({ lineNumber: 7, column: 1 }));
    fireEvent.click(screen.getByRole("button", { name: /AI Chat/ }));
    expect(screen.getByText("Fix this error")).toBeInTheDocument();
  });

  it("renders the PDF object for the exact successful build", async () => {
    state.api.getLatestBuild.mockResolvedValue(build("SUCCEEDED"));
    render(<WorkspacePage />);
    await screen.findByLabelText("Code editor");
    fireEvent.click(screen.getByRole("button", { name: /PDF Preview/ }));
    expect(await screen.findByLabelText("Compiled PDF")).toHaveAttribute("data", "blob:compiled-pdf");
    expect(state.api.getBuildPdf).toHaveBeenCalledWith("project-1", "build-SUCCEEDED");
  });
});
