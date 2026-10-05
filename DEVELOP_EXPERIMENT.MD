# Overleaf CE (sharelatex) fork — development record

> **What this file is.** The record of how this fork adds features to Overleaf
> CE and what happened while building them: the structure, the findings that
> shaped it, the security decisions that were made afterwards, the verification
> that exists today, and the traps this approach carries. Written for a
> developer who is about to change it and wants the history rather than the
> rules.
>
> The **rules** distilled from this record live in
> [`DEVELOP_SKILL.MD`](./DEVELOP_SKILL.MD) (English, agent-facing). Configuration
> and deployment *usage* live in [`README.md`](./README.md) /
> [`README.zh-CN.md`](./README.zh-CN.md).

- Approach: **no Overleaf rebuild** — `overlay/` holds complete replacement files
  and new files copied into the `sharelatex/sharelatex` image; Overleaf runs its
  backend directly from these sources, so there is no compile step.
- Upstream baseline: Overleaf CE `6.3.0`; published image `lvcs/sharelatex`
- Prior art: the overlay mechanism follows `smhaller/ldap-overleaf-sl`; the OIDC
  implementation is a port of `stugen-admins/forks/overleaf-oidc`; the
  track-changes module and the clsi Docker runner are ports of
  `ayaka-notes/ayakaleaf-pro`; the TeX Live toolchain files and the font-cache
  work come from `ayaka-notes/texlive-full`.

---

## 1. Change list

The OIDC work, by commit:

| Commit | What changed |
| --- | --- |
| `9df94e4` | OIDC login and redirect-URI resolution introduced (`OidcCallbackUrl`) |
| `224c869` `90210b8` | login support and error handling completed; configuration requirements documented |
| `d0febbe` | **only vouched-for email addresses identify an account** (`OidcEmailTrust`) |
| `0cac0a6` | first-time linking confirms the **account password**; the **id_token is verified** (`OidcIdToken`, `OidcLinkRequest`) |
| `2bd219e` | a wrong discovery URL is reported at once; a trailing slash on the issuer is ignored |
| `675fbff` | CI: build the image once, publish as a separate step |
| `8c5d0ba` | build-time font verification + documentation |
| `1f39b68` `da84d4c` | image name unified as `lvcs/sharelatex` |
| `3856bd7` | marketing navbar layout (unrelated to OIDC) |

The second round — porting from `ayakaleaf-pro-server-pro` and
`texlive-full-main` — by area (see §3–§5 for the reasoning):

| Area | What changed |
| --- | --- |
| Track changes | `modules/track-changes/**` (3 files) + `OVERLEAF_ENABLE_TRACK_CHANGES` |
| Sandboxed compiles | `modules/sandboxed-compiles/**`, `services/clsi/app/js/DockerRunner.js`, `DockerLockManager.js`, `DockerRunner.mjs` (shim), `services/clsi/seccomp/clsi-profile.json` |
| Settings | `etc/overleaf/settings.overlay.cjs`, `etc/overleaf/overlay-modules.cjs`, `ENV OVERLEAF_CONFIG`, `MAX_UPLOAD_SIZE`, the linked-URL proxy |
| Compile toolchain | `texlive/LatexMk`, `texlive/run-chktex.sh`, `texlive/patchSynctex.R`, R + knitr + stringr, ghostscript, qpdf, gnuplot, python3-pygments, `time`, `LANG=C.UTF-8` |
| TeX Live configuration | `openout_any`/`openin_any`, `OSFONTDIR`, Type1 rejection in fontconfig, `luaotfload-tool --update`, `fc-cache -fsv`, the essential-package safety net |
| Verification | `tests/verify-overlay.sh` (was `verify-oidc.sh`), `tests/overlay-settings.test.mjs`, `tests/sandboxed-compiles-images.test.mjs`, `tests/knitr` |

---

## 2. How the integration is built

Overleaf ships its backend as plain ESM source in the image
(`app/src/**/*.mjs`, `modules/**/*.mjs`, `app/views/**/*.pug`), so replacing
those files inside the image changes behaviour without touching the build. The
overlay therefore contains:

