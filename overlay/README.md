# Overlay: OIDC login support for Overleaf CE

This directory contains complete replacement files that are copied into the
`sharelatex/sharelatex` image to add OpenID Connect (OIDC) single sign-on.

The approach is the same as the one used by
[smhaller/ldap-overleaf-sl](https://github.com/smhaller/ldap-overleaf-sl):
instead of rebuilding Overleaf from source, the files are overwritten inside
the image. Overleaf runs its backend directly from these source files
(`app/src/**/*.mjs`, `app/views/**/*.pug`), so no compilation step is needed.

The implementation is a port of the patches from
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
5. Update `overlay/README.md` (this file) with the new base version.

For convenience, the files can be extracted from the image without starting
it:

```sh
docker create --name tmp sharelatex/sharelatex:<new-version>
docker cp tmp:/overleaf/services/web/app/src/Features/Authentication/AuthenticationController.mjs .
docker rm tmp
```

## Modified files

| File | Change |
| --- | --- |
| `app/src/Features/Authentication/OidcStrategy.mjs` | **new file**: minimal OIDC strategy on top of `passport-oauth2`; fetches the profile from the userinfo endpoint |
| `app/src/Features/Authentication/AuthenticationController.mjs` | adds `oidcLogin`, `oidcLoginCallback`, `verifyOpenIDConnect`, `extractOidcIdFromProfile`, `ensureOidcLoginEnabled`; extracts `createPassportCallback`; disables local login when `OVERLEAF_ENABLE_LOCAL_LOGIN=false` |
| `app/src/infrastructure/Server.mjs` | registers the `oidc` passport strategy when `OVERLEAF_OIDC_ISSUER` is set |
| `app/src/infrastructure/ExpressLocals.mjs` | exposes the login/OIDC configuration to the views |
| `app/src/infrastructure/Features.mjs` | counts OIDC as an external authentication system (hides the registration page unless `OVERLEAF_ENABLE_REGISTRATION` overrides it) |
| `app/src/models/User.mjs` | adds the `oidcIdentifier` field |
| `app/src/Features/User/UserPrimaryEmailCheckHandler.mjs` | skips the primary email check for OIDC users (the mail address is asserted by the provider) |
| `app/src/router.mjs` | adds `/login/oidc` and `/login/oidc/callback`; redirects `/register` to `/login` when registration is disabled |
| `app/views/user/login.pug` | hides the password form when local login is disabled, adds the SSO button and the `OVERLEAF_LOGIN_INFO_TEXT` text |
| `app/views/layout/navbar-marketing.pug` | optional SSO button in the navigation bar |

## Notes

- `.pug` files are precompiled to `.js` at image build time and take
  precedence at boot, so the `Dockerfile` deletes all precompiled templates
  after copying the overlay. The views are then compiled from source when a
  container boots (a few seconds), which guarantees that the modified
  templates are actually used.
- Overleaf `6.x` restricts direct access to request input
  (`req.query`/`req.body`, `REQ_LOCKDOWN_MODE`). The OIDC flow reads request
  parameters only through `passport-oauth2`, which is patched for this in the
  image; the added code does not access raw request input.
- The token exchange sends the client credentials in the request body
  (`client_secret_post`). Make sure the OIDC client is configured accordingly.
