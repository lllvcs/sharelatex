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

Five of the overlay's assumptions were checked against the published image
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

### 3.2 Rebuilding the frontend (the opt-in step)

The measurements above leave one question open: if the sources are there and only
the toolchain was pruned, does a rebuild actually work? The answer is now in the
repository as an opt-in build step, proved with the smallest feature that can
prove it.

**Why `symbol-palette`.** Its `index.mjs` is four lines that log and export an
empty object: no route, no hook, no setting. Everything the feature *is* lives in
its frontend, pulled in through one registry key (`sourceEditorSymbolPalette`,
which the core `symbol-palette-pane.tsx` renders). So it is the one module whose
whole effect is proof that the registry and the bundle agree - and its imports
are only declared packages (`react`, `react-i18next`, `match-sorter`,
`prop-types`, all devDependencies that `yarn install` restores) plus five `@/`
core frontend files that exist upstream. Nothing else had to be ported.

**What the step does**, in `Dockerfile`, behind
`--build-arg OVERLEAF_REBUILD_FRONTEND=true`:

1. `yarn install --immutable` restores the pruned devDependencies. The yarn cache
   in the image holds most of them, and the build has network, so this is the
   least risky of the three.
2. `OVERLEAF_CONFIG=…/config/settings.frontend.cjs yarn run webpack:production`
   compiles the frontend with the registry filled. The settings file is *not* the
   runtime one: the macro reads `@overleaf/settings` once, while webpack starts.
3. `yarn workspaces focus --all --production` prunes the devDependencies again, so
   the running image is the same as before - which is exactly what upstream's own
   build does.

**The trap, which is why the settings file exists at all.** Running webpack
without `OVERLEAF_CONFIG` makes it read the image's own
`services/web/config/settings.defaults.js`, whose registry is `[]` for every key
except three `full-project-search` ones. The result is a byte-equivalent empty
bundle **and a green build**. This is the failure mode to design against, so the
verification checks the *output*, not the command:

- `tests/verify-overlay.sh` looks for the module's component in `public/js`
  (a CSS class of it, and CSS is extracted elsewhere, so a hit means the module's
  JavaScript was bundled), and checks that the rebuilt manifest still has the
  core entrypoints - the two mistakes fail in opposite directions.
- `tests/frontend-rebuild.test.mjs` checks the settings file itself: the key the
  core frontend asks for, a path that resolves, a path written relatively (so it
  survives being copied to `/overleaf/services/web`), and that the string the
  image check greps for is still in the component.
- `.github/workflows/build-test.yml` builds **with** the argument, so CI is what
  proves the whole path - and so does `docker-build.yml`, because the user
  interfaces a module contributes only exist in a bundle that was rebuilt. Leaving
  the argument off produces an image whose features have their routes and no UI,
  which is a failure mode that looks like a broken frontend rather than a missing
  build argument, so both workflows pass it and `tests/verify-overlay.sh` checks
  the components are in the bundle afterwards.