| File under `overlay/services/web/app/src/...` | Responsibility |
| --- | --- |
| `Features/Authentication/OidcStrategy.mjs` | passport strategy: code exchange, userinfo, account matching |
| `Features/Authentication/OidcIdToken.mjs` | id_token validation: JWKS signature, `iss`/`aud`/`exp`/`nonce` |
| `Features/Authentication/OidcEmailTrust.mjs` | decides whether an address may identify an account |
| `Features/Authentication/OidcLinkRequest.mjs` | first-time linking (password confirmation) |
| `Features/Authentication/OidcCallbackUrl.mjs` | redirect URI: explicit → list → derived from the request |
| `Features/Authentication/OidcDiscovery.mjs` | `.well-known` discovery, failing fast |
| `Features/Authentication/AuthenticationController.mjs` | routes and flow orchestration (wholesale replacement) |
| `Features/User/UserPrimaryEmailCheckHandler.mjs`, `models/User.mjs` | minimal account/email adaptations |
| `infrastructure/{Features,Server,ExpressLocals}.mjs`, `router.mjs` | feature flag and route registration |
| `views/user/{login.pug,login-oidc-link.pug}`, `views/layout/navbar-marketing.pug` | login entry point and linking page |

and, outside it:

| Path | Responsibility |
| --- | --- |
| `services/web/modules/track-changes/**` | track changes and the review panel |
| `services/web/modules/sandboxed-compiles/**` | the TeX Live image settings of a project |
| `services/clsi/app/js/DockerRunner.{js,mjs}`, `DockerLockManager.js` | the compile container runner |
| `services/clsi/seccomp/clsi-profile.json` | the seccomp profile of the compile containers |
| `etc/overleaf/settings.overlay.cjs`, `overlay-modules.cjs` | what `OVERLEAF_CONFIG` points at |

**Constraint that shaped the implementation:** the image installs dependencies
with **Yarn PnP**, and the overlay never reinstalls them — a new package cannot
resolve. The upstream patch depended on `@govtechsg/passport-openidconnect`;
this fork replaced it with a small strategy over the already-present
`passport-oauth2`. Every import must be a Node built-in or a package that is
already in the image. The two ports of the second round were chosen partly
because they satisfy this: the Docker runner needs `dockerode`, `async` and
`lodash`, all of which `services/clsi/package.json` already declares, and the
track-changes module needs `p-limit`, which `@overleaf/web` already declares.

---

## 3. What the CE image keeps and what it removes

This is the finding the whole second round rests on, and it is worth stating
plainly because it is counter-intuitive: **the CE image is not a smaller
application, it is the same application with three things taken out.**

Comparing the image with a fork that restored the Server Pro features
(`ayaka-notes/ayakaleaf-pro`):

| Layer | What CE keeps | What CE removes |
| --- | --- | --- |
| `services/web/app/src` | **everything**, byte-identical to the fork apart from two files (see §6) | — |
| `services/web/modules` | 5 modules | the other 18 (all Pro/SaaS features) |
| `services/web/config/settings.defaults.js` | all code that *reads* a setting | the defaults of the Pro settings, and the module list |
| `services/web/frontend` | the source of the whole UI, including the Pro screens | nothing (the frontend is not what is gated) |
| `services/clsi` | everything except two files | `DockerRunner.js`, `DockerLockManager.js`, `seccomp/` |

The consequences are what make the ports possible:

- **Settings are a working switch.** `Settings.enableGitBridge`,
  `allowedImageNames`, `imageRoot`, `currentImageName`, `apis.linkedUrlProxy`,
  `trackChangesAvailable` and others are read by CE core code that has no default
  for them. Writing the setting is enough. This is also why a vanilla CE
  deployment cannot offer linked URLs: `UrlHelper` throws
  `no linked url proxy configured`, although the image runs the
  `linked-url-proxy` service.
