# Overlay

This directory contains complete replacement files and new files that are copied
into the `sharelatex/sharelatex` image. It adds:

| Area | What it adds | Switched on by |
| --- | --- | --- |
| `services/web/app/src/Features/Authentication/Oidc*.mjs`, `AuthenticationController.mjs`, `Server.mjs`, `router.mjs`, `views/user/login*.pug`, ... | OpenID Connect single sign-on | `OVERLEAF_OIDC_ISSUER` |
| `services/web/modules/track-changes/` | track changes and the review panel (comments, ranges, accept/reject) | `OVERLEAF_ENABLE_TRACK_CHANGES` |
| `services/web/modules/sandboxed-compiles/` | which TeX Live image a project compiles in | `SANDBOXED_COMPILES` |
| `services/clsi/app/js/DockerRunner.js`, `DockerLockManager.js`, `seccomp/clsi-profile.json` | the compile service that runs each project in its own container (a Server Pro file) | `SANDBOXED_COMPILES` |
| `etc/overleaf/settings.overlay.cjs`, `overlay-modules.cjs` | module registration, `MAX_UPLOAD_SIZE`, the linked-URL proxy | `OVERLEAF_CONFIG` |

The approach is the same as the one used by
[smhaller/ldap-overleaf-sl](https://github.com/smhaller/ldap-overleaf-sl):
instead of rebuilding Overleaf from source, the files are overwritten inside
the image. Overleaf runs its backend directly from these source files
(`app/src/**/*.mjs`, `modules/**/*.mjs`, `app/views/**/*.pug`), so no
compilation step is needed.

The OIDC implementation is a port of the patches from
[stugen-admins/forks/overleaf-oidc](https://gitlab.informatik.uni-bremen.de/stugen-admins/forks/overleaf-oidc)
(which in turn is based on the Overleaf fork of the fachschaften.org admin
team), adapted to Overleaf `6.3.0` and reworked to avoid adding new npm
dependencies:

- the `@govtechsg/passport-openidconnect` dependency of the original patch is
  replaced by a small strategy built on `passport-oauth2`, which is already
  part of the image. Overleaf `6.x` installs its dependencies with Yarn PnP
  (`yarn workspaces focus --all --production`), so adding a package to a
  derived image is fragile; the overlay therefore only uses packages that are
  already present.
- user creation/updating follows the `6.x` API (`UserCreator.createNewUser`
  requires an `analyticsId`, confirms the email through `options.confirmedAt`
  and synchronises the profile with the identity provider on every login).

The track-changes module and the Docker runner are ports from
[ayaka-notes/ayakaleaf-pro](https://github.com/ayaka-notes/ayakaleaf-pro) (an
Overleaf CE fork with the Server Pro features restored), which is where the
knowledge of *which* piece CE is missing comes from; see
[`DEVELOP_EXPERIMENT.MD`](../DEVELOP_EXPERIMENT.MD).

The important difference to that fork: it rebuilds Overleaf from source, so it
can also ship new frontend code. The overlay cannot. Everything it adds is
therefore **backend or configuration only** - which is exactly why track changes
and sandboxed compiles are portable (their user interface is part of the CE
core) and the AI assistant is not (its components are compiled into the
frontend bundle at build time).


## Base version

The overlay is based on **`sharelatex/sharelatex:6.3.0`**
(CE image revision `370f4763da4bc910da8309c9a71c85ecbe39f6a7`).

The `Dockerfile` verifies the checksum of two files of the base image before
copying the overlay. When the base image is updated, the build fails with
`sha256sum: WARNING: 1 computed checksum did NOT match`, so a base image
update can never silently ship overlay files that no longer match the
application around them.

## Re-basing onto a new Overleaf version

1. Pull the new image and locate its revision:
   ```sh
   docker pull sharelatex/sharelatex:<new-version>
   docker inspect --format '{{ index .Config.Labels "com.overleaf.ce.revision" }}' sharelatex/sharelatex:<new-version>
   ```
2. Check out the Overleaf source at that revision (or the closest public
   commit on the `main` branch) and copy the files listed below into this
   directory again.
3. Re-apply the changes described below, keeping the original file content as
   the base. Keeping the diff minimal makes future re-basing easy.
4. Update the checksums in the `Dockerfile` and the version above:
   ```sh
   docker run --rm sharelatex/sharelatex:<new-version> \
     sha256sum /overleaf/services/web/app/src/Features/Authentication/AuthenticationController.mjs \
               /overleaf/services/web/app/src/router.mjs
   ```
5. Check the things the overlay assumes about the base image, all of which the
   `Dockerfile` reports or verifies during the build:
   - `services/clsi/app/js/CommandRunner.js` still imports a Docker runner, and
     `services/clsi/config/settings.defaults.cjs` still checks for one - print
     their names and adjust the files in `services/clsi/app/js/`;
   - `services/web/app/src/infrastructure/Modules.mjs` still loads modules from
     `Settings.moduleImportSequence`, and `ProjectEditorHandler.mjs` still has
     the `trackChangesAvailable` flag the track-changes module flips;
   - `ProjectOptionsHandler.mjs` / `ProjectCreationHandler.mjs` still read
     `allowedImageNames`, `imageRoot` and `currentImageName`;
   - the TeX Live layout the `Dockerfile` relies on (`/usr/local/texlive/<year>`,
     `texmf.cnf`, the luaotfload name database, `dvipdfmx-unsafe.cfg`) and the
     3-line `/usr/local/share/latexmk/LatexMk` that `texlive/` replaces.
6. Re-check that the frontend still reaches the track-changes UI through the
   project payload (`features.trackChangesVisible`) rather than through
   `Settings.overleafModuleImports`; see `DEVELOP_SKILL.MD`, S14.
7. Update `overlay/README.md` (this file) with the new base version.

For convenience, the files can be extracted from the image without starting
it:

```sh
docker create --name tmp sharelatex/sharelatex:<new-version>
docker cp tmp:/overleaf/services/web/app/src/Features/Authentication/AuthenticationController.mjs .
docker rm tmp
```

## Modified files

### OIDC login

| File | Change |
| --- | --- |
| `app/src/Features/Authentication/OidcStrategy.mjs` | **new file**: minimal OIDC strategy on top of `passport-oauth2`; fetches the profile from the userinfo endpoint, resolves the redirect URI per request |
| `app/src/Features/Authentication/OidcCallbackUrl.mjs` | **new file**: picks the redirect URI for a request (automatic/derived, one URL, or a list of URLs); no imports besides `node:url`, so `tests/oidc-callback-url.test.mjs` can test it on its own |
| `app/src/Features/Authentication/OidcDiscovery.mjs` | **new file**: reads the provider's discovery document (`OVERLEAF_OIDC_WELL_KNOWN_URL`) and fills the unset `OVERLEAF_OIDC_*` endpoint variables; only imports `node:timers/promises`, tested by `tests/oidc-well-known.test.mjs` |
| `app/src/Features/Authentication/OidcEmailTrust.mjs` | **new file**: whether the `email` claim may identify an account - it decides whether an existing account is linked and whether the stored address is rewritten (`email_verified`, overridable with `OVERLEAF_OIDC_TRUST_UNVERIFIED_EMAIL`); no imports, tested by `tests/oidc-email-trust.test.mjs` |
| `app/src/Features/Authentication/OidcIdToken.mjs` | **new file**: verifies the provider's `id_token` (signature against the JWKS, `iss`, `aud`, `exp`/`nbf`/`iat`, `sub`; RSA/ECDSA only) with `node:crypto`, so no dependency is added; fetch, clock and the JWKS cache are injectable, tested by `tests/oidc-id-token.test.mjs` |
| `app/src/Features/Authentication/OidcLinkRequest.mjs` | **new file**: the pending "link this identity after the password was confirmed" state (session-bound, 10 minutes, single use), the `OVERLEAF_OIDC_LINK_MODE` policy and the login page messages (a code from the query string is mapped to text); no imports, tested by `tests/oidc-link-request.test.mjs` |
| `app/src/Features/Authentication/AuthenticationController.mjs` | adds `oidcLogin`, `oidcLoginCallback`, `oidcLinkPage`, `oidcLink`, `verifyOpenIDConnect`, `extractOidcIdFromProfile`, `ensureOidcLoginEnabled`; extracts `createPassportCallback`; disables local login when `OVERLEAF_ENABLE_LOCAL_LOGIN=false`; `ensureOidcLoginEnabled` accepts the request only when the strategy is registered (`oidcIsConfigured`) |
| `app/src/infrastructure/Server.mjs` | reads the discovery document when `OVERLEAF_OIDC_WELL_KNOWN_URL` is set and registers the `oidc` passport strategy when the configuration is usable (`oidcIsConfigured`), passing `OVERLEAF_OIDC_CALLBACK_URL(S)`, `OVERLEAF_OIDC_JWKS_URL`, `OVERLEAF_OIDC_REQUIRE_ID_TOKEN` and Overleaf's `behindProxy` setting |
| `app/src/infrastructure/ExpressLocals.mjs` | exposes the login/OIDC configuration to the views; the SSO button is only offered when the strategy is registered (`oidcIsConfigured`); turns `?oidc_error=<code>` into the message the login page shows (unknown codes render nothing) |
| `app/src/infrastructure/Features.mjs` | counts OIDC as an external authentication system (hides the registration page unless `OVERLEAF_ENABLE_REGISTRATION` overrides it); reads the issuer when it is asked instead of at import time, so the discovery document can supply it |
| `app/src/models/User.mjs` | adds the `oidcIdentifier` field |
| `app/src/Features/User/UserPrimaryEmailCheckHandler.mjs` | skips the primary email check for OIDC users (the mail address is asserted by the provider) |
| `app/src/router.mjs` | adds `/login/oidc`, `/login/oidc/callback` and the password step `/login/oidc/link` (GET and POST, with the same rate limit and captcha middleware as a password login); redirects `/register` to `/login` when registration is disabled |
| `app/views/user/login.pug` | hides the password form when local login is disabled, adds the SSO button, the `OVERLEAF_LOGIN_INFO_TEXT` text and the reason a single sign-on login failed |
| `app/views/user/login-oidc-link.pug` | **new file**: the page that asks for the password of an existing account before an OIDC identity is bound to it |
| `app/views/layout/navbar-marketing.pug` | optional SSO button in the navigation bar |

### Track changes and the review panel

| File | Change |
| --- | --- |
| `modules/track-changes/index.mjs` | **new file**: sets `ProjectEditorHandler.trackChangesAvailable = true`, the one switch that keeps the whole feature hidden in CE, and registers the router |
| `modules/track-changes/app/src/TrackChangesRouter.mjs` | **new file**: the eleven routes of the feature (toggle track changes, accept changes, ranges, change authors, threads, comment create/edit/delete, resolve, reopen, delete thread), each behind the core `AuthorizationMiddleware` |
| `modules/track-changes/app/src/TrackChangesController.mjs` | **new file**: the handlers. Everything they call exists in CE core; the only import outside of it is `p-limit`, which is a declared dependency of `@overleaf/web` in the image. **Deviates from the original in one place**: `acceptChanges` also passes the accepting user id (the ported version passed three of the four arguments, so the `changesAccepted` hook received `undefined`) |

### Sandboxed compiles

| File | Change |
| --- | --- |
| `modules/sandboxed-compiles/index.mjs` | **new file**: fills `Settings.imageRoot`, `Settings.allowedImageNames` and `Settings.currentImageName`, the three settings the CE core reads but never sets |
| `modules/sandboxed-compiles/app/src/TexLiveImages.mjs` | **new file**: derives those three values from `ALL_TEX_LIVE_DOCKER_IMAGES`, `ALL_TEX_LIVE_DOCKER_IMAGE_NAMES`, `TEX_LIVE_DOCKER_IMAGE` and `IMAGE_ROOT`, and refuses a configuration whose parts contradict each other; imports only Node built-ins, so `tests/sandboxed-compiles-images.test.mjs` can test it on its own |
| `services/clsi/app/js/DockerRunner.js` | **new file**: the compile runner that starts a container per compile (a Server Pro file the CE image does not ship; CE only ships its unit test). Ported from ayakaleaf, unchanged |
| `services/clsi/app/js/DockerLockManager.js` | **new file**: the lock `DockerRunner` uses, also a Server Pro file |
| `services/clsi/app/js/DockerRunner.mjs` | **new file**: a one-line re-export of `DockerRunner.js`. The CE code names the runner in two places (`CommandRunner.js` imports it, `config/settings.defaults.cjs` checks that it exists) and releases have used both extensions; shipping both names makes the overlay independent of that |
| `services/clsi/seccomp/clsi-profile.json` | **new file**: the seccomp profile the compile containers run under. `config/settings.defaults.cjs` reads this path and exits when it is missing, so it is required, not optional |

### Settings

| File | Change |
| --- | --- |
| `etc/overleaf/settings.overlay.cjs` | **new file**: what `OVERLEAF_CONFIG` points at. Loads `/etc/overleaf/settings.js` of the base image (which is no longer replaced, only read) and adds the settings below |
| `etc/overleaf/overlay-modules.cjs` | **new file**: which modules the environment asks for, how they are appended to `moduleImportSequence` of the base image, and the two settings that only exist here (`MAX_UPLOAD_SIZE`, the linked-URL proxy); imports only Node built-ins, tested by `tests/overlay-settings.test.mjs` |

The `settings.overlay.cjs` file is installed at `/etc/overleaf/settings.overlay.cjs`
and the `Dockerfile` points `OVERLEAF_CONFIG` at it. That variable is already set
by the CE image (to `/etc/overleaf/settings.js`, which this file loads and
extends), so the upstream settings keep being applied in full and this image
only adds to them. **Overriding `OVERLEAF_CONFIG` replaces this file**: a
deployment that sets it would lose the module registration above, without an
error. Point it at a file that requires `settings.overlay.cjs` if you need your
own.

## Notes

- `.pug` files are precompiled to `.js` at image build time and take
  precedence at boot, so the `Dockerfile` deletes all precompiled templates
  after copying the overlay. The views are then compiled from source when a
  container boots (a few seconds), which guarantees that the modified
  templates are actually used.
- Overleaf `6.x` restricts direct access to request input
  (`req.query`/`req.body`, `REQ_LOCKDOWN_MODE`). The OIDC flow reads request
  parameters only through `passport-oauth2`, which is patched for this in the
  image; the added code does not access raw request input. The ported
  track-changes routes do read `req.body` and `req.params` directly, the way the
  core routes they were taken from do. `REQ_LOCKDOWN_MODE` is unset in this image
  (its default is `off`), so this works; **`REQ_LOCKDOWN_MODE=throw` would break
  those routes**, and they are the only part of the overlay that would need
  `parseReq` schemas before that mode can be used.
- The token exchange sends the client credentials in the request body
  (`client_secret_post`). Make sure the OIDC client is configured accordingly.
- The redirect URI is resolved per request in `OidcCallbackUrl.mjs`:
  `passport-oauth2` resolves a *relative* callback URL against the URL of the
  request being authenticated and honours the `X-Forwarded-*` headers when the
  strategy is constructed with `proxy` (it gets `Settings.behindProxy`, which
  is `true` in the CE image). That is what makes a deployment reachable under
  several host names work without configuration; the same value is used for the
  authorization request and the token exchange because both go through
  `strategy.authenticate()`. `OVERLEAF_OIDC_CALLBACK_URL` (one URL) and
  `OVERLEAF_OIDC_CALLBACK_URLS` (a list, matched by host name, with the port
  deciding when both sides name one) pin the value for providers that require an
  exact match with the registered URI. `requestOrigin()` prefers the header that
  carries a port (`Host`, `X-Forwarded-Host` or `X-Forwarded-Port`), because the
  CE nginx sets both host headers from nginx's `$host`, which drops the port -
  for an instance on a non-standard port the URI therefore has to be pinned, or
  the proxy has to send `X-Forwarded-Port`.
- `OVERLEAF_OIDC_WELL_KNOWN_URL` is resolved while the server starts
  (`applyWellKnownConfiguration()`, awaited in `Server.mjs` before the passport
  strategy is registered). The document's values are written into
  `process.env` as defaults, so all the other code keeps reading plain
  environment variables and explicit values keep winning. Nothing is fetched
  when the issuer and the three endpoint variables are set by hand. A document
  that cannot be read, or that does not carry the endpoints, is **logged** and
  leaves OIDC login disabled (`oidcIsConfigured()` gates the strategy
  registration, and it also requires the client id and secret, without which
  the passport-oauth2 constructor would throw), so a misconfigured provider
  cannot keep the whole application from starting. The variable also accepts the document itself (a value
  starting with `{`), and the default scope is reduced to what the document
  lists in `scopes_supported` (an explicit `OVERLEAF_OIDC_SCOPE` is left
  alone), because providers such as Synology's SSO server reject unsupported
  scopes. `applyDocument()` validates before it writes anything, so a
  rejected document never leaves a half-applied configuration behind. Because
  the issuer, and with it the "OIDC is enabled" flag, may come from the
  document, module-level reads of `process.env.OVERLEAF_OIDC_ISSUER` had to
  become call-time reads (see `Features.mjs`); the other readers already
  evaluate it per request. The retry loop is bounded by a 60-second budget
  (`budgetMs`) as well, because it runs before the web service starts listening.
- The `email` claim of a userinfo response only identifies an account - linking
  an existing one on the first login, and rewriting the address on every login -
  when the provider vouches for it: `email_verified: true`, or the claim not
  stated at all (logged). `email_verified: false` refuses the link and keeps the
  stored address. See `OidcEmailTrust.mjs`; the decision lives in one place so
  the policy cannot drift between the two call sites.
- An identity that matches an existing account which is **not linked yet** is
  parked in the session and the user has to confirm the account's password
  (`/login/oidc/link`) before the identity is bound (`OidcLinkRequest.mjs`). The
  bind itself is a `$set` of `oidcIdentifier`, done only after the credentials
  were checked through the same code path a password login uses, so failed
  attempts are audited and rate limited identically. `OVERLEAF_OIDC_LINK_MODE=auto`
  restores the earlier behaviour of linking straight away.
- `OidcStrategy.mjs` normalises the two call shapes of `passport-oauth2` and
  captures the token response itself (keyed by the authorization code, which is
  unique per request), so the `id_token` can be verified without depending on
  which passport-oauth2 version is installed. The strategy hands the application
  `verify(req, accessToken, refreshToken, { params, idTokenClaims }, profile, done)`
  and refuses the login when the token does not verify or when its `sub` differs
  from the one in the userinfo response.

### Track changes

- A module directory is **not** picked up by itself: `Modules.loadModulesImpl()`
  walks `Settings.moduleImportSequence` and imports `modules/<name>/index.mjs`
  for each entry. Nothing else in the image changes that sequence, which is why
  the overlay ships a settings file for it - see above.
- `modules/track-changes/index.mjs` flips a flag on a core module's export at
  import time (`ProjectEditorHandler.trackChangesAvailable = true`). That is the
  whole switch: the core then reports `features.trackChangesVisible: true` in the
  project payload, and the review panel that is already part of the frontend
  bundle becomes reachable. There is no equivalent flag to set from the settings
  file.
- The feature is **opt-in** (`OVERLEAF_ENABLE_TRACK_CHANGES=true`). The user
  interface it switches on - the review panel, the track-changes toolbar and the
  comment threads - ships in the CE frontend bundle, but whether it works with
  the rest of a given deployment (the document-updater's range handling, the
  chat service) can only be seen by using it. Turning it on is therefore a
  decision, not a default.
- The user interface is reached through the *core* frontend, not through
  `Settings.overleafModuleImports` (the registry that pulls module frontends into
  the webpack build). That is the reason this feature is portable and, for
  example, the error assistant is not: its components are compiled into the
  bundle and a runtime setting cannot add them.

### Sandboxed compiles

- The CE image is *wired* for sibling containers (its clsi start script adds
  `www-data` to the group of `/var/run/docker.sock` when the socket is mounted)
  but does not ship the runner: `services/clsi/config/settings.defaults.cjs`
  exits with "Sandboxed compiles are only available with Overleaf Server Pro"
  when `SANDBOXED_COMPILES=true` and the file is missing. The overlay adds the
  file, so the feature becomes available; it also has to be *configured* on the
  host, see `README.md`.
- The compile container runs as `Settings.clsi.docker.user`, which clsi defaults
  to `TEXLIVE_IMAGE_USER` or `tex` (uid 1000). The directories it compiles in
  belong to `www-data` - the uid clsi writes them with - so the overlay sets the
  user to `www-data` when `SANDBOXED_COMPILES` is on. Without that, every
  sandboxed compile fails on a permission error, which is why later releases of
  the base image export `TEXLIVE_IMAGE_USER=www-data` from
  `/etc/overleaf/env.sh` (a file this overlay does not replace; an explicit
  `TEXLIVE_IMAGE_USER` still wins).
- The seccomp profile is version dependent. `clsi-profile.json` is the one that
  belongs to the clsi of this base image (the copy in
  `ayaka-notes/texlive-full` is an older, smaller one: 171 instead of 205 syscall
  groups). A profile that is too old makes `minted` fail with a permission error
  that looks like a user or config problem.
- `services/clsi/package.json` already depends on `dockerode`, `async` and
  `lodash`, so the runner needs no new package - the same constraint as
  everywhere else in this overlay (S2).
- The image a project compiles in must be tagged `<year>.<something>`: the
  runner reads the TeX Live year out of the tag to build the `PATH` inside the
  compile container (`image.match(/:([0-9]+)\.[0-9]+/)`). `lvcs/sharelatex:6.3.0`
  would be read as "TeX Live 6".
