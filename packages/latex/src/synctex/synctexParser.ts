export interface SyncTeXRecord {
  tag: number;
  line: number;
  column?: number | undefined;
  page: number;
  x: number;      // pt from left (origin top-left)
  y: number;      // pt from top (origin top-left)
  width: number;  // pt
  height: number; // pt
  type: string;
}

export interface SyncTeXData {
  version: number;
  files: Map<number, string>;
  records: SyncTeXRecord[];
  magnification: number;
  unit: number;
  xOffset: number;
  yOffset: number;
}

export interface SyncTeXForwardResult {
  available: boolean;
  reason?: string | undefined;
  page?: number | undefined;
  x?: number | undefined;
  y?: number | undefined;
}

export interface SyncTeXInverseResult {
  available: boolean;
  reason?: string | undefined;
  file?: string | undefined;
  line?: number | undefined;
  column?: number | undefined;
}

const SP_PER_PT = 65781.76;

/**
 * Parses raw uncompressed SyncTeX file content (from .synctex or gunzipped .synctex.gz).
 */
export function parseSyncTeX(content: string): SyncTeXData {
  const lines = content.split(/\r?\n/);
  const files = new Map<number, string>();
  const records: SyncTeXRecord[] = [];
  let version = 1;
  let magnification = 1000;
  let unit = 1;
  let xOffset = 0;
  let yOffset = 0;
  let inContent = false;
  let currentPage: number | null = null;
  let lastH = 0;
  let lastV = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("Input:")) {
      const match = trimmed.match(/^Input:(\d+):(.*)$/);
      if (match && match[1] && match[2] !== undefined) {
        files.set(parseInt(match[1], 10), match[2].trim());
      }
      continue;
    }

    if (!inContent) {
      if (trimmed.startsWith("SyncTeX Version:")) {
        version = parseInt(trimmed.slice("SyncTeX Version:".length).trim(), 10) || 1;
      } else if (trimmed.startsWith("Magnification:")) {
        magnification = parseInt(trimmed.slice("Magnification:".length).trim(), 10) || 1000;
      } else if (trimmed.startsWith("Unit:")) {
        unit = parseInt(trimmed.slice("Unit:".length).trim(), 10) || 1;
      } else if (trimmed.startsWith("X Offset:")) {
        xOffset = parseInt(trimmed.slice("X Offset:".length).trim(), 10) || 0;
      } else if (trimmed.startsWith("Y Offset:")) {
        yOffset = parseInt(trimmed.slice("Y Offset:".length).trim(), 10) || 0;
      } else if (trimmed === "Content:") {
        inContent = true;
      }
      continue;
    }

    if (trimmed.startsWith("Postamble:")) {
      break;
    }

    if (trimmed.startsWith("{")) {
      const pageNum = parseInt(trimmed.slice(1), 10);
      if (!isNaN(pageNum)) {
        currentPage = pageNum;
        lastH = 0;
        lastV = 0;
      }
      continue;
    }

    if (trimmed.startsWith("}")) {
      currentPage = null;
      continue;
    }

    // Ignore comments, closing delimiters, and records outside a page
    if (currentPage === null || trimmed.startsWith("!") || trimmed === "]" || trimmed === ")") {
      continue;
    }

    // Record line format: <type><tag>,<line>[,<col>]:<h>,<v>[:<W>[,<H>,<D>]]
    const firstChar = trimmed[0] ?? "";
    const rest = trimmed.slice(1);
    const colonIndex = rest.indexOf(":");
    if (colonIndex === -1) continue;

    const linkPart = rest.slice(0, colonIndex);
    const coordsAndSize = rest.slice(colonIndex + 1);

    const linkSegments = linkPart.split(",");
    const tag = parseInt(linkSegments[0] ?? "", 10);
    const sourceLine = parseInt(linkSegments[1] ?? "", 10);
    const sourceCol = linkSegments[2] !== undefined ? parseInt(linkSegments[2], 10) : undefined;

    if (isNaN(tag) || isNaN(sourceLine)) continue;

    const parts = coordsAndSize.split(":");
    const coordParts = (parts[0] ?? "").split(",");
    const hStr = coordParts[0];
    const vStr = coordParts[1];

    let h = lastH;
    if (hStr !== "=" && hStr !== undefined) {
      const parsedH = parseInt(hStr, 10);
      if (!isNaN(parsedH)) {
        h = parsedH;
        lastH = h;
      }
    }

    let v = lastV;
    if (vStr !== "=" && vStr !== undefined) {
      const parsedV = parseInt(vStr, 10);
      if (!isNaN(parsedV)) {
        v = parsedV;
        lastV = v;
      }
    }

    let widthSp = 0;
    let heightSp = 0;
    let depthSp = 0;

    if (parts[1]) {
      const sizeParts = parts[1].split(",");
      widthSp = parseInt(sizeParts[0] ?? "", 10) || 0;
      heightSp = parseInt(sizeParts[1] ?? "", 10) || 0;
      depthSp = parseInt(sizeParts[2] ?? "", 10) || 0;
    }

    const scaleFactor = (unit / SP_PER_PT) * (1000 / magnification);
    const x = (h + xOffset) * scaleFactor;
    // For records without explicit height/depth (such as leaf nodes 'x', 'k', 'g'),
    // v represents the baseline. Give them a realistic font ascent (~8pt) and descent (~3pt)
    // so clicks anywhere on that line hit the record.
    const hasExplicitHeight = heightSp !== 0 || depthSp !== 0;
    const ascentSp = hasExplicitHeight ? heightSp : 8 * SP_PER_PT;
    const descentSp = hasExplicitHeight ? depthSp : 3 * SP_PER_PT;
    const y = (v - ascentSp + yOffset) * scaleFactor;
    const width = Math.max(1, Math.abs(widthSp) * scaleFactor);
    const height = Math.max(1, (Math.abs(ascentSp) + Math.abs(descentSp)) * scaleFactor);

    records.push({
      tag,
      line: sourceLine,
      ...(sourceCol !== undefined && !isNaN(sourceCol) ? { column: sourceCol } : {}),
      page: currentPage,
      x,
      y,
      width,
      height,
      type: firstChar
    });
  }

  return {
    version,
    files,
    records,
    magnification,
    unit,
    xOffset,
    yOffset
  };
}

