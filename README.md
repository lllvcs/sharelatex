# sharelatex-full (Overleaf CE, extended)

[English](README.md) | [简体中文](README.zh-CN.md)

[![GitHub license](https://img.shields.io/github/license/lllvcs/sharelatex)](https://github.com/lllvcs/sharelatex/blob/master/LICENSE)
[![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/lllvcs/sharelatex/build-test.yml)](https://github.com/lllvcs/sharelatex/actions/workflows/build-test.yml)
[![GitHub issues](https://img.shields.io/github/issues/lllvcs/sharelatex)](https://github.com/lllvcs/sharelatex/issues)
[![Docker Pulls](https://img.shields.io/docker/pulls/lvcs/sharelatex-full)](https://hub.docker.com/r/lvcs/sharelatex-full)

An extended [Overleaf Community Edition](https://github.com/overleaf/overleaf)
Docker image, based on
[tuetenk0pp/sharelatex-full](https://github.com/tuetenk0pp/sharelatex-full).

## Features

Compared to the official `sharelatex/sharelatex` image:

- fully updated TeX Live installation, including all available packages
- additional TeX Live and system fonts, including a bundled collection of
  Chinese fonts (vendored in [`fonts/`](fonts/README.md), so nothing has to be
  downloaded while building the image)
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
OVERLEAF_IMAGE_NAME=lvcs/sharelatex-full
```

Alternatively, use a `config/docker-compose.override.yml` file as described
[here](https://github.com/overleaf/toolkit/blob/master/doc/configuration.md#the-docker-composeoverrideyml-file):

```yaml
services:
    sharelatex:
        image: lvcs/sharelatex-full
```

### Docker Compose

> [!WARNING]
> This method is not recommended. Use the Overleaf Toolkit instead.

Use the [docker-compose.yml](https://github.com/overleaf/overleaf/blob/main/docker-compose.yml)
provided in the [official GitHub](https://github.com/overleaf/overleaf), but
change the image to `lvcs/sharelatex-full`. Also, note the additional
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

With the Overleaf Toolkit, add the variables to `config/overleaf.rc` (they are
passed to the container) or to `config/docker-compose.override.yml`:

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
| `OVERLEAF_OIDC_ISSUER` | Issuer URL of the provider. OIDC login is disabled while this is unset. |
| `OVERLEAF_OIDC_AUTHORIZATION_URL` | Authorization endpoint used to start the login flow. |
| `OVERLEAF_OIDC_TOKEN_URL` | Token endpoint used to exchange the authorization code. |
| `OVERLEAF_OIDC_USERINFO_URL` | Userinfo endpoint, its claims identify the user. |
| `OVERLEAF_OIDC_CALLBACK_URL` | Redirect URI registered at the provider, base URL plus `/login/oidc/callback`. |
| `OVERLEAF_OIDC_CLIENT_ID` | Client id registered at the provider. |
| `OVERLEAF_OIDC_CLIENT_SECRET` | Client secret registered at the provider. |
| `OVERLEAF_OIDC_SCOPE` | Scopes to request (default `openid profile email`). |
| `OVERLEAF_OIDC_MATCHING` | Which claim identifies the account, `id` (the `sub` claim, default) or `username` (the `preferred_username` claim). |
| `OVERLEAF_ENABLE_LOCAL_LOGIN` | Set to `false` to hide and disable the email/password login (default `true`). |
| `OVERLEAF_LOGIN_INFO_TEXT` | HTML rendered above the login form (default `Welcome to Overleaf! Log in to your account below.`; set it to an empty value to show nothing). |
| `OVERLEAF_LOGIN_OIDC_BUTTON` | Label of the SSO button (default `Log in with SSO`). |
| `OVERLEAF_OIDC_LOGIN_IN_NAVBAR` | Set to `true` to also show the SSO button in the navigation bar (default `false`; it is always shown when local login is disabled). |
| `OVERLEAF_ENABLE_REGISTRATION` | Set to `false` to hide the registration page. When unset, registration is hidden whenever OIDC is enabled. |

### Provider setup

- Redirect URI: `https://<your-overleaf-domain>/login/oidc/callback`
- Client authentication: the token request sends `client_id` and
  `client_secret` in the request body (`client_secret_post`).
- The `openid profile email` scopes must be available. The userinfo response
  must contain the `sub` and `email` claims; `given_name`, `family_name`,
  `name` and `preferred_username` are used when present.

### Behaviour

- On the first login the account is looked up by its OIDC identifier. If no
  account is linked yet, an existing account with the same **email address**
  claimed by the provider is linked to the OIDC identity; otherwise a new
  account is created with a confirmed email address.
- On every login the first name, last name and email address of the account
  are synchronised with the claims of the provider.
- Because the email address is asserted by the provider, the "confirm your
  email" prompts are skipped for OIDC users.
- Linking by email assumes that the provider only asserts verified email
  addresses. If your provider allows users to set arbitrary, unverified email
  addresses, configure it to verify them, otherwise a user could take over an
  account by choosing its email address.
- Failed logins (for example when a user cancels the consent screen) send the
  user back to `/login`; the reason is written to the container log
  (`OIDC login failed`).

## Environment variables

All variables of the official image remain available (see the
[Overleaf documentation](https://docs.overleaf.com/on-premises/configuration/overleaf-toolkit/overleaf-toolkit-configuration)).
The variables added by this image are the ones documented in the OIDC section
above.

## Building the image

### GitHub Actions

| Workflow | Trigger | Publishes to |
| --- | --- | --- |
| `build-test.yml` | pull requests to `master`, manual | – (builds and runs the tests) |
| `build-push-docker.yml` | release published, manual | `lvcs/sharelatex-full` on Docker Hub |
| `build-push-ghcr.yml` | release published, manual | `ghcr.io/<owner>/<repo>` (GitHub Packages) |

- **Docker Hub**: create the repository and add the secrets `DOCKER_USER` and
  `DOCKER_PASSWORD` (a Docker Hub access token) in
  *Settings → Secrets and variables → Actions*.
- **GitHub Packages**: no secret is needed, the workflow uses the built-in
  `GITHUB_TOKEN`.
- **Trigger a build**: publish a release (which also produces versioned tags
  plus `latest`), or start a workflow manually from the *Actions* tab
  (*Run workflow*), which tags the image after the selected branch.

### Local build

The build requires BuildKit, which is the default in current Docker versions;
it is used to install the bundled fonts without copying them into an extra
image layer. On older setups, enable it explicitly (`DOCKER_BUILDKIT=1 docker
build ...`).

```sh
docker build -t sharelatex-full .
docker run --rm --volume "$(pwd)/tests:/tests" --entrypoint=/bin/bash \
    sharelatex-full -c "/bin/bash /tests/compile.sh"
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
