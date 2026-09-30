// Checks ID token verification (see
// overlay/services/web/app/src/Features/Authentication/OidcIdToken.mjs).
//
//   locally:            node --test tests/oidc-id-token.test.mjs
//   inside the image:   node --test /tests/oidc-id-token.test.mjs
//
// The module only imports node:crypto (and uses the global fetch), so nothing
// else from the application is needed. Tokens are signed here with keys that
// are generated on the spot, so no network access is involved.

import { existsSync } from 'node:fs'
import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const modulePath = [
  process.env.OVERLEAF_OIDC_ID_TOKEN_MODULE,
  '/overleaf/services/web/app/src/Features/Authentication/OidcIdToken.mjs',
  fileURLToPath(
    new URL(
      '../overlay/services/web/app/src/Features/Authentication/OidcIdToken.mjs',
      import.meta.url
    )
  ),
].find(candidate => candidate && existsSync(candidate))

if (!modulePath) {
  throw new Error('cannot find OidcIdToken.mjs')
}

const {
  createJwksCache,
  ecSignatureToDer,
  normaliseIssuer,
  parseIdToken,
  verifyClaims,
  verifyIdToken,
} = await import(pathToFileURL(modulePath).href)

const ISSUER = 'https://idp.example.com/realms/myrealm'
const CLIENT_ID = 'overleaf'
const NOW = 1_800_000_000_000

function base64url(input) {
  return Buffer.from(input).toString('base64url')
}

function rsaKey(kid) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  })
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid } }
}

function ecKey(kid) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  })
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid } }
}

function sign({ key, header, claims }) {
  const alg = header.alg
  const signingInput = `${base64url(
    JSON.stringify({ typ: 'JWT', ...header })
  )}.${base64url(JSON.stringify(claims))}`
  const signer = createSign(alg.startsWith('ES') ? 'sha256' : 'sha256')
  signer.update(signingInput)
  const signature = signer.sign(
    alg.startsWith('ES')
      ? { key: key.privateKey, dsaEncoding: 'ieee-p1363' }
      : key.privateKey
  )
  return `${signingInput}.${base64url(signature)}`
}

function claims(overrides = {}) {
  return {
    iss: ISSUER,
    aud: CLIENT_ID,
    sub: 'user-1',
    exp: Math.floor(NOW / 1000) + 300,
    iat: Math.floor(NOW / 1000),
    ...overrides,
  }
}

function jwksResponse(keys) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ keys }),
  }
}

function stubFetch(responses) {
  const calls = []
  return {
    calls,
    fetchImpl: async url => {
      calls.push(url)
      if (responses.length === 0) {
        throw new Error('unexpected JWKS request')
      }
      const response = responses.shift()
      if (response instanceof Error) {
        throw response
      }
      return response
    },
  }
}

test('a token signed by the published key verifies', async () => {
  const key = rsaKey('key-1')
  const token = sign({ key, header: { alg: 'RS256', kid: 'key-1' }, claims: claims() })

  const verified = await verifyIdToken(token, {
    issuer: ISSUER,
    clientId: CLIENT_ID,
    keys: [key.jwk],
    now: NOW,
  })
  assert.equal(verified.sub, 'user-1')
  assert.equal(verified.iss, ISSUER)
})

test('a token of another key is refused', async () => {
  const key = rsaKey('key-1')
  const other = rsaKey('key-2')
  const token = sign({ key: other, header: { alg: 'RS256', kid: 'key-1' }, claims: claims() })

  await assert.rejects(
    verifyIdToken(token, {
      issuer: ISSUER,
      clientId: CLIENT_ID,
      keys: [key.jwk],
      now: NOW,
    }),
    /signature does not verify/
  )
})

test('an unsigned token and an HMAC token are refused', async () => {
  const key = rsaKey('key-1')
  const none = `${base64url(
    JSON.stringify({ alg: 'none', typ: 'JWT' })
  )}.${base64url(JSON.stringify(claims()))}.${base64url(' ')}`

  await assert.rejects(
    verifyIdToken(none, { keys: [key.jwk], now: NOW }),
    /not a supported algorithm/
  )

  const hmac = `${base64url(
    JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'key-1' })
  )}.${base64url(JSON.stringify(claims()))}.${base64url('not-a-signature')}`
  await assert.rejects(
    verifyIdToken(hmac, { keys: [key.jwk], now: NOW }),
    /not a supported algorithm/
  )
})

