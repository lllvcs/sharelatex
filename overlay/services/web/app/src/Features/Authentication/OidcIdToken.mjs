// Verification of the identity token an OpenID Connect provider returns from
// its token endpoint (OpenID Connect Core 1.0, section 3.1.3.7).
//
// The userinfo response is fetched over TLS with an access token that was just
// obtained from the provider, so it is already trustworthy; verifying the ID
// token adds the signature check that ties the claims to the provider's keys
// (and catches a provider or proxy that hands out tokens it did not sign). What
// is checked:
//
//   - the signature, against the key of the provider's JWKS whose `kid` matches
//   - `alg`, restricted to the RSA/EC signature algorithms (never `none`, never
//     a shared-secret HMAC algorithm, which is how signed-token confusion bugs
//     start)
//   - `iss` (the expected issuer, when one is configured)
//   - `aud` (has to name our client id)
//   - `exp` / `nbf` / `iat`, with a small clock skew allowance
//   - `sub` is present, which is what the account is matched on
//
// A `nonce` is not sent by the OAuth2 flow this strategy uses, so it cannot be
// checked here; the code is exchanged directly with the token endpoint, so the
// ID token is not taken from anywhere but that response.
//
// Everything is done with node:crypto and fetch, so the image needs no extra
// dependency. `fetchImpl`, `now` and the JWKS cache are injectable, which is
// what tests/oidc-id-token.test.mjs uses.

import { createPublicKey, verify as verifySignature } from 'node:crypto'

// JWS algorithm -> node hash and key type. HMAC (`HS*`) is deliberately absent.
const ALGORITHMS = {
  RS256: { hash: 'sha256', type: 'rsa' },
  RS384: { hash: 'sha384', type: 'rsa' },
  RS512: { hash: 'sha512', type: 'rsa' },
  ES256: { hash: 'sha256', type: 'ec', size: 32 },
  ES384: { hash: 'sha384', type: 'ec', size: 48 },
  ES512: { hash: 'sha512', type: 'ec', size: 66 },
}

const DEFAULT_LEEWAY_SECONDS = 60
const DEFAULT_JWKS_TTL_MS = 10 * 60 * 1000

export function decodeSegment(segment) {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(padded, 'base64')
}

function parseJsonSegment(segment, what) {
  let parsed
  try {
    parsed = JSON.parse(decodeSegment(segment).toString('utf8'))
  } catch (err) {
    throw new Error(`the identity token has a ${what} that is not JSON`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`the identity token has a ${what} that is not a JSON object`)
  }
  return parsed
}

export function parseIdToken(idToken) {
  if (typeof idToken !== 'string') {
    throw new Error('the identity token is not a string')
  }
  const parts = idToken.split('.')
  if (parts.length !== 3) {
    throw new Error(
      `the identity token has ${parts.length} segments instead of 3`
    )
  }
  const [headerSegment, payloadSegment, signatureSegment] = parts
  if (!headerSegment || !payloadSegment || !signatureSegment) {
    throw new Error('the identity token has an empty segment')
  }
  return {
    header: parseJsonSegment(headerSegment, 'header'),
    claims: parseJsonSegment(payloadSegment, 'payload'),
    signingInput: `${headerSegment}.${payloadSegment}`,
    signature: decodeSegment(signatureSegment),
  }
}

export function keyForAlgorithm(jwk) {
  try {
    return createPublicKey({ key: jwk, format: 'jwk' })
  } catch (err) {
    throw new Error(`the JWKS entry cannot be used as a key: ${err.message}`)
  }
}

// JWS signs with the raw big-endian r||s pair, node:crypto verifies ECDSA with
// the DER-encoded form (RFC 7518, section 3.4).
export function ecSignatureToDer(raw, size) {
  if (raw.length !== size * 2) {
    throw new Error(
      `an ECDSA signature of this algorithm has ${size * 2} bytes, got ${raw.length}`
    )
  }
  const encodeInteger = value => {
    let start = 0
    while (start < value.length - 1 && value[start] === 0) {
      start++
    }
    let integer = value.subarray(start)
    if (integer[0] & 0x80) {
      integer = Buffer.concat([Buffer.from([0]), integer])
    }
    return Buffer.concat([Buffer.from([0x02, integer.length]), integer])
  }
  const r = encodeInteger(raw.subarray(0, size))
  const s = encodeInteger(raw.subarray(size))
  const body = Buffer.concat([r, s])
  return Buffer.concat([Buffer.from([0x30, body.length]), body])
}

function signatureMatches({ algorithm, jwk, signingInput, signature }) {
  const key = keyForAlgorithm(jwk)
  if (algorithm.type === 'ec') {
    return verifySignature(
      algorithm.hash,
      Buffer.from(signingInput),
      key,
      ecSignatureToDer(signature, algorithm.size)
    )
  }
  return verifySignature(
    algorithm.hash,
    Buffer.from(signingInput),
    key,
    signature
  )
}

// OpenID Connect compares the issuer as a string, and a trailing slash is the
// one difference that carries no meaning: a provider that publishes
// `https://idp.example.com/sso` and an administrator who typed
// `https://idp.example.com/sso/` would otherwise never get a login through.
export function normaliseIssuer(value) {
  return String(value == null ? '' : value).replace(/\/+$/, '')
}

function audienceMatches(aud, clientId) {
  if (Array.isArray(aud)) {
    return aud.includes(clientId)
  }
  return aud === clientId
}

