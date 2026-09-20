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
  missingEndpoints,
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
