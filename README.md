# sharelatex (Overleaf CE, extended)

[English](README.md) | [简体中文](README.zh-CN.md)

[![GitHub license](https://img.shields.io/github/license/lllvcs/sharelatex)](https://github.com/lllvcs/sharelatex/blob/master/LICENSE)
[![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/lllvcs/sharelatex/build-test.yml)](https://github.com/lllvcs/sharelatex/actions/workflows/build-test.yml)
[![GitHub issues](https://img.shields.io/github/issues/lllvcs/sharelatex)](https://github.com/lllvcs/sharelatex/issues)
[![Docker Pulls](https://img.shields.io/docker/pulls/lvcs/sharelatex)](https://hub.docker.com/r/lvcs/sharelatex)

An extended [Overleaf Community Edition](https://github.com/overleaf/overleaf)
Docker image, based on
[tuetenk0pp/sharelatex-full](https://github.com/tuetenk0pp/sharelatex-full).

## Features

Compared to the official `sharelatex/sharelatex` image:

- fully updated TeX Live installation, including all available packages
- additional TeX Live and system fonts, including a bundled collection of
  Chinese fonts (vendored in [`fonts/`](fonts/README.md), so nothing has to be
  downloaded while building the image)
- all TeX Live fonts are registered with fontconfig, so they can be selected by
  family name, and the Chinese fonts are installed under the names the TeX Live
  `zhmetrics` metrics (`uniyou20`, `unisong5b`, `gbkyou20`, ...) expect, see
  [Fonts](#fonts)
- support for `minted`
- support for `svg` images through the addition of inkscape
- support for lilypond
- shell-escape enabled by default
- **OIDC (OpenID Connect) single sign-on**, see below

## Installation

### Overleaf Toolkit

Use the [Overleaf Toolkit](https://github.com/overleaf/toolkit) as described in
the [Quick-Start Guide](https://github.com/overleaf/toolkit/blob/master/doc/quick-start-guide.md)
and set the image in `config/overleaf.rc`:

```sh
OVERLEAF_IMAGE_NAME=lvcs/sharelatex
```

Alternatively, use a `config/docker-compose.override.yml` file as described
[here](https://github.com/overleaf/toolkit/blob/master/doc/configuration.md#the-docker-composeoverrideyml-file):

```yaml
services:
    sharelatex:
        image: lvcs/sharelatex
```

### Docker Compose

> [!WARNING]
> This method is not recommended. Use the Overleaf Toolkit instead.

Use the [docker-compose.yml](https://github.com/overleaf/overleaf/blob/main/docker-compose.yml)
provided in the [official GitHub](https://github.com/overleaf/overleaf), but
change the image to `lvcs/sharelatex`. Also, note the additional
instructions in the [official Wiki](https://github.com/overleaf/overleaf/wiki/Release-Notes--4.x.x#manually-setting-up-mongodb-as-a-replica-set).

## Required secret: `OVERLEAF_INVITE_TOKEN_SECRET`

> [!IMPORTANT]
> Since Overleaf 6.2.0 the container refuses to start when this variable is
> missing (it exits with code 101 after printing `Your configuration is
> missing 1 required secret(s)`).

Overleaf uses this secret to encrypt the sharing-link tokens stored in the
database. Unlike the other internal secrets, which the container generates on
its first start, it has to be provided by you - and it must stay stable across
restarts and upgrades: if it changes, all previously issued sharing links
become invalid. Values shorter than 16 characters are rejected.

Generate a value with:

```sh
openssl rand -base64 32
```

- **Overleaf Toolkit**: add `OVERLEAF_INVITE_TOKEN_SECRET=<value>` to
  `config/variables.env` and restart with `bin/up`.
- **Docker Compose**: add it to the environment of the `sharelatex` service
  and restart the container.

## OIDC single sign-on

The image can authenticate users against an OpenID Connect provider (Keycloak,
Authentik, Okta, Azure AD, ...). OIDC login is **disabled until the provider is
configured** through environment variables, so the default behaviour is
unchanged.

The feature is a port of the
[overleaf-oidc patch](https://gitlab.informatik.uni-bremen.de/stugen-admins/forks/overleaf-oidc)
to Overleaf `6.3.0`, implemented as file replacements inside the image (see
[overlay/README.md](overlay/README.md)).

### Configuration

With the Overleaf Toolkit, add the variables to **`config/variables.env`** -
that file is what the toolkit passes to the container (as an env file). Note
that `config/overleaf.rc` is only read by the toolkit's own scripts, variables
put there do **not** reach the container. For a plain compose setup, use the
service's `environment:`/`env_file:` in `config/docker-compose.override.yml`:

```yaml
services:
    sharelatex:
        environment:
            OVERLEAF_OIDC_ISSUER: https://idp.example.com/realms/myrealm
            OVERLEAF_OIDC_AUTHORIZATION_URL: https://idp.example.com/realms/myrealm/protocol/openid-connect/auth
            OVERLEAF_OIDC_TOKEN_URL: https://idp.example.com/realms/myrealm/protocol/openid-connect/token
            OVERLEAF_OIDC_USERINFO_URL: https://idp.example.com/realms/myrealm/protocol/openid-connect/userinfo
            OVERLEAF_OIDC_CALLBACK_URL: https://overleaf.example.com/login/oidc/callback
            OVERLEAF_OIDC_CLIENT_ID: overleaf
            OVERLEAF_OIDC_CLIENT_SECRET: <client-secret>
```

| Variable | Description |
| --- | --- |
| `OVERLEAF_OIDC_ISSUER` | Issuer URL of the provider (a trailing slash is ignored when it is compared with the `iss` of the identity token). OIDC login is disabled while this is unset. |
| `OVERLEAF_OIDC_WELL_KNOWN_URL` | Discovery document of the provider, or just the issuer - the endpoints below are then read from it, see [Discovery](#discovery-one-click-configuration). |
| `OVERLEAF_OIDC_AUTHORIZATION_URL` | Authorization endpoint used to start the login flow. |
| `OVERLEAF_OIDC_TOKEN_URL` | Token endpoint used to exchange the authorization code. |
| `OVERLEAF_OIDC_USERINFO_URL` | Userinfo endpoint, its claims identify the user. |
| `OVERLEAF_OIDC_CALLBACK_URL` | Redirect URI registered at the provider. Optional: when unset it is derived from the host the user is browsing, see [Redirect URI](#redirect-uri-several-domains-and-reverse-proxies). |
| `OVERLEAF_OIDC_CALLBACK_URLS` | Several redirect URIs, separated by commas or whitespace, for deployments reachable under more than one host name. Takes precedence over `OVERLEAF_OIDC_CALLBACK_URL`. |
| `OVERLEAF_OIDC_CLIENT_ID` | Client id registered at the provider. |
| `OVERLEAF_OIDC_CLIENT_SECRET` | Client secret registered at the provider. |
| `OVERLEAF_OIDC_SCOPE` | Scopes to request (default `openid profile email`). |
| `OVERLEAF_OIDC_MATCHING` | Which claim identifies the account, `id` (the `sub` claim, default) or `username` (the `preferred_username` claim). |
| `OVERLEAF_OIDC_TRUST_UNVERIFIED_EMAIL` | Set to `true` to trust the `email` claim even when the provider reports `email_verified: false`, or `false` to refuse a claim the provider does not state at all. See [Behaviour](#behaviour). |
| `OVERLEAF_OIDC_LINK_MODE` | What a first login does when its email address matches an existing account that is not linked yet: `password` (default) asks for the password of that account before linking it, `auto` links without asking. See [Behaviour](#behaviour). |
| `OVERLEAF_OIDC_JWKS_URL` | The provider's JWKS, against which the identity token is verified. Taken from the discovery document's `jwks_uri` when unset; without it identity tokens cannot be verified. |
| `OVERLEAF_OIDC_REQUIRE_ID_TOKEN` | Set to `true` to refuse a login when the provider returns no identity token or no JWKS is known (default `false`: such a login is allowed and logged). |
| `OVERLEAF_ENABLE_LOCAL_LOGIN` | Set to `false` to hide and disable the email/password login (default `true`). |
| `OVERLEAF_LOGIN_INFO_TEXT` | HTML rendered above the login form (default `Welcome to Overleaf! Log in to your account below.`; set it to an empty value to show nothing). |
| `OVERLEAF_LOGIN_OIDC_BUTTON` | Label of the SSO button (default `Log in with SSO`). |
| `OVERLEAF_OIDC_LOGIN_IN_NAVBAR` | Set to `true` to also show the SSO button in the navigation bar (default `false`; it is always shown when local login is disabled). |
| `OVERLEAF_ENABLE_REGISTRATION` | Set to `false` to hide the registration page. When unset, registration is hidden whenever OIDC is enabled. |

### Discovery (one-click configuration)

Instead of naming every endpoint, the provider's discovery document can be
used. Set either the document itself or just the issuer (the
`/.well-known/openid-configuration` part is appended):

```yaml
OVERLEAF_OIDC_WELL_KNOWN_URL: https://idp.example.com/realms/myrealm
# or
OVERLEAF_OIDC_WELL_KNOWN_URL: https://idp.example.com/realms/myrealm/.well-known/openid-configuration
```

`issuer`, `authorization_endpoint`, `token_endpoint` and `userinfo_endpoint`
are then taken from the document - but only where the corresponding variable is
not set, so **every other `OVERLEAF_OIDC_*` variable still overrides** what the
document says. `OVERLEAF_OIDC_ISSUER` itself is optional as well: the issuer
from the document enables OIDC login.

The document itself may be pasted as well (the value then starts with `{`),
which helps with providers that do not document where their discovery URL
lives. Scopes are adapted to the provider: the default `openid profile email`
is reduced to what the document lists in `scopes_supported` (`openid` is always
requested, and an explicit `OVERLEAF_OIDC_SCOPE` is never changed) - providers
such as Synology's SSO server, which do not support `profile`, reject the
authorization request otherwise.

The document is not fetched at all when the issuer and
`OVERLEAF_OIDC_AUTHORIZATION_URL`, `OVERLEAF_OIDC_TOKEN_URL` and
`OVERLEAF_OIDC_USERINFO_URL` are all set, which keeps a fully pinned
configuration independent of the provider being reachable while the container
starts. Otherwise the fetch is retried five times with an increasing delay, and the
whole loop is bounded by a 60-second budget as well, because it runs before the
web service starts listening: an unreachable provider delays the boot by about a
minute at most, instead of by five request timeouts. A wrong URL, on the other
hand, is reported at once: providers such as Synology's SSO server answer an
unknown path with their web page, and an HTML answer is logged as a wrong URL
instead of being retried (the same goes for any HTTP 4xx). If the document still
cannot be read, or if it
does not carry the endpoints, the reason is written to the container log and
**OIDC login stays disabled - the rest of Overleaf keeps working**, so a wrong
provider URL does not take the whole instance down. `OVERLEAF_OIDC_CLIENT_ID`
and `OVERLEAF_OIDC_CLIENT_SECRET` are needed as well (a discovery document does
not contain them); when one of them is missing, OIDC login is disabled with a
log message instead of stopping the container.

### Identity token verification

The identity token (`id_token`) the provider returns from its token endpoint is
verified before a login is accepted: the signature is checked against the
provider's JWKS (`jwks_uri` from the discovery document, or
`OVERLEAF_OIDC_JWKS_URL`), together with `iss`, `aud` (it has to name the client
id), `exp`/`nbf`/`iat` (60 seconds of clock skew are allowed) and the presence of
`sub`. Only the RSA and ECDSA signature algorithms are accepted - never `none`,
never a shared-secret one. The `sub` of the token also has to equal the `sub` of
the userinfo response, so both responses are known to describe the same person.

Not every provider returns an identity token, and a provider that keeps its keys
elsewhere needs `OVERLEAF_OIDC_JWKS_URL`: when verification is impossible the
login is allowed and logged, so an existing deployment keeps working. Set
`OVERLEAF_OIDC_REQUIRE_ID_TOKEN: true` to refuse those logins instead. A token
that is presented but does not verify always refuses the login, and the login
page says so. The flow does not send a `nonce`, so none can be checked here.

### Redirect URI (several domains and reverse proxies)

**By default nothing has to be configured**: the redirect URI is derived from
the request that starts the login, so it is
`<scheme>://<the host the user is browsing>/login/oidc/callback`. A deployment
that is reachable under several host names therefore works as it is - each host
only has to be registered as a redirect URI at the provider - and the callback
that arrives is matched against the host name the login was started from.

The scheme and host name are taken from the `X-Forwarded-Proto` and
`X-Forwarded-Host` headers when they are trusted, which is Overleaf's default
(`behindProxy`), so a reverse proxy should set them. Without those headers the
URI is built from the `Host` header and `http`, which a provider that expects
`https` will reject.

To pin the redirect URI instead:

```yaml
# one URI (or just a path), used as configured
OVERLEAF_OIDC_CALLBACK_URL: https://latex.example.com/login/oidc/callback

# one URI per host name
OVERLEAF_OIDC_CALLBACK_URLS: https://latex.example.com/login/oidc/callback, https://tex.example.org/login/oidc/callback
```

With `OVERLEAF_OIDC_CALLBACK_URLS` the entry whose host name matches the request
is used; the port decides when both the entry and the request name one, and an
entry without a port matches every port. An entry that is a plain path such as
`/login/oidc/callback` applies to every host name. Host names that no entry
matches fall back to the derived URI, which is what an unconfigured deployment
uses anyway.

**Non-standard ports.** The derived URI keeps the port when any of the headers
carries it - `Host`, `X-Forwarded-Host` or `X-Forwarded-Port`. Overleaf's own
nginx, however, passes the host without the port (`proxy_set_header Host $host`,
and `$host` drops the port), so an instance that is reached on a non-standard
port (for example `http://192.168.1.10:8080`) either needs a proxy that sends
`X-Forwarded-Port`, or the port has to be part of a pinned URI:

```yaml
OVERLEAF_OIDC_CALLBACK_URLS: http://192.168.1.10:8080/login/oidc/callback, https://latex.example.com/login/oidc/callback
```

### Provider setup

- Redirect URI: `https://<your-overleaf-domain>/login/oidc/callback` - register
  one per host name you serve, or the `OVERLEAF_OIDC_CALLBACK_URLS` values.
- Client authentication: the token request sends `client_id` and
  `client_secret` in the request body (`client_secret_post`).
- The `openid` and `email` scopes are required. `profile` is requested as well
  by default and left out automatically when the discovery document does not
  list it. The userinfo response must contain the `sub` and `email` claims;
  `given_name`, `family_name`, `name` and `preferred_username` (or `username`)
  are used when present.

### Behaviour

- **An identity that is already linked signs the user in.** The account is
  looked up by its OIDC identifier (`OVERLEAF_OIDC_MATCHING`), and nothing else
  is asked for.
- **An email address that belongs to an existing account which is not linked yet
  does not sign anybody in by itself.** The identity is parked in the session for
  ten minutes and the user is sent to `/login/oidc/link`, a page that asks for
  the password of that account (the address is prefilled). Confirming it binds
  the OIDC identity to the account and finishes the login; the password goes
  through the normal credential check, so a wrong password is audited, rate
  limited and answered exactly like a failed password login. This is what stops
  somebody who can set an arbitrary address at the provider from taking an
  account over. `OVERLEAF_OIDC_LINK_MODE: auto` skips the step and links right
  away (the behaviour before the step existed), which is only safe when the
  provider verifies addresses.
- **No account with that address: one is created**, with the address marked as
  confirmed, because the provider vouches for it (see the point below about
  providers that say `email_verified: false`).
- On every login the first name and last name of the account are synchronised
  with the claims of the provider; the email address is only taken over when the
  provider vouches for it (next point).
- **The `email` claim identifies an account only when the provider vouches for
  it.** Linking an existing account, and rewriting the address stored on an
  account, require `email_verified: true` - or a provider that does not state
  the claim at all (the login then says so in the log, because providers that
  verify addresses often leave it out). When the provider answers
  `email_verified: false`, the login for an account with that address is refused
  ("the identity provider did not verify this email address ...") and the stored
  address is left alone, so that a user who can set an arbitrary address at the
  provider cannot take an account over. Set
  `OVERLEAF_OIDC_TRUST_UNVERIFIED_EMAIL: true` to trust such a claim anyway, or
  `false` to refuse a claim the provider does not state.
- Because the email address is asserted by the provider, the "confirm your
  email" prompts are skipped for OIDC users.
- A failed login sends the user back to `/login`, which now **shows why**: the
  provider did not verify the address, the address is linked to another
  identity, the confirmation expired before the password was entered, the
  password did not match, or the identity token did not verify. The reason is
  written to the container log as well (`OIDC login failed`). The texts are
  English; the page renders only the codes this image knows, never anything the
  provider returned.

## Fonts

The image contains every font of the TeX Live installation (`scheme-full`,
which is also every font of the CTAN archive that has a TeX Live package),
the system fonts that TeX Live does not ship (Noto CJK, WenQuanYi, Arphic
Uming/Ukai, Unifont, IPA/Un, Liberation, Carlito/Caladea, ...) and the
collection vendored in [`fonts/`](fonts/README.md).

Three things make the difference between "installed" and "usable", and all of
them are handled by the `Dockerfile`:

- **The TeX Live fonts are registered with fontconfig.** Without that they can
  only be used by file name (`\setCJKmainfont{FandolSong-Regular.otf}`), since a
  family-name lookup (`\setCJKmainfont{FandolSong}`) goes through fontconfig.
  The image adds a fontconfig configuration for
  `texmf-dist/fonts/{opentype,truetype}`, which covers the whole TeX Live
  collection - for XeLaTeX/LuaLaTeX documents as well as for tools like
  inkscape.
- **The `zhmetrics` metrics get their glyph files.** TeX Live's `zhmetrics`
  package ships metrics only (`uniyou20`, `unisong5b`, `gbkyou20`, ...); the
  glyphs are the Windows fonts the metrics were generated from. The vendored
  fonts are installed under the names its map expects (`simyou.ttf`,
  `simsun.ttc`, `simhei.ttf`, `simkai.ttf`, `simfang.ttf`, `simli.ttf`) and the
  map is enabled system-wide, so documents using these families work with
  **pdfLaTeX** and the `CJK`/`CJKutf8` package without having to
  `\input zhwinfonts` themselves.
- **The build verifies the result.** It checks with `kpsewhich` that the metric
  and glyph files of both groups are installed and compiles a small document
  with pdfTeX to prove that the `zhmetrics` map is active (a missing map is what
  turns into "Font uniyou20 not found" in a real document). The fontconfig
  family names are reported as well, and the XeLaTeX example
  `tests/fonts-by-name` is compiled by CI against the built image.

Notes:

- CTeX font sets that consist of Unicode fonts (`fontset=fandol`,
  `fontset=founder`, `fontset=mac`, ...) require **XeLaTeX or LuaLaTeX**; with
  pdfLaTeX, CTeX reports the font set as unavailable by design. `fandol` is
  part of TeX Live and works with XeLaTeX/LuaLaTeX.
- `tests/fonts-zhmetrics` and `tests/fonts-by-name` are minimal examples for
  both routes and are compiled by CI inside the image.
- The vendored Microsoft/Apple/Adobe fonts are not redistributable; see
  [`fonts/README.md`](fonts/README.md).

## Environment variables

All variables of the official image remain available (see the
[Overleaf documentation](https://docs.overleaf.com/on-premises/configuration/overleaf-toolkit/overleaf-toolkit-configuration)).
The variables added by this image are the ones documented in the OIDC section
above.

## Troubleshooting

### Log lines that are not errors

- `err={"message":"The \`punycode\` module is deprecated ...","code":"DEP0040"}`
  together with `msg=Warning details`, printed on every start: a deprecation
  warning from the dependencies of the bundled Overleaf version (Node 24 warns
  about the built-in `punycode` module). Overleaf's logger sends `process`
  warnings to its error channel as well, which is why it looks like an error;
  nothing is broken. Add `NODE_OPTIONS=--no-deprecation` (for example to the
  toolkit's `config/variables.env`) to keep it out of the log.
- Lines in which several timestamps and a JSON object are squeezed together are
  an artifact of how the container writes the logs of several processes into
  one stream; the same message is fine, just interleaved.
- `*** Running /etc/my_init.pre_shutdown.d/00_close_site ...` appears when the
  container is being stopped, it is not a crash.

## Building the image

### GitHub Actions

| Workflow | Trigger | Publishes to |
| --- | --- | --- |
| `build-test.yml` | pull requests to `master`, manual | – (builds and runs the tests) |
| `docker-build.yml` | release published, manual | `ghcr.io/<owner>/<repo>` under `<channel>-<short-hash>` (the hand-off image) |
| `docker-publish.yml` | manual | copies that image to `lvcs/sharelatex` on Docker Hub and moves `latest`/`<channel>`/`<version>` on both registries |

- **Docker Hub**: create the repository and add the secrets `DOCKER_USER` and
  `DOCKER_PASSWORD` (a Docker Hub access token) in
  *Settings → Secrets and variables → Actions*.
- **GitHub Packages**: no secret is needed, the workflow uses the built-in
  `GITHUB_TOKEN`.
- **Build, then publish**: `docker-build.yml` compiles the image **once** and stores
  it in GHCR under an immutable `<channel>-<short-hash>` tag (a cold build takes tens
  of minutes). `docker-publish.yml` copies that image registry-to-registry to Docker
  Hub and moves the `latest`/`<channel>`/`<version>` tags — seconds, never a rebuild.
  Publish a release to start a build automatically, or run either workflow manually
  from the *Actions* tab (*Run workflow*). Both registries get the image signed with
  cosign by the publish workflow.

### Local build

The build requires BuildKit, which is the default in current Docker versions;
it is used to install the bundled fonts without copying them into an extra
image layer. On older setups, enable it explicitly (`DOCKER_BUILDKIT=1 docker
build ...`).

```sh
docker build -t sharelatex .
docker run --rm --volume "$(pwd)/tests:/tests" --entrypoint=/bin/bash \
    sharelatex -c "/bin/bash /tests/compile.sh"
```

## Staying in sync with the upstream image

`Dockerfile` extends the official `sharelatex/sharelatex` image; the OIDC
support is applied as file replacements in `overlay/`. The `Dockerfile`
verifies the checksum of the patched files **before** copying the overlay: when
the base image (or the upstream `tuetenk0pp/sharelatex-full` repository, which
drives the base image version) is updated, the build fails instead of silently
mixing the overlay with a newer application version. In that case, re-base the
overlay as described in [overlay/README.md](overlay/README.md).

## Credits

- [Overleaf](https://github.com/overleaf/overleaf) for Overleaf CE
- [tuetenk0pp/sharelatex-full](https://github.com/tuetenk0pp/sharelatex-full),
  the base of this repository
- [stugen-admins/forks/overleaf-oidc](https://gitlab.informatik.uni-bremen.de/stugen-admins/forks/overleaf-oidc)
  for the OIDC patch this port is based on
- [smhaller/ldap-overleaf-sl](https://github.com/smhaller/ldap-overleaf-sl)
  for the approach of patching the application inside the image

## License

AGPL-3.0, see [LICENSE](LICENSE).