/**
 * Forward search: find the PDF (page, x, y) corresponding to a source file line.
 */
export function forwardSearch(
  data: SyncTeXData,
  file: string,
  line: number,
  column?: number
): SyncTeXForwardResult {
  const normalizedFile = file.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "").replace(/\/\.\//g, "/").toLowerCase();
  let matchedTag: number | null = null;

  // 1. Exact match
  for (const [tag, filePath] of data.files.entries()) {
    const normalizedPath = filePath.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "").replace(/\/\.\//g, "/").toLowerCase();
    if (normalizedPath === normalizedFile) {
      matchedTag = tag;
      break;
    }
  }

  // 2. Suffix match
  if (matchedTag === null) {
    for (const [tag, filePath] of data.files.entries()) {
      const normalizedPath = filePath.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "").replace(/\/\.\//g, "/").toLowerCase();
      if (normalizedPath.endsWith(`/${normalizedFile}`) || normalizedFile.endsWith(`/${normalizedPath}`)) {
        matchedTag = tag;
        break;
      }
    }
  }

  // 3. Basename match
  if (matchedTag === null) {
    const targetBase = normalizedFile.split("/").pop();
    for (const [tag, filePath] of data.files.entries()) {
      const normalizedPath = filePath.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "").replace(/\/\.\//g, "/").toLowerCase();
      if (targetBase && normalizedPath.split("/").pop() === targetBase) {
        matchedTag = tag;
        break;
      }
    }
  }

  if (matchedTag === null) {
    return { available: false, reason: `File "${file}" not found in SyncTeX data` };
  }

  const fileRecords = data.records.filter((r) => r.tag === matchedTag);
  if (fileRecords.length === 0) {
    return { available: false, reason: `No typeset output found for "${file}"` };
  }

  let candidates = fileRecords.filter((r) => r.line === line);

  if (candidates.length === 0) {
    let minDiff = Infinity;
    for (const r of fileRecords) {
      const diff = Math.abs(r.line - line);
      if (diff < minDiff) {
        minDiff = diff;
      }
    }
    if (minDiff <= 50) {
      candidates = fileRecords.filter((r) => Math.abs(r.line - line) === minDiff);
    }
  }

  const bestCandidate = candidates[0];
  if (!bestCandidate) {
    return { available: false, reason: `No position found near line ${line}` };
  }

  let best = bestCandidate;
  if (column !== undefined) {
    let bestColDiff = Infinity;
    for (const c of candidates) {
      const colDiff = Math.abs((c.column ?? 1) - column);
      if (colDiff < bestColDiff) {
        bestColDiff = colDiff;
        best = c;
      }
    }
  } else {
    // Prefer line-level horizontal boxes '(' or void hboxes 'h', then leaf records, avoiding container vboxes '['
    const hbox = candidates.find((c) => c.type === "(" || c.type === "h");
    const leaf = candidates.find((c) => c.type !== "[" && c.type !== "(");
    if (hbox) best = hbox;
    else if (leaf) best = leaf;
  }

  return {
    available: true,
    page: best.page,
    x: Math.round(best.x),
    y: Math.round(best.y)
  };
}

