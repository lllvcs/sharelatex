// OpenID Connect discovery (OpenID Connect Discovery 1.0).
//
// OVERLEAF_OIDC_WELL_KNOWN_URL configures the endpoints that are not set
// explicitly.  It takes the URL of the provider's discovery document
//
//   https://idp.example.com/realms/myrealm/.well-known/openid-configuration
//
// the issuer, in which case /.well-known/openid-configuration is appended
//
//   https://idp.example.com/realms/myrealm
//
// or the document itself as JSON (providers hand it out as JSON, and copying
// it into the variable is what people try when they are unsure about the URL).
//
// The values of the document are written into the environment as defaults, so
// the rest of the application keeps reading the plain OVERLEAF_OIDC_*
// variables and explicitly configured values always win.  Nothing is fetched
// when the authorization, token and userinfo endpoints are all configured.
//
// The module deliberately has no imports besides node:timers/promises, so that
// tests/oidc-well-known.test.mjs can exercise it on its own.

import { setTimeout as sleepFor } from 'node:timers/promises'

const WELL_KNOWN_PATH = '/.well-known/openid-configuration'

export const DEFAULT_SCOPE = 'openid profile email'

const ENDPOINT_VARIABLES = {
  authorization_endpoint: 'OVERLEAF_OIDC_AUTHORIZATION_URL',
  token_endpoint: 'OVERLEAF_OIDC_TOKEN_URL',
  userinfo_endpoint: 'OVERLEAF_OIDC_USERINFO_URL',
}

// Everything passport-oauth2 needs besides the issuer: a missing client id or
// secret makes the strategy constructor throw, which would keep the whole web
// service from starting, so they are part of the completeness check.
const REQUIRED_VARIABLES = [
  ...Object.values(ENDPOINT_VARIABLES),
  'OVERLEAF_OIDC_CLIENT_ID',
  'OVERLEAF_OIDC_CLIENT_SECRET',
]

export function wellKnownDocumentUrl(value) {
  const url = String(value).trim()
  if (url.includes('/.well-known/')) {
    return url
  }
  return url.replace(/\/+$/, '') + WELL_KNOWN_PATH
}

// Endpoints that are neither configured nor taken from the document so far.
export function missingEndpoints(env, document) {
  return Object.entries(ENDPOINT_VARIABLES)
    .filter(
      ([field, variable]) =>
        !env[variable] && !isFilled(document && document[field])
    )
    .map(([field, variable]) => `${field} (${variable})`)
}

// Whether the configuration is pinned completely, i.e. reading the document
// cannot add anything. The issuer counts as well: it is what enables OIDC.
export function isCompletelyConfigured(env) {
  return (
    missingEndpoints(env, null).length === 0 &&
    Boolean(env.OVERLEAF_OIDC_ISSUER)
  )
}

// The settings passport-oauth2 needs to register the strategy.
export function missingOidcEndpoints(env) {
  return REQUIRED_VARIABLES.filter(variable => !env[variable])
}

// Whether OIDC login can be registered: an issuer enables it, and the
// endpoints plus the client credentials have to be known. Called after the
// discovery document was read, so an incomplete configuration (or a document
// that could not be read) leaves the application running without OIDC instead
// of failing to start.
export function oidcIsConfigured(env) {
  return (
    Boolean(env.OVERLEAF_OIDC_ISSUER) && missingOidcEndpoints(env).length === 0
  )
}

function isFilled(value) {
  return typeof value === 'string' && value !== ''
}

// The scopes to request: the default is "openid profile email", and a provider
// that does not list one of them in scopes_supported (Synology's SSO server,
// for example, only supports "openid email groups") rejects the authorization
// request. Scopes that the document does not list are left out; "openid" is
// always requested, and an explicit OVERLEAF_OIDC_SCOPE is never touched.
export function scopesForDocument(document, env = process.env) {
  const requested = String(env.OVERLEAF_OIDC_SCOPE || DEFAULT_SCOPE)
    .split(/\s+/)
    .filter(Boolean)

  if (env.OVERLEAF_OIDC_SCOPE) {
    return { scopes: requested, dropped: [] }
  }
  const supported = Array.isArray(document && document.scopes_supported)
    ? document.scopes_supported.map(String)
    : null
  if (!supported) {
    return { scopes: requested, dropped: [] }
  }

  const scopes = requested.filter(
    scope => scope === 'openid' || supported.includes(scope)
  )
  return {
    scopes,
    dropped: requested.filter(scope => !scopes.includes(scope)),
  }
}

