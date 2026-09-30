import { Strategy as OAuth2Strategy } from 'passport-oauth2'
import logger from '@overleaf/logger'
import {
  DEFAULT_CALLBACK_PATH,
  resolveCallbackURL,
} from './OidcCallbackUrl.mjs'
import { createJwksCache, verifyIdToken } from './OidcIdToken.mjs'

// Minimal OpenID Connect strategy built on top of passport-oauth2, which is
// already a dependency of the web service. passport-oauth2 performs the
// authorization-code exchange and verifies the `state` parameter against the
// session store; this subclass adds
//
//   - the userinfo lookup that turns the access token into a user profile,
//   - verification of the identity token the provider returned (see
//     OidcIdToken.mjs), so the claims are known to be signed by the provider,
//   - `req` for the verify callback, which the password step that links an
//     existing account needs (see OidcLinkRequest.mjs).
//
// The verify callback this strategy hands to the application has the shape
//
//   verify(req, accessToken, refreshToken, { params, idTokenClaims }, profile, done)
//
// There is no dependency on how a particular passport-oauth2 version calls its
// own verify function: the strategy normalises the two historical call shapes,
// and reads the identity token from the token response it captures itself.

const TOKEN_RESPONSE_TTL_MS = 5 * 60 * 1000
const TOKEN_RESPONSE_LIMIT = 50

function authorizationCodeOf(req) {
  return (
    (req && req.query && req.query.code) ||
    (req && req.body && req.body.code) ||
    null
  )
}

export class OidcStrategy extends OAuth2Strategy {
  constructor(options, verify) {
    // `handle` is assigned after super() returns: an arrow function cannot be
    // used here because `this` is not initialised until super() has run.
    let handle = null
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
        // The verify callback needs the request: the OIDC login parks a pending
        // "link this identity" request in the session.
        passReqToCallback: true,
      },
      function (req, accessToken, refreshToken, paramsOrProfile, profileOrDone, maybeDone) {
        return handle(
          req,
          accessToken,
          refreshToken,
          paramsOrProfile,
          profileOrDone,
          maybeDone
        )
      }
    )
    this.name = 'oidc'
    this._userInfoURL = options.userInfoURL
    this._configuredCallbackURL = options.callbackURL
    this._callbackURLs = options.callbackURLs || []
    this._issuer = options.issuer
    this._clientID = options.clientID
    this._jwksURL = options.jwksURL
    this._requireIdToken = options.requireIdToken === true
    this._jwksCache = options.jwksCache || createJwksCache()
    this._logger = options.logger || logger
    this._verifyApplication = verify
    this._warnedAboutMissingIdToken = false

    // The token response is the only place the identity token appears, and
    // whether passport-oauth2 forwards it to the verify callback depends on its
    // version. Capture it here, keyed by the authorization code, which is
    // unique per login attempt (so concurrent logins cannot mix up responses).
    this._tokenResponses = new Map()
    const getToken = this._oauth2.getOAuthAccessToken.bind(this._oauth2)
    this._oauth2.getOAuthAccessToken = (code, params, callback) => {
      getToken(code, params, (err, accessToken, refreshToken, tokenParams) => {
        if (!err && code) {
          this._rememberTokenResponse(code, tokenParams)
        }
        callback(err, accessToken, refreshToken, tokenParams)
      })
    }

    handle = (req, accessToken, refreshToken, paramsOrProfile, profileOrDone, maybeDone) => {
      // Two call shapes, depending on whether the installed passport-oauth2
      // passes the token response to the verify callback:
      //   (req, accessToken, refreshToken, params, profile, done)
      //   (req, accessToken, refreshToken, profile, done)
      let params
      let profile
      let done
      if (typeof profileOrDone === 'function') {
        done = profileOrDone
        profile = paramsOrProfile
      } else {
        params = paramsOrProfile
        profile = profileOrDone
        done = maybeDone
      }
      return this._verifyWithIdToken(
        req,
        accessToken,
        refreshToken,
        params,
        profile,
        done
      )
    }
  }

  _rememberTokenResponse(code, params) {
    if (!params || typeof params !== 'object') {
      return
    }
    if (this._tokenResponses.size >= TOKEN_RESPONSE_LIMIT) {
      const oldest = this._tokenResponses.keys().next().value
      this._tokenResponses.delete(oldest)
    }
    this._tokenResponses.set(code, { params, at: Date.now() })
  }

  _takeTokenResponse(req) {
    const code = authorizationCodeOf(req)
    if (!code) {
      return null
    }
    const entry = this._tokenResponses.get(code)
    if (!entry) {
      return null
    }
    this._tokenResponses.delete(code)
    if (Date.now() - entry.at > TOKEN_RESPONSE_TTL_MS) {
      return null
    }
    return entry.params
  }

  async _verifyWithIdToken(
    req,
    accessToken,
    refreshToken,
    params,
    profile,
    done
  ) {
    const tokenParams = params || this._takeTokenResponse(req) || {}
    const idToken = tokenParams.id_token

    let idTokenClaims = null
    if (typeof idToken === 'string' && idToken !== '') {
      try {
        idTokenClaims = await verifyIdToken(idToken, {
          issuer: this._issuer,
          clientId: this._clientID,
          jwksUri: this._jwksURL,
          cache: this._jwksCache,
          onWarn: message =>
            this._logger.warn({ provider: this._issuer }, `OIDC: ${message}`),
        })
      } catch (err) {
        this._logger.err(
          { err, provider: this._issuer },
          'OIDC: refusing the login, the identity token could not be verified'
        )
        const error = new Error(
          `the identity token could not be verified: ${err.message}`
        )
        error.oidcErrorCode = 'oidc-token-invalid'
        return done(error)
      }
    } else if (this._requireIdToken) {
      this._logger.err(
        { provider: this._issuer },
        'OIDC: refusing the login, the provider returned no identity token'
      )
      const error = new Error(
        'the provider returned no identity token (OVERLEAF_OIDC_REQUIRE_ID_TOKEN is set)'
      )
      error.oidcErrorCode = 'oidc-token-invalid'
      return done(error)
    } else if (!this._warnedAboutMissingIdToken) {
      this._warnedAboutMissingIdToken = true
      this._logger.warn(
        { provider: this._issuer, jwksURL: this._jwksURL },
        'OIDC: the provider returned no identity token, so only the userinfo ' +
          'response is used; set OVERLEAF_OIDC_REQUIRE_ID_TOKEN to refuse such logins'
      )
    }

    if (
      idTokenClaims &&
      profile &&
      profile.id != null &&
      String(idTokenClaims.sub) !== String(profile.id)
    ) {
      this._logger.err(
        {
          provider: this._issuer,
          idTokenSub: idTokenClaims.sub,
          userinfoSub: profile.id,
        },
        'OIDC: refusing the login, the identity token and the userinfo response name different subjects'
      )
      const error = new Error(
        'the identity token and the userinfo response name different subjects'
      )
      error.oidcErrorCode = 'oidc-token-invalid'
      return done(error)
    }

    return this._verifyApplication(
      req,
      accessToken,
      refreshToken,
      { params: tokenParams, idTokenClaims },
      profile,
      done
    )
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
