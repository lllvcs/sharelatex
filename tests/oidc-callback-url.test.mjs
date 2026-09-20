// Checks how the OIDC redirect URI is chosen (see
// overlay/services/web/app/src/Features/Authentication/OidcCallbackUrl.mjs).
//
//   locally:            node --test tests/oidc-callback-url.test.mjs
//   inside the image:   node --test /tests/oidc-callback-url.test.mjs
//
// Nothing here needs the rest of the application, the module under test only
// imports node:url.

import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const modulePath = [
  process.env.OVERLEAF_OIDC_CALLBACK_URL_MODULE,
  '/overleaf/services/web/app/src/Features/Authentication/OidcCallbackUrl.mjs',
  fileURLToPath(
    new URL(
      '../overlay/services/web/app/src/Features/Authentication/OidcCallbackUrl.mjs',
      import.meta.url
    )
  ),
].find(candidate => candidate && existsSync(candidate))

if (!modulePath) {
  throw new Error('cannot find OidcCallbackUrl.mjs')
}

const { DEFAULT_CALLBACK_PATH, parseCallbackUrls, requestOrigin, resolveCallbackURL } =
  await import(pathToFileURL(modulePath).href)

function request({ host = 'a.example.com', protocol = 'http', headers = {} } = {}) {
  return { protocol, headers: { host, ...headers } }
}

test('without configuration the callback URL follows the request host', () => {
  assert.equal(
    resolveCallbackURL(request({ host: 'one.example.com' }), {}),
    DEFAULT_CALLBACK_PATH
  )
  assert.equal(
    resolveCallbackURL(request({ host: 'two.example.com' }), {}),
    '/login/oidc/callback'
  )
})

test('a single callback URL is used as configured', () => {
  const callbackURL = 'https://overleaf.example.com/login/oidc/callback'
  assert.equal(
    resolveCallbackURL(request({ host: 'other.example.com' }), { callbackURL }),
    callbackURL
  )
  assert.equal(
    resolveCallbackURL(request({ host: 'other.example.com' }), {
      callbackURL: '/login/oidc/callback',
    }),
    '/login/oidc/callback'
  )
})

test('a list of callback URLs is matched by host name', () => {
  const callbackURLs = [
    'https://one.example.com/login/oidc/callback',
    'https://two.example.com/login/oidc/callback',
  ]
  assert.equal(
    resolveCallbackURL(request({ host: 'one.example.com' }), { callbackURLs }),
    'https://one.example.com/login/oidc/callback'
  )
  assert.equal(
    resolveCallbackURL(request({ host: 'two.example.com' }), { callbackURLs }),
    'https://two.example.com/login/oidc/callback'
  )
})

test('host names are matched case-insensitively and without the port', () => {
  const callbackURLs = ['https://One.Example.com:8443/login/oidc/callback']
  assert.equal(
    resolveCallbackURL(request({ host: 'ONE.example.com' }), { callbackURLs }),
    callbackURLs[0]
  )
  assert.equal(
    resolveCallbackURL(request({ host: 'one.example.com:443' }), { callbackURLs }),
    callbackURLs[0]
  )
})

test('a path in the list applies to every host', () => {
  const callbackURLs = ['/login/oidc/callback']
  assert.equal(
    resolveCallbackURL(request({ host: 'one.example.com' }), { callbackURLs }),
    '/login/oidc/callback'
  )
})

test('an unlisted host falls back to the automatic callback URL', () => {
  const callbackURLs = ['https://one.example.com/login/oidc/callback']
  assert.equal(
    resolveCallbackURL(request({ host: 'three.example.com' }), { callbackURLs }),
    DEFAULT_CALLBACK_PATH
  )
})

test('the list takes precedence over the single callback URL', () => {
  assert.equal(
    resolveCallbackURL(request({ host: 'one.example.com' }), {
      callbackURL: 'https://pinned.example.com/login/oidc/callback',
      callbackURLs: ['https://one.example.com/login/oidc/callback'],
    }),
    'https://one.example.com/login/oidc/callback'
  )
})

test('the request origin honours the proxy headers when they are trusted', () => {
  const behindProxy = request({
    host: 'internal:3000',
    headers: {
      'x-forwarded-host': 'overleaf.example.com',
      'x-forwarded-proto': 'https',
    },
  })
  assert.equal(
    requestOrigin(behindProxy, true),
    'https://overleaf.example.com'
  )
  assert.equal(requestOrigin(behindProxy, false), 'http://internal:3000')
})

test('proxy headers are used to match the host of a pinned URL', () => {
  const callbackURLs = ['https://overleaf.example.com/login/oidc/callback']
  const behindProxy = request({
    host: 'internal:3000',
    headers: {
      'x-forwarded-host': 'overleaf.example.com',
      'x-forwarded-proto': 'https',
    },
  })
  assert.equal(
    resolveCallbackURL(behindProxy, { callbackURLs, trustProxy: true }),
    callbackURLs[0]
  )
})

test('the list is parsed from commas and whitespace', () => {
  assert.deepEqual(
    parseCallbackUrls(
      'https://a.example.com/login/oidc/callback, https://b.example.com/login/oidc/callback\n/login/oidc/callback'
    ),
    [
      'https://a.example.com/login/oidc/callback',
      'https://b.example.com/login/oidc/callback',
      '/login/oidc/callback',
    ]
  )
  assert.deepEqual(parseCallbackUrls(''), [])
  assert.deepEqual(parseCallbackUrls(undefined), [])
})
