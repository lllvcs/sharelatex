# syntax=docker/dockerfile:1

FROM sharelatex/sharelatex:6.3.0

SHELL ["/bin/bash", "-cx"]

# update tlmgr itself
#
# `update-tlmgr-latest.sh` alone does not do it: with `-- --upgrade` it refuses
# when the TeX Live year already matches ("using --upgrade doesn't make sense"),
# and without it, it leaves the installed `texlive.infra` where it was.
#
# That matters because `tlmgr` refuses to *install* anything while the repository
# has a newer `texlive.infra` than the installed one - "tlmgr itself needs to be
# updated" - and CTAN publishes several revisions of it every day. The base image
# was built months ago, so `tlmgr install` fails in it, which means this image
# could only be built on the day the base image was built. `tlmgr update --self`
# is what the error asks for, and it is a no-op when there is nothing to do.
RUN wget "https://mirror.ctan.org/systems/texlive/tlnet/update-tlmgr-latest.sh" \
    && sh update-tlmgr-latest.sh \
    && tlmgr update --self \
    && tlmgr --version

# enable tlmgr to install ctex
RUN tlmgr update texlive-scripts 

# update packages
RUN tlmgr update --all

# install all the packages
#
# `update --self` again first: `update --all` above downloads for minutes, which
# is long enough for CTAN to publish a new `texlive.infra` and for this install
# to be refused. The same applies to every install in this file.
RUN tlmgr update --self && tlmgr install scheme-full

# recreate symlinks
RUN tlmgr path add

# The packages Overleaf's own compile image installs on top of the scheme, as a
# safety net: if `tlmgr install scheme-full` ever installs only partially, these
# are the ones every compile needs (the package list is the one Overleaf's
# server-ce/Dockerfile-base uses). Installing an already present package is a
# no-op, so this only ever adds something.
RUN tlmgr update --self && tlmgr install latexmk texcount synctex etoolbox xetex

# update system packages
RUN apt-get update && apt-get upgrade -y

# install inkscape for svg support
RUN apt-get install inkscape -y

# install lilypond
RUN apt-get install lilypond -y

# install extra fonts
RUN apt-get install texlive-fonts-recommended -y

RUN apt-get install texlive-fonts-extra -y

RUN apt-get install fonts-dejavu -y

RUN apt-get install fonts-noto -y

# system fonts that TeX Live does not ship at all: Noto CJK, the Debian
# Chinese fonts (WenQuanYi, Arphic Uming/Ukai), Unifont, the IPA/Un fonts and
# a few metric-compatible replacements (Liberation, Carlito/Caladea,
# FreeFont). fontconfig makes them available by name to fontspec/xeCJK, to
# LuaTeX and to tools like inkscape.
RUN apt-get install -y \
      fonts-noto-cjk \
      fonts-noto-cjk-extra \
      fonts-noto-color-emoji \
      fonts-arphic-uming \
      fonts-arphic-ukai \
      fonts-wqy-microhei \
      fonts-wqy-zenhei \
      fonts-unifont \
      fonts-ipaexfont \
      fonts-unfonts-core \
      fonts-liberation \
      fonts-crosextra-carlito \
      fonts-crosextra-caladea \
      fonts-freefont-ttf \
      fonts-texgyre \
      fonts-lmodern \
      fonts-stix

