// Checks OIDC discovery (see
// overlay/services/web/app/src/Features/Authentication/OidcDiscovery.mjs).
//
//   locally:            node --test tests/oidc-well-known.test.mjs
//   inside the image:   node --test /tests/oidc-well-known.test.mjs
//
// The module under test only imports node:timers/promises, so nothing else
// from the application is needed.

import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const modulePath = [
  process.env.OVERLEAF_OIDC_DISCOVERY_MODULE,
  '/overleaf/services/web/app/src/Features/Authentication/OidcDiscovery.mjs',
  fileURLToPath(
    new URL(
      '../overlay/services/web/app/src/Features/Authentication/OidcDiscovery.mjs',
      import.meta.url
    )
  ),
].find(candidate => candidate && existsSync(candidate))

if (!modulePath) {
  throw new Error('cannot find OidcDiscovery.mjs')
}

const {
  applyDocument,
  applyWellKnownConfiguration,
  describeError,
  missingEndpoints,
  missingOidcEndpoints,
  oidcIsConfigured,
  scopesForDocument,
  wellKnownDocumentUrl,
} = await import(pathToFileURL(modulePath).href)

const DOCUMENT = {
  issuer: 'https://idp.example.com/realms/myrealm',
  authorization_endpoint:
    'https://idp.example.com/realms/myrealm/protocol/openid-connect/auth',
  token_endpoint:
    'https://idp.example.com/realms/myrealm/protocol/openid-connect/token',
  userinfo_endpoint:
    'https://idp.example.com/realms/myrealm/protocol/openid-connect/userinfo',
  scopes_supported: ['openid', 'profile', 'email'],
}

// The document of Synology's SSO server: it does not support the `profile`
// scope, uses a non-standard `username` claim and lists the endpoints under
// the /webman/sso/ prefix.
const SYNO_DOCUMENT = {
  authorization_endpoint: 'https://idp.example.com/webman/sso/SSOOauth.cgi',
  claims_supported: ['aud', 'email', 'exp', 'groups', 'iat', 'iss', 'sub', 'username'],
  code_challenge_methods_supported: ['S256', 'plain'],
  grant_types_supported: ['authorization_code', 'implicit'],
  id_token_signing_alg_values_supported: ['RS256'],
  issuer: 'https://idp.example.com/webman/sso',
  jwks_uri: 'https://idp.example.com/webman/sso/openid-jwks.json',
  response_types_supported: ['code', 'code id_token', 'id_token', 'id_token token'],
  scopes_supported: ['email', 'groups', 'openid'],
  subject_types_supported: ['public'],
  token_endpoint: 'https://idp.example.com/webman/sso/SSOAccessToken.cgi',
  token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
  userinfo_endpoint: 'https://idp.example.com/webman/sso/SSOUserInfo.cgi',
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

function stubFetch(responses) {
  const calls = []
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      if (responses.length === 0) {
        throw new Error('unexpected request')
      }
      const response = responses.shift()
      if (response instanceof Error) {
        throw response
      }
      return response
    },
  }
}

function recordSleeps() {
  const slept = []
  return { slept, sleep: async ms => slept.push(ms) }
}

const logger = { info() {}, warn() {}, err() {} }

test('the discovery document URL is derived from the issuer', () => {
  assert.equal(
    wellKnownDocumentUrl('https://idp.example.com/realms/myrealm'),
    'https://idp.example.com/realms/myrealm/.well-known/openid-configuration'
  )
  assert.equal(
    wellKnownDocumentUrl('https://idp.example.com/realms/myrealm/'),
    'https://idp.example.com/realms/myrealm/.well-known/openid-configuration'
  )
})

test('a discovery document URL is used as it is', () => {
  const url =
    'https://idp.example.com/realms/myrealm/.well-known/openid-configuration'
  assert.equal(wellKnownDocumentUrl(url), url)
})

