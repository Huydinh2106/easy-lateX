import { parseCompileErrors } from "../src/builds/log-parser";

describe("compile log parser", () => {
  it("extracts file, line and message without exposing stack traces", () => {
    expect(parseCompileErrors("chapters/introduction.tex:42: Undefined control sequence\n! Emergency stop." )).toEqual([
      { file: "chapters/introduction.tex", line: 42, message: "Undefined control sequence" },
      { file: null, line: null, message: "Emergency stop." }
    ]);
  });
});
