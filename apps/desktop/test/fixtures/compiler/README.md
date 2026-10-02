# Compiler integration fixtures

`npm run compiler:test` compiles every valid project through the same locked-down
Docker invocation used by the desktop backend. It never calls a TeX executable
from the host. The intentionally broken fixture must fail and retain the
missing-package root cause in its log. The final check starts a non-terminating
compile and proves that `docker stop` cancels it.

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