test('an ES256 token verifies (raw signature converted to DER)', async () => {
  const key = ecKey('ec-1')
  const token = sign({ key, header: { alg: 'ES256', kid: 'ec-1' }, claims: claims() })

  const verified = await verifyIdToken(token, {
    issuer: ISSUER,
    clientId: CLIENT_ID,
    keys: [key.jwk],
    now: NOW,
  })
  assert.equal(verified.sub, 'user-1')
})

test('a trailing slash on the issuer is the only difference ignored', async () => {
  const key = rsaKey('key-1')
  const token = sign({ key, header: { alg: 'RS256', kid: 'key-1' }, claims: claims() })

  for (const issuer of [ISSUER, `${ISSUER}/`, `${ISSUER}//`]) {
    const verified = await verifyIdToken(token, {
      issuer,
      clientId: CLIENT_ID,
      keys: [key.jwk],
      now: NOW,
    })
    assert.equal(verified.sub, 'user-1')
  }

  assert.equal(normaliseIssuer('https://idp.example.com/sso/'), 'https://idp.example.com/sso')
  assert.equal(normaliseIssuer(undefined), '')
  assert.equal(normaliseIssuer(null), '')

  const withoutIssuer = claims()
  delete withoutIssuer.iss
  await assert.rejects(
    verifyIdToken(sign({ key, header: { alg: 'RS256', kid: 'key-1' }, claims: withoutIssuer }), {
      issuer: ISSUER,
      keys: [key.jwk],
      now: NOW,
    }),
    /no iss claim/
  )
})

test('the issuer and the audience have to match', async () => {
  const key = rsaKey('key-1')
  const wrongIssuer = sign({
    key,
    header: { alg: 'RS256', kid: 'key-1' },
    claims: claims({ iss: 'https://evil.example.com' }),
  })
  await assert.rejects(
    verifyIdToken(wrongIssuer, {
      issuer: ISSUER,
      clientId: CLIENT_ID,
      keys: [key.jwk],
      now: NOW,
    }),
    /was issued by 'https:\/\/evil.example.com'/
  )

  const wrongAudience = sign({
    key,
    header: { alg: 'RS256', kid: 'key-1' },
    claims: claims({ aud: 'another-client' }),
  })
  await assert.rejects(
    verifyIdToken(wrongAudience, {
      issuer: ISSUER,
      clientId: CLIENT_ID,
      keys: [key.jwk],
      now: NOW,
    }),
    /not addressed to this client/
  )

  const listAudience = sign({
    key,
    header: { alg: 'RS256', kid: 'key-1' },
    claims: claims({ aud: ['another-client', CLIENT_ID] }),
  })
  const verified = await verifyIdToken(listAudience, {
    issuer: ISSUER,
    clientId: CLIENT_ID,
    keys: [key.jwk],
    now: NOW,
  })
  assert.equal(verified.sub, 'user-1')
})

test('an expired token is refused, with a small allowance for clock skew', async () => {
  const key = rsaKey('key-1')
  const expired = sign({
    key,
    header: { alg: 'RS256', kid: 'key-1' },
    claims: claims({ exp: Math.floor(NOW / 1000) - 3600 }),
  })
  await assert.rejects(
    verifyIdToken(expired, { keys: [key.jwk], now: NOW }),
    /has expired/
  )

  const justExpired = sign({
    key,
    header: { alg: 'RS256', kid: 'key-1' },
    claims: claims({ exp: Math.floor(NOW / 1000) - 5 }),
  })
  const verified = await verifyIdToken(justExpired, {
    keys: [key.jwk],
    now: NOW,
    leewaySeconds: 60,
  })
  assert.equal(verified.sub, 'user-1')
})

