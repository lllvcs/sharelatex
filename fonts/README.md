# Chinese fonts

The font files in this directory are vendored from
[Haixing-Hu/latex-chinese-fonts](https://github.com/Haixing-Hu/latex-chinese-fonts)
so that the image can be built without downloading them:

- upstream commit: `287399335ec1beb72062ce67c36eaa8bec35f386` (2018-08-08)
- `chinese/` and `english/` are copied verbatim, `UPSTREAM-README.md` and
  `LICENSE` are the files of the upstream repository
- `zhwinfonts-simfonts.map` is **not** from upstream, it is generated from the
  map lines of the TeX Live `zhmetrics` package, see below

## How the Dockerfile installs them

1. Every `*.ttf`/`*.ttc` is copied into
   `/usr/local/texlive/texmf-local/fonts/truetype` and every `*.otf` into
   `.../opentype`, where kpathsea - and therefore pdfTeX, XeTeX and LuaTeX -
   finds them by file name, and additionally into `/usr/share/fonts`, where
   fontconfig picks them up under the family names stored inside the files.
   (fontconfig does not look into the TeX Live trees, which is why the
   `Dockerfile` registers `texmf-dist/fonts` with fontconfig for the fonts that
   TeX Live itself ships.)
2. Six of them are installed a second time under the Windows file names that
   the `zhmetrics` map expects:

   | vendored file | installed as |
   | --- | --- |
   | `chinese/宋体/SimSun.ttc` | `simsun.ttc` |
   | `chinese/黑体/SimHei.ttf` | `simhei.ttf` |
   | `chinese/楷体/KaiTi.ttf` | `simkai.ttf` |
   | `chinese/仿宋体/FangSong.ttf` | `simfang.ttf` |
   | `chinese/隶书/LiSu.ttf` | `simli.ttf` |
   | `chinese/幼圆/YouYuan.ttf` | `simyou.ttf` |

   The TeX Live `zhmetrics` package ships font *metrics* only (`uniyou20`,
   `unisong5b`, `gbkyou20`, ...) - the glyphs are the Windows fonts these
   metrics were generated from. The map lines that connect the two live in
   `zhwinfonts.tex` inside the package and normally have to be loaded by the
   document itself (`\input zhwinfonts`). `zhwinfonts-simfonts.map` holds those
   lines (the pdfTeX branch of the file, with the leading `=`, which is a
   `\pdfmapline` modifier and not map file syntax, removed); the `Dockerfile`
   installs it into `texmf-local/fonts/map/pdftex/local` and enables it with
   `updmap-sys --enable Map=zhwinfonts-simfonts.map`, so that `uniyou20`,
   `unisong5b`, ... work in pdfLaTeX documents out of the box.
3. `mktexlsr` and `fc-cache` run afterwards, and the build verifies with
   `kpsewhich`/`fc-match` that the fonts can really be resolved.

To regenerate the map after a `zhmetrics` update, take the `\pdfmapline` lines
of the pdfTeX branch of `texmf-dist/tex/generic/zhmetrics/zhwinfonts.tex` and
strip the leading `=`.

## License

The upstream repository is MIT licensed (see `LICENSE`), but that covers the
collection and its documentation, not necessarily the fonts themselves. Many
of the fonts were taken from proprietary sources - for example the Microsoft
fonts (`SimSun.ttc`, `SimHei.ttf`, `KaiTi.ttf`, `FangSong.ttf`), the Apple
fonts (`STSong.ttf`, `STHeiti.ttf`, `STKaiti.ttf`, `STFangsong.ttf`) and the
Adobe fonts (`AdobeSongStd.otf`, `AdobeHeitiStd.otf`, `AdobeKaitiStd.otf`,
`AdobeFangsongStd.otf`) are not freely redistributable. The upstream project
states that the fonts are collected for personal study and research only;
redistributing them (for example through a public image or repository) can
infringe their licenses.

If you cannot accept that, remove the affected font files from this directory;
the `Dockerfile` installs whatever is present here. Removing the Microsoft
fonts also disables the `zhmetrics` families (`uniyou20` and friends), because
those are the files their map points at.

## Updating

```sh
git clone --depth 1 https://github.com/Haixing-Hu/latex-chinese-fonts.git /tmp/latex-chinese-fonts
rm -rf fonts/chinese fonts/english
cp -r /tmp/latex-chinese-fonts/chinese /tmp/latex-chinese-fonts/english fonts/
cp /tmp/latex-chinese-fonts/LICENSE fonts/
cp /tmp/latex-chinese-fonts/README.md fonts/UPSTREAM-README.md
```

The commit of the last update should be recorded above.
