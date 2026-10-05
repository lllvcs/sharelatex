#!/bin/bash
# Verifies the overlay of this image: the OIDC login support, the track-changes
# module, the sandboxed-compile files, the settings file and the TeX Live
# configuration. Run with:
#   docker run --rm --entrypoint=/bin/bash <image> -c "/bin/bash /tests/verify-overlay.sh"
set -e

WEB=/overleaf/services/web
CLSI=/overleaf/services/clsi

echo "== syntax check of the patched files =="
for f in \
  $WEB/app/src/Features/Authentication/AuthenticationController.mjs \
  $WEB/app/src/Features/Authentication/OidcStrategy.mjs \
  $WEB/app/src/Features/Authentication/OidcCallbackUrl.mjs \
  $WEB/app/src/Features/Authentication/OidcDiscovery.mjs \
  $WEB/app/src/Features/Authentication/OidcEmailTrust.mjs \
  $WEB/app/src/Features/Authentication/OidcIdToken.mjs \
  $WEB/app/src/Features/Authentication/OidcLinkRequest.mjs \
  $WEB/app/src/infrastructure/Server.mjs \
  $WEB/app/src/infrastructure/Features.mjs \
  $WEB/app/src/infrastructure/ExpressLocals.mjs \
  $WEB/app/src/router.mjs \
  $WEB/app/src/models/User.mjs \
  $WEB/app/src/Features/User/UserPrimaryEmailCheckHandler.mjs \
  $WEB/modules/track-changes/index.mjs \
  $WEB/modules/track-changes/app/src/TrackChangesRouter.mjs \
  $WEB/modules/track-changes/app/src/TrackChangesController.mjs \
  $WEB/modules/sandboxed-compiles/index.mjs \
  $WEB/modules/sandboxed-compiles/app/src/TexLiveImages.mjs \
  $CLSI/app/js/DockerRunner.js \
  $CLSI/app/js/DockerRunner.mjs \
  $CLSI/app/js/DockerLockManager.js \
  /etc/overleaf/settings.overlay.cjs \
  /etc/overleaf/overlay-modules.cjs ; do
  node --check "$f"
  echo "  ok: $f"
done

echo "== the seccomp profile of the sandboxed compiles is valid JSON =="
node -e "const p = require('$CLSI/seccomp/clsi-profile.json'); if (!Array.isArray(p.syscalls) || p.syscalls.length === 0) { throw new Error('no syscalls') } console.log('  ' + p.syscalls.length + ' syscall groups, defaultAction ' + p.defaultAction)"

echo "== the settings file of this image is complete =="
# Every service reads /etc/overleaf/settings.overlay.cjs (OVERLEAF_CONFIG), so a
# mistake in it stops the container before anything is logged about it.
OVERLEAF_ENABLE_TRACK_CHANGES=true SANDBOXED_COMPILES=true \
ALL_TEX_LIVE_DOCKER_IMAGES='ghcr.io/ayaka-notes/texlive-full:2026.1' \
TEX_LIVE_DOCKER_IMAGE='ghcr.io/ayaka-notes/texlive-full:2026.1' \
MAX_UPLOAD_SIZE=120 \
node -e "
const settings = require('/etc/overleaf/settings.overlay.cjs')
for (const name of ['track-changes', 'sandboxed-compiles']) {
  if (!settings.moduleImportSequence.includes(name)) throw new Error(name + ' is not in moduleImportSequence: ' + JSON.stringify(settings.moduleImportSequence))
}
for (const name of ['history-v1', 'launchpad', 'server-ce-scripts', 'user-activate']) {
  if (!settings.moduleImportSequence.includes(name)) throw new Error(name + ' was dropped from moduleImportSequence: ' + JSON.stringify(settings.moduleImportSequence))
}
if (settings.imageRoot !== 'ghcr.io/ayaka-notes') throw new Error('imageRoot is ' + settings.imageRoot)
if (settings.allowedImageNames.length !== 1) throw new Error('allowedImageNames is ' + JSON.stringify(settings.allowedImageNames))
if (settings.currentImageName !== 'ghcr.io/ayaka-notes/texlive-full:2026.1') throw new Error('currentImageName is ' + settings.currentImageName)
if (settings.maxUploadSize !== 120 * 1024 * 1024) throw new Error('maxUploadSize is ' + settings.maxUploadSize)
if (!settings.mongo || !settings.mongo.url) throw new Error('the settings of the base image were lost')
console.log('  moduleImportSequence: ' + JSON.stringify(settings.moduleImportSequence))
"

