#!/bin/bash
# Verifies the OIDC overlay inside a built sharelatex-full image.
# Run with: docker run --rm --entrypoint=/bin/bash <image> -c "/bin/bash /tests/verify-oidc.sh"
set -e

echo "== syntax check of the patched files =="
for f in \
  /overleaf/services/web/app/src/Features/Authentication/AuthenticationController.mjs \
  /overleaf/services/web/app/src/Features/Authentication/OidcStrategy.mjs \
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
# OVERLEAF_OIDC_ISSUER is read while the modules are evaluated, so it has to
# be set before node starts
OVERLEAF_OIDC_ISSUER='https://idp.example.com' node --input-type=module -e "
import controller from './app/src/Features/Authentication/AuthenticationController.mjs'
import { OidcStrategy } from './app/src/Features/Authentication/OidcStrategy.mjs'
import { User } from './app/src/models/User.mjs'
import Features from './app/src/infrastructure/Features.mjs'

for (const fn of ['oidcLogin', 'oidcLoginCallback', 'verifyOpenIDConnect', 'extractOidcIdFromProfile', 'ensureOidcLoginEnabled']) {
  if (typeof controller[fn] !== 'function') throw new Error('AuthenticationController.' + fn + ' is missing')
}
if (typeof OidcStrategy !== 'function') throw new Error('OidcStrategy is missing')
if (!User.schema.path('oidcIdentifier')) throw new Error('the User model is missing the oidcIdentifier field')
if (!Features.externalAuthenticationSystemUsed()) throw new Error('OIDC is not treated as an external authentication system')
console.log('OIDC modules OK')
"

echo "== the views compile =="
# the Dockerfile regenerates the precompiled views; this makes a failure
# loud instead of only slowing down the first boot of a container
yarn run precompile-pug

echo "OIDC overlay checks passed"