test('the document fills in the variables that are not set', () => {
  const env = {}
  const applied = applyDocument(DOCUMENT, env)

  assert.equal(env.OVERLEAF_OIDC_ISSUER, DOCUMENT.issuer)
  assert.equal(
    env.OVERLEAF_OIDC_AUTHORIZATION_URL,
    DOCUMENT.authorization_endpoint
  )
  assert.equal(env.OVERLEAF_OIDC_TOKEN_URL, DOCUMENT.token_endpoint)
  assert.equal(env.OVERLEAF_OIDC_USERINFO_URL, DOCUMENT.userinfo_endpoint)
  assert.equal(Object.keys(applied).length, 4)
})

test('explicit variables win over the document', () => {
  const env = {
    OVERLEAF_OIDC_ISSUER: 'https://issuer.example.com',
    OVERLEAF_OIDC_USERINFO_URL: 'https://issuer.example.com/userinfo',
  }
  const applied = applyDocument(DOCUMENT, env)

  assert.equal(env.OVERLEAF_OIDC_ISSUER, 'https://issuer.example.com')
  assert.equal(env.OVERLEAF_OIDC_USERINFO_URL, 'https://issuer.example.com/userinfo')
  assert.equal(env.OVERLEAF_OIDC_TOKEN_URL, DOCUMENT.token_endpoint)
  assert.deepEqual(Object.keys(applied).sort(), [
    'OVERLEAF_OIDC_AUTHORIZATION_URL',
    'OVERLEAF_OIDC_TOKEN_URL',
  ])
})

test('an incomplete document is rejected, unless the value is configured', () => {
  const incomplete = { ...DOCUMENT }
  delete incomplete.userinfo_endpoint

  assert.deepEqual(missingEndpoints({}, incomplete), [
    'userinfo_endpoint (OVERLEAF_OIDC_USERINFO_URL)',
  ])
  assert.throws(
    () => applyDocument(incomplete, {}),
    /does not provide userinfo_endpoint/
  )

  const env = { OVERLEAF_OIDC_USERINFO_URL: 'https://issuer.example.com/me' }
  applyDocument(incomplete, env)
  assert.equal(env.OVERLEAF_OIDC_ISSUER, DOCUMENT.issuer)
})

test('a document without an issuer is rejected', () => {
  const withoutIssuer = { ...DOCUMENT }
  delete withoutIssuer.issuer

  assert.throws(
    () => applyDocument(withoutIssuer, {}),
    /no issuer/
  )
  // unless the issuer is configured explicitly
  const env = { OVERLEAF_OIDC_ISSUER: 'https://issuer.example.com' }
  applyDocument(withoutIssuer, env)
  assert.equal(env.OVERLEAF_OIDC_TOKEN_URL, DOCUMENT.token_endpoint)
})

test('OIDC is only usable with an issuer, the endpoints and the client credentials', () => {
  assert.equal(oidcIsConfigured({}), false)
  assert.equal(
    oidcIsConfigured({ OVERLEAF_OIDC_ISSUER: 'https://idp.example.com' }),
    false
  )
  assert.deepEqual(
    missingOidcEndpoints({ OVERLEAF_OIDC_ISSUER: 'https://idp.example.com' }),
    [
      'OVERLEAF_OIDC_AUTHORIZATION_URL',
      'OVERLEAF_OIDC_TOKEN_URL',
      'OVERLEAF_OIDC_USERINFO_URL',
      'OVERLEAF_OIDC_CLIENT_ID',
      'OVERLEAF_OIDC_CLIENT_SECRET',
    ]
  )
  const complete = {
    OVERLEAF_OIDC_ISSUER: 'https://idp.example.com',
    OVERLEAF_OIDC_AUTHORIZATION_URL: 'https://idp.example.com/auth',
    OVERLEAF_OIDC_TOKEN_URL: 'https://idp.example.com/token',
    OVERLEAF_OIDC_USERINFO_URL: 'https://idp.example.com/me',
    OVERLEAF_OIDC_CLIENT_ID: 'overleaf',
    OVERLEAF_OIDC_CLIENT_SECRET: 'secret',
  }
  assert.equal(oidcIsConfigured(complete), true)
  // a missing client secret would make the strategy constructor throw
  delete complete.OVERLEAF_OIDC_CLIENT_SECRET
  assert.equal(oidcIsConfigured(complete), false)
  assert.deepEqual(missingOidcEndpoints(complete), ['OVERLEAF_OIDC_CLIENT_SECRET'])
})