echo "== the modules are registered on a default start =="
# Without the variables nothing may change: an instance that does not ask for a
# feature must behave exactly like the base image.
node -e "
const settings = require('/etc/overleaf/settings.overlay.cjs')
if (settings.moduleImportSequence !== undefined) throw new Error('a module was registered without being asked for: ' + JSON.stringify(settings.moduleImportSequence))
if (settings.maxUploadSize !== undefined) throw new Error('maxUploadSize was set without MAX_UPLOAD_SIZE')
console.log('  nothing extra is set')
"

# @overleaf/settings reads OVERLEAF_CONFIG once, when it is first imported, so
# the module sequence has to be switched on in the environment of this script
# for the checks below to see the same configuration a container would.
export OVERLEAF_ENABLE_TRACK_CHANGES=true

cd $WEB

echo "== the patched modules load (resolves their whole import graph) =="
# Importing the application also creates the Redis/Mongo clients of the modules
# it pulls in (e.g. UserSessionsManager creates one at import time). This
# container runs no database, and the init script that normally makes the
# default host name "dockerhost" resolvable has not run either, so those
# clients log connection errors: messages about Redis, Mongo or a deprecation
# warning below are expected and do not mean the check failed.
#
# The check ends with an explicit exit, because the clients keep the event loop
# alive and would otherwise make this step hang forever.
#
# OVERLEAF_OIDC_ISSUER is read while the modules are evaluated, so it has to
# be set before node starts.
OVERLEAF_OIDC_ISSUER='https://idp.example.com' \
OVERLEAF_REDIS_HOST=127.0.0.1 REDIS_HOST=127.0.0.1 OVERLEAF_REDIS_PORT=6379 \
OVERLEAF_MONGO_URL='mongodb://127.0.0.1:27017/overleaf' \
MONGO_URL='mongodb://127.0.0.1:27017/overleaf' \
timeout 120 node --input-type=module -e "
import fs from 'node:fs'

try {
  const controller = (await import('./app/src/Features/Authentication/AuthenticationController.mjs')).default
  const { OidcStrategy } = await import('./app/src/Features/Authentication/OidcStrategy.mjs')
  const { User } = await import('./app/src/models/User.mjs')
  const Features = (await import('./app/src/infrastructure/Features.mjs')).default

  for (const fn of ['oidcLogin', 'oidcLoginCallback', 'oidcLinkPage', 'oidcLink', 'verifyOpenIDConnect', 'extractOidcIdFromProfile', 'ensureOidcLoginEnabled']) {
    if (typeof controller[fn] !== 'function') throw new Error('AuthenticationController.' + fn + ' is missing')
  }
  if (typeof OidcStrategy !== 'function') throw new Error('OidcStrategy is missing')
  if (!User.schema.path('oidcIdentifier')) throw new Error('the User model is missing the oidcIdentifier field')
  if (!Features.externalAuthenticationSystemUsed()) throw new Error('OIDC is not treated as an external authentication system')

  // track-changes: the module flips the switch the core reads, and registers
  // its routes.
  const trackChanges = (await import('./modules/track-changes/index.mjs')).default
  const ProjectEditorHandler = (await import('./app/src/Features/Project/ProjectEditorHandler.mjs')).default
  if (ProjectEditorHandler.trackChangesAvailable !== true) throw new Error('track-changes did not switch the feature on')
  const routes = []
  trackChanges.router.apply({ post: p => routes.push(p), get: p => routes.push(p), delete: p => routes.push(p) })
  for (const route of ['/project/:project_id/track_changes', '/project/:project_id/ranges', '/project/:project_id/threads']) {
    if (!routes.includes(route)) throw new Error('track-changes does not register ' + route)
  }
  if (!Features.hasFeature('track-changes')) throw new Error('Features.hasFeature(track-changes) is still false')

  // sandboxed compiles: the module derives the three settings.
  const { resolveTexLiveConfiguration } = await import('./modules/sandboxed-compiles/app/src/TexLiveImages.mjs')
  const config = resolveTexLiveConfiguration({
    ALL_TEX_LIVE_DOCKER_IMAGES: 'ghcr.io/ayaka-notes/texlive-full:2026.1',
    TEX_LIVE_DOCKER_IMAGE: 'ghcr.io/ayaka-notes/texlive-full:2026.1',
  })
  if (config.imageRoot !== 'ghcr.io/ayaka-notes') throw new Error('the image root is ' + config.imageRoot)

  fs.writeSync(1, 'overlay modules OK\n')
  process.exit(0)
} catch (err) {
  fs.writeSync(2, 'the patched modules do not load: ' + (err && err.stack ? err.stack : err) + '\n')
  process.exit(1)
}
"

