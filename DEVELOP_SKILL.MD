---
name: overleaf-oidc-fork
description: Use when developing on the Overleaf CE (sharelatex) fork — touching overlay/, texlive/, porting a feature from a Server Pro fork, debugging a login flow or a compile, or bumping the upstream release. Rules with their reason and verification step; the incident history lives in DEVELOP_EXPERIMENT.MD.
---

# Overleaf CE (sharelatex) fork — development rules (agent-facing)

> **When to use this file.** Before touching anything under `overlay/` or
> `texlive/`, before porting a feature from another Overleaf fork, when an OIDC
> login flow misbehaves, when a compile behaves differently than on Overleaf, or
> when bumping the upstream Overleaf release. Deployment and configuration
> *usage* live in [`README.md`](./README.md); the record behind these rules lives
> in [`DEVELOP_EXPERIMENT.MD`](./DEVELOP_EXPERIMENT.MD).
>
> Written as rules: **do X → because Y → verify with Z.** Read the one you need.

- Approach: **no Overleaf rebuild.** `overlay/` holds complete replacement files
  and new files copied into the `sharelatex/sharelatex` image; Overleaf runs its
  backend straight from these sources (`app/src/**/*.mjs`, `modules/**/*.mjs`,
  `app/views/**/*.pug`), so there is no compile step. `texlive/` holds the
  compile toolchain's configuration files.
- Upstream baseline: Overleaf CE `6.3.0`; published image `lvcs/sharelatex`
- Prior art: the overlay mechanism follows `smhaller/ldap-overleaf-sl`; the OIDC
  implementation is a port of `stugen-admins/forks/overleaf-oidc`, reworked (S2);
  the track-changes module and the clsi Docker runner are ports of
  `ayaka-notes/ayakaleaf-pro`; `texlive/` comes from `ayaka-notes/texlive-full`.

## Quick index

| Rule | Use when |
| --- | --- |
| S1 Reconcile the overlay on every upstream bump | upgrading the base image |
| S2 Add no npm dependencies | you want to import a new package |
| S3 Only vouched-for emails identify an account | touching account matching |
| S4 Ask for the existing password on first link | touching the linking flow |
| S5 Verify the id_token yourself | touching token/userinfo handling |
| S6 Ignore a trailing slash on the issuer | logins fail on a valid IdP |
| S7 Fail fast on configuration errors | a setting can be wrong |
| S8 Prefer new files over edited ones | adding a feature |
| S9 Test at module level, test first | changing a pure module |
| S10 Callback URLs: explicit > list > request | multi-domain / proxy setups |
| S11 Declare what only the instance can verify | before writing "done" |
| S12 Look for the switch before reimplementing | porting a Server Pro feature |
| S13 A module is switched on by its name in the module sequence | adding a module |
| S14 Check the frontend registry before porting | the feature has a user interface |
| S15 Ship the file name the base image asks for | adding a file the application imports |
| S16 Extend the settings, do not replace them | adding a setting |
| S17 Verify the toolchain at build time | adding a program a compile calls |
| S18 Bring a moving third party up to date first | installing from CTAN or a mirror |
| S19 Read the test runner before trusting its configuration | a test sets its own environment |

---

## S1. Reconcile the overlay on every upstream bump

**Do.** Before bumping the base image, diff every file under `overlay/` against
the same path in the new upstream release, and treat the result as part of the
upgrade: an overlay file silently reverts whatever upstream changed in it.

**Because.** The overlay is **full-file replacement**, not a patch series. This
is the permanent cost of the approach — the one file that must be replaced
wholesale (`AuthenticationController.mjs`, 244 lines changed) is also the one
most likely to move upstream.

**Verify.** `git log --oneline` on the upstream path, then a file-by-file
`diff`. Record the reconciliation in the upgrade commit. The `Dockerfile` also
verifies, and fails the build on: the checksum of the two replaced files, the
existence of the clsi Docker runner reference the overlay depends on, the TeX
Live files it appends to, and the programs the compile toolchain calls.