- **A module directory is the unit of enablement.** `Modules.loadModulesImpl()`
  imports `modules/<name>/index.mjs` for every entry of
  `Settings.moduleImportSequence` and does nothing else - no directory scan, no
  auto-discovery, no build step. Adding a directory plus one name activates a
  feature.
- **The user interface is the part that cannot be added at runtime.** Components
  that a module contributes are pulled into the webpack build through
  `Settings.overleafModuleImports`, which a Babel macro resolves **at build
  time**. A runtime setting cannot add an import to an already-built bundle.
  That single fact separates the portable features from the rest:

  | Feature | Why it is portable / not |
  | --- | --- |
  | track changes, review panel | the UI is *core* frontend source, reached through the `trackChangesVisible` field of the project payload - no registry entry needed |
  | sandboxed compiles | no UI of its own; the image picker is core |
  | sign-in (any kind), registration | core views |
  | AI assistant (workbench), error assistant, admin panel, template gallery, Git bridge, GitHub sync, Zotero/Mendeley, personal access tokens, open-in-overleaf | the components are module frontend files registered in `overleafModuleImports` - **not in the bundle**, so the feature cannot be reached |
  | symbol palette, Python runner, reference picker | the module *is* the frontend: its `index.mjs` registers no routes, no hooks and no settings, it only exists so the registry has something to point at. Adding them would change nothing at all |
  | `learn` (the documentation mirror) | backend-only and its imports resolve, so it is the one rejected candidate that *would* work - but the module fetches and caches every page of the upstream wiki **while the server starts**, with no timeout, before it accepts a request |
  | LDAP, the fork's own OIDC module | **not to be ported, by decision as well as by constraint.** Both are additionally blocked (`ldapjs` and `passport-openidconnect` are not declared by `@overleaf/web`, so PnP refuses the import and the whole web service fails to boot), but the decision stands on its own: this fork's OIDC support is the one that is used and hardened here (§6), and the fork's module registers a *second* `oidc` strategy with its own `/oidc/login` routes and its own `Settings.oauthProviders`, which would collide with `/login/oidc` instead of extending it |
  | `authentication/saml` | resolvable - `@node-saml/passport-saml` is declared and patched - but it carries its own login and logout routes that would collide with the OIDC overlay's, and the fork's patched `@node-saml/node-saml` resolution is *not* applied in this image, so its behaviour could not be verified before shipping it |
  | `login-register`'s `@domain` registration restriction | the module is a whole replacement of the login and registration pages, which this fork already replaces for OIDC; only its "registration is limited to one email domain" check would add something, and that belongs in the core register controller rather than in a second one |

  The AI case is worth recording in full because it is the one people ask for:
  the image *does* declare `ai@6`, `@ai-sdk/openai`, `@ai-sdk/google-vertex`,
  `@ai-sdk/mcp` and `zod`, so the backend would run after replacing a single
  import (`createOpenAICompatible` from `@ai-sdk/openai-compatible`, which is
  only a transitive dependency). It would still be unreachable, because the chat
  panel, the error-assistant components and the editor extension that trigger it
  are compiled into the bundle.

  **How far the "frozen frontend" reaches, measured.** The image was read
  directly from the registry (`.research/image-inspection/`, which also records
  the method), and the answer is more interesting than "the UI is missing":

  | Piece | In the image? |
  | --- | --- |
  | `services/web/frontend/` (the whole UI source) | yes, 2367 entries |
  | `webpack.config*.js`, `frontend/macros/import-overleaf-module.macro.js` | yes |
  | `public/js/*.js` and `public/manifest.json` (the built bundle) | yes |
  | `overleaf/.pnp.cjs` | yes, 1.19 MB |
  | the webpack **toolchain** in that PnP map | **no** - devDependencies are pruned after the build (`genScript.js` ends its compile step with `yarn workspaces focus --all --production`) |
  | the **yarn cache** of those pruned packages | yes, largely (2829 zips, including webpack's loaders and `@babel/*`) |

  And the bundle's own `public/manifest.json` has 41 entrypoints, of which
  exactly two belong to a module (`modules/launchpad/pages/launchpad`,
  `modules/user-activate/pages/user-activate-page`). So the UI of those features
  is genuinely not in the image, and switching one on **without** rebuilding does
  not give an empty page - `ExpressLocals.getWebpackAssets()` indexes
  `webpackManifest.entrypoints[entrypoint].assets`, so an unknown entrypoint is an
  **HTTP 500**, which is worse than the feature being absent.

  Rebuilding is possible, and upstream does it in this shape:
  `OVERLEAF_CONFIG=<a settings file with a filled registry> yarn run
  webpack:production`, after `yarn install` restores the devDependencies from the
  cache. What it costs: a much longer image build, a generated bundle that has to
  be regenerated on every upstream bump, and - for the AI modules specifically -
  a one-line import substitution plus an AI gateway to point at. It is also easy
  to get silently wrong: running webpack without `OVERLEAF_CONFIG` reads the
  image's own all-empty registry and produces an equally empty bundle **with a
  green build**. That is the pivot point if this repository ever takes on a
  frontend rebuild; it is not something the overlay can do.
- **Order in the module list is load-bearing.** The sequence is walked with
  `await import()`, so one module whose imports do not resolve aborts
  `loadModules()` and the web service does not start. Only modules that are
  known to resolve may be added.

### 3.1 What only the image could settle

Three of the overlay's assumptions were checked against the published image
rather than against the source tree, and one of them was wrong:

| Assumption | Result |
| --- | --- |
| the compile runner is `DockerRunner.js`, and clsi checks the same name | confirmed - `CommandRunner.js` imports it and `config/settings.defaults.cjs:133` stats it, and neither file is in the image |
| `/usr/local/share/latexmk/LatexMk` is the three-line stub | confirmed (125 bytes), so replacing it is a strict gain |
| `qpdf` and `time` are already installed, `ghostscript`/`Rscript`/`gnuplot`/`chktex`/`inkscape`/`lilypond` are not | confirmed |
| TeX Live lives at `/usr/local/texlive/<year>` and only DejaVu is in `/usr/share/fonts` | confirmed (2026) |
| **`server-ce/config/env.sh` sets `TEXLIVE_IMAGE_USER` for sibling compiles** | **wrong for 6.3.0.** The image's `env.sh` (383 bytes) has only the `*_HOST` exports; the block exists on `main`, not here. clsi would therefore start the compile container as `tex` (uid 1000) while the compile directories belong to `www-data` (uid 33), and every sandboxed compile would fail on a permission error. The overlay sets `Settings.clsi.docker.user` itself now |

That last row is the reason the inspection was worth the download: it is a
failure that only shows up on a real compile, in a deployment, with the socket
mounted.

---

## 4. Track changes and the review panel

The feature looked like the one that would need a rebuild, and it is the
opposite: **everything is in the image except a boolean.**

- `ProjectEditorHandler.mjs` has `trackChangesAvailable: false` and reports it as
  `features.trackChangesVisible` in the project payload. The frontend reads that
  field; nothing in the frontend can turn the feature on.
- `Features.hasFeature('track-changes')` is
  `Settings.moduleImportSequence.includes('track-changes')` - it does not depend
  on any setting.
- Every backend method the feature needs exists in the CE core and is called by
  the core in the licensed product: `DocumentUpdaterHandler.acceptChanges`
  / `getProjectRanges` / `resolveThread` / `reopenThread` / `deleteThread`,
  `DocstoreManager.getTrackedChangesUserIds`, the `ChatApiHandler` thread
  methods, the `AuthorizationMiddleware` guards
  (`ensureUserCanWriteOrReviewProjectContent`,
  `ensureUserCanDeleteOrResolveThread`), `EditorRealTimeController.emitToRoom`.
  The `document-updater` service ships `RangesManager.js` and
  `TrackedChangePreview.js`; `defaultFeatures.trackChanges` is `true`, so users
  are entitled to the feature by default.
- The review panel itself lives in `services/web/frontend/js/features/review-panel`
  of the *same public source tree* the CE frontend is built from, and it is
  rendered from the source editor behind `features.trackChangesVisible`.
  `tests/verify-overlay.sh` proves the backend half inside the image; the frontend
  half can only be proven by using it, which is why the feature is opt-in.

The module is three files and 10 KB; the port was mostly *deciding that it was
safe to try*, which the analysis above is.

One deliberate deviation from the fork it was ported from: its
`acceptChanges` passed three of the four arguments of
`DocumentUpdaterHandler.acceptChanges(projectId, docId, changeIds, userId)`, so
the `changesAccepted` hook was told the wrong user (`undefined`). The overlay
passes the session user, like the neighbouring handlers do.

---

## 5. Sandboxed compiles, and the TeX Live toolchain

### 5.1 The compile service

CE is *wired* for sibling containers and does not ship the code: its clsi start
script adds `www-data` to the group of `/var/run/docker.sock` when the socket is
mounted, and `CommandRunner.js` contains

```js
commandRunnerPath = Settings.clsi.dockerRunner === true
  ? './DockerRunner.js'
  : './LocalCommandRunner.js'
```

but `services/clsi/config/settings.defaults.cjs` first checks that this file
exists and otherwise exits with *"Sandboxed compiles are only available with
Overleaf Server Pro"*. Two files (plus the seccomp profile, which the same
settings file reads and requires), and the feature is available.

