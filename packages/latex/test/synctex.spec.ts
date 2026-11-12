import { describe, expect, it } from "vitest";
import { forwardSearch, inverseSearch, parseSyncTeX } from "../src/synctex/synctexParser";

const sampleSyncTeX = `SyncTeX Version:1
Input:1:/workspace/main.tex
Input:2:/workspace/chapters/intro.tex
Output:pdf
Magnification:1000
Unit:1
X Offset:0
Y Offset:0
Content:
!100
{1
[1,1:6578176,6578176:26312704,65781760,0
(1,5:6578176,13156352:13156352,657817,131563
h1,5:6578176,13156352:6578176,657817,131563
k1,5:13156352,=:65781
g1,5:13222133,=
)
(1,10:6578176,19734528:19734528,657817,131563
h1,10:6578176,19734528:13156352,657817,131563
)
]
}1
{2
(2,15:6578176,13156352:13156352,657817,131563
h2,15:6578176,13156352:6578176,657817,131563
)
}2
Postamble:
Count:2
!200
Post Scriptum:
`;

describe("SyncTeX parser", () => {
  it("parses preamble, inputs, and sheet records", () => {
    const data = parseSyncTeX(sampleSyncTeX);
    expect(data.version).toBe(1);
    expect(data.files.get(1)).toBe("/workspace/main.tex");
    expect(data.files.get(2)).toBe("/workspace/chapters/intro.tex");
    expect(data.records.length).toBeGreaterThan(0);
    expect(data.records.some((r) => r.page === 1 && r.line === 5)).toBe(true);
    expect(data.records.some((r) => r.page === 2 && r.line === 15)).toBe(true);
  });

  it("parses Input: records that appear dynamically inside the Content: section", () => {
    const contentWithDynamicInput = `SyncTeX Version:1
Input:1:/workspace/main.tex
Output:pdf
Magnification:1000
Unit:1
X Offset:0
Y Offset:0
Content:
{1
h1,1:6578176,6578176:6578176,657817,0
}1
Input:2:/workspace/./chapters/c1/intro.tex
{2
h2,10:6578176,6578176:6578176,657817,0
}2
Postamble:
Count:2
Post Scriptum:
`;
    const data = parseSyncTeX(contentWithDynamicInput);
    expect(data.files.get(2)).toBe("/workspace/./chapters/c1/intro.tex");
    const inv = inverseSearch(data, 2, 100, 100);
    expect(inv.available).toBe(true);
    expect(inv.file).toBe("chapters/c1/intro.tex");
    expect(inv.line).toBe(10);
  });

  describe("forward search (TeX -> PDF)", () => {
    it("locates line 5 in main.tex on page 1", () => {
      const data = parseSyncTeX(sampleSyncTeX);
      const result = forwardSearch(data, "main.tex", 5);
      expect(result.available).toBe(true);
      expect(result.page).toBe(1);
      expect(result.x).toBe(100);
      expect(result.y).toBe(190);
    });

    it("locates line 15 in chapters/intro.tex on page 2", () => {
      const data = parseSyncTeX(sampleSyncTeX);
      const result = forwardSearch(data, "chapters/intro.tex", 15);
      expect(result.available).toBe(true);
      expect(result.page).toBe(2);
      expect(result.x).toBe(100);
      expect(result.y).toBe(190);
    });

    it("falls back to closest line when exact line is not typeset", () => {
      const data = parseSyncTeX(sampleSyncTeX);
      // Line 6 does not exist; line 5 is the closest
      const result = forwardSearch(data, "main.tex", 6);
      expect(result.available).toBe(true);
      expect(result.page).toBe(1);
      expect(result.y).toBe(190);
    });

    it("returns reason when file is not in synctex data", () => {
      const data = parseSyncTeX(sampleSyncTeX);
      const result = forwardSearch(data, "nonexistent.tex", 1);
      expect(result.available).toBe(false);
      expect(result.reason).toContain("not found");
    });
  });

  describe("inverse search (PDF -> TeX)", () => {
    it("maps click on page 1 to line 5 of main.tex", () => {
      const data = parseSyncTeX(sampleSyncTeX);
      const result = inverseSearch(data, 1, 120, 195);
      expect(result.available).toBe(true);
      expect(result.file).toBe("main.tex");
      expect(result.line).toBe(5);
    });

    it("maps click on page 1 near line 10 to line 10 of main.tex", () => {
      const data = parseSyncTeX(sampleSyncTeX);
      const result = inverseSearch(data, 1, 150, 295);
      expect(result.available).toBe(true);
      expect(result.file).toBe("main.tex");
      expect(result.line).toBe(10);
    });

    it("maps click on page 2 to chapters/intro.tex", () => {
      const data = parseSyncTeX(sampleSyncTeX);
      const result = inverseSearch(data, 2, 120, 195);
      expect(result.available).toBe(true);
      expect(result.file).toBe("chapters/intro.tex");
      expect(result.line).toBe(15);
    });

    it("handles page with no records gracefully", () => {
      const data = parseSyncTeX(sampleSyncTeX);
      const result = inverseSearch(data, 99, 100, 100);
      expect(result.available).toBe(false);
      expect(result.reason).toContain("page 99");
    });

    it("prefers leaf text records inside an included file over outer container boxes from parent file", () => {
      // Container box [1,50 covers whole page from main.tex (\input{chapters/section.tex})
      // Inside it are leaf records k2,23 and x2,23 from chapters/section.tex
      const nestedSyncTeX = `SyncTeX Version:1
Input:1:/workspace/thesis.tex
Input:2:/workspace/chapters/c1/c1_introduction.tex
Output:pdf
Magnification:1000
Unit:1
X Offset:0
Y Offset:0
Content:
{10
[1,157:4736286,51753031:30692631,47016745,0
(1,157:5594039,17451754:29834878,967103,165620
k2,23:7415424,17451754:315822
x2,23:9222454,17451754
)
]
}10
Postamble:
Count:10
!100
Post Scriptum:
`;
      const data = parseSyncTeX(nestedSyncTeX);
      // Click at the text on line 23 (x ~ 140, y ~ 260)
      const res = inverseSearch(data, 10, 140, 260);
      expect(res.available).toBe(true);
      expect(res.file).toBe("chapters/c1/c1_introduction.tex");
      expect(res.line).toBe(23);
    });

    it("avoids false matches when two files share the same basename", () => {
      const multiFileSyncTeX = `SyncTeX Version:1
Input:1:/workspace/thesis.tex
Input:2:/workspace/chapters/c1/intro.tex
Input:3:/workspace/chapters/c2/intro.tex
Output:pdf
Magnification:1000
Unit:1
X Offset:0
Y Offset:0
Content:
{1
h2,5:6578176,13156352:6578176,657817,131563
}1
{2
h3,12:6578176,13156352:6578176,657817,131563
}2
Postamble:
Count:2
!100
Post Scriptum:
`;
      const data = parseSyncTeX(multiFileSyncTeX);
      const fwd1 = forwardSearch(data, "chapters/c1/intro.tex", 5);
      expect(fwd1.available).toBe(true);
      expect(fwd1.page).toBe(1);

      const fwd2 = forwardSearch(data, "chapters/c2/intro.tex", 12);
      expect(fwd2.available).toBe(true);
      expect(fwd2.page).toBe(2);
    });
  });
});