---

## S2. Add no npm dependencies

**Do.** Only use what the image already contains: bundled packages or Node
built-ins. Reimplement small pieces instead of importing them.

**Because.** The image installs dependencies with **Yarn PnP**; the overlay only
replaces files and never reinstalls, so a new package cannot resolve. The
original OIDC patch depended on `@govtechsg/passport-openidconnect`; this fork
replaced it with a small strategy over the already-present `passport-oauth2`.
The ports of `modules/track-changes` (`p-limit`) and `DockerRunner.js`
(`dockerode`, `async`, `lodash`) were only possible because those are declared
dependencies of the service that imports them.

**Verify.** `grep -rn "from '" overlay/**/*.mjs` and confirm every import is
either a Node built-in or declared in the `package.json` of the service that
would load the file (`services/web/package.json`, `services/clsi/package.json`,
or a `libraries/*/package.json` it depends on). A *transitive* dependency does
not count: PnP only allows what the importing package declares, which is why
`@ai-sdk/openai-compatible` blocks the AI modules even though it is in the
lockfile.

**When an undeclared package is the only blocker, substitute rather than add.**
The AI modules import `createOpenAICompatible` from that undeclared package; the
declared `@ai-sdk/openai` speaks the same wire protocol, so one import changed and
one call site now asks for the chat-completions API (`getProvider().chat(...)`)
instead of relying on what a bare provider call resolves to (`/responses`). Two
rules for such a substitution: say in a comment *why* the import differs from the
upstream module, so the next person does not "fix" it back; and verify it against
the real service, because two provider factories that look interchangeable differ
in more than their name.

---

## S3. Only a vouched-for email address may identify an account

**Do.** Treat an address as account-identifying only when the provider
**vouches** for it (`email_verified`, or an equivalent trust signal). Keep that
decision in one place (`OidcEmailTrust.mjs`) and test it.

**Because.** Otherwise anyone who can register the same address at *some*
provider can take over an existing Overleaf account. This is the most expensive
mistake available in an OIDC integration, and it is invisible in normal testing.

**Verify.** `node --test tests/oidc-email-trust.test.mjs`.

---

## S4. Ask for the existing password when linking for the first time

**Do.** When an OIDC identity matches an existing account's email, require the
account's password before linking; show the confirmation view
(`login-oidc-link.pug`).

**Because.** Automatic linking turns a compromise on the provider side into a
takeover on the Overleaf side. The confirmation step keeps the second factor of
proof.

**Verify.** Walk the linking flow against a real instance: login with a
matching email must land on the confirmation page, not straight into the
account.

---

## S5. Verify the id_token yourself

**Do.** Validate signature (JWKS), `iss`, `aud`, `exp` and `nonce` in
`OidcIdToken.mjs`; do not treat userinfo as sufficient.

**Because.** A flow that only reads userinfo is forgeable and replayable against
heterogeneous providers. The verification is also the place where a
misconfigured issuer shows up as a clear failure instead of a random login
error.

**Verify.** `node --test tests/oidc-id-token.test.mjs`.

---

## S6. Ignore a trailing slash when comparing the issuer

**Do.** Normalise `iss` before comparing it with the configured issuer.

**Because.** Providers differ on the trailing slash; a strict string compare
fails intermittently on a perfectly valid IdP.

**Verify.** `node --test tests/oidc-well-known.test.mjs`.

---

## S7. Fail fast on configuration errors

**Do.** Validate a configuration where it is read, and raise the error naming
the variable that is wrong — at startup for a service, at build time for the
image.

**Because.** When the well-known URL returns an HTML page (a proxy or gateway
login screen) the flow fails much later, as "login failed" — the user cannot see
which URL was wrong. Since `2bd219e` the wrong URL is reported immediately. The
same reasoning produced the checks that refuse a sandboxed-compiles
configuration whose image list and current image contradict each other, and the
build-time checks for the compile toolchain.