test('a document that cannot be used leaves the environment untouched', () => {
  // an incomplete document must not end up half-applied: OIDC stays off
  const incomplete = { ...DOCUMENT }
  delete incomplete.userinfo_endpoint
  const env = { OVERLEAF_OIDC_WELL_KNOWN_URL: 'https://idp.example.com' }

  assert.throws(() => applyDocument(incomplete, env), /does not provide/)
  assert.deepEqual(env, { OVERLEAF_OIDC_WELL_KNOWN_URL: 'https://idp.example.com' })
  assert.equal(oidcIsConfigured(env), false)
})

test('scopes the provider does not support are left out', () => {
  const { scopes, dropped } = scopesForDocument(SYNO_DOCUMENT, {})
  assert.deepEqual(scopes, ['openid', 'email'])
  assert.deepEqual(dropped, ['profile'])

  const env = {}
  applyDocument(SYNO_DOCUMENT, env)
  assert.equal(env.OVERLEAF_OIDC_SCOPE, 'openid email')
  assert.equal(env.OVERLEAF_OIDC_TOKEN_URL, SYNO_DOCUMENT.token_endpoint)
  assert.equal(env.OVERLEAF_OIDC_USERINFO_URL, SYNO_DOCUMENT.userinfo_endpoint)
})

test('an explicit scope and documents without scopes_supported are untouched', () => {
  assert.deepEqual(
    scopesForDocument(SYNO_DOCUMENT, { OVERLEAF_OIDC_SCOPE: 'openid profile email' }),
    { scopes: ['openid', 'profile', 'email'], dropped: [] }
  )

  const withoutScopes = { ...DOCUMENT }
  delete withoutScopes.scopes_supported
  assert.deepEqual(scopesForDocument(withoutScopes, {}), {
    scopes: ['openid', 'profile', 'email'],
    dropped: [],
  })

  // openid is always requested, even if the document does not list it
  assert.deepEqual(
    scopesForDocument({ scopes_supported: ['email'] }, {}).scopes,
    ['openid', 'email']
  )
})

test('the document itself may be configured instead of its URL', async () => {
  const { calls, fetchImpl } = stubFetch([])
  const env = { OVERLEAF_OIDC_WELL_KNOWN_URL: JSON.stringify(SYNO_DOCUMENT) }

  const document = await applyWellKnownConfiguration({ env, fetchImpl, logger })

  assert.equal(calls.length, 0)
  assert.equal(document.issuer, SYNO_DOCUMENT.issuer)
  assert.equal(env.OVERLEAF_OIDC_ISSUER, SYNO_DOCUMENT.issuer)
  assert.equal(env.OVERLEAF_OIDC_SCOPE, 'openid email')
})

test('a value that is neither a URL nor JSON is reported clearly', async () => {
  const { fetchImpl } = stubFetch([])
  await assert.rejects(
    applyWellKnownConfiguration({
      env: { OVERLEAF_OIDC_WELL_KNOWN_URL: 'idp.example.com/webman/sso' },
      fetchImpl,
      logger,
    }),
    /has to be a URL/
  )
  await assert.rejects(
    applyWellKnownConfiguration({
      env: { OVERLEAF_OIDC_WELL_KNOWN_URL: '{not json' },
      fetchImpl,
      logger,
    }),
    /starts like JSON but cannot be parsed/
  )
})

