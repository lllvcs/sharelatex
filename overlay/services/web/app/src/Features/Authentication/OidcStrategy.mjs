import { Strategy as OAuth2Strategy } from 'passport-oauth2'
import logger from '@overleaf/logger'

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
        callbackURL: options.callbackURL,
        scope: options.scope,
        // Enables the `state` parameter, which passport-oauth2 stores in and
        // verifies against the session. Without it no CSRF protection is
        // performed on the callback.
        state: true,
      },
      verify
    )
    this.name = 'oidc'
    this._userInfoURL = options.userInfoURL
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
          username: claims.preferred_username || claims.email,
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
