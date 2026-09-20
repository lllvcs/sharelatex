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

// Host names and ports are read through the URL parser, so that IPv6 literals
// ("[::1]:8080") work as well.
function authorityOf(value) {
  try {
    const url = new URL(`http://${value}`)
    return { hostname: url.hostname.toLowerCase(), port: url.port }
  } catch (err) {
    return { hostname: String(value).toLowerCase(), port: '' }
  }
}

export function hostnameOf(value) {
  const url = tryUrl(value)
  return url ? url.hostname.toLowerCase() : null
}

function portOf(value) {
  const url = tryUrl(value)
  if (url) {
    return url.port
  }
  const authority = authorityOf(value)
  return authority.port
}

function tryUrl(value) {
  try {
    return new URL(value)
  } catch (err) {
    return null
  }
}

function defaultPortFor(protocol) {
  return protocol === 'https' ? '443' : '80'
}

// Protocol and host the user is browsing; behind a reverse proxy these are in
// the X-Forwarded-* headers, which are only read when the deployment is
// configured to trust them (`trustProxy`).
//
// The port matters when the instance is reached on a non-standard port (an
// internal address such as http://192.168.1.10:8080): it is taken from the host
// that carries one - the plain `Host` header often still has it while
// `X-Forwarded-Host` does not, because nginx's `$host` drops the port - or from
// `X-Forwarded-Port`.
export function requestOrigin(req, trustProxy) {
  const forwardedProto = trustProxy
    ? firstHeaderValue(req, 'x-forwarded-proto')
    : null
  const protocol = forwardedProto || req.protocol || 'http'

  const forwardedHost = trustProxy
    ? firstHeaderValue(req, 'x-forwarded-host')
    : null
  const hostHeader = firstHeaderValue(req, 'host')
  const forwardedPort = trustProxy
    ? firstHeaderValue(req, 'x-forwarded-port')
    : null

  let host = forwardedHost || hostHeader
  if (!host) {
    return null
  }

  if (!portOf(host)) {
    const alternative = [hostHeader, forwardedHost].find(
      candidate =>
        candidate &&
        candidate !== host &&
        portOf(candidate) &&
        hostnameOf(candidate) === hostnameOf(host)
    )
    if (alternative) {
      host = `${host}:${portOf(alternative)}`
    } else if (forwardedPort && forwardedPort !== defaultPortFor(protocol)) {
      host = `${host}:${forwardedPort}`
    }
  }

  return `${protocol}://${host}`
}

// Host names are compared case-insensitively. The port only decides when both
// sides name one: a pinned entry without a port matches every port, and when
// the proxy did not pass the port on, an entry that names it still matches.
export function matchesHost(entry, origin) {
  const entryHostname = hostnameOf(entry)
  const originHostname = hostnameOf(origin)
  if (!entryHostname || entryHostname !== originHostname) {
    return false
  }
  const entryPort = portOf(entry)
  const originPort = portOf(origin)
  return !entryPort || !originPort || entryPort === originPort
}

function matchByHostname(req, entries, trustProxy) {
  const origin = requestOrigin(req, trustProxy)
  if (!origin) {
    return null
  }
  return entries.find(entry => hasProtocol(entry) && matchesHost(entry, origin)) || null
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