Three findings made this port more than a file copy:

1. **The runner is named inconsistently across releases.** The public CE tree
   names it `DockerRunner.js` in both places; the fork renamed it to
   `DockerRunner.mjs` and updated both. Since the overlay has to work on one
   *specific* base image but should survive a re-base, it ships the real file as
   `DockerRunner.js` and a one-line re-export as `DockerRunner.mjs`. The
   `Dockerfile` prints which name the base image uses, so a change is visible in
   the build log rather than in a compile error.
2. **The web side needs three settings that nothing in CE sets.**
   `Settings.allowedImageNames`, `imageRoot` and `currentImageName` are read by
   `ClsiManager`, `ProjectOptionsHandler`, `ProjectCreationHandler` and
   `ProjectHelper`, and are never assigned, so the image picker is inert in CE
   and `bin/run-script scripts/set_tex_live_image.mjs` throws. The module derives
   them, and - unlike the version it was ported from - validates that they agree:
   `ProjectOptionsHandler.normalizeImageName()` rebuilds the image as
   `imageRoot + '/' + imageName`, while clsi hands `TEX_LIVE_DOCKER_IMAGE` to
   Docker unchanged, so a list of bare names plus a prefix produces two different
   references for the same project. That contradiction is now refused at startup,
   with the correction in the message.