# Tools the compile configuration and the clsi service expect next to TeX Live.
# The base image already brings qpdf, time and python3; they are listed again so
# that the dependency is visible where it is used. The rest is missing there, and
# each one is silent when it is absent - a compile fails, or a feature quietly
# does nothing:
#
#   ghostscript       dvipdf/ps2pdf/epstopdf and TeX Live's own tools
#   qpdf              the `output.pdfxref` the PDF preview reads, and clsi's
#                     OutputFileOptimiser
#   gnuplot           the gnuplot backend of pgfplots
#   python3-pygments  minted
#   time              clsi parses the "Command being timed" output of
#                     `latexmk -time` for its CPU metrics
#   R + knitr/stringr `.Rtex`/`.Rnw` documents (knitr), and patchSynctex.R,
#                     which maps SyncTeX positions back to the R source
#
# chktex is deliberately *not* installed here: TeX Live's scheme-full brings its
# own and `tlmgr path add` links it into /usr/local/bin, which comes before the
# /usr/bin copies of the apt TeX Live packages.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ghostscript \
      qpdf \
      gnuplot \
      python3-pygments \
      time \
      r-base-core \
      r-cran-knitr \
      r-cran-stringr \
    && rm -rf /var/lib/apt/lists/*

# knitr reads and writes UTF-8, and so do the Chinese fonts of this image.
# Without a UTF-8 locale Perl and R treat file names and log output as bytes.
ENV LANG=C.UTF-8

# The fonts Overleaf supports by family name through fontspec/xeCJK that the
# packages above do not bring (see
# https://www.overleaf.com/learn/latex/Questions/Which_OTF_or_TTF_fonts_are_supported_via_fontspec%3F).
# A document that names one of them fails with "The font ... cannot be found"
# when it is missing, which is the error this block exists to remove.
#
# Every package here was checked to exist in both Ubuntu 24.04 and 22.04, so the
# block does not depend on which release the base image is built on. Nothing is
# installed either that could win one of the generic families outright:
# `fonts-ubuntu` is left out for that reason, because a sans-serif alias it took
# over would change documents that never named a font.
#
# One measured caveat, recorded here because the obvious fix does not work: the
# collection moves what `serif` and `sans-serif` resolve to from the Noto
# Regular faces to the SemiCondensed ones (`monospace` stays DejaVu Sans Mono).
# Pinning them cannot be done from the pattern side - `<alias><prefer>`, a
# `<match>` that prepends the family, and assigning a normal `width`, with and
# without `binding="strong"`, were all measured to have no effect, because every
# Noto Serif face declares the same family name and fontconfig ignores the
# requested width when it chooses between them. An ordinary LaTeX document is
# unaffected in any case: its default font comes from the format (Latin Modern),
# not from fontconfig. What this shows in is a document that names a *generic*
# family, and in non-TeX tools that ask fontconfig for "serif".
#
#   Noto          the script coverage Overleaf itself recommends ("use the
#                 relevant Google Noto font, as included in Ubuntu")
#   croscore      Arimo / Tinos / Cousine, the metric-compatible equivalents of
#                 Arial / Times New Roman / Courier New
#   urw-base35    Nimbus Roman/Sans/Mono, C059, URW Bookman, Z003 - named in
#                 Overleaf's list and otherwise only present as Type1 fonts,
#                 which the fontconfig rule above hides from XeTeX on purpose
#   SIL, GFS, Lohit, tlwg, ...  the non-Latin families of that list
RUN apt-get update && apt-get install -y --no-install-recommends \
      fonts-noto-extra \
      fonts-noto-mono \
      fonts-croscore \
      fonts-urw-base35 \
      fonts-cantarell \
      fonts-oxygen \
      fonts-comic-neue \
      fonts-opendyslexic \
      fonts-symbola \
      fonts-jura \
      fonts-lemonada \
      fonts-navilu \
      fonts-yrsa-rasa \
      fonts-elstob \
      fonts-aenigma \
      fonts-sil-charis \
      fonts-sil-doulos \
      fonts-sil-abyssinica \
      fonts-sil-annapurna \
      fonts-sil-ezra \
      fonts-sil-padauk \
      fonts-sil-scheherazade \
      fonts-sil-sophia-nubian \
      fonts-sil-andika \
      fonts-sil-gentium \
      fonts-hosny-amiri \
      fonts-hosny-thabit \
      fonts-kacst \
      fonts-kacst-one \
      fonts-paktype \
      fonts-gfs-artemisia \
      fonts-gfs-bodoni-classic \
      fonts-gfs-complutum \
      fonts-gfs-didot \
      fonts-gfs-neohellenic \
      fonts-gfs-olga \
      fonts-gfs-porson \
      fonts-gfs-solomos \
      fonts-gfs-theokritos \
      fonts-lohit-beng-assamese \
      fonts-lohit-beng-bengali \
      fonts-lohit-deva \
      fonts-lohit-deva-marathi \
      fonts-lohit-deva-nepali \
      fonts-lohit-gujr \
      fonts-lohit-guru \
      fonts-lohit-knda \
      fonts-lohit-mlym \
      fonts-lohit-orya \
      fonts-lohit-taml \
      fonts-lohit-taml-classical \
      fonts-lohit-telu \
      fonts-samyak-deva \
      fonts-samyak-mlym \
      fonts-samyak-taml \
      fonts-gargi \
      fonts-sahadeva \
      fonts-sarai \
      fonts-pagul \
      fonts-beng \
      fonts-deva \
      fonts-gujr \
      fonts-guru \
      fonts-knda \
      fonts-mlym \
      fonts-orya \
      fonts-taml \
      fonts-telu \
      fonts-tlwg-garuda \
      fonts-tlwg-kinnari \
      fonts-tlwg-laksaman \
      fonts-tlwg-loma \
      fonts-tlwg-norasi \
      fonts-tlwg-purisa \
      fonts-tlwg-sawasdee \
      fonts-tlwg-typewriter \
      fonts-tlwg-typist \
      fonts-tlwg-typo \
      fonts-tlwg-umpush \
      fonts-tlwg-waree \
      fonts-tibetan-machine \
      fonts-khmeros \
      fonts-lklug-sinhala \
      fonts-myanmar \
      fonts-baekmuk \
      fonts-nanum \
      fonts-nanum-extra \
      fonts-alee \
      fonts-droid-fallback \
      fonts-dejavu-extra \
    && rm -rf /var/lib/apt/lists/*

# TeX Live keeps its fonts in texmf-dist, where fontconfig does not look, so
# they could only be used by file name ("FandolSong-Regular.otf") and not by
# family name ("FandolSong"). Registering the two font directories makes the
# fonts that scheme-full installed usable by name, in xelatex/lualatex
# documents as well as in inkscape.
RUN TLROOT=$(find /usr/local/texlive -maxdepth 1 -type d -name '20*' | head -1) && \
    mkdir -p /etc/fonts/conf.d && \
    printf '%s\n' \
      '<?xml version="1.0"?>' \
      '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">' \
      '<fontconfig>' \
      "  <dir>$TLROOT/texmf-dist/fonts/opentype</dir>" \
      "  <dir>$TLROOT/texmf-dist/fonts/truetype</dir>" \
      '  <!--' \
      '    XeTeX cannot embed Type1 fonts and gets confused by them when it' \
      '    matches one by family name, so they are hidden from fontconfig.' \
      '  -->' \
      '  <selectfont>' \
      '    <rejectfont>' \
      '      <pattern>' \
      '        <patelt name="fontformat"><string>Type 1</string></patelt>' \
      '      </pattern>' \
      '    </rejectfont>' \
      '    <!-- XeTeX cannot embed variable fonts either (the [..] in a name),' \
      '         nor woff/woff2 web fonts. -->' \
      '    <rejectfont>' \
      '      <glob>/usr/share/fonts/truetype/google-fonts/*[*</glob>' \
      '    </rejectfont>' \
      '    <rejectfont>' \
      '      <glob>/usr/share/fonts/woff/*</glob>' \
      '    </rejectfont>' \
      '    <rejectfont>' \
      '      <glob>/usr/share/fonts/woff2/*</glob>' \
      '    </rejectfont>' \
      '  </selectfont>' \
      '</fontconfig>' \
      > /etc/fonts/conf.d/60-texlive-fonts.conf && \
    cat /etc/fonts/conf.d/60-texlive-fonts.conf

# install the Chinese fonts vendored from
# https://github.com/Haixing-Hu/latex-chinese-fonts (see fonts/README.md).
# The fonts are bind-mounted instead of COPY-ed so that they do not end up in
# an extra image layer of their own; BuildKit is required for this.
#
# The TeX Live "zhmetrics" metrics (uniyou20, unisong5b, gbkyou20, ...) carry
# no glyphs: the zhmetrics map expects the Windows files simyou.ttf,
# simsun.ttc, ... for them. The vendored fonts are therefore installed a
# second time under those names, and the map itself (fonts/zhwinfonts-simfonts.map,
# the pdfTeX lines of the zhmetrics package) is enabled through updmap, so
# that documents using these fonts work without having to \input zhwinfonts.tex
# first.
RUN --mount=type=bind,source=fonts,target=/tmp/latex-chinese-fonts \
    TLBIN=$(find /usr/local/texlive -maxdepth 3 -type d -name '*-linux' | head -1) && \
    export PATH="$TLBIN:$PATH" && \
    TRUETYPE=/usr/local/texlive/texmf-local/fonts/truetype && \
    OPENTYPE=/usr/local/texlive/texmf-local/fonts/opentype && \
    MAPS=/usr/local/texlive/texmf-local/fonts/map/pdftex/local && \
    mkdir -p "$TRUETYPE" "$OPENTYPE" "$MAPS" /usr/share/fonts && \
    find /tmp/latex-chinese-fonts -name "*.ttf" -exec cp {} "$TRUETYPE" \; && \
    find /tmp/latex-chinese-fonts -name "*.ttc" -exec cp {} "$TRUETYPE" \; && \
    find /tmp/latex-chinese-fonts -name "*.otf" -exec cp {} "$OPENTYPE" \; && \
    find /tmp/latex-chinese-fonts -name "*.ttf" -exec cp {} /usr/share/fonts/ \; && \
    find /tmp/latex-chinese-fonts -name "*.ttc" -exec cp {} /usr/share/fonts/ \; && \
    find /tmp/latex-chinese-fonts -name "*.otf" -exec cp {} /usr/share/fonts/ \; && \
    for pair in SimSun.ttc:simsun.ttc SimHei.ttf:simhei.ttf KaiTi.ttf:simkai.ttf \
                FangSong.ttf:simfang.ttf LiSu.ttf:simli.ttf YouYuan.ttf:simyou.ttf ; do \
      src="${pair%%:*}"; dst="${pair##*:}"; \
      find /tmp/latex-chinese-fonts -iname "$src" -exec cp {} "$TRUETYPE/$dst" \; ; \
    done && \
    for name in simsun.ttc simhei.ttf simkai.ttf simfang.ttf simli.ttf simyou.ttf ; do \
      test -f "$TRUETYPE/$name" || { \
        echo "ERROR: $TRUETYPE/$name was not installed. The vendored collection names" ; \
        echo "       its files the way its upstream does (Kaiti.ttf, not KaiTi.ttf), so the" ; \
        echo "       copy above matches case-insensitively; a file that is missing here means" ; \
        echo "       the name changed upstream. tests/fonts-zhmetrics needs all six." ; \
        ls /tmp/latex-chinese-fonts | head -40 ; \
        exit 1 ; \
      } ; \
    done && \
    cp /tmp/latex-chinese-fonts/zhwinfonts-simfonts.map "$MAPS"/ && \
    mktexlsr && \
    updmap-sys --enable Map=zhwinfonts-simfonts.map && \
    fc-cache -fv

# Pre-build both font caches, now that every font is in place.
#
# Without this the first compile in a fresh container pays for it: when LuaTeX
# does not find a font in its name database it rebuilds the whole database, and
# with scheme-full that takes long enough to hit the compile timeout. The
# symptom is a compile that is slow exactly once per container, which is easy to
# mistake for a slow document.
#
# TEXMFVAR is pointed at the system tree on purpose. The image sets
# TEXMFVAR=/var/lib/overleaf/tmp/texmf-var, and /var/lib/overleaf is where a
# deployment mounts its data volume - anything written there while building the
# image would be hidden at runtime. /usr/local/texlive/<year>/texmf-var is the
# tree LuaTeX reads as TEXMFSYSVAR, and the compile user only needs to read it.
RUN TLBIN=$(find /usr/local/texlive -maxdepth 3 -type d -name '*-linux' | head -1) && \
    TLROOT=$(find /usr/local/texlive -maxdepth 1 -type d -name '20*' | head -1) && \
    export PATH="$TLBIN:$PATH" && \
    fc-cache -fsv && \
    TEXMFVAR="$TLROOT/texmf-var" luaotfload-tool --update ; \
    if ! find "$TLROOT" -name 'luaotfload-names*' -print -quit | grep -q . ; then \
      echo "ERROR: luaotfload-tool --update did not write a name database, so LuaLaTeX would rebuild it on every fresh container" ; \
      exit 1 ; \
    fi ; \
    echo "  the LuaTeX name database is part of the image:" ; \
    find "$TLROOT" -name 'luaotfload-names*' -printf '  %p (%s bytes)\n'

# Fail the build instead of shipping an image in which documents that use
# these fonts stop with "font not found".
#
# The first group is fatal: uniyou20.tfm, gbkyou20.tfm and
# FandolSong-Regular.otf come from TeX Live scheme-full, gbsn00lp.ttf from its
# arphic-ttf package and simyou.ttf/simsun.ttc from the fonts/ installation
# above; when one of them is missing, documents using that font cannot work.
# The fontconfig families are only reported, because a family name is also
# covered by the XeLaTeX example in tests/fonts-by-name, which CI compiles
# against the built image.
#
# The TeX Live binaries are called by path because the apt packages of TeX
# Live (installed above for the extra Type1 fonts) put their own, older copies
# into /usr/bin.
RUN TLBIN=$(find /usr/local/texlive -maxdepth 3 -type d -name '*-linux' | head -1) && \
    export PATH="$TLBIN:$PATH" && \
    for f in uniyou20.tfm gbkyou20.tfm FandolSong-Regular.otf gbsn00lp.ttf \
             simyou.ttf simsun.ttc ; do \
      path=$(kpsewhich "$f" || true) ; \
      if [ -z "$path" ] ; then \
        echo "ERROR: $f is missing (TeX Live scheme-full or the fonts/ installation did not complete)" ; \
        exit 1 ; \
      fi ; \
      echo "  found $f -> $path" ; \
    done && \
    cd /tmp && \
    printf '%s\n' '\font\testyou=uniyou5e' '\testyou\char"7c' '\bye' > uniyou5e.tex && \
    if pdftex -interaction=nonstopmode uniyou5e.tex > uniyou5e.log 2>&1 ; then \
      echo "  pdfTeX loads uniyou5e, the zhmetrics map is active" ; \
    else \
      echo "ERROR: pdfTeX cannot load uniyou5e, the zhmetrics map is not active" ; \
      cat uniyou5e.log ; \
      exit 1 ; \
    fi && \
    rm -f uniyou5e.tex uniyou5e.log uniyou5e.dvi && \
    for family in FandolSong YouYuan 'Noto Sans CJK SC' ; do \
      match=$(fc-match -f '%{family}' "$family") ; \
      case "$match" in \
        *"$family"*) echo "  fontconfig knows $family" ;; \
        *) echo "WARNING: fontconfig resolves $family to '$match'; documents selecting it by that name will not find it" ;; \
      esac ; \
    done ; \
    for family in Arimo Tinos Cousine 'Nimbus Roman' 'Nimbus Sans' Cantarell \
                  'Comic Neue' OpenDyslexic Symbola Amiri KacstOne \
                  'Charis SIL' 'Doulos SIL' 'Baekmuk Gulim' NanumGothic Garuda \
                  'Lohit Devanagari' 'Tibetan Machine Uni' \
                  'Khmer OS Battambang' Jura Elstob ; do \
      match=$(fc-match -f '%{family}' "$family") ; \
      case "$match" in \
        *"$family"*) echo "  fontconfig knows $family" ;; \
        *) echo "WARNING: fontconfig resolves $family to '$match'; tests/fonts-extra will say whether it compiles" ;; \
      esac ; \
    done ; \
    for alias in serif sans-serif monospace ; do \
      echo "  fc-match $alias -> $(fc-match -f '%{family}' "$alias")" ; \
    done

# TeX Live configuration, in the same texmf.cnf the shell_escape setting used to
# go into:
#
#   shell_escape=t   minted, the inkscape/svg route, gnuplot, tikzexternalize
#   openout_any=a    ... all of which also read and write outside the working
#   openin_any=a     directory; the default ("p") refuses absolute paths and
#                    "..", which shows up as "I can't write on file ..."
#   OSFONTDIR        a kpathsea-level fallback for XeTeX and LuaTeX, which
#                    otherwise reach the system fonts only through fontconfig
#
# The settings are read back afterwards: appending to a file that turned out not
# to be the one TeX reads is exactly the kind of mistake that only shows up as a
# compile error in production.
RUN TLROOT=$(find /usr/local/texlive -maxdepth 1 -type d -name '20*' | head -1) && \
    TEXMFCNF="$TLROOT/texmf.cnf" && \
    test -f "$TEXMFCNF" && \
    printf '%s\n' \
      '% enable shell-escape by default' \
      'shell_escape = t' \
      'openout_any = a' \
      'openin_any = a' \
      'OSFONTDIR = /usr/share/fonts//' \
      >> "$TEXMFCNF" && \
    for setting in 'shell_escape = t' 'openout_any = a' 'openin_any = a' 'OSFONTDIR = /usr/share/fonts//' ; do \
      grep -qF "$setting" "$TEXMFCNF" || { \
        echo "ERROR: '$setting' did not end up in $TEXMFCNF" ; \
        exit 1 ; \
      } ; \
    done && \
    tail -n 6 "$TEXMFCNF"

# Overleaf's own latexmk configuration, which the CE image ships as three lines.
# Everything that is configured only there - R/knitr, glossaries, nomenclature,
# feynmf, asymptote, metapost, the chktex step, the qpdf/xref post-processing -
# is missing without it; see texlive/README.md.
COPY texlive/LatexMk /usr/local/share/latexmk/LatexMk
COPY texlive/run-chktex.sh /usr/local/bin/run-chktex.sh
COPY texlive/patchSynctex.R /usr/local/bin/patchSynctex.R
RUN chmod +x /usr/local/bin/run-chktex.sh /usr/local/bin/patchSynctex.R && \
    grep -qF "add_cus_dep( 'Rtex', 'tex', 0, 'do_knitr');" /usr/local/share/latexmk/LatexMk || { \
      echo "ERROR: texlive/LatexMk was not installed correctly" ; \
      exit 1 ; \
    }

# Fail the build when one of the programs the configuration above calls is
# missing. None of them stops a compile - they only make a feature quietly
# unavailable (no Check button, no R documents, no PDF preview xref data), so
# without this check the image would look fine and behave incompletely.
RUN TLBIN=$(find /usr/local/texlive -maxdepth 3 -type d -name '*-linux' | head -1) && \
    export PATH="$TLBIN:$PATH" && \
    for tool in latexmk chktex gs qpdf gnuplot python3 Rscript fc-cache luaotfload-tool ; do \
      command -v "$tool" > /dev/null || { echo "ERROR: $tool is missing" ; exit 1 ; } ; \
      echo "  found $tool -> $(command -v "$tool")" ; \
    done && \
    test -x /usr/bin/time || { echo "ERROR: /usr/bin/time is missing, clsi cannot report compile timings" ; exit 1 ; } && \
    echo "  found /usr/bin/time" && \
    Rscript -e 'library(knitr); library(stringr); cat("  R can load knitr and stringr\n")'

# The XeLaTeX route of texlive/LatexMk ends in
#
#     xdvipdfmx -z 6 -i dvipdfmx-unsafe.cfg -o out.pdf in.xdv
#
# so that file has to resolve, or every XeLaTeX compile fails - including
# tests/fonts-by-name, which CI compiles against the built image.
#
# It is checked by compiling, not with `kpsewhich`: kpsewhich's file type for
# `.cfg` does not include texmf-dist, so `kpsewhich dvipdfmx-unsafe.cfg` exits 1
# while the file sits in
# /usr/local/texlive/<year>/texmf-dist/dvipdfmx/dvipdfmx-unsafe.cfg - which is
# how an earlier version of this check failed a perfectly good build. What the
# claim needs is the whole route: xelatex, xdvipdfmx and its config file.
RUN TLBIN=$(find /usr/local/texlive -maxdepth 3 -type d -name '*-linux' | head -1) && \
    export PATH="$TLBIN:$PATH" && \
    rm -rf /tmp/xelatex-check && mkdir -p /tmp/xelatex-check && \
    cd /tmp/xelatex-check && \
    printf '%s\n' '\documentclass{article}' '\begin{document}' 'Hello.' '\end{document}' > minimal.tex && \
    latexmk -xelatex -interaction=nonstopmode minimal.tex || { \
      echo "ERROR: a minimal XeLaTeX compile fails. texlive/LatexMk points xdvipdfmx at" ; \
      echo "       dvipdfmx-unsafe.cfg, so every XeLaTeX document would fail to build." ; \
      exit 1 ; \
    } ; \
    test -s /tmp/xelatex-check/minimal.pdf || { \
      echo "ERROR: XeLaTeX produced no PDF" ; \
      exit 1 ; \
    } ; \
    echo "  a minimal XeLaTeX compile works ($(stat -c %s /tmp/xelatex-check/minimal.pdf) byte PDF, xdvipdfmx config file resolved)" ; \
    rm -rf /tmp/xelatex-check

# ---------------------------------------------------------------------------
# OIDC / SSO login support, see overlay/README.md
# ---------------------------------------------------------------------------
# The overlay files are full replacements for files shipped in
# sharelatex/sharelatex:6.3.0, with OpenID Connect login support added.
# This guard fails the build when the base image no longer matches the
# version the overlay was made for, instead of silently shipping a patched
# file that is out of sync with the rest of the application.
RUN echo "5d5c62eb3c1d38ce8f5440e26bba2f598e01d9b42ac1310cec6d2659165e06a8  /overleaf/services/web/app/src/Features/Authentication/AuthenticationController.mjs" | sha256sum -c - \
    && echo "09199bb851219d53431507df913e04e6569b2670cd50c8f85c0a3d1d1fd6f6e2  /overleaf/services/web/app/src/router.mjs" | sha256sum -c - \
    || { echo "ERROR: the base image does not match the version the OIDC overlay in ./overlay was written for."; \
         echo "Re-base the overlay as described in overlay/README.md before using this base image."; \
         exit 1; }

COPY overlay/services/web /overleaf/services/web

# ---------------------------------------------------------------------------
# Sandboxed compiles, see overlay/README.md
# ---------------------------------------------------------------------------
# The clsi service selects the Docker runner on its own: with
# SANDBOXED_COMPILES=true its settings enable `clsi.dockerRunner`, and
# CommandRunner.js imports the runner behind it - a Server Pro file the CE image
# does not ship, which is how the feature is gated ("Sandboxed compiles are only
# available with Overleaf Server Pro", followed by exit 1). The overlay adds it
# back, under both of the names a release may use.
#
# This only reports what this base image names; the overlay ships both.
RUN echo "clsi Docker runner references in the base image:" && \
    { grep -n "DockerRunner" /overleaf/services/clsi/config/settings.defaults.cjs || \
      echo "  (settings.defaults.cjs does not name one)"; } && \
    { grep -n "DockerRunner" /overleaf/services/clsi/app/js/CommandRunner.js || { \
        echo "ERROR: CommandRunner.js of this base image does not import a Docker runner,"; \
        echo "so the overlay cannot enable sandboxed compiles on it."; \
        exit 1; \
      }; }

COPY overlay/services/clsi /overleaf/services/clsi

# ---------------------------------------------------------------------------
# The settings of this image
# ---------------------------------------------------------------------------
# The CE image sets OVERLEAF_CONFIG=/etc/overleaf/settings.js. Pointing it at a
# file that loads that one and extends it keeps the upstream settings untouched
# (they are read, not replaced) and switches on the modules of this overlay.
# See overlay/etc/overleaf/settings.overlay.cjs.
COPY overlay/etc/overleaf/ /etc/overleaf/
ENV OVERLEAF_CONFIG=/etc/overleaf/settings.overlay.cjs

# The settings file is loaded by every service in the container, before
# anything else works, so a mistake in it would take the whole instance down
# with an unhelpful error. Load it once here instead, with the modules switched
# on, so that the build log shows the resulting sequence.
RUN OVERLEAF_ENABLE_TRACK_CHANGES=true node -e "const settings = require('/etc/overleaf/settings.overlay.cjs'); if (typeof settings !== 'object' || settings === null) { throw new Error('settings.overlay.cjs did not export an object') } const sequence = settings.moduleImportSequence; if (!Array.isArray(sequence) || !sequence.includes('track-changes')) { throw new Error('settings.overlay.cjs did not register the modules: ' + JSON.stringify(sequence)) } console.log('  settings.overlay.cjs loads, moduleImportSequence: ' + JSON.stringify(sequence))"

# Overleaf precompiles the .pug views to .js files at image build time and
# prefers those over the .pug sources at boot. Regenerate them so the modified
# views take effect; if that fails, remove the stale precompiled files so the
# views are compiled from source when a container boots (slower, but correct).
RUN cd /overleaf/services/web \
    && (yarn run precompile-pug || { \
         echo "precompiling views failed, falling back to compiling them at boot"; \
         for dir in app/views modules/*/app/views; do \
           [ -d "$dir" ] || continue; \
           find "$dir" -name '*.pug' -exec sh -c 'rm -f "${1%.pug}.js"' _ {} \; ; \
         done; \
       })

