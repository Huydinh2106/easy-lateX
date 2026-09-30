import { describe, expect, it } from "vitest";
import { buildDockerRunArguments, resolveDockerExecutable } from "../src/main/services/compiler/DockerLatexCompiler";
import type { CompilerRequest } from "../src/main/services/compiler/CompilerBackend";

const request: CompilerRequest = {
  workspacePath: "/work/paper",
  outputDirectory: "/work/paper/.easy-latex/build",
  rootDocument: "main.tex",
  engine: "pdflatex",
  onOutput: () => undefined
};

describe("DockerLatexCompiler", () => {
  it("builds a restricted Docker invocation with separate source and output mounts", () => {
    const args = buildDockerRunArguments(request, {
      image: "easy-latex-compiler:test",
      containerName: "easy-latex-build-test",
      user: "501:20"
    });

    expect(args).toEqual(expect.arrayContaining([
      "--network", "none",
      "--read-only",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "--user", "501:20",
      "type=bind,source=/work/paper,target=/workspace,readonly",
      "type=bind,source=/work/paper/.easy-latex/build,target=/output",
      "easy-latex-compiler:test",
      "-pdf",
      "-no-shell-escape",
      "main.tex"
    ]));
  });

  it.each([
    ["pdflatex", "-pdf"],
    ["xelatex", "-xelatex"],
    ["lualatex", "-lualatex"]
  ] as const)("maps %s to %s", (engine, flag) => {
    const args = buildDockerRunArguments({ ...request, engine }, {
      image: "image",
      containerName: "container"
    });
    expect(args).toContain(flag);
  });

  it("falls back to PATH on an unsupported platform", () => {
    expect(resolveDockerExecutable("freebsd", () => false)).toBe("docker");
  });
});