/**
 * Inverse search: find the source (file, line, column) corresponding to a point clicked on a PDF page.
 */
export function inverseSearch(
  data: SyncTeXData,
  page: number,
  x: number,
  y: number,
  workspaceRoot?: string
): SyncTeXInverseResult {
  const pageRecords = data.records.filter((r) => r.page === page);
  if (pageRecords.length === 0) {
    return { available: false, reason: `No SyncTeX records for page ${page}` };
  }

  // Prioritize leaf records (glyphs, kerns, glue, rules, math) over container boxes ('[' and '(')
  // because container boxes are frequently attributed to outer \input macros or enclosing pages,
  // whereas leaf records pinpoint the actual source file and line.
  const leafRecords = pageRecords.filter((r) => r.type !== "[" && r.type !== "(");

  let bestRecord: SyncTeXRecord | null = null;
  let minDistance = Infinity;
  let minArea = Infinity;

  const recordsToSearch = leafRecords.length > 0 ? leafRecords : pageRecords;

  for (const r of recordsToSearch) {
    const dx = Math.max(0, r.x - x, x - (r.x + r.width));
    const dy = Math.max(0, r.y - y, y - (r.y + r.height));
    const distSq = dx * dx + 4 * dy * dy;
    const area = r.width * r.height;

    if (distSq < minDistance) {
      minDistance = distSq;
      minArea = area;
      bestRecord = r;
    } else if (distSq === minDistance && area < minArea) {
      minArea = area;
      bestRecord = r;
    }
  }

  // If no leaf record was close enough (e.g. clicked in wide empty space/margin > 50pt away),
  // fallback to container boxes
  if (leafRecords.length > 0 && (!bestRecord || minDistance > 2500)) {
    let containerBest: SyncTeXRecord | null = null;
    let containerMinDist = Infinity;
    let containerMinArea = Infinity;

    for (const r of pageRecords) {
      const dx = Math.max(0, r.x - x, x - (r.x + r.width));
      const dy = Math.max(0, r.y - y, y - (r.y + r.height));
      const distSq = dx * dx + 4 * dy * dy;
      const area = r.width * r.height;

      if (distSq < containerMinDist) {
        containerMinDist = distSq;
        containerMinArea = area;
        containerBest = r;
      } else if (distSq === containerMinDist && area < containerMinArea) {
        containerMinArea = area;
        containerBest = r;
      }
    }

    if (containerBest && containerMinDist < minDistance) {
      bestRecord = containerBest;
    }
  }

  if (!bestRecord) {
    return { available: false, reason: `No match found on page ${page}` };
  }

  const rawPath = data.files.get(bestRecord.tag);
  if (!rawPath) {
    return { available: false, reason: "Source file mapping missing" };
  }

  let resolvedFile = rawPath.replace(/\\/g, "/");
  if (resolvedFile.startsWith("/workspace/")) {
    resolvedFile = resolvedFile.slice("/workspace/".length);
  } else if (workspaceRoot && resolvedFile.startsWith(workspaceRoot.replace(/\\/g, "/"))) {
    resolvedFile = resolvedFile.slice(workspaceRoot.length);
  }
  resolvedFile = resolvedFile.replace(/^(\.\/|\/)+/, "").replace(/\/\.\//g, "/");

  return {
    available: true,
    file: resolvedFile,
    line: bestRecord.line,
    column: bestRecord.column ?? 1
  };
}
