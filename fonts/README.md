# Chinese fonts

The font files in this directory are vendored from
[Haixing-Hu/latex-chinese-fonts](https://github.com/Haixing-Hu/latex-chinese-fonts)
so that the image can be built without downloading them:

- upstream commit: `287399335ec1beb72062ce67c36eaa8bec35f386` (2018-08-08)
- `chinese/` and `english/` are copied verbatim, `UPSTREAM-README.md` and
  `LICENSE` are the files of the upstream repository

The `Dockerfile` installs them into the TeX Live tree
(`/usr/local/texlive/texmf-local/fonts/{truetype,opentype}`) and into
`/usr/share/fonts` (for fontconfig, e.g. LuaLaTeX and inkscape).

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
the `Dockerfile` installs whatever is present here.

## Updating

```sh
git clone --depth 1 https://github.com/Haixing-Hu/latex-chinese-fonts.git /tmp/latex-chinese-fonts
rm -rf fonts/chinese fonts/english
cp -r /tmp/latex-chinese-fonts/chinese /tmp/latex-chinese-fonts/english fonts/
cp /tmp/latex-chinese-fonts/LICENSE fonts/
cp /tmp/latex-chinese-fonts/README.md fonts/UPSTREAM-README.md
```

The commit of the last update should be recorded above.
