# Minimal Working Examples

This folder holds minimal Working Examples (MWEs) for the features added on top
of the base image.

The LaTeX examples are compiled directly using `latexmk` inside the built
image (`compile.sh`), which verifies that the TeX Live packages and fonts are
usable. `latexmkrc` selects LuaLaTeX for all examples; an example directory can
add its own `latexmkrc` next to its `.tex` file to override that (it is read
after the shared one).

| Example | What it verifies |
| --- | --- |
| `chinese-fonts` | the vendored Chinese fonts are registered with fontconfig (`SimSun`, `SimHei`, `FangSong`) |
| `fonts-by-name` | fonts selected by family name, which needs the fontconfig registration of `texmf-dist/fonts` (`FandolSong`, ...) |
| `fonts-zhmetrics` | the `zhmetrics` metrics have their glyph files and map (`uniyou20`, `unisong5b`, ...), compiled with pdfLaTeX |
| `gregorio`, `lilypond`, `minted`, `svg_(inkscape)`, `shell-escape_subfolder_(tikzext)` | the tools installed on top of the base image work |

`verify-oidc.sh` checks the OIDC overlay that is applied to the Overleaf
application in the image (see `../overlay/README.md`): the patched modules
must load, the redirect URI must be resolved correctly per request
(`oidc-callback-url.test.mjs`), the discovery document must be applied to the
environment (`oidc-well-known.test.mjs`), the user model must carry the
`oidcIdentifier` field and the views must compile.

Neither script needs a database: importing the application does create Redis
and Mongo clients, but the check points them at `127.0.0.1`, ignores their
connection errors (they are expected, the container has no database) and exits
explicitly, since those clients would otherwise keep the process alive. Every
step that can get stuck has a time limit (`timeout`, `COMPILE_TIMEOUT` for the
examples, `timeout-minutes` in the workflow).