**What running it actually did**, measured against the real image on 2026-10-05
(28 cores, the base image's own yarn cache, no network for the install):

| Step | Result |
| --- | --- |
| `yarn install --immutable` | 15 s, from `/overleaf/.yarn/cache` alone - the cache really did keep the pruned devDependencies |
| `yarn run webpack:production` | 35 s, 464 JS assets, `manifest.json` written |
| the settings file | `Using settings from /overleaf/services/web/config/settings.frontend.cjs`, followed by `Detected change in overleafModuleImports, purging babel cache!` - the registry is read where it should be |
| the bundle | 41 entrypoints, the same ones as the base image's manifest, **plus** the module's component found in `public/js/pages/ide-*.js` |
| `yarn workspaces focus --all --production` | pruned the devDependencies again; the running image is unchanged |

So the rebuild works, and the mechanism is no longer a hypothesis. What it does
*not* answer is whether the palette renders correctly in a browser - that needs a
running instance, not a build.

**What it costs**, and why it is not the default: the image build gains a
`yarn install` and a production webpack run; the bundle is generated from *this*
image's frontend sources, so it has to be regenerated whenever the base image
moves; and a module whose UI is rebuilt in must still have its backend listed in
`moduleImportSequence` for its routes to exist.

**What it unblocks.** Every feature whose UI is a registry entry or a page
entrypoint becomes reachable by adding its module and its registry key - the AI
assistant, the error assistant, the admin panel, the template gallery, the Git
integrations. The first three of those were ported once the mechanism was proved;
§3.3 records what each one cost, including the two obstacles that were visible
before the port and turned out to be small:

- the AI assistant also needs `modules/workbench`, which imports
  `createOpenAICompatible` from `@ai-sdk/openai-compatible` - a package the image
  has only in its lockfile, so PnP refuses it and the web service does not boot.
  One import is substituted (`createOpenAI` from the declared `@ai-sdk/openai`)
  and the feature then needs `AI_ENABLED`, `AI_BASE_URL` and `AI_API_KEY` to do
  anything;
- the admin panel and the base image's `user-activate` register the same two
  paths, and the first registration wins, so the sequence needs an insertion
  rather than an append - see `MODULE_PLACEMENT` in
  `overlay/etc/overleaf/overlay-modules.cjs`.

### 3.3 Porting what that unblocked

Once the rebuild was proved, three of those features were ported. What each one
actually cost, measured against the image rather than read off the source tree:

| | AI assistant (`workbench` + `error-assistant`) | Admin panel (`admin-tools`) | Reference picker (`reference-picker`) |
| --- | --- | --- | --- |
| source files | 34 + 14 | 117 | 8 |
| core `@/` imports, and how many are missing | 36 + 14, **0 missing** | 48, **0 missing** | 15, **0 missing** |
| npm packages not declared | `@ai-sdk/openai-compatible` | none | none |
| how its UI reaches the browser | 7 registry keys | 2 webpack **page entrypoints** (`globSync` picks them up on its own) | 3 registry keys |
| other work | one import substitution; `workbench` before `error-assistant` | inserted **before** `user-activate` | none |
| needs a service | an AI gateway | none | none |
| needs the rebuild | yes | yes | yes |

Three things are worth recording because they were not obvious:

- **The `@/` imports were the real risk, and they were fine.** The earlier
  analysis of `admin-tools` could only say "some of its `@/...` imports may be
  Pro-only core frontend files, not verifiable from here"; checking all 48 against
  the image (`.research/`-style script, run inside the container) answered it in
  one pass. The remaining risk was never the *core* frontend - it is the same code
  in both products - but the *modules*, which the CE image removes.
- **The AI provider substitution is real but small.** `workbench` imports
  `createOpenAICompatible` from a package the image has only in its lockfile, so
  PnP refuses it and - because modules are imported with `await import()` - the
  web service would not start. The declared `@ai-sdk/openai` speaks the same wire
  protocol; the difference is which API a bare provider call resolves to
  (`/responses` rather than `/chat/completions`), which is why the one call site
  uses `.chat(...)`. Verified against a real gateway before the port was written,
  and again afterwards through the module's own code path.
- **`reference-picker` is the cheapest feature in the whole repository.** The base
  image's core already ships the BibTeX parser, the editor's BibTeX language, the
  "root bib document" and "reference format" settings, and a *basic* reference
  index - and it already calls `importOverleafModules('referenceIndices')` for a
  better one. The module supplies the other three registry entries and nothing
  else; its `index.mjs` is an empty object, so it is not in
  `moduleImportSequence` at all.

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

Three things that example taught, all of which are now in the file:

- **Declaring a family is enough to test it.** `\newfontfamily{X}` resolves the
  name through fontconfig when it is declared, not when it is first used - a
  family that does not exist fails the build even if nothing is ever typeset in
  it. That was measured in both directions, and it matters because the obvious
  alternative (a sample sentence per family) does not work: a font with no Latin
  characters at all makes XeTeX fail with "there are no glyphs in the subset".
- **`\newfontfamily\testC059{C059}` does not do what it looks like.** Digits are
  not letters in TeX, so that declares `\testC` and hands fontspec the lone `0`
  as the font name; the error is `The font "0" cannot be found`, which says
  nothing about the real mistake. Two of the families are called `C059` and
  `Z003`, so their command names are spelled out.
- **The generic families cannot be pinned, and the collection does move them.**
  With the font set this image had before, `serif` and `sans-serif` resolved to
  the Noto Regular faces; with the full collection they resolve to the
  SemiCondensed ones. `<alias><prefer>`, a `<match>` that prepends the family,
  and assigning a normal `width` - each with and without `binding="strong"` -
  were all measured to have no effect, because every Noto Serif face declares the
  same family name and fontconfig ignores the requested width when choosing
  between them. Only rejecting the condensed faces would work, at the price of
  making them unselectable. An ordinary LaTeX document is unaffected either way:
  its default font comes from the format (Latin Modern), not from fontconfig, so
  this shows in a document that names a *generic* family and in non-TeX tools.
  `fonts-ubuntu` is still left out of the package list, since it could win the
  `sans-serif` alias outright.

### 5.4 The build used to work only on the day the base image was built

The first CI run of this round failed, and the failure had nothing to do with
what it was testing:

```
#16 [stage-0 7/36] RUN tlmgr install latexmk texcount synctex etoolbox xetex
tlmgr itself needs to be updated.
...
tlmgr: Terminating; please see warning above!
```

`tlmgr` refuses to *install* anything while the CTAN repository has a newer
`texlive.infra` than the installed one. The base image ships `tlmgr revision
79639` from July; the repository was at `80502` by October, and CTAN publishes
several revisions of that package every day. So **the image could not be built
from scratch at all** - the CI run only got as far as it did because the layers
up to `tlmgr install scheme-full` were cache hits from a build made months
earlier. A cold build would have failed at `scheme-full`, and a reader of the
Dockerfile would have had no way to know.

What the fix is *not*: `update-tlmgr-latest.sh`, which the Dockerfile already
ran. Without arguments it leaves `texlive.infra` where it was, and with
`-- --upgrade` - the form Overleaf's own `Dockerfile-base` uses - it refuses here
with *"have TL 2026, new version also 2026; using --upgrade doesn't make sense;
terminating"*. What the fix is: `tlmgr update --self`, which is what the error
message asks for, and which is a no-op when there is nothing to do. Measured
both ways in a container before touching the Dockerfile.

Because the repository can move again *during* a build (scheme-full alone takes
minutes), every `tlmgr install` in the Dockerfile is preceded by
`tlmgr update --self`, not just the first one.

The general lesson, and the reason this is in a record rather than a commit
message: **a build that depends on a moving third party needs its first step to
bring that third party up to date**, or the dependency is invisible until the day
it breaks.

### 5.5 What running the tests for the first time found

The image had never been built from a cold cache when this round started, so
neither `tests/verify-overlay.sh` nor `tests/compile.sh` had ever run - the last
green CI was months old and predated most of the tests. Building it locally and
running both turned up nine defects, none of which any amount of reading had
found. They are listed here because the pattern is the point: seven of the nine
were in the *tests*, and all seven passed for the wrong reason or would have
failed on a correct image.

| What was wrong | How it showed | Why it had survived |
| --- | --- | --- |
| `tlmgr install` refused to run (above, §5.4) | the build stopped at the first `tlmgr install` | the layers above it came from a cache built months earlier |
| `tests/compile.sh` gave latexmk the shared rc with `-r`, so the example's own rc never won | every example asking for XeLaTeX was compiled with LuaLaTeX | nothing in a PDF says which engine made it |
| the knitr example was handed `main.Rnw` instead of the `main.tex` clsi asks for | latexmk ran the engine on R source | the example had never been compiled |
| latexmk needs `-jobname=output` (which clsi also passes) or it exits 12 after a harmless first pass | `compile.sh` failed on the knitr example although the PDF was correct | same |
| the vendored KaiTi font is called `Kaiti.ttf`, not `KaiTi.ttf`, so the case-sensitive copy never made `simkai.ttf` | `tests/fonts-zhmetrics` failed with `cannot open TrueType font file` | same |
| `verify-overlay.sh` read the settings with `require()` and then asserted settings that a *module* applies at load time | `imageRoot is undefined` on a correct image | it had never run |
| it also imported clsi's `DockerRunner` with the feature off, where `clsi.docker` does not exist | `Cannot read properties of undefined (reading 'maxContainerAge')` | same |
| it compared the latexmk rc against strings with a different spacing than the file uses | `add_cus_dep( 'glo'...` "missing" from a correct file | same |
| `compile.sh` compiled knitr's generated `main-concordance.tex` on the second run | the first run left it behind and the second failed | only visible when run twice |

Two behaviours are worth recording as *properties of the product*, found the same
way and now written down where a user would look for them:

- **`\tikzexternalize` cannot work under Overleaf's compile invocation.** pgfplots
  externalizes a figure by running a second compile whose wrapper is
  `\def\tikzexternalrealjob{\jobname}\input{\jobname}`, and clsi calls latexmk
  with `-jobname=output` while the source keeps its own name - so the wrapper
  looks for `output.tex`, which does not exist. The figure fails ("! Emergency
  stop" in its own log, `tikzext/plot.log`) while the surrounding document still
  produces a PDF, which is what makes it hard to notice. The workaround is to
  name the source in `external/system call` instead of relying on `\texsource`.
  The example that had been written to test this was reduced to what it can
  actually prove - shell-escape writing into a subdirectory - rather than
  asserting something the product does not do.
- **`\write18` is a no-op under LuaLaTeX.** XeLaTeX and pdfLaTeX run it,
  LuaLaTeX does not (TeX Live's LuaTeX expects `os.execute` through
  `\directlua`), which is why `minted` and `svg` work under LuaLaTeX - they
  detect the engine and switch. A document with a hand-written `\write18` works
  under two of the three engines, which is worth knowing before blaming the
  image: `texmf.cnf` has `shell_escape = t` and the fail is the engine's.

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

### 7.1 What the three ported features are checked against

The AI assistant, the admin panel and the reference picker were ported after the
frontend rebuild had been proved (§3.2), and each is checked where it can fail:

| Feature | The check that would catch a regression |
| --- | --- |
| all three | `tests/verify-overlay.sh` imports every ported module's `index.mjs` inside the image and applies its router against a stub, which resolves the whole import graph - the thing that stops the web service from booting if a dependency is missing |
| all three | it also greps `public/js` for a string unique to each feature's components (`symbol-palette-close-button-outer`, `references-search-modal`, `workbench-ai-message`). A string the *core* also contains would make this meaningless, so each was checked against the image's own `frontend/` first - `ai-paywall-notification` looks distinctive and lives in three core files, which is why it is not one of them |
| the registry | `tests/frontend-rebuild.test.mjs` resolves every path in `settings.frontend.cjs`, checks the keys the core asks for, and checks that the marker strings are still in the components - the two halves fail in opposite directions |
| the module order | `tests/overlay-settings.test.mjs` asserts that `admin-tools` is inserted *before* `user-activate` (both register `/admin/user`, first registration wins) and that `workbench` precedes `error-assistant` |
| the AI gateway | verified once by hand against a DeepSeek gateway before the port was written: `createOpenAI({ baseURL, apiKey })` with `.chat(model)` answers and reports token usage, which is what `TokenQuota` needs. This is not in CI - it needs a key |

What is still only verifiable by hand, and was not verified: that the AI panel
renders and streams in a browser, that the admin panel's pages load, and that the
reference picker's modal opens. All three need a running instance.

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
- The frontend rebuild exists and works (§3.2) and currently carries one module,
  `symbol-palette`. What it makes reachable next, and what each still needs, is
  recorded there: the AI assistant needs a one-line import substitution plus an
  AI gateway, and the admin panel collides with `user-activate` on `/admin/user`.
  Adding any of them is three edits and a rebuild.
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
