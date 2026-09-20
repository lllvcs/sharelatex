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

# TeX Live keeps its fonts in texmf-dist, where fontconfig does not look, so
# they could only be used by file name ("FandolSong-Regular.otf") and not by
# family name ("FandolSong"). Registering the two font directories makes the
# fonts that scheme-full installed usable by name, in xelatex/lualatex
# documents as well as in inkscape.
RUN TLROOT=$(find /usr/local/texlive -maxdepth 1 -type d -name '20*') && \
    mkdir -p /etc/fonts/conf.d && \
    printf '%s\n' \
      '<?xml version="1.0"?>' \
      '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">' \
      '<fontconfig>' \
      "  <dir>$TLROOT/texmf-dist/fonts/opentype</dir>" \
      "  <dir>$TLROOT/texmf-dist/fonts/truetype</dir>" \
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

# enable shell-escape by default:
RUN TEXLIVE_FOLDER=$(find /usr/local/texlive/ -type d -name '20*') \
    && echo % enable shell-escape by default >> /$TEXLIVE_FOLDER/texmf.cnf \
    && echo shell_escape = t >> /$TEXLIVE_FOLDER/texmf.cnf

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