// Returns the claims of a verified token. Throws with a readable reason
// otherwise; the caller logs it and refuses the login.
export function verifyClaims(
  { header, claims, signingInput, signature },
  {
    issuer,
    clientId,
    keys,
    now = Date.now(),
    leewaySeconds = DEFAULT_LEEWAY_SECONDS,
  } = {}
) {
  const algorithm = ALGORITHMS[header.alg]
  if (!algorithm) {
    throw new Error(
      `the identity token is signed with '${header.alg}', which is not a supported algorithm`
    )
  }
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error('the provider published no usable signing key')
  }

  // A token without `kid` is allowed only when there is exactly one candidate.
  const candidates = header.kid
    ? keys.filter(key => key.kid === header.kid)
    : keys.length === 1
      ? keys
      : []
  if (candidates.length === 0) {
    throw new Error(
      header.kid
        ? `the provider published no signing key with the id '${header.kid}'`
        : 'the identity token names no signing key and the provider published several'
    )
  }

  const verified = candidates.some(jwk => {
    try {
      return signatureMatches({ algorithm, jwk, signingInput, signature })
    } catch (err) {
      return false
    }
  })
  if (!verified) {
    throw new Error('the identity token signature does not verify')
  }

  if (typeof claims.iss !== 'string' || claims.iss === '') {
    throw new Error('the identity token carries no iss claim')
  }
  if (issuer && normaliseIssuer(claims.iss) !== normaliseIssuer(issuer)) {
    throw new Error(
      `the identity token was issued by '${claims.iss}', expected '${issuer}'`
    )
  }
  if (clientId && !audienceMatches(claims.aud, clientId)) {
    throw new Error(
      'the identity token is not addressed to this client (aud does not match)'
    )
  }
  if (typeof claims.sub !== 'string' || claims.sub === '') {
    throw new Error('the identity token carries no sub claim')
  }

  const seconds = Math.floor(now / 1000)
  if (typeof claims.exp !== 'number') {
    throw new Error('the identity token carries no exp claim')
  }
  if (seconds > claims.exp + leewaySeconds) {
    throw new Error('the identity token has expired')
  }
  if (typeof claims.nbf === 'number' && seconds + leewaySeconds < claims.nbf) {
    throw new Error('the identity token is not valid yet (nbf is in the future)')
  }
  if (typeof claims.iat === 'number' && seconds + leewaySeconds < claims.iat) {
    throw new Error('the identity token was issued in the future (iat)')
  }

  return claims
}

// The keys are cached per URI: a provider rotates rarely, and every login would
// otherwise fetch the document again.
export function createJwksCache() {
  return { entries: new Map() }
}

export function resetJwksCache(cache) {
  if (cache && cache.entries) {
    cache.entries.clear()
  }
}

async function loadKeys(
  jwksUri,
  { fetchImpl = fetch, cache, now = Date.now(), ttlMs = DEFAULT_JWKS_TTL_MS } = {}
) {
  const cached = cache && cache.entries.get(jwksUri)
  if (cached && now - cached.fetchedAt < ttlMs) {
    return cached.keys
  }

  let response
  try {
    response = await fetchImpl(jwksUri, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
  } catch (err) {
    throw new Error(`the JWKS could not be fetched from ${jwksUri}: ${err.message}`)
  }
  if (!response.ok) {
    throw new Error(
      `the JWKS request to ${jwksUri} answered with HTTP ${response.status}`
    )
  }
  let document
  try {
    document = await response.json()
  } catch (err) {
    throw new Error(`the JWKS from ${jwksUri} is not valid JSON: ${err.message}`)
  }
  const keys = Array.isArray(document && document.keys)
    ? document.keys.filter(key => key && typeof key === 'object')
    : []
  if (keys.length === 0) {
    throw new Error(`the JWKS from ${jwksUri} carries no keys`)
  }
  if (cache) {
    cache.entries.set(jwksUri, { fetchedAt: now, keys })
  }
  return keys
}

// Verifies an ID token against `jwksUri` (or a JWKS passed in directly, which
// the tests use) and returns its claims.
export async function verifyIdToken(
  idToken,
  {
    issuer,
    clientId,
    jwksUri,
    keys,
    fetchImpl = fetch,
    cache,
    now = Date.now(),
    leewaySeconds = DEFAULT_LEEWAY_SECONDS,
    ttlMs = DEFAULT_JWKS_TTL_MS,
    onWarn = () => {},
  } = {}
) {
  const parsed = parseIdToken(idToken)
  const algorithm = ALGORITHMS[parsed.header.alg]
  if (!algorithm) {
    throw new Error(
      `the identity token is signed with '${parsed.header.alg}', which is not a supported algorithm`
    )
  }

  let availableKeys = Array.isArray(keys) ? keys : null
  if (!availableKeys) {
    if (!jwksUri) {
      throw new Error(
        'no JWKS URL is configured, so the identity token cannot be verified'
      )
    }
    availableKeys = await loadKeys(jwksUri, { fetchImpl, cache, now, ttlMs })
    if (
      parsed.header.kid &&
      !availableKeys.some(key => key.kid === parsed.header.kid)
    ) {
      // the provider may have rotated its keys since the last fetch
      onWarn('the JWKS has no key for this identity token, fetching it again')
      if (cache) {
        cache.entries.delete(jwksUri)
      }
      availableKeys = await loadKeys(jwksUri, { fetchImpl, cache, now, ttlMs })
    }
  }

  return verifyClaims(parsed, {
    issuer,
    clientId,
    keys: availableKeys,
    now,
    leewaySeconds,
  })
}