echo "== the clsi docker runner resolves its imports =="
# Server Pro file, added back by the overlay. Importing it proves that dockerode,
# async and lodash are reachable under Yarn PnP; the module starts a timer, so
# the process is ended explicitly.
cd $CLSI
SANDBOXED_COMPILES=false timeout 60 node --input-type=module -e "
const { default: DockerRunner } = await import('./app/js/DockerRunner.js')
if (typeof DockerRunner.run !== 'function' || typeof DockerRunner.kill !== 'function') {
  throw new Error('DockerRunner is incomplete')
}
console.log('  DockerRunner loads, run() and kill() are there')
process.exit(0)
"

cd /overleaf/services/web

echo "== the callback URL is resolved per request =="
node --test /tests/oidc-callback-url.test.mjs

echo "== the discovery document is applied to the environment =="
node --test /tests/oidc-well-known.test.mjs

echo "== the email claim is only trusted when the provider vouches for it =="
node --test /tests/oidc-email-trust.test.mjs

echo "== the identity token is verified against the provider keys =="
node --test /tests/oidc-id-token.test.mjs

echo "== the pending link step and the login page messages =="
node --test /tests/oidc-link-request.test.mjs

echo "== which modules the settings file switches on =="
node --test /tests/overlay-settings.test.mjs

echo "== the TeX Live images of the sandboxed compiles =="
node --test /tests/sandboxed-compiles-images.test.mjs

echo "== the TeX Live settings are in place =="
TLROOT=$(find /usr/local/texlive -maxdepth 1 -type d -name '20*' | head -1)
TLBIN=$(find /usr/local/texlive -maxdepth 3 -type d -name '*-linux' | head -1)
export PATH="$TLBIN:$PATH"
for setting in 'shell_escape = t' 'openout_any = a' 'openin_any = a' 'OSFONTDIR = /usr/share/fonts//' ; do
  grep -qF "$setting" "$TLROOT/texmf.cnf" || { echo "ERROR: '$setting' is missing from $TLROOT/texmf.cnf" ; exit 1 ; }
  echo "  $setting"
done

echo "== the latexmk configuration provides the custom dependencies =="
for dependency in "add_cus_dep( 'Rtex', 'tex', 0, 'do_knitr')" \
                  "add_cus_dep( 'Rnw', 'tex', 0, 'do_knitr')" \
                  "add_cus_dep( 'glo', 'gls', 0, 'glo2gls')" \
                  "add_cus_dep(\"nlo\", \"nls\", 0, \"nlo2nls\")" \
                  "add_cus_dep(\"asy\",\"pdf\",0,\"asy\")" \
                  'run-chktex.sh' ; do
  grep -qF "$dependency" /usr/local/share/latexmk/LatexMk || {
    echo "ERROR: '$dependency' is missing from /usr/local/share/latexmk/LatexMk, a whole feature would be silently unavailable" ; \
    exit 1 ; \
  }
  echo "  $dependency"
done

echo "== the LuaTeX font database is part of the image =="
find "$TLROOT" -name 'luaotfload-names*' -print -quit | grep -q . || {
  echo "ERROR: no luaotfload name database; the first LuaLaTeX compile in a fresh container would rebuild it" ; \
  exit 1 ; \
}

echo "== chktex runs the way the latexmk configuration calls it =="
# The wrapper is what LatexMk invokes when clsi exports CHKTEX_OPTIONS. What is
# checked here is that it runs and writes its output file; whether it finds
# anything in a three-line document is chktex's business.
cd /tmp && rm -rf chktex-check && mkdir chktex-check && cd chktex-check
printf '%s\n' '\documentclass{article}' '\begin{document}' 'Hello  world' '\end{document}' > main.tex
CHKTEX_OPTIONS='-wall' /usr/local/bin/run-chktex.sh "$(pwd)" main.tex || true
test -f output.chktex || { echo "ERROR: run-chktex.sh produced no output.chktex" ; exit 1 ; }
echo "  output.chktex has $(wc -l < output.chktex) line(s)"

echo "== the views compile =="
# the Dockerfile regenerates the precompiled views; this makes a failure
# loud instead of only slowing down the first boot of a container
cd /overleaf/services/web
yarn run precompile-pug

echo "overlay checks passed"
