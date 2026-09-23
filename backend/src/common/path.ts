import path from "node:path";
import { BadRequestException } from "@nestjs/common";

export const MAX_PATH_LENGTH = 1024;

export function normalizeProjectPath(raw: string): string {
  if (typeof raw !== "string" || raw.includes("\0")) throw new BadRequestException("Invalid project path");
  const unicode = raw.normalize("NFC").trim();
  if (!unicode || unicode.length > MAX_PATH_LENGTH || unicode.startsWith("/") || unicode.startsWith("\\")) {
    throw new BadRequestException("Path must be a non-empty relative path");
  }
  if (unicode.includes("\\")) throw new BadRequestException("Backslashes are not allowed in project paths");
  const segments = unicode.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.length > 255)) {
    throw new BadRequestException("Path contains an invalid segment");
  }
  const normalized = path.posix.normalize(unicode);
  if (normalized !== unicode || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new BadRequestException("Path escapes the project");
  }
  return normalized;
}

export function parentPath(value: string): string {
  const parent = path.posix.dirname(value);
  return parent === "." ? "" : parent;
}

export function baseName(value: string): string {
  return path.posix.basename(value);
}

export function isDescendant(candidate: string, directory: string): boolean {
  return candidate.startsWith(`${directory}/`);
}

export function textEditable(pathValue: string): boolean {
  return [".tex", ".bib", ".sty", ".cls", ".md", ".txt"].includes(path.posix.extname(pathValue).toLowerCase());
}