3. **The image tag is not decoration.** `DockerRunner` reads the TeX Live year
   out of the tag (`image.match(/:([0-9]+)\.[0-9]+/)`) to build the `PATH` inside
   the compile container. `lvcs/sharelatex:6.3.0` would be read as "TeX Live 6".
   This is why this image cannot be its own compile image, and it is the most
   likely way to misconfigure the feature.

The deployment side is not code and cannot be: the Docker socket, the host paths
of the compile directories and the image list are the operator's part, and the
toolkit only does its half when `SERVER_PRO=true`. That is documented in
`README.md`; the trap is that the *toolkit* half (socket mount, `bin/up` pulling
the images) is gated on that flag while the *clsi* half is gated on the file
existing, so a half-configured setup fails in a way that mentions the other half.

### 5.2 The compile toolchain

The comparison with `texlive-full` was worth doing for a reason that is easy to
miss: the difference between the two images is not mainly the *packages*, it is
the **configuration of the tools**.

The CE image installs TeX Live and then points latexmk at
`/usr/local/share/latexmk/LatexMk`, which in CE is three lines
(`$go_mode = 3;`). Overleaf's own compile image ships the real file, which is
what makes these work:

- `.Rtex`/`.Rnw` documents (the knitr custom dependency, `Rscript`, the
  `knitr`/`stringr` packages, the SyncTeX patching of R code),