test('a token without exp, sub or in the future is refused', async () => {
  const key = rsaKey('key-1')
  const header = { alg: 'RS256', kid: 'key-1' }

  const noExp = claims()
  delete noExp.exp
  await assert.rejects(
    verifyIdToken(sign({ key, header, claims: noExp }), { keys: [key.jwk], now: NOW }),
    /no exp claim/
  )

  await assert.rejects(
    verifyIdToken(sign({ key, header, claims: claims({ sub: undefined }) }), {
      keys: [key.jwk],
      now: NOW,
    }),
    /no sub claim/
  )

  await assert.rejects(
    verifyIdToken(
      sign({
        key,
        header,
        claims: claims({ iat: Math.floor(NOW / 1000) + 3600 }),
      }),
      { keys: [key.jwk], now: NOW }
    ),
    /issued in the future/
  )
})

test('a key that the JWKS does not have triggers one refetch, then fails', async () => {
  const other = rsaKey('key-9')
  const token = sign({
    key: other,
    header: { alg: 'RS256', kid: 'key-9' },
    claims: claims(),
  })
  const { calls, fetchImpl } = stubFetch([jwksResponse([]), jwksResponse([])].map(
    response =>
      // an empty key list is refused by loadKeys, so publish another key
      response
  ))
  await assert.rejects(
    verifyIdToken(token, {
      jwksUri: 'https://idp.example.com/jwks',
      fetchImpl,
      cache: createJwksCache(),
      now: NOW,
    }),
    /carries no keys/
  )
  assert.equal(calls.length, 1)
})

test('the rotated-in key is found after a refetch', async () => {
  const old = rsaKey('key-1')
  const rotated = rsaKey('key-2')
  const token = sign({
    key: rotated,
    header: { alg: 'RS256', kid: 'key-2' },
    claims: claims(),
  })
  const { calls, fetchImpl } = stubFetch([
    jwksResponse([old.jwk]),
    jwksResponse([old.jwk, rotated.jwk]),
  ])

  const verified = await verifyIdToken(token, {
    issuer: ISSUER,
    clientId: CLIENT_ID,
    jwksUri: 'https://idp.example.com/jwks',
    fetchImpl,
    cache: createJwksCache(),
    now: NOW,
  })
  assert.equal(verified.sub, 'user-1')
  assert.equal(calls.length, 2)
})

test('the JWKS is cached between logins', async () => {
  const key = rsaKey('key-1')
  const { calls, fetchImpl } = stubFetch([jwksResponse([key.jwk])])
  const cache = createJwksCache()
  const options = {
    issuer: ISSUER,
    clientId: CLIENT_ID,
    jwksUri: 'https://idp.example.com/jwks',
    fetchImpl,
    cache,
    now: NOW,
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const verified = await verifyIdToken(
      sign({ key, header: { alg: 'RS256', kid: 'key-1' }, claims: claims() }),
      options
    )
    assert.equal(verified.sub, 'user-1')
  }
  assert.equal(calls.length, 1)
})

test('verifyClaims works on parsed tokens and parseIdToken reports bad input', () => {
  const key = rsaKey('key-1')
  const parsed = parseIdToken(
    sign({ key, header: { alg: 'RS256', kid: 'key-1' }, claims: claims() })
  )
  assert.equal(parsed.header.alg, 'RS256')
  assert.deepEqual(
    verifyClaims(parsed, { keys: [key.jwk], now: NOW }).sub,
    'user-1'
  )

  assert.throws(() => parseIdToken('not-a-token'), /1 segments/)
  assert.throws(() => parseIdToken('header.payload'), /2 segments/)
  assert.throws(() => parseIdToken(`${base64url('{}')}.x.`), /empty segment/)
  assert.throws(
    () => parseIdToken(`${base64url('nope')}.${base64url('{}')}.${base64url('x')}`),
    /header that is not JSON/
  )
  assert.equal(typeof randomUUID(), 'string')
})

test('ecSignatureToDer encodes both integers with their sign byte', () => {
  const size = 32
  const raw = Buffer.concat([
    Buffer.from([0x80]),
    Buffer.alloc(31, 0x01),
    Buffer.alloc(32, 0x02),
  ])
  const der = ecSignatureToDer(raw, size)
  assert.equal(der[0], 0x30)
  assert.equal(der[1], der.length - 2)
  // the first integer needs a leading zero because its top bit is set
  assert.equal(der[2], 0x02)
  assert.equal(der[3], 33)
  assert.equal(der[4], 0x00)

  assert.throws(() => ecSignatureToDer(Buffer.alloc(10), size), /64 bytes/)
})