test('a failed request reports the underlying reason, not just "fetch failed"', async () => {
  const dnsFailure = Object.assign(new Error('fetch failed'), {
    cause: Object.assign(new Error('getaddrinfo ENOTFOUND idp.example.com'), {
      code: 'ENOTFOUND',
    }),
  })
  const { fetchImpl } = stubFetch([dnsFailure])

  await assert.rejects(
    applyWellKnownConfiguration({
      env: { OVERLEAF_OIDC_WELL_KNOWN_URL: 'https://idp.example.com/realms/x' },
      fetchImpl,
      logger,
      attempts: 1,
    }),
    /ENOTFOUND idp\.example\.com/
  )

  // when several addresses were tried, fetch reports an AggregateError
  assert.match(
    describeError(
      Object.assign(new Error('fetch failed'), {
        cause: new AggregateError(
          [
            Object.assign(new Error('connect ECONNREFUSED ::1:443'), {
              code: 'ECONNREFUSED',
            }),
            Object.assign(new Error('connect ENETUNREACH 2a01:cb00::1:443'), {
              code: 'ENETUNREACH',
            }),
          ],
          'all addresses failed'
        ),
      })
    ),
    /ENETUNREACH/
  )

  // a plain error without a cause still says something useful
  assert.equal(describeError(new Error('boom')), 'boom')
})

test('nothing is fetched without OVERLEAF_OIDC_WELL_KNOWN_URL', async () => {
  const { calls, fetchImpl } = stubFetch([])
  const env = { OVERLEAF_OIDC_ISSUER: 'https://issuer.example.com' }

  assert.equal(
    await applyWellKnownConfiguration({ env, fetchImpl, logger }),
    null
  )
  assert.equal(calls.length, 0)
})

test('nothing is fetched when the configuration is pinned completely', async () => {
  const { calls, fetchImpl } = stubFetch([])
  const env = {
    OVERLEAF_OIDC_WELL_KNOWN_URL: 'https://idp.example.com/realms/myrealm',
    OVERLEAF_OIDC_ISSUER: 'https://issuer.example.com',
    OVERLEAF_OIDC_AUTHORIZATION_URL: 'https://issuer.example.com/auth',
    OVERLEAF_OIDC_TOKEN_URL: 'https://issuer.example.com/token',
    OVERLEAF_OIDC_USERINFO_URL: 'https://issuer.example.com/me',
  }

  assert.equal(
    await applyWellKnownConfiguration({ env, fetchImpl, logger }),
    null
  )
  assert.equal(calls.length, 0)
})

test('the document is still read to learn the issuer', async () => {
  const { calls, fetchImpl } = stubFetch([jsonResponse(DOCUMENT)])
  const env = {
    OVERLEAF_OIDC_WELL_KNOWN_URL: 'https://idp.example.com/realms/myrealm',
    OVERLEAF_OIDC_AUTHORIZATION_URL: 'https://issuer.example.com/auth',
    OVERLEAF_OIDC_TOKEN_URL: 'https://issuer.example.com/token',
    OVERLEAF_OIDC_USERINFO_URL: 'https://issuer.example.com/me',
  }

  await applyWellKnownConfiguration({ env, fetchImpl, logger })

  assert.equal(calls.length, 1)
  assert.equal(env.OVERLEAF_OIDC_ISSUER, DOCUMENT.issuer)
  // the configured endpoints are not touched
  assert.equal(env.OVERLEAF_OIDC_TOKEN_URL, 'https://issuer.example.com/token')
})

