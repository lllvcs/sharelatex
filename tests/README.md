# Minimal Working Examples

This folder holds minimal Working Examples (MWEs) for the features added on top
of the base image.

The LaTeX examples are compiled directly using `latexmk` inside the built
image (`compile.sh`), which verifies that the TeX Live packages and fonts are
usable.

`verify-oidc.sh` checks the OIDC overlay that is applied to the Overleaf
application in the image (see `../overlay/README.md`): the patched modules
must load, the user model must carry the `oidcIdentifier` field and the views
must compile.