**Verify.** Point the issuer at an HTML page and confirm the error names it;
start the container with a contradictory image list and confirm the message
contains the correction.

---

## S8. Prefer new files over edited ones

**Do.** Implement features as new files plus the smallest possible mount point;
keep edits to upstream files minimal.

**Because.** Every edited upstream file enlarges the reconciliation surface of
S1. Today only `AuthenticationController.mjs` is a wholesale replacement; the
existing-file touches (`User.mjs`, `UserPrimaryEmailCheckHandler.mjs`,
`infrastructure/*`) are deliberately small, and the second round added **no**
further replacement — the track-changes module, the Docker runner and the
settings live in new files, and the settings file of the base image is read
rather than replaced.

**Verify.** `git diff --stat` against the previous overlay state.

---

## S9. Test at module level, and write the test first

**Do.** Put the logic that can be decided without Overleaf into a module that
imports only Node built-ins, and add a case before changing it:

```sh
node --test tests/oidc-callback-url.test.mjs tests/oidc-well-known.test.mjs \
            tests/oidc-id-token.test.mjs tests/oidc-link-request.test.mjs \
            tests/oidc-email-trust.test.mjs           # 65 cases: 13+13+24+8+7
node --test tests/overlay-settings.test.mjs           # 28 cases
node --test tests/sandboxed-compiles-images.test.mjs  # 22 cases
node --test /tests/oidc-*.test.mjs /tests/overlay-settings.test.mjs \
            /tests/sandboxed-compiles-images.test.mjs # inside the image
```

**Because.** This is the cheapest verification available in this repository, and
it is the only one that runs locally. `TexLiveImages.mjs` and
`overlay-modules.cjs` exist as separate modules for exactly this reason: the
logic that decides which image a project uses, and which modules are switched
on, is testable, while the code that *applies* it is three lines.

**Verify.** All 115 pass.

---

## S10. Callback URLs: explicit config, then the list, then the request

**Do.** Resolve the redirect URI in this order: `OVERLEAF_OIDC_CALLBACK_URL` →
`OVERLEAF_OIDC_CALLBACK_URLS` (comma/whitespace separated, for multi-host
deployments) → derived from the host the user is browsing. Register **every**
resulting URI at the provider.

**Because.** Deployments reachable under several names (LAN, Tailscale, reverse
proxy) need a matching redirect URI per name; the provider-side allow-list is the
one step no code change can do.

**Verify.** `node --test tests/oidc-callback-url.test.mjs`, then a real round
trip from each host.

---

## S11. Declare what only the instance can verify

**Do.** Separate "ran locally" (the 115 module tests) and "ran in the image"
(`tests/verify-overlay.sh`, `tests/compile.sh`) from "needs the instance" (the
login flow, the linking page, the provider-side allow-list, the review panel in
the browser, a real sandboxed compile) in the commit message.

**Because.** A green local run says nothing about the flow; a green image run
says nothing about the browser. This is also why track changes is **opt-in**:
the only thing that can prove its user interface works is a user, so it must not
be switched on for everyone by an upgrade.

---

## S12. Look for the switch before reimplementing

**Do.** Before porting a feature, check whether the CE image already contains
its logic and only lacks the value that enables it: grep `app/src` for the
setting it reads, for the `Features.hasFeature('<name>')` case, and for the
`moduleImportSequence` entry.

**Because.** Overleaf CE is the same source tree as the licensed product with
(a) module directories, (b) settings defaults and (c) frontend components
removed. Track changes needed a boolean, sandboxed compiles three settings,
linked URLs one setting. Reimplementing any of them would have been wasted work
and a permanent reconciliation burden — and the removed defaults are invisible,
because nothing in the CE image mentions the setting that is missing.

**Verify.** Name the file and line that reads the setting, and the file and line
that would have set it in a Server Pro tree. If the reading site is not in the
image, the feature is code, not configuration.

