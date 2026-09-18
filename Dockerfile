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

# install the Chinese fonts vendored from
# https://github.com/Haixing-Hu/latex-chinese-fonts (see fonts/README.md).
# The fonts are bind-mounted instead of COPY-ed so that they do not end up in
# an extra image layer of their own; BuildKit is required for this.
RUN --mount=type=bind,source=fonts,target=/tmp/latex-chinese-fonts \
    mkdir -p /usr/local/texlive/texmf-local/fonts/truetype/ \
             /usr/local/texlive/texmf-local/fonts/opentype/ \
             /usr/share/fonts/ && \
    find /tmp/latex-chinese-fonts -name "*.ttf" -exec cp {} /usr/local/texlive/texmf-local/fonts/truetype/ \; && \
    find /tmp/latex-chinese-fonts -name "*.ttc" -exec cp {} /usr/local/texlive/texmf-local/fonts/truetype/ \; && \
    find /tmp/latex-chinese-fonts -name "*.otf" -exec cp {} /usr/local/texlive/texmf-local/fonts/opentype/ \; && \
    find /tmp/latex-chinese-fonts -name "*.ttf" -exec cp {} /usr/share/fonts/ \; && \
    find /tmp/latex-chinese-fonts -name "*.ttc" -exec cp {} /usr/share/fonts/ \; && \
    find /tmp/latex-chinese-fonts -name "*.otf" -exec cp {} /usr/share/fonts/ \; && \
    mktexlsr && \
    fc-cache -fv


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
