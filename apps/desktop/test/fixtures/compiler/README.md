# Compiler integration fixtures

`npm run compiler:test` tests `DockerLatexCompiler` itself with every valid
project. It never calls a TeX executable from the host. Tests also verify
missing-package and BibTeX diagnostics, retry after a cached failed build,
preservation of successful PDF bytes after a failed rebuild, and cancellation
through the app backend. These Docker tests are opt-in; `npm test` runs unit tests.

| Fixture | Engine | Coverage |
| --- | --- | --- |
| `pdflatex-basic` | pdfLaTeX | Basic PDF and SyncTeX |
| `pdflatex-vietnamese` | pdfLaTeX | Vietnamese and `vietnam.sty` |
| `xelatex-unicode` | XeLaTeX | Unicode and OpenType fonts |
| `lualatex-unicode` | LuaLaTeX | Unicode and OpenType fonts |
| `bibtex` | pdfLaTeX | BibTeX workflow |
| `biber` | pdfLaTeX | `biblatex`/Biber workflow |
| `packages` | pdfLaTeX | TikZ, `booktabs`, `longtable`, `hyperref`, `listings` |
| `multifile` | pdfLaTeX | `\input` and `\include` |
| `broken` | pdfLaTeX | Missing-package diagnostics (expected failure) |
| `cancel` | pdfLaTeX | Cancellation of an active container |