---

## S13. A module is switched on by its name in the module sequence

**Do.** To activate a module that exists in the image or that you add: put the
directory under `services/web/modules/<name>/` and add `<name>` to
`Settings.moduleImportSequence`. Do not expect a directory scan.

**Because.** `Modules.loadModulesImpl()` iterates the sequence and imports
`modules/<name>/index.mjs`; there is no discovery. The sequence is set in
`services/web/config/settings.defaults.js`, which this image does not replace,
so the overlay appends to it through the settings file `OVERLEAF_CONFIG` points
at (`overlay/etc/overleaf/overlay-modules.cjs`). Appending rather than
hard-coding keeps a module that a later base image adds.

**Verify.** `node --test tests/overlay-settings.test.mjs`, then
`tests/verify-overlay.sh` in the image, which loads the module and asserts that
`Features.hasFeature('<name>')` became true. The order matters: the sequence is
imported sequentially, so **one module whose imports do not resolve stops the
whole web service** — and a module whose `index.mjs` blocks on the network
delays every start, because the sequence is awaited before the server listens.
That second trap is why the fork's `learn` module, which caches an entire wiki at
import time, is the one rejected candidate that would otherwise have worked
(`DEVELOP_EXPERIMENT.MD` §3).

**And the order is sometimes the whole feature.** Appending is the default because
it cannot drop an entry a later base image adds, but a module that registers a
route the base image already registers loses silently: Express gives a path to
whoever registers it first. `admin-tools` and the base image's `user-activate`
both register `GET /admin/user`, so appending would leave the admin panel
unreachable behind the base image's redirect, with no error anywhere. When a
ported module shares a path with one in the sequence, insert it in front
(`MODULE_PLACEMENT` in `overlay-modules.cjs`) and assert the relative order in
the test — and check for a shared path by grepping both routers for
`webRouter.(get|post|delete)`, not by reading one of them.

---

## S14. Check the frontend registry before porting a feature

**Do.** Before porting anything with a user interface, check whether its
components are reached through the core frontend or through
`Settings.overleafModuleImports`.

**Because.** That registry is consumed by a Babel macro **at webpack build
time**, so components a module contributes are pulled into the bundle while it is
built — a runtime setting cannot add them afterwards. The registry is the line
between the features that can be ported and the ones that cannot: track changes'
review panel is core frontend reached through the `trackChangesVisible` field of
the project payload, while the AI assistant, the error assistant, the admin
panel, the template gallery and the Git integrations all register their
components there. `README.md` / `DEVELOP_EXPERIMENT.MD` §3 have the full list.

**But the frontend is not frozen - it is a build step.** The image has the frontend
sources, the webpack configs and the yarn cache; what it does not have is the
webpack toolchain, which the base image prunes after its own build. `Dockerfile`
therefore has an opt-in step (`--build-arg OVERLEAF_REBUILD_FRONTEND=true`) that
restores the devDependencies, runs webpack against
`overlay/services/web/config/settings.frontend.cjs` and prunes them again. Before
porting a UI feature, decide whether it is worth turning that on - it makes the
image build much longer and the bundle has to be regenerated on every upstream
bump. The rule that matters: **webpack must be given `OVERLEAF_CONFIG`.** Without
it webpack reads the base image's own registry, which is empty for every key
except `full-project-search`, and produces an equally empty bundle **with a green
build**.

**Verify.** `grep -rn "@/" <the module>/frontend` shows which core frontend files
it needs - they must exist in the base image, and a missing one fails the webpack
build rather than the page (checking all 48 of `admin-tools` against the image
took one pass and cleared the biggest unknown of that port). Then, for each key
the core asks for, decide how the module's UI arrives: a **registry key**, which
has to be filled in `settings.frontend.cjs`, or a **webpack page entrypoint**
under `frontend/js/pages/`, which `webpack.config.js` collects with a `globSync`
and needs no registry entry at all - `admin-tools` is the second kind and needed
none. Also read the module's own `index.mjs`: a feature whose module registers
**no route, no hook and no setting** exists only to give the registry something to
point at (the fork's `symbol-palette`, `python-runner` and `reference-picker` are
like that), so it does **not** belong in `moduleImportSequence` - naming it there
registers nothing - and it reaches the browser only through the rebuild.