// Fills the environment from the document, without overwriting anything that
// is set already; returns what was taken from the document.
export function applyDocument(document, env = process.env) {
  if (document === null || typeof document !== 'object') {
    throw new Error('the discovery document is not a JSON object')
  }

  const missing = missingEndpoints(env, document)
  if (missing.length > 0) {
    throw new Error(
      `the discovery document does not provide ${missing.join(', ')}; ` +
        'set them explicitly if the provider does not publish them'
    )
  }
  if (!env.OVERLEAF_OIDC_ISSUER && !isFilled(document.issuer)) {
    throw new Error(
      'the discovery document has no issuer; set OVERLEAF_OIDC_ISSUER explicitly'
    )
  }

  const applied = {}
  for (const [field, variable] of Object.entries(ENDPOINT_VARIABLES)) {
    if (!env[variable]) {
      env[variable] = document[field]
      applied[variable] = document[field]
    }
  }
  if (!env.OVERLEAF_OIDC_ISSUER) {
    env.OVERLEAF_OIDC_ISSUER = document.issuer
    applied.OVERLEAF_OIDC_ISSUER = document.issuer
  }

  const { scopes } = scopesForDocument(document, env)
  if (scopes.join(' ') !== (env.OVERLEAF_OIDC_SCOPE || DEFAULT_SCOPE)) {
    env.OVERLEAF_OIDC_SCOPE = scopes.join(' ')
    applied.OVERLEAF_OIDC_SCOPE = env.OVERLEAF_OIDC_SCOPE
  }
  return applied
}

// fetch() reports every network problem as "fetch failed" and hides the real
// reason in `cause` (and, when several addresses were tried, in an
// AggregateError's `errors`). Walk the chain so that the log says what actually
// went wrong - ENOTFOUND, ECONNREFUSED, a certificate error, ...
export function describeError(err) {
  const seen = new Set()
  const parts = []
  const walk = (nested, depth) => {
    if (!nested || depth > 5 || seen.has(nested)) {
      return
    }
    seen.add(nested)
    parts.push(nested.code ? `${nested.code} (${nested.message})` : nested.message)
    for (const inner of Array.isArray(nested.errors) ? nested.errors : []) {
      walk(inner, depth + 1)
    }
    walk(nested.cause, depth + 1)
  }
  walk(err, 0)
  return parts.filter(Boolean).join(' | ') || String(err)
}

async function fetchDocument(url, fetchImpl, timeoutMs) {
  let response
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw new Error(`the request failed: ${describeError(err)}`)
  }
  if (!response.ok) {
    const err = new Error(`the provider answered with HTTP ${response.status}`)
    // a client error will not go away by retrying
    if (response.status >= 400 && response.status < 500) {
      err.permanent = true
    }
    throw err
  }
  try {
    return await response.json()
  } catch (err) {
    throw new Error(`the response is not valid JSON: ${err.message}`)
  }
}

export async function applyWellKnownConfiguration(options = {}) {
  const {
    env = process.env,
    fetchImpl = fetch,
    logger = {},
    attempts = 5,
    initialDelayMs = 2000,
    timeoutMs = 15000,
    sleep = sleepFor,
  } = options
  const warn = logger.warn || (() => {})
  const info = logger.info || (() => {})

  const wellKnownUrl = env.OVERLEAF_OIDC_WELL_KNOWN_URL
  if (!wellKnownUrl) {
    return null
  }
  const value = String(wellKnownUrl).trim()

  if (isCompletelyConfigured(env)) {
    warn(
      { wellKnownUrl: value },
      'OIDC: the issuer and all endpoints are configured, so the discovery ' +
        'document is not read - remove the explicit OVERLEAF_OIDC_*_URL ' +
        'variables if the document should provide them'
    )
    return null
  }

  // The document itself may be configured instead of its URL: providers hand
  // it out as JSON, and copying it into the variable is what people try when
  // they are not sure where the URL lives.
  if (value.startsWith('{')) {
    let document
    try {
      document = JSON.parse(value)
    } catch (err) {
      throw new Error(
        'OVERLEAF_OIDC_WELL_KNOWN_URL contains something that starts like ' +
          `JSON but cannot be parsed: ${err.message}`
      )
    }
    return applyOrDefault(info, warn, document, env, 'the configured document')
  }

  if (!/^https?:\/\//i.test(value)) {
    throw new Error(
      'OVERLEAF_OIDC_WELL_KNOWN_URL has to be a URL - either the discovery ' +
        'document (https://<provider>/.well-known/openid-configuration) or ' +
        'the issuer it is derived from - or the discovery document itself ' +
        '(JSON)'
    )
  }

  const documentUrl = wellKnownDocumentUrl(value)

  let delay = initialDelayMs
  for (let attempt = 1; ; attempt++) {
    try {
      const document = await fetchDocument(documentUrl, fetchImpl, timeoutMs)
      return applyOrDefault(info, warn, document, env, documentUrl)
    } catch (err) {
      if (err.permanent || attempt >= attempts) {
        throw new Error(
          `could not configure OIDC from ${documentUrl}: ${err.message}`
        )
      }
      warn(
        { documentUrl, attempt, attempts, err },
        'OIDC: reading the discovery document failed, retrying'
      )
      await sleep(delay)
      delay *= 2
    }
  }
}

// Applies a document that was read (or configured) and reports what happened;
// returns the document as the caller's result.
function applyOrDefault(info, warn, document, env, source) {
  const { dropped } = scopesForDocument(document, env)
  if (dropped.length > 0) {
    warn(
      { dropped, kept: env.OVERLEAF_OIDC_SCOPE || DEFAULT_SCOPE },
      'OIDC: leaving out scopes that the provider does not support'
    )
  }
  const applied = applyDocument(document, env)
  info({ source, applied }, 'OIDC: configured from the discovery document')
  return document
}
