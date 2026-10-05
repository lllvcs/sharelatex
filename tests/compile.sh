#!/bin/bash
# Compiles every MWE with latexmk, using the shared latexmkrc in this
# directory (LuaLaTeX by default).  A test directory may place its own
# latexmkrc next to its source file to override settings such as the engine;
# see the note about the order of the two files below.
#
# Alongside .tex, the sources that Overleaf accepts as a root document and that
# latexmk has to build first are compiled as well: .Rnw and .Rtex, which the
# knitr custom dependency of /usr/local/share/latexmk/LatexMk turns into a .tex.
#
# Each example is given its own time limit, so that a runaway compile fails the
# job instead of hanging it.

set -e

COMPILE_TIMEOUT=${COMPILE_TIMEOUT:-600}

# The knitr example is a .Rnw, and compiling it *generates* files next to it that
# are not documents of their own: `main.tex` (the knitted source, which the .Rnw
# run compiles) and `main-concordance.tex` (a table knitr writes for SyncTeX,
# which has no \documentclass and cannot be compiled). Both are in .gitignore for
# the same reason. Without the exclusions the first run leaves them behind and the
# second run fails on the concordance file.
find /tests \( -name "*.tex" -o -name "*.Rnw" -o -name "*.Rtex" \) \
     ! -name "*-concordance.tex" ! -path "/tests/knitr/*.tex" -print0 | while IFS= read -r -d "" file; do
  cd "$(dirname "$file")" || exit 1
  echo "compiling inside $(pwd)"
  # The two rc files have to be concatenated, which is not obvious: latexmk
  # reads ./latexmkrc *before* any file given with -r, so passing the shared
  # file as `-r /tests/latexmkrc` makes it override the example's settings
  # instead of the other way round - and silently, since both are valid
  # configurations. That is how tests/fonts-by-name came to be compiled with
  # LuaLaTeX while its own latexmkrc asked for XeLaTeX (measured with the
  # harness in .research/dsh-harness.sh). Read last is what the example's
  # latexmkrc is for.
  #
  # The file is deliberately not named latexmkrc: one with that name in this
  # directory would be read by latexmk on its own, before the -r argument.
  rc="/tmp/latexmkrc-$$-$(basename "$(pwd)")"
  if [ -f latexmkrc ]; then
    cat /tests/latexmkrc latexmkrc > "$rc"
    rc_args=(-r "$rc")
  else
    rc_args=(-r /tests/latexmkrc)
  fi

  # The root document of a knitr example is named as .tex, and latexmk is given
  # -jobname, because that is what clsi does:
  #
  #     mainFile = mainFile.replace(/\.(Rtex|md|Rmd|Rnw)$/, '.tex')
  #     command.push('latexmk', '-cd', '-jobname=output', ...)
  #
  # (services/clsi/app/js/LatexRunner.js). Both details matter. Handing latexmk
  # the .Rnw itself makes it run the engine on R source, which errors and stops
  # the build; and without -jobname latexmk runs the engine once *before* the
  # knitr dependency has created the .tex, and although the later passes produce
  # a correct PDF it exits 12 for that first failure. This way the examples are
  # compiled the way the product compiles them.
  case "$file" in
    *.Rnw|*.Rtex) target="$(basename "${file%.*}").tex" ;;
    *)            target="$(basename "$file")" ;;
  esac

  if ! timeout "$COMPILE_TIMEOUT" latexmk "${rc_args[@]}" -jobname=output -f \
       -interaction=nonstopmode "$target" ; then
    rm -f "$rc"
    exit 1
  fi
  rm -f "$rc"
done || exit 1