---

## S15. Ship the file name the base image asks for

**Do.** When adding a file the application imports, use the exact name the base
image's own code references — and when releases differ, ship both names, with
the real file under the primary one and a one-line re-export under the other.

**Because.** The clsi Docker runner is named in two places (`CommandRunner.js`
imports it, `config/settings.defaults.cjs` checks that it exists) and the two do
not always agree across releases: CE 6.3.0 uses `DockerRunner.js`, a fork that
ported the same feature renamed it to `DockerRunner.mjs`. A wrong name fails in
one of two confusing ways — an `ERR_MODULE_NOT_FOUND` at boot, or the "Sandboxed
compiles are only available with Overleaf Server Pro" exit.

**Verify.** The `Dockerfile` prints the references it finds in the base image,
and fails the build when `CommandRunner.js` does not import a runner at all. The
re-export is documented in the file itself.

---

## S16. Extend the settings, do not replace them

**Do.** Add settings through `overlay/etc/overleaf/settings.overlay.cjs`, which
loads `/etc/overleaf/settings.js` of the base image and returns it extended;
keep `OVERLEAF_CONFIG` pointing at it.

**Because.** `config/settings.defaults.js` is 35 KB and changes with every
release, so replacing it would be the largest reconciliation surface in the
repository. `OVERLEAF_CONFIG` is the documented override mechanism — the CE image
already sets it — and the override file is loaded *after* the defaults, so it can
add to them. `merge()` replaces arrays, which is why the module sequence has to
be appended explicitly rather than declared in full.

**Verify.** `node --test tests/overlay-settings.test.mjs`. In the image,
`tests/verify-overlay.sh` checks both that the features appear when they are
asked for **and that nothing changes when they are not**.

---

## S17. Verify the toolchain at build time

**Do.** Every program and file a compile calls has to be checked by the
`Dockerfile`, and the build has to fail when one is missing.

**Because.** A missing `chktex`, `qpdf`, `Rscript` or `dvipdfmx-unsafe.cfg` does
not stop a compile — it makes a feature silently unavailable (no *Check* button,
no R documents, no PDF preview xref data), or breaks one engine, which is a bug
report that arrives weeks later from a user. The same applies to the font caches:
without `luaotfload-tool --update` the first compile in a fresh container is slow
for a reason that looks like a slow document.

**Verify.** The `Dockerfile` has a verification block for the fonts, one for the
compile toolchain and one for the settings file; `tests/verify-overlay.sh`
repeats the checks inside the built image, and `tests/compile.sh` compiles an
MWE for every capability that was added (including `tests/knitr` for the R
route).

**For fonts specifically.** A family name is not the package name: read it out of
the font file before you write it down, or CI fails on a name that was never
right (`.research/font-check/` does this with `fontTools`, and it corrected three
names). Check that a package exists on **both** Ubuntu releases the base image
may be built on. Never add one that could take over a generic family on its own:
`fonts-ubuntu` is left out for exactly that reason. Note that the generic
families can still drift within a family - with the full collection `serif`
resolves to the Noto SemiCondensed face rather than the Regular one, and that
cannot be pinned from fontconfig (measured; `DEVELOP_EXPERIMENT.MD` §5.3) - so
say what the aliases resolve to rather than claiming they are unchanged.

**In the example file.** `\newfontfamily` resolves a family when it is declared,
so a declaration is a complete test and no sample text is needed. Do not typeset
Latin text in a font that has none: XeTeX then fails with *"there are no glyphs in
the subset"*, which is fatal. And keep digits out of the command name - digits
are not letters in TeX, so `\newfontfamily\testC059{C059}` silently declares
`\testC` and hands fontspec the bare `0`, failing with *The font "0" cannot be
found*.

