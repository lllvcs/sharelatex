// Checks the pending state of the OIDC password step and the login page
// messages (see
// overlay/services/web/app/src/Features/Authentication/OidcLinkRequest.mjs).
//
//   locally:            node --test tests/oidc-link-request.test.mjs
//   inside the image:   node --test /tests/oidc-link-request.test.mjs

import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const modulePath = [
  process.env.OVERLEAF_OIDC_LINK_REQUEST_MODULE,
  '/overleaf/services/web/app/src/Features/Authentication/OidcLinkRequest.mjs',
  fileURLToPath(
    new URL(
      '../overlay/services/web/app/src/Features/Authentication/OidcLinkRequest.mjs',
      import.meta.url
    )
  ),
].find(candidate => candidate && existsSync(candidate))

if (!modulePath) {
  throw new Error('cannot find OidcLinkRequest.mjs')
}

const {
  OIDC_MESSAGES,
  attemptsToLinkAccount,
  clearLinkRequest,
  createLinkRequest,
  linkMode,
  oidcMessageFor,
  readLinkRequest,
  storeLinkRequest,
} = await import(pathToFileURL(modulePath).href)

test('the password step is the default, auto has to be asked for', () => {
  assert.equal(linkMode({}), 'password')
  assert.equal(linkMode({ OVERLEAF_OIDC_LINK_MODE: 'password' }), 'password')
  assert.equal(linkMode({ OVERLEAF_OIDC_LINK_MODE: 'anything' }), 'password')
  assert.equal(linkMode({ OVERLEAF_OIDC_LINK_MODE: 'auto' }), 'auto')
  assert.equal(linkMode(), 'password')
})

const session = () => ({ session: {} })

test('a link request is stored in the session and read back', () => {
  const req = session()
  const request = createLinkRequest({
    oidcId: 'sub-1',
    userId: 'user-1',
    email: 'Admin@Example.com',
    now: 1000,
  })
  storeLinkRequest(req, request)

  assert.deepEqual(readLinkRequest(req, { now: 1500 }), {
    oidcId: 'sub-1',
    userId: 'user-1',
    email: 'Admin@Example.com',
    createdAt: 1000,
  })
})

test('an expired or absent request reads as null', () => {
  const req = session()
  assert.equal(readLinkRequest(req), null)

  storeLinkRequest(
    req,
    createLinkRequest({ oidcId: 's', userId: 'u', email: 'a@b.c', now: 1000 })
  )
  assert.equal(readLinkRequest(req, { now: 1000 + 600001 }), null)
  assert.equal(readLinkRequest(req, { now: 1000 + 599999 }) !== null, true)
})

test('a request without a timestamp is not usable', () => {
  const req = session()
  req.session.oidcLinkRequest = { oidcId: 's', userId: 'u', email: 'a@b.c' }
  assert.equal(readLinkRequest(req), null)
})

test('clearing removes the request and tolerates an empty session', () => {
  const req = session()
  storeLinkRequest(
    req,
    createLinkRequest({ oidcId: 's', userId: 'u', email: 'a@b.c' })
  )
  clearLinkRequest(req)
  assert.equal(readLinkRequest(req), null)
  clearLinkRequest({}) // must not throw
})

test('a request needs an identity, a user and an email', () => {
  assert.throws(() => createLinkRequest({ userId: 'u', email: 'a@b.c' }), /needs/)
  assert.throws(() => createLinkRequest({ oidcId: 's', email: 'a@b.c' }), /needs/)
  assert.throws(() => createLinkRequest({ oidcId: 's', userId: 'u' }), /needs/)
})

test('the password step only links the account the request was parked for', () => {
  const request = createLinkRequest({
    oidcId: 'sub-1',
    userId: 'user-1',
    email: 'Admin@Example.com',
  })

  assert.equal(
    attemptsToLinkAccount(request, {
      userId: 'user-1',
      emails: ['admin@example.com'],
    }),
    true
  )
  // the case of an address is not significant
  assert.equal(
    attemptsToLinkAccount(request, {
      userId: 'user-1',
      emails: ['ADMIN@EXAMPLE.COM'],
    }),
    true
  )
  // another account, or another address of the same account
  assert.equal(
    attemptsToLinkAccount(request, {
      userId: 'user-2',
      emails: ['admin@example.com'],
    }),
    false
  )
  assert.equal(
    attemptsToLinkAccount(request, {
      userId: 'user-1',
      emails: ['other@example.com'],
    }),
    false
  )
  assert.equal(
    attemptsToLinkAccount(null, { userId: 'user-1', emails: [] }),
    false
  )
})

test('the login page messages are known codes mapped to plain text', () => {
  assert.match(oidcMessageFor('oidc-link-failed'), /do not match/)
  assert.equal(oidcMessageFor('nonsense'), null)
  assert.equal(oidcMessageFor(undefined), null)
  assert.equal(oidcMessageFor({}), null)

  // nothing that a provider said may be rendered into the page
  const codes = Object.keys(OIDC_MESSAGES)
  assert.ok(codes.length >= 5, 'the expected codes are defined')
  for (const code of codes) {
    const message = oidcMessageFor(code)
    assert.equal(typeof message, 'string')
    assert.ok(message.length > 0)
    assert.ok(!message.includes('<'), `${code} must not contain markup`)
  }
})