- glossaries and nomenclature (`makeglossaries`, `makeindex`),
- `feynmf`/`feynmp`, asymptote, metapost (their auxiliary programs),
- the *Check* button: clsi exports `CHKTEX_OPTIONS` and friends and only the
  configuration file consumes them, so without it the button silently does
  nothing,
- `output.pdfxref`, which the PDF preview reads and only the qpdf step in that
  file writes.

Shipping the file means the compile toolchain has to be complete, so the port
came with R (`r-base-core`, `r-cran-knitr`, `r-cran-stringr`), ghostscript,
qpdf, gnuplot, `python3-pygments`, GNU `time` and a UTF-8 locale. `tests/knitr`
compiles an `.Rnw` document, and `tests/verify-overlay.sh` checks the custom
dependencies and runs `run-chktex.sh`.

Two smaller items from the same comparison:

- **The font caches.** Without `luaotfload-tool --update` at build time, the
  first LuaLaTeX compile in a fresh container rebuilds the whole font database -
  slow enough to hit the compile timeout, and easy to mistake for a slow
  document. `fc-cache -fsv` does the same for fontconfig. The cache has to be
  written into the TeX Live tree, **not** into `TEXMFVAR`
  (`/var/lib/overleaf/tmp/texmf-var`): `/var/lib/overleaf` is a volume, so
  anything written there while building the image is invisible at runtime.
- **The texmf.cnf settings.** `openout_any`/`openin_any` are the other half of
  shell-escape (minted, inkscape/svg, gnuplot and tikzexternalize write outside
  the working directory, which the default `p` refuses), and `OSFONTDIR` is a
  kpathsea-level route to the system fonts next to the fontconfig one. The
  `Dockerfile` also hides Type1 fonts from fontconfig, because XeTeX cannot embed
  them and matches them by family name.

Deliberately **not** ported from `texlive-full`: the Google Fonts download and
the Microsoft core-font installer. This image vendors its fonts instead and says
so; adding a build-time download from a third-party mirror would trade a
reproducible build for fonts of uncertain licence. What *was* taken from the same
idea is the font coverage itself, by a different route - see below.

### 5.3 The fonts Overleaf documents

