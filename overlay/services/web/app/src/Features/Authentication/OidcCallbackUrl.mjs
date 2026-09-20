// The redirect URI (callback URL) sent to the identity provider.
//
// The provider has to know this URI, and the authorization request and the
// token exchange have to use the same value.  By default it is derived from
// the request that starts the login: passport-oauth2 resolves a *relative*
// callback path against the URL of the current request, so a deployment that
// is reachable under several host names needs no configuration, and each host
// only has to be registered at the provider.
//
// Providers that insist on a redirect URI matching the registered value
// verbatim (scheme included) can pin it:
//
//   OVERLEAF_OIDC_CALLBACK_URL   one URL (or path); used as-is
//   OVERLEAF_OIDC_CALLBACK_URLS  a list; the entry whose host name matches the
//                                request is used, entries that are paths act
//                                as a fallback for every host
//
// Anything that is not pinned falls back to the path on the host that the user
// is browsing, which relies on the X-Forwarded-* headers of the reverse proxy
// (passport-oauth2 gets `proxy: true` from Server.mjs, matching Overleaf's
// `behindProxy` default).

import { URL } from 'node:url'

export const DEFAULT_CALLBACK_PATH = '/login/oidc/callback'

// Entries are separated by commas and/or whitespace.
export function parseCallbackUrls(value) {
  return String(value || '')
    .split(/[\s,]+/)
    .filter(Boolean)
}

export function hasProtocol(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
}

function firstHeaderValue(req, name) {
  const value = req.headers ? req.headers[name] : undefined
  return value ? String(value).split(',')[0].trim() : null
}

// Protocol and host the user is browsing; behind a reverse proxy these are in
// the X-Forwarded-* headers, which are only read when the deployment is
// configured to trust them (`trustProxy`).
export function requestOrigin(req, trustProxy) {
  const protocol =
    (trustProxy && firstHeaderValue(req, 'x-forwarded-proto')) ||
    req.protocol ||
    'http'
  const host =
    (trustProxy && firstHeaderValue(req, 'x-forwarded-host')) ||
    firstHeaderValue(req, 'host')
  return host ? `${protocol}://${host}` : null
}

// Host names are compared without the port, so a pinned entry matches the
// same host name on every port it is reachable at.
export function hostnameOf(value) {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch (err) {
    return null
  }
}

function matchByHostname(req, entries, trustProxy) {
  const origin = requestOrigin(req, trustProxy)
  const hostname = origin && hostnameOf(origin)
  if (!hostname) {
    return null
  }
  return (
    entries.find(
      entry => hasProtocol(entry) && hostnameOf(entry) === hostname
    ) || null
  )
}

export function resolveCallbackURL(req, options = {}) {
  const {
    callbackURL,
    callbackURLs = [],
    trustProxy = false,
    defaultPath = DEFAULT_CALLBACK_PATH,
  } = options

  if (callbackURLs.length > 0) {
    const pinned = matchByHostname(req, callbackURLs, trustProxy)
    if (pinned) {
      return pinned
    }
    const anyPath = callbackURLs.find(entry => !hasProtocol(entry))
    if (anyPath) {
      return anyPath
    }
  }

  if (callbackURL) {
    return callbackURL
  }

  return defaultPath
}
