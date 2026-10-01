---
name: overleaf-oidc-fork
description: Use when developing on the Overleaf CE (sharelatex) OIDC fork — touching overlay/, debugging a login flow, or bumping the upstream release. Rules with their reason and verification step; the incident history lives in DEVELOP_EXPERIMENT.MD.
---

# Overleaf CE (sharelatex) OIDC fork — development rules (agent-facing)

> **When to use this file.** Before touching anything under `overlay/`, when an
> OIDC login flow misbehaves, or when bumping the upstream Overleaf release.
> Deployment and configuration *usage* live in [`README.md`](./README.md); the
> record behind these rules lives in
> [`DEVELOP_EXPERIMENT.MD`](./DEVELOP_EXPERIMENT.MD).
>
> Written as rules: **do X → because Y → verify with Z.** Read the one you need.

- Approach: **no Overleaf rebuild.** `overlay/` holds complete replacement files
  copied into the `sharelatex/sharelatex` image; Overleaf runs its backend
  straight from these sources (`app/src/**/*.mjs`, `app/views/**/*.pug`), so
  there is no compile step.
- Upstream baseline: Overleaf CE `6.3.0`; published image `lvcs/sharelatex`
- Prior art: the overlay mechanism follows `smhaller/ldap-overleaf-sl`; the OIDC
  implementation is a port of `stugen-admins/forks/overleaf-oidc`, reworked (S2).

## Quick index

| Rule | Use when |
| --- | --- |
| S1 Reconcile the overlay on every upstream bump | upgrading the base image |
| S2 Add no npm dependencies | you want to import a new package |
| S3 Only vouched-for emails identify an account | touching account matching |
| S4 Ask for the existing password on first link | touching the linking flow |
| S5 Verify the id_token yourself | touching token/userinfo handling |
| S6 Ignore a trailing slash on the issuer | logins fail on a valid IdP |
| S7 Fail fast on discovery errors | configuration points at the wrong URL |
| S8 Prefer new files over edited ones | adding a feature |
| S9 Test at module level, test first | changing any `Oidc*.mjs` |
| S10 Callback URLs: explicit > list > request | multi-domain / proxy setups |
| S11 Declare what only the instance can verify | before writing "done" |

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
`diff`. Record the reconciliation in the upgrade commit.

---

## S2. Add no npm dependencies

**Do.** Only use what the image already contains: bundled packages or Node
built-ins. Reimplement small pieces instead of importing them.

**Because.** The image installs dependencies with **Yarn PnP**; the overlay only
replaces files and never reinstalls, so a new package cannot resolve. The
original patch depended on `@govtechsg/passport-openidconnect`; this fork
replaced it with a small strategy over the already-present `passport-oauth2`.

**Verify.** `grep -rn "from '" overlay/**/*.mjs` and confirm every import is
either a Node built-in or a package visible in the image.

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

## S7. Fail fast on discovery errors

**Do.** Validate that the discovery document is what you expect and raise the
error at configuration/startup time.

**Because.** When the well-known URL returns an HTML page (a proxy or gateway
login screen) the flow fails much later, as "login failed" — the user cannot see
which URL was wrong. Since `2bd219e` the wrong URL is reported immediately.

**Verify.** Point the issuer at an HTML page and confirm the error names it.

---

## S8. Prefer new files over edited ones

**Do.** Implement features as new `Oidc*.mjs` files plus the smallest possible
mount point; keep edits to upstream files minimal.

**Because.** Every edited upstream file enlarges the reconciliation surface of
S1. Today only `AuthenticationController.mjs` is a wholesale replacement; the
existing-file touches (`User.mjs`, `UserPrimaryEmailCheckHandler.mjs`,
`infrastructure/*`) are deliberately small.

**Verify.** `git diff --stat` against the previous overlay state.

---

## S9. Test at module level, and write the test first

**Do.** Add or adjust a case in `tests/oidc-*.test.mjs` before changing the
module. The modules import only Node built-ins, so they run without Overleaf:

```sh
node --test tests/oidc-callback-url.test.mjs tests/oidc-well-known.test.mjs \
            tests/oidc-id-token.test.mjs tests/oidc-link-request.test.mjs \
            tests/oidc-email-trust.test.mjs          # 65 cases: 13+13+24+8+7
node --test /tests/oidc-*.test.mjs                   # inside the image
```

**Because.** This is the cheapest verification available in this repository, and
it is the only one that runs locally.

**Verify.** All 65 pass.

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

**Do.** Separate "ran locally" (the 65 module tests) from "needs the instance"
(the login flow, the linking page, the provider-side allow-list) in the commit
message.

**Because.** A green local run says nothing about the flow; `tests/verify-oidc.sh`
plus a real login is the only end-to-end evidence.

---

## Pre-commit checklist

1. `node --test tests/oidc-*.test.mjs` (65 cases) — add cases for new behaviour.
2. Every import is a built-in or already in the image (S2).
3. Overlay diff reviewed when the upstream base changes (S1).
4. Commit message: cause, blast radius, `Verified:` / `Not verified:`.
5. CI: `build-test.yml` (tests + build) → `docker-build.yml` → `docker-publish.yml`
   (publish is a separate manual step; build-time font verification stays).

## Open items

- The upstream reconciliation (S1) is a manual step; consider committing the
  overlay-vs-upstream diff with each upgrade.
- Multi-provider features (group mapping, `preferred_username`) are constrained
  by S2 before they are designed.
