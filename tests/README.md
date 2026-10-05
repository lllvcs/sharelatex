# Minimal Working Examples and verification

This folder holds the Minimal Working Examples (MWEs) for the features added on
top of the base image, and the scripts that check the overlay inside a built
image.

## Compiling the examples

The LaTeX examples are compiled directly using `latexmk` inside the built image
(`compile.sh`), which verifies that the TeX Live packages, the fonts and the
latexmk configuration are usable. `latexmkrc` selects LuaLaTeX for all examples;
an example directory can add its own `latexmkrc` next to its source file to
override that (it is read after the shared one).

## Node tests

Run by `verify-overlay.sh` inside the built image, and directly during
development:

| Test | What it covers |
| --- | --- |
| `oidc-*.test.mjs` | the OIDC settings: discovery, the identity token, the redirect URI, provider defaults |
| `overlay-settings.test.mjs` | `overlay/etc/overleaf/overlay-modules.cjs`: which modules the environment switches on, the upload limit, the compile-container user |
| `sandboxed-compiles-images.test.mjs` | the TeX Live image list of the sandboxed compiles |
| `frontend-rebuild.test.mjs` | `overlay/services/web/config/settings.frontend.cjs`: the registry key the core frontend asks for, a path that resolves, and the marker the bundle check greps for |

## Example documents

An example directory may put its own `latexmkrc` next to its source to change
settings such as the engine. `compile.sh` concatenates it *after* the shared
`/tests/latexmkrc` into one file and passes that with `-r`, because latexmk reads
`./latexmkrc` before any `-r` file: passing the shared file with `-r` would make
it override the example, which is how the examples that ask for XeLaTeX were
compiled with LuaLaTeX for several rounds.

| Example | What it verifies |
| --- | --- |
| `chinese-fonts` | the vendored Chinese fonts are registered with fontconfig (`SimSun`, `SimHei`, `FangSong`) |
| `fonts-by-name` | fonts selected by family name, compiled with **XeLaTeX** because that is the engine that goes through fontconfig (`FandolSong`, `WenQuanYi Zen Hei`, ...) |
| `fonts-extra` | the families this image installs from Overleaf's supported-font list resolve by name (`Arimo`, `Nimbus Roman`, `Cantarell`, `Amiri`, `Charis SIL`, `Garuda`, `Lohit Devanagari`, `Tibetan Machine Uni`, ...) - also XeLaTeX |
| `fonts-zhmetrics` | the `zhmetrics` metrics have their glyph files and map (`uniyou20`, `unisong5b`, ...), compiled with pdfLaTeX |
| `knitr` | `.Rnw` sources are knitted by R and then compiled, i.e. `texlive/LatexMk`, R and the `knitr` package work together |
| `gregorio`, `lilypond`, `minted`, `svg_(inkscape)`, `shell-escape_subfolder_(tikzext)` | the tools installed on top of the base image work |

`compile.sh` compiles every `*.tex`, `*.Rnw` and `*.Rtex` below `/tests` - the
extensions Overleaf accepts as a root document and that latexmk has to build
first.

## Verifying the overlay

`verify-overlay.sh` checks everything the overlay puts into the image:

- the patched and added modules pass `node --check` and **load** (importing
  `AuthenticationController.mjs`, `modules/track-changes/index.mjs` and
  `services/clsi/app/js/DockerRunner.js` resolves their whole import graph, which
  is what fails when a package is missing under Yarn PnP);
- the track-changes module really flips the flag the core reads, registers its
  routes, and `Features.hasFeature('track-changes')` becomes true;
- the sandboxed-compiles module derives `imageRoot` / `allowedImageNames` /
  `currentImageName` from the environment;
- `/etc/overleaf/settings.overlay.cjs` produces the expected
  `moduleImportSequence` when the features are asked for, and **changes nothing**
  when they are not;
- the seccomp profile is valid JSON;
- the TeX Live settings (`shell_escape`, `openout_any`, `openin_any`,
  `OSFONTDIR`) are in `texmf.cnf`, the latexmk configuration provides its custom
  dependencies (knitr, glossaries, nomenclature, asymptote, ...), the LuaTeX font
  database is part of the image, and `run-chktex.sh` produces `output.chktex`;
- the module tests below, and that the views compile.

The module tests run without Overleaf, so they also run locally:

```sh
node --test tests/oidc-*.test.mjs tests/overlay-settings.test.mjs \
            tests/sandboxed-compiles-images.test.mjs
```

`oidc-*.test.mjs` cover the login flow's own logic (the redirect URI, the
discovery document, the identity token, the link step, the email trust
decision), `overlay-settings.test.mjs` covers which modules the environment
switches on and how the settings are assembled, and
`sandboxed-compiles-images.test.mjs` covers the TeX Live image configuration.

`verify-overlay.sh` does not need a database: importing the application does
create Redis and Mongo clients, but the check points them at `127.0.0.1`, ignores
their connection errors (they are expected, the container has no database) and
exits explicitly, since those clients would otherwise keep the process alive.
Every step that can get stuck has a time limit (`timeout`, `COMPILE_TIMEOUT` for
the examples, `timeout-minutes` in the workflow).

Not covered, because only a running instance can show it: the login flow itself,
the linking confirmation page, the change tracking of a real document, a real
sandboxed compile and the provider-side redirect URI allow-list.
