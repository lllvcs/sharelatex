# Overleaf CE (sharelatex) OIDC fork — development record

> **What this file is.** The record of how this fork adds OIDC single sign-on to
> Overleaf CE and what happened while building it: the structure, the security
> findings that were fixed afterwards, the verification that exists today, and the
> traps this approach carries. Written for a developer who is about to change it
> and wants the history rather than the rules.
>
> The **rules** distilled from this record live in
> [`DEVELOP_SKILL.MD`](./DEVELOP_SKILL.MD) (English, agent-facing). Configuration
> and deployment *usage* live in [`README.md`](./README.md) /
> [`README.zh-CN.md`](./README.zh-CN.md).

- Approach: **no Overleaf rebuild** — `overlay/` holds complete replacement files
  copied into the `sharelatex/sharelatex` image; Overleaf runs its backend
  directly from these sources, so there is no compile step.
- Upstream baseline: Overleaf CE `6.3.0`; published image `lvcs/sharelatex`
- Prior art: the overlay mechanism follows `smhaller/ldap-overleaf-sl`; the OIDC
  implementation is a port of `stugen-admins/forks/overleaf-oidc`.

---

## 1. Change list

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

---

## 2. How the integration is built

Overleaf ships its backend as plain ESM source in the image
(`app/src/**/*.mjs`, `app/views/**/*.pug`), so replacing those files inside the
image changes behaviour without touching the build. The overlay therefore
contains:

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

**Constraint that shaped the implementation:** the image installs dependencies
with **Yarn PnP**, and the overlay never reinstalls them — a new package cannot
resolve. The upstream patch depended on `@govtechsg/passport-openidconnect`;
this fork replaced it with a small strategy over the already-present
`passport-oauth2`. Every import must be a Node built-in or a package that is
already in the image.

---

## 3. Security findings fixed after the first port

The first working version logged people in; these three findings are what made it
safe to expose.

### 3.1 An unverified email could identify an account (`d0febbe`)

**Risk:** matching by email alone means anyone who can register the same address
at *some* provider can take over an existing Overleaf account.
**Fix:** only a **vouched-for** address (a provider attestation such as
`email_verified`) may identify an account; the decision is centralised in
`OidcEmailTrust.mjs` and covered by `tests/oidc-email-trust.test.mjs`.

### 3.2 Linking happened without proving control of the account (`0cac0a6`)

**Risk:** automatic linking turns a compromise on the provider side into a
takeover on the Overleaf side.
**Fix:** when an OIDC identity matches an existing account, the account
**password** is required first; `login-oidc-link.pug` renders the confirmation
step.

### 3.3 The id_token was trusted rather than verified (`0cac0a6`)

**Risk:** a flow that only reads userinfo is forgeable and replayable against
heterogeneous providers.
**Fix:** `OidcIdToken.mjs` validates signature (JWKS), `iss`, `aud`, `exp` and
`nonce`; `tests/oidc-id-token.test.mjs` covers it.

### 3.4 Later hardening (`2bd219e`)

- A trailing slash on the issuer is normalised before comparing `iss` — different
  providers write it differently, and a strict compare fails intermittently on a
  valid IdP.
- A discovery URL that returns HTML (a proxy or gateway login page) is reported
  immediately at configuration time; previously the failure surfaced much later
  as an unexplained "login failed".

---

## 4. Verification manual

The modules under test import only Node built-ins, so they run without Overleaf:

```sh
node --test tests/oidc-callback-url.test.mjs tests/oidc-well-known.test.mjs \
            tests/oidc-id-token.test.mjs tests/oidc-link-request.test.mjs \
            tests/oidc-email-trust.test.mjs
# 65 cases: callback-url 13, well-known 24, id-token 13, link-request 8, email-trust 7

node --test /tests/oidc-*.test.mjs      # inside the image
tests/verify-oidc.sh                    # real provider round trip (needs an instance)
```

What only the instance can verify: the login flow itself, the linking
confirmation page, the account matching outcome, and the provider-side redirect
URI allow-list. A green local run says nothing about any of those.

---

## 5. Traps this approach carries

1. **Full-file replacement.** Every file under `overlay/` silently reverts
   whatever upstream changed in it, so each upstream bump needs a file-by-file
   reconciliation — including the wholesale-replaced
   `AuthenticationController.mjs`, which is also the most volatile upstream file.
2. **No new dependencies** (Yarn PnP, §2) — this constrains feature design before
   it constrains implementation.
3. **The provider-side allow-list is not code.** A multi-host deployment needs
   every callback URI registered at the provider
   (`OVERLEAF_OIDC_CALLBACK_URLS`); no change here can substitute for that.
4. **Errors that surface late are the expensive ones.** Both the discovery
   failure and the issuer comparison produced "login failed" symptoms far from
   the actual misconfiguration; both now fail at the point of the mistake.

---

## 6. Open items

- The upstream reconciliation (§5.1) is a manual step; committing the
  overlay-vs-upstream diff with each upgrade would make it reviewable.
- Multi-provider features (group mapping, `preferred_username`) must be designed
  within the dependency constraint.
- End-to-end verification needs a real instance and a real provider; it is not
  part of CI.
