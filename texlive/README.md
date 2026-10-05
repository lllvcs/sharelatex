# TeX Live toolchain files

The `sharelatex/sharelatex` image compiles LaTeX **inside the container** by
default. Its clsi service runs `latexmk` without a `-r` option
(`services/clsi/app/js/LatexRunner.js`), so latexmk reads its system
configuration file `/usr/local/share/latexmk/LatexMk` on its own.

In the Overleaf CE image that file is three lines long (`$go_mode = 3;`), while
Overleaf's own compile image ships the full one. Everything that is configured
*only* there is therefore missing in a CE container:

| Without this file | Consequence |
| --- | --- |
| no `add_cus_dep('Rtex'/'Rnw', …)` | `.Rtex`/`.Rnw` projects fail with `Rscript: not found`; R/knitr is not usable even though `validRootDocExtensions` allows those files |
| no `makeglossaries`, no nomenclature, no `feynmf`/`feynmp`, no `asymptote`, no `metapost` | those packages never get their auxiliary programs run |
| no `chktex` block | clsi exports `CHKTEX_OPTIONS` and friends, but nothing consumes them - the *Check* button silently does nothing |
| no `qpdf` post-processing | `output.pdfxref` is never written, which the PDF preview uses |

The files here are that missing configuration, taken from
[ayaka-notes/texlive-full](https://github.com/ayaka-notes/texlive-full)
(`texlive/2026/`, MIT), which in turn carries Overleaf's own file. The
`Dockerfile` installs them:

| File | Installed as | Purpose |
| --- | --- | --- |
| `LatexMk` | `/usr/local/share/latexmk/LatexMk` | latexmk's system RC file: custom dependencies (knitr, glossaries, nomenclature, feynmf, asymptote, metapost), the chktex step, the qpdf/xref post-processing |
| `run-chktex.sh` | `/usr/local/bin/run-chktex.sh` | runs chktex under `ulimit` and writes `output.chktex`, called from `LatexMk` |
| `patchSynctex.R` | `/usr/local/bin/patchSynctex.R` | maps SyncTeX positions back to the `.Rtex`/`.Rnw` source lines of a knitr document; called from `LatexMk` when a `*-concordance.tex` exists |

Notes:

- The **2026** version of `LatexMk` is used. The 2025 one additionally sets
  `$dvipdf` for pstricks transparency, which the maintainer dropped again; the
  not-set default of latexmk is the more conservative choice.
- latexmk reads `-r` files **after** the system RC file, so a project-local
  `latexmkrc` (and the shared `../tests/latexmkrc` used by the MWEs) still wins.
  `LatexMk` itself sets no `$pdf_mode` and no engine variable, so it cannot
  override a project's choice of engine.
- `LatexMk` degrades gracefully where a helper is missing: the qpdf block
  returns early when `qpdf` is not executable, and the chktex block only runs
  when `CHKTEX_OPTIONS` is set. `patchSynctex.R` needs R with the `stringr`
  package, which the `Dockerfile` installs.
- The files are LF only; `.gitattributes` enforces that, and a `CRLF` in
  `run-chktex.sh` would break its shebang inside the container.
