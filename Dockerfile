FROM sharelatex/sharelatex:6.0.1

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

RUN git clone https://github.com/Haixing-Hu/latex-chinese-fonts.git /tmp/latex-chinese-fonts && \
    mkdir -p /usr/local/texlive/texmf-local/fonts/truetype/ \
             /usr/local/texlive/texmf-local/fonts/opentype/ \
             /usr/share/fonts/ && \
    find /tmp/latex-chinese-fonts -maxdepth 3 -name "*.ttf" -exec cp {} /usr/local/texlive/texmf-local/fonts/truetype/ \; && \
    find /tmp/latex-chinese-fonts -maxdepth 3 -name "*.ttc" -exec cp {} /usr/local/texlive/texmf-local/fonts/truetype/ \; && \
    find /tmp/latex-chinese-fonts -maxdepth 3 -name "*.otf" -exec cp {} /usr/local/texlive/texmf-local/fonts/opentype/ \; && \
    find /tmp/latex-chinese-fonts -maxdepth 3 -name "*.ttf" -exec cp {} /usr/share/fonts/ \; && \
    find /tmp/latex-chinese-fonts -maxdepth 3 -name "*.ttc" -exec cp {} /usr/share/fonts/ \; && \
    find /tmp/latex-chinese-fonts -maxdepth 3 -name "*.otf" -exec cp {} /usr/share/fonts/ \; && \
    mktexlsr && \
    fc-cache -fv


# enable shell-escape by default:
RUN TEXLIVE_FOLDER=$(find /usr/local/texlive/ -type d -name '20*') \
    && echo % enable shell-escape by default >> /$TEXLIVE_FOLDER/texmf.cnf \
    && echo shell_escape = t >> /$TEXLIVE_FOLDER/texmf.cnf
