#!/bin/bash
# Compiles every MWE with latexmk, using the shared latexmkrc in this
# directory (LuaLaTeX by default).  A test directory may place its own
# latexmkrc next to its source file to override settings such as the engine;
# it is read after the shared file, so it takes precedence.
#
# Alongside .tex, the sources that Overleaf accepts as a root document and that
# latexmk has to build first are compiled as well: .Rnw and .Rtex, which the
# knitr custom dependency of /usr/local/share/latexmk/LatexMk turns into a .tex.
#
# Each example is given its own time limit, so that a runaway compile fails the
# job instead of hanging it.

set -e

COMPILE_TIMEOUT=${COMPILE_TIMEOUT:-600}

find /tests \( -name "*.tex" -o -name "*.Rnw" -o -name "*.Rtex" \) -print0 | while IFS= read -r -d "" file; do
  cd "$(dirname "$file")" || exit 1
  echo "compiling inside $(pwd)"
  rc_args=(-r /tests/latexmkrc)
  if [ -f latexmkrc ]; then
    rc_args+=(-r ./latexmkrc)
  fi
  timeout "$COMPILE_TIMEOUT" latexmk "${rc_args[@]}" "$(basename "$file")" || exit 1
done || exit 1