test('the endpoints are taken from the issuer URL', async () => {
  const { calls, fetchImpl } = stubFetch([jsonResponse(DOCUMENT)])
  const env = {
    OVERLEAF_OIDC_WELL_KNOWN_URL: 'https://idp.example.com/realms/myrealm',
  }

  const document = await applyWellKnownConfiguration({
    env,
    fetchImpl,
    logger,
  })

  assert.deepEqual(document, DOCUMENT)
  assert.equal(calls.length, 1)
  assert.equal(
    calls[0].url,
    'https://idp.example.com/realms/myrealm/.well-known/openid-configuration'
  )
  assert.equal(env.OVERLEAF_OIDC_ISSUER, DOCUMENT.issuer)
  assert.equal(env.OVERLEAF_OIDC_AUTHORIZATION_URL, DOCUMENT.authorization_endpoint)
  assert.equal(env.OVERLEAF_OIDC_TOKEN_URL, DOCUMENT.token_endpoint)
  assert.equal(env.OVERLEAF_OIDC_USERINFO_URL, DOCUMENT.userinfo_endpoint)
})

test('a failing request is retried', async () => {
  const { calls, fetchImpl } = stubFetch([
    jsonResponse('boom', 503),
    jsonResponse(DOCUMENT),
  ])
  const { slept, sleep } = recordSleeps()
  const env = {
    OVERLEAF_OIDC_WELL_KNOWN_URL: 'https://idp.example.com/realms/myrealm',
  }

  await applyWellKnownConfiguration({
    env,
    fetchImpl,
    logger,
    sleep,
    initialDelayMs: 100,
  })

  assert.equal(calls.length, 2)
  assert.deepEqual(slept, [100])
  assert.equal(env.OVERLEAF_OIDC_TOKEN_URL, DOCUMENT.token_endpoint)
})

test('a client error is not retried', async () => {
  const { calls, fetchImpl } = stubFetch([jsonResponse('not found', 404)])
  const { slept, sleep } = recordSleeps()
  const env = {
    OVERLEAF_OIDC_WELL_KNOWN_URL: 'https://idp.example.com/realms/myrealm',
  }

  await assert.rejects(
    applyWellKnownConfiguration({ env, fetchImpl, logger, sleep }),
    /HTTP 404/
  )
  assert.equal(calls.length, 1)
  assert.deepEqual(slept, [])
})

test('a wrong JSON document is retried and then reported', async () => {
  const invalidJson = () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error('not json')
    },
  })
  const { calls, fetchImpl } = stubFetch([
    invalidJson(),
    invalidJson(),
    invalidJson(),
  ])
  const { slept, sleep } = recordSleeps()
  const env = {
    OVERLEAF_OIDC_WELL_KNOWN_URL: 'https://idp.example.com/realms/myrealm',
  }

  await assert.rejects(
    applyWellKnownConfiguration({
      env,
      fetchImpl,
      logger,
      sleep,
      attempts: 3,
      initialDelayMs: 10,
    }),
    /could not configure OIDC from .*not valid JSON/
  )
  assert.equal(calls.length, 3)
  assert.deepEqual(slept, [10, 20])
})

test('the retry loop stops once the time budget is spent', async () => {
  const failure = () =>
    Object.assign(new Error('fetch failed'), {
      cause: Object.assign(
        new Error('getaddrinfo ENOTFOUND idp.example.com'),
        { code: 'ENOTFOUND' }
      ),
    })
  const { calls, fetchImpl } = stubFetch([
    failure(),
    failure(),
    failure(),
    failure(),
    failure(),
  ])
  const { slept, sleep: recordSleep } = recordSleeps()
  // a clock that only moves with the (stubbed) sleeps
  let clock = 0
  const sleep = async ms => {
    await recordSleep(ms)
    clock += ms
  }
  const now = () => clock
  const env = {
    OVERLEAF_OIDC_WELL_KNOWN_URL: 'https://idp.example.com/realms/myrealm',
  }

  await assert.rejects(
    applyWellKnownConfiguration({
      env,
      fetchImpl,
      logger,
      sleep,
      now,
      attempts: 5,
      initialDelayMs: 2000,
      budgetMs: 5000,
    }),
    /ENOTFOUND idp\.example\.com.*gave up after 6s of 5s/
  )
  // two attempts (2s + 4s of waiting); the third one would not fit the budget
  assert.equal(calls.length, 3)
  assert.deepEqual(slept, [2000, 4000])
})