# ---------------------------------------------------------------------------
# Optional: rebuild the frontend with the user interfaces of this overlay
# ---------------------------------------------------------------------------
# A module that brings its own user interface does not reach the browser through
# a setting: its components are pulled into the webpack build by the Babel macro
# `frontend/macros/import-overleaf-module.macro.js`, which reads
# `Settings.overleafModuleImports` **while webpack runs**. The CE image has that
# registry for every key, but empty, and prunes the webpack toolchain after its
# own build (`genScript.js` ends its compile step with
# `yarn workspaces focus --all --production`), so a module's UI can only be added
# by doing here what upstream does in its own build:
#
#   1. restore the devDependencies (`yarn install`, from `.yarn/cache`),
#   2. run webpack with a settings file that fills the registry
#      (`config/settings.frontend.cjs` - **without** `OVERLEAF_CONFIG` webpack
#      would read the image's own empty registry and produce an equally empty
#      bundle, with a green build),
#   3. prune the devDependencies again, so the running image is unchanged.
#
# It is off by default, because it is a real rebuild: it makes the image build
# much longer, needs the yarn cache (or network), and the bundle has to be
# regenerated on every upstream bump. Enable it with
# `--build-arg OVERLEAF_REBUILD_FRONTEND=true`. See DEVELOP_EXPERIMENT.MD.
#
# Only the *frontend* is rebuilt; the backend modules are ordinary source files
# and are switched on at runtime as usual (they still have to be listed in
# `moduleImportSequence` for their routes to be registered).
ARG OVERLEAF_REBUILD_FRONTEND=false
RUN if [ "$OVERLEAF_REBUILD_FRONTEND" = "true" ]; then \
      echo "rebuilding the frontend with the modules of this overlay" ; \
      cd /overleaf/services/web && \
      export CYPRESS_INSTALL_BINARY=0 && \
      yarn install --immutable && \
      OVERLEAF_CONFIG=/overleaf/services/web/config/settings.frontend.cjs \
        yarn run webpack:production && \
      yarn workspaces focus --all --production && \
      touch /opt/overleaf-frontend-rebuilt ; \
    else \
      echo "the frontend is not rebuilt (pass --build-arg OVERLEAF_REBUILD_FRONTEND=true to do so)" ; \
    fi
