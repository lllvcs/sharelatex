import { Strategy as OAuth2Strategy } from 'passport-oauth2'
import logger from '@overleaf/logger'
import {
  DEFAULT_CALLBACK_PATH,
  resolveCallbackURL,
} from './OidcCallbackUrl.mjs'

// Minimal OpenID Connect strategy built on top of passport-oauth2, which is
// already a dependency of the web service. passport-oauth2 performs the
// authorization-code exchange and verifies the `state` parameter against the
// session store; this subclass only adds the userinfo lookup that turns the
// access token into a user profile. This mirrors the behaviour of
// passport-openidconnect (used by other Overleaf OIDC patches) without adding
// a new dependency: the profile is fetched from the provider's userinfo
// endpoint over TLS using an access token that was obtained by authenticating
// as the registered client.
export class OidcStrategy extends OAuth2Strategy {
  constructor(options, verify) {
    super(
      {
        authorizationURL: options.authorizationURL,
        tokenURL: options.tokenURL,
        clientID: options.clientID,
        clientSecret: options.clientSecret,
        // A path instead of an absolute URL: passport-oauth2 resolves it
        // against the URL of the request being authenticated, so the redirect
        // URI follows the host name the user is browsing (see
        // OidcCallbackUrl.mjs).
        callbackURL: options.callbackURL || DEFAULT_CALLBACK_PATH,
        scope: options.scope,
        // Enables the `state` parameter, which passport-oauth2 stores in and
        // verifies against the session. Without it no CSRF protection is
        // performed on the callback.
        state: true,
        // Read the X-Forwarded-* headers when deriving the callback URL, like
        // the rest of the application does (`behindProxy`).
        proxy: options.proxy,
      },
      verify
    )
    this.name = 'oidc'
    this._userInfoURL = options.userInfoURL
    this._configuredCallbackURL = options.callbackURL
    this._callbackURLs = options.callbackURLs || []
  }

  authenticate(req, options) {
    if (options && options.callbackURL) {
      return super.authenticate(req, options)
    }
    return super.authenticate(req, {
      ...options,
      callbackURL: resolveCallbackURL(req, {
        callbackURL: this._configuredCallbackURL,
        callbackURLs: this._callbackURLs,
        trustProxy: this._trustProxy === true,
      }),
    })
  }

  userProfile(accessToken, done) {
    fetch(this._userInfoURL, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(15000),
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(
            `userinfo endpoint responded with status ${response.status}`
          )
        }
        return response.json()
      })
      .then(claims => {
        if (!claims.sub || !claims.email) {
          throw new Error(
            'userinfo response is missing the required "sub" or "email" claim'
          )
        }
        done(null, {
          id: claims.sub,
          // `username` is not the standard claim (that is
          // `preferred_username`), but providers like Synology's SSO server
          // only publish `username`
          username:
            claims.preferred_username || claims.username || claims.email,
          displayName:
            claims.name ||
            [claims.given_name, claims.family_name].filter(Boolean).join(' '),
          name: {
            givenName: claims.given_name,
            familyName: claims.family_name,
          },
          emails: [{ value: claims.email }],
          _json: claims,
        })
      })
      .catch(err => {
        logger.err({ err }, 'failed to load OIDC user profile')
        done(err)
      })
  }
}
