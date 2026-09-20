// OpenID Connect discovery (OpenID Connect Discovery 1.0).
//
// OVERLEAF_OIDC_WELL_KNOWN_URL configures the endpoints that are not set
// explicitly.  It takes either the discovery document itself
//
//   https://idp.example.com/realms/myrealm/.well-known/openid-configuration
//
// or just the issuer, in which case /.well-known/openid-configuration is
// appended:
//
//   https://idp.example.com/realms/myrealm
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

const ENDPOINT_VARIABLES = {
  authorization_endpoint: 'OVERLEAF_OIDC_AUTHORIZATION_URL',
  token_endpoint: 'OVERLEAF_OIDC_TOKEN_URL',
  userinfo_endpoint: 'OVERLEAF_OIDC_USERINFO_URL',
}

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

function isFilled(value) {
  return typeof value === 'string' && value !== ''
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
  return applied
}

async function fetchDocument(url, fetchImpl, timeoutMs) {
  let response
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw new Error(`the request failed: ${err.message}`)
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

  const documentUrl = wellKnownDocumentUrl(wellKnownUrl)
  if (isCompletelyConfigured(env)) {
    info({ documentUrl }, 'OIDC: endpoints are configured, not reading the discovery document')
    return null
  }

  let delay = initialDelayMs
  for (let attempt = 1; ; attempt++) {
    try {
      const document = await fetchDocument(documentUrl, fetchImpl, timeoutMs)
      const applied = applyDocument(document, env)
      info({ documentUrl, applied }, 'OIDC: configured from the discovery document')
      return document
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
