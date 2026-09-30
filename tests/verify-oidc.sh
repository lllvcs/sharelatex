#!/bin/bash
# Verifies the OIDC overlay inside a built sharelatex-full image.
# Run with: docker run --rm --entrypoint=/bin/bash <image> -c "/bin/bash /tests/verify-oidc.sh"
set -e

echo "== syntax check of the patched files =="
for f in \
  /overleaf/services/web/app/src/Features/Authentication/AuthenticationController.mjs \
  /overleaf/services/web/app/src/Features/Authentication/OidcStrategy.mjs \
  /overleaf/services/web/app/src/Features/Authentication/OidcCallbackUrl.mjs \
  /overleaf/services/web/app/src/Features/Authentication/OidcDiscovery.mjs \
  /overleaf/services/web/app/src/Features/Authentication/OidcEmailTrust.mjs \
  /overleaf/services/web/app/src/infrastructure/Server.mjs \
  /overleaf/services/web/app/src/infrastructure/Features.mjs \
  /overleaf/services/web/app/src/infrastructure/ExpressLocals.mjs \
  /overleaf/services/web/app/src/router.mjs \
  /overleaf/services/web/app/src/models/User.mjs \
  /overleaf/services/web/app/src/Features/User/UserPrimaryEmailCheckHandler.mjs ; do
  node --check "$f"
  echo "  ok: $f"
done

cd /overleaf/services/web

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

  for (const fn of ['oidcLogin', 'oidcLoginCallback', 'verifyOpenIDConnect', 'extractOidcIdFromProfile', 'ensureOidcLoginEnabled']) {
    if (typeof controller[fn] !== 'function') throw new Error('AuthenticationController.' + fn + ' is missing')
  }
  if (typeof OidcStrategy !== 'function') throw new Error('OidcStrategy is missing')
  if (!User.schema.path('oidcIdentifier')) throw new Error('the User model is missing the oidcIdentifier field')
  if (!Features.externalAuthenticationSystemUsed()) throw new Error('OIDC is not treated as an external authentication system')

  fs.writeSync(1, 'OIDC modules OK\n')
  process.exit(0)
} catch (err) {
  fs.writeSync(2, 'the patched modules do not load: ' + (err && err.stack ? err.stack : err) + '\n')
  process.exit(1)
}
"

echo "== the callback URL is resolved per request =="
node --test /tests/oidc-callback-url.test.mjs

echo "== the discovery document is applied to the environment =="
node --test /tests/oidc-well-known.test.mjs

echo "== the email claim is only trusted when the provider vouches for it =="
node --test /tests/oidc-email-trust.test.mjs

echo "== the views compile =="
# the Dockerfile regenerates the precompiled views; this makes a failure
# loud instead of only slowing down the first boot of a container
yarn run precompile-pug

echo "OIDC overlay checks passed"