The gap the comparison exposed was real: a document that says
`\setmainfont{Open Sans}` or `\setmainfont{Amiri}` stopped with *"The font ...
cannot be found"* even though the image carries all of TeX Live `scheme-full`,
because the families Overleaf
[lists as usable through `fontspec`](https://www.overleaf.com/learn/latex/Questions/Which_OTF_or_TTF_fonts_are_supported_via_fontspec%3F)
are only partly TeX Live fonts. That page also says what to do about the rest -
*"use the relevant Google Noto font, as included in Ubuntu 22.04"* - which is the
route taken here: **the distribution's font packages**, not the `google/fonts`
repository that `texlive-full` downloads at build time.

Three things made the port more careful than a package list:

1. **Reproducibility across the base image's release.** Every package was checked
   to exist in **both** Ubuntu 24.04 and 22.04 before being added, because the
   image is built on whichever release the base image uses and a name that only
   exists in one of them would fail the build there (`.research/font-check/`).
2. **The family names were read out of the fonts, not guessed.** The `.deb` files
   were downloaded and their name tables read with `fontTools`, which corrected
   three names that would otherwise have failed CI: `KacstOne` is in
   `fonts-kacst-one` and not in `fonts-kacst`, the Thai families are `Tlwg Typo`
   and not `TLWG Typo`, and `fonts-khmeros` has no bare `Khmer OS`. The same
   check showed that the URW base 35 package is the only way to get `Nimbus
   Roman`, `C059` or `Z003`: TeX Live has them as Type1 fonts, which the
   fontconfig rule above hides on purpose.
3. **Nothing may change the default rendering.** `fonts-ubuntu` is deliberately
   *not* installed - whether a document that names no font still renders the same
   must not depend on an upgrade - and the build now prints what `serif`,
   `sans-serif` and `monospace` resolve to, so such a change would be visible.
   The blunderbuss `apt search ^fonts | xargs apt-get install` of `texlive-full`
   was rejected for this reason, not for size.

`tests/fonts-extra` compiles a document that selects one family per group with
`fontspec` under XeLaTeX, so a missing or renamed family fails CI with the name
in the log. That is the difference to the original plan of "add some Google
fonts": the list is now something the repository can regress against.

---

## 6. Security findings fixed after the first port

The first working version logged people in; these three findings are what made it
safe to expose.

### 6.1 An unverified email could identify an account (`d0febbe`)

**Risk:** matching by email alone means anyone who can register the same address
at *some* provider can take over an existing Overleaf account.
**Fix:** only a **vouched-for** address (a provider attestation such as
`email_verified`) may identify an account; the decision is centralised in
`OidcEmailTrust.mjs` and covered by `tests/oidc-email-trust.test.mjs`.

### 6.2 Linking happened without proving control of the account (`0cac0a6`)

**Risk:** automatic linking turns a compromise on the provider side into a
takeover on the Overleaf side.
**Fix:** when an OIDC identity matches an existing account, the account
**password** is required first; `login-oidc-link.pug` renders the confirmation
step.

### 6.3 The id_token was trusted rather than verified (`0cac0a6`)

**Risk:** a flow that only reads userinfo is forgeable and replayable against
heterogeneous providers.
**Fix:** `OidcIdToken.mjs` validates signature (JWKS), `iss`, `aud`, `exp` and
`nonce`; `tests/oidc-id-token.test.mjs` covers it.

### 6.4 Later hardening (`2bd219e`)

- A trailing slash on the issuer is normalised before comparing `iss` — different
  providers write it differently, and a strict compare fails intermittently on a
  valid IdP.
- A discovery URL that returns HTML (a proxy or gateway login page) is reported
  immediately at configuration time; previously the failure surfaced much later
  as an unexplained "login failed".

### 6.5 The second round

- **Track changes is opt-in.** It is not a security finding but a
  decision: the feature changes what every project offers, and only a running
  instance can show that the whole chain (document-updater ranges, chat threads,
  the review panel) behaves. A feature that is off cannot break an upgrade.
- **Sandboxed compiles need the Docker socket**, which is root-equivalent on the
  host. `README.md` says so in as many words, and the recommendation is to enable
  the feature for per-project TeX Live images and isolation between compiles, not
  as a substitute for a firewall.
- **`MAX_UPLOAD_SIZE` moves a zip-bomb limit.** The uncompressed limit of an
  uploaded archive is now six times the upload limit, but never below the 300 MB
  the official image allows - raising the upload limit for a large project
  otherwise leaves it rejected for a reason that has nothing to do with it.
- The linked-URL proxy is only configured when the administrator asked for the
  `url` linked-file type, so no instance starts fetching URLs because it was
  upgraded.

---

## 7. Verification manual

The modules under test import only Node built-ins (or nothing), so they run
without Overleaf:

```sh
node --test tests/oidc-callback-url.test.mjs tests/oidc-well-known.test.mjs \
            tests/oidc-id-token.test.mjs tests/oidc-link-request.test.mjs \
            tests/oidc-email-trust.test.mjs
# 65 cases: callback-url 13, well-known 24, id-token 13, link-request 8, email-trust 7

node --test tests/overlay-settings.test.mjs            # 28 cases
node --test tests/sandboxed-compiles-images.test.mjs   # 22 cases

node --test /tests/oidc-*.test.mjs /tests/overlay-settings.test.mjs \
            /tests/sandboxed-compiles-images.test.mjs   # inside the image
tests/verify-overlay.sh                                # everything else, needs the image
tests/compile.sh                                       # the MWEs, needs the image
```

What only the instance can verify:

- the OIDC login flow itself, the linking confirmation page, the account
  matching outcome, and the provider-side redirect URI allow-list;
- that track changes attributes a change to its author, that accepting it
  removes the markup, and that a comment thread survives a reload;
- that a sandboxed compile really happens in the configured image (the module
  test proves the configuration, not the container);
- the review panel in the browser, the knitr MWE in CI, and every font.
  A green local run says nothing about any of those.

`tests/verify-overlay.sh` is the part that grew the most: it loads the patched
modules inside the image (which is what catches a Yarn PnP resolution problem),
drives the track-changes router against a stub, checks the settings file both
with and without the features switched on, validates the seccomp profile, checks
the TeX Live settings and the latexmk custom dependencies, runs `run-chktex.sh`,
and compiles the views.

---

## 8. Traps this approach carries

1. **Full-file replacement.** Every file under `overlay/` silently reverts
   whatever upstream changed in it, so each upstream bump needs a file-by-file
   reconciliation — including the wholesale-replaced
   `AuthenticationController.mjs`, which is also the most volatile upstream file.
   The second round added no further wholesale replacements: the new
   functionality lives in new files, and the settings file *reads* the one of the
   base image instead of replacing it.
2. **No new dependencies** (Yarn PnP, §2) — this constrains feature design before
   it constrains implementation.
3. **The frontend is frozen.** Anything whose user interface a module has to
   contribute is out of reach, no matter how well its backend resolves. §3 has
   the list.
4. **One unresolvable import kills the whole web service**, because the module
   list is imported sequentially at boot.
5. **`OVERLEAF_CONFIG` is now part of the contract.** It points at the settings
   file of this image; a deployment that overrides it loses the module
   registration without an error, and the only symptom is a missing feature.
6. **The provider-side allow-list is not code.** A multi-host deployment needs
   every callback URI registered at the provider
   (`OVERLEAF_OIDC_CALLBACK_URLS`); no change here can substitute for that.
7. **The deployment half of sandboxed compiles is not code either**, and the
   toolkit gates its half on `SERVER_PRO`.
8. **Errors that surface late are the expensive ones.** Both the discovery
   failure and the issuer comparison produced "login failed" symptoms far from
   the actual misconfiguration; both now fail at the point of the mistake. The
   second round followed the same rule: an incomplete image configuration, a
   missing `dvipdfmx-unsafe.cfg` and a missing chktex or Rscript all fail the
   **build** now, with the reason in the message.

---

## 9. Open items

- The upstream reconciliation (§8.1) is a manual step; committing the
  overlay-vs-upstream diff with each upgrade would make it reviewable.
- Multi-provider features (group mapping, `preferred_username`) must be designed
  within the dependency constraint.
- End-to-end verification needs a real instance and a real provider; it is not
  part of CI. The same is true for track changes and for a real sandboxed
  compile.
- Google Fonts are covered now (§5.3) through the distribution's packages rather
  than a build-time download; what remains uncovered are the families that no
  distribution packages (`Merriweather`, `Raleway`, `Oswald`, `Source Sans Pro`,
  `PT Sans`, ...). Vendoring a curated subset would close that without a
  build-time download, and is the one thing `texlive-full`'s approach still has
  over this one.
- If a frontend build step is ever added, the AI assistant becomes reachable
  after a single import substitution (§3); until then it is not.
- `MAX_UPLOAD_SIZE` and the linked-URL proxy are settings only because they are
  read by CE core code; the two features they belong to (large uploads, linked
  URLs) are otherwise complete in the image.
- The one rejected candidate worth revisiting is `learn` (§3): its backend works
  as it is, and the only reason it is not here is that it caches the whole
  upstream wiki **before the server starts listening**. A version that crawls in
  the background, or on first request, would be a strict improvement over the
  fork it comes from.
- Registration is still all-or-nothing (`OVERLEAF_ENABLE_REGISTRATION`). The
  restriction to one email domain that the fork implements in its
  `login-register` module would fit this overlay as a small module that guards
  `POST /register` and lets the core handler through - new files only, no
  upstream replacement - and `overlay-modules.cjs` is already the place to
  switch it on.