---

## S18. Bring a moving third party up to date before using it

**Do.** When the build installs from a repository that is updated continuously
(CTAN, a package mirror, a `main` branch), make the first step of that block pull
the *tool* up to date, not just the packages.

**Because.** `tlmgr install` refuses to do anything while CTAN has a newer
`texlive.infra` than the installed one — and the base image is months old by the
time anyone builds from it, while CTAN publishes several revisions a day. The
result is an image that builds only on the day its base image was built, with a
failure that looks like it belongs to whatever line happens to run first. The
error message names the fix (`tlmgr update --self`); `update-tlmgr-latest.sh`,
which the `Dockerfile` also runs, does *not* fix it — without arguments it leaves
`texlive.infra` alone, and `-- --upgrade` refuses while the TeX Live year
matches. Repeat it before every install in the same build, because the
repository can move during a long one.

**Verify.** Build the image from a *cold* cache at least once. A cached build
hides this class of bug completely: CI passed the layers above the failure out of
a cache built months earlier and only the new line was actually executed
(`DEVELOP_EXPERIMENT.MD` §5.4).

---

## S19. Read the test runner before trusting its configuration

**Do.** When a test sets up its own environment (an rc file, a config, a
Makefile), check that the runner actually reads it in the order the test assumes.

**Because.** `tests/compile.sh` passed the shared `latexmkrc` with `-r` while
expecting the example's own `latexmkrc` to win. latexmk reads `./latexmkrc`
*before* any `-r` file, so the shared file won and every example that asked for
XeLaTeX was compiled with LuaLaTeX — silently, since both are valid
configurations. The fix is to concatenate the two files in the intended order
into one file that is *not* named `latexmkrc` (a file with that name is read on
its own). Nothing about the resulting PDFs says which engine made them, which is
why this survived several rounds.

**Verify.** Make one example's configuration observably different (a different
engine, a different output format) and check that it took effect, rather than
assuming the runner honours it. Three more traps from the same round, all of
which passed for the wrong reason until the suite was actually run
(`DEVELOP_EXPERIMENT.MD` §5.5):

- a `latexmkrc` is **Perl**: comments start with `#`, and a `%` comment makes
  latexmk report "Initialization file gave an error" and silently compile with
  the shared settings instead. `verify-overlay.sh` now runs `perl -c` on each;
- a generated file next to a test is picked up by the next run of the same
  runner (`knitr`'s `main-concordance.tex`), so exclude what a run creates;
- run the suite **twice** in a row. The first run hides this class of bug
  completely.

---

## Pre-commit checklist

1. `node --test tests/oidc-*.test.mjs tests/overlay-settings.test.mjs tests/sandboxed-compiles-images.test.mjs`
   (115 cases) — add cases for new behaviour.
2. Every import is a built-in or declared by the importing service (S2).
3. Overlay diff reviewed when the upstream base changes (S1).
4. A new module is in `moduleImportSequence` through the settings file, and
   `tests/verify-overlay.sh` loads it (S13).
5. A new feature with a user interface was checked against the frontend registry
   (S14).
6. New programs the compile toolchain calls are verified at build time (S17).
7. Commit message: cause, blast radius, `Verified:` / `Not verified:` — say
   explicitly which parts need a running instance (S11).
8. CI: `build-test.yml` (build, `verify-overlay.sh`, `compile.sh`) →
   `docker-build.yml` → `docker-publish.yml` (publish is a separate manual step;
   the build-time verification stays).

## Open items

- The upstream reconciliation (S1) is a manual step; consider committing the
  overlay-vs-upstream diff with each upgrade.
- Multi-provider features (group mapping, `preferred_username`) are constrained
  by S2 before they are designed.
- Anything whose UI is behind `overleafModuleImports` (S14) needs a frontend
  build step before it can be ported at all.
