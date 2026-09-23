import { BadRequestException } from "@nestjs/common";
import { isDescendant, normalizeProjectPath, parentPath } from "../src/common/path";

describe("project path security", () => {
  it.each(["../secret", "/etc/passwd", "folder//file.tex", "folder/../file.tex", "a\\b.tex", "\0evil"])("rejects %s", (value) => {
    expect(() => normalizeProjectPath(value)).toThrow(BadRequestException);
  });

  it("normalizes unicode to prevent equivalent-name collisions", () => {
    expect(normalizeProjectPath("cafe\u0301.tex")).toBe(normalizeProjectPath("caf\u00e9.tex"));
  });

  it("handles hierarchy without prefix confusion", () => {
    expect(parentPath("chapters/intro.tex")).toBe("chapters");
    expect(isDescendant("chapters/a.tex", "chapters")).toBe(true);
    expect(isDescendant("chapters-old/a.tex", "chapters")).toBe(false);
  });
});
