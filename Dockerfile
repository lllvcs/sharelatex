# syntax=docker/dockerfile:1

FROM sharelatex/sharelatex:6.3.0

SHELL ["/bin/bash", "-cx"]

# update tlmgr itself
RUN wget "https://mirror.ctan.org/systems/texlive/tlnet/update-tlmgr-latest.sh" \
    && sh update-tlmgr-latest.sh \
    && tlmgr --version

# enable tlmgr to install ctex
RUN tlmgr update texlive-scripts 

# update packages
RUN tlmgr update --all

# install all the packages
RUN tlmgr install scheme-full

# recreate symlinks
RUN tlmgr path add

# The packages Overleaf's own compile image installs on top of the scheme, as a
# safety net: if `tlmgr install scheme-full` ever installs only partially, these
# are the ones every compile needs (the package list is the one Overleaf's
# server-ce/Dockerfile-base uses). Installing an already present package is a
# no-op, so this only ever adds something.
RUN tlmgr install latexmk texcount synctex etoolbox xetex

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
      find /tmp/latex-chinese-fonts -name "$src" -exec cp {} "$TRUETYPE/$dst" \; ; \
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

# `dvipdfmx-unsafe.cfg` is the one that is not optional: texlive/LatexMk points
# xdvipdfmx at it, so a missing file breaks every XeLaTeX compile - including
# tests/fonts-by-name, which CI compiles against the built image.
RUN TLBIN=$(find /usr/local/texlive -maxdepth 3 -type d -name '*-linux' | head -1) && \
    export PATH="$TLBIN:$PATH" && \
    DVIPDFMX_CFG=$(kpsewhich dvipdfmx-unsafe.cfg) || { \
      echo "ERROR: dvipdfmx-unsafe.cfg is missing, so the xelatex command in texlive/LatexMk would fail" ; \
      exit 1 ; \
    } ; \
    echo "  found dvipdfmx-unsafe.cfg -> $DVIPDFMX_CFG"

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
