// Checks whether the `email` claim of a userinfo response may identify an
// account - i.e. whether an existing account may be linked to an OIDC identity,
// or its address rewritten (see
// overlay/services/web/app/src/Features/Authentication/OidcEmailTrust.mjs).
//
//   locally:            node --test tests/oidc-email-trust.test.mjs
//   inside the image:   node --test /tests/oidc-email-trust.test.mjs
//
// The module under test has no imports, so nothing else from the application is
// needed.

import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const modulePath = [
  process.env.OVERLEAF_OIDC_EMAIL_TRUST_MODULE,
  '/overleaf/services/web/app/src/Features/Authentication/OidcEmailTrust.mjs',
  fileURLToPath(
    new URL(
      '../overlay/services/web/app/src/Features/Authentication/OidcEmailTrust.mjs',
      import.meta.url
    )
  ),
].find(candidate => candidate && existsSync(candidate))

if (!modulePath) {
  throw new Error('cannot find OidcEmailTrust.mjs')
}

const { emailClaimTrust } = await import(pathToFileURL(modulePath).href)

test('an address the provider verified is trusted', () => {
  const trust = emailClaimTrust(
    { email: 'user@example.com', email_verified: true },
    {}
  )
  assert.equal(trust.trusted, true)
})

test('an address the provider marks unverified is not trusted', () => {
  const trust = emailClaimTrust(
    { email: 'admin@example.com', email_verified: false },
    {}
  )
  assert.equal(trust.trusted, false)
  assert.match(trust.reason, /email_verified/)
})

test('a missing claim is trusted, so providers that omit it keep working', () => {
  assert.equal(emailClaimTrust({ email: 'user@example.com' }, {}).trusted, true)
})

test('the string forms providers use are understood', () => {
  assert.equal(emailClaimTrust({ email_verified: 'true' }, {}).trusted, true)
  assert.equal(emailClaimTrust({ email_verified: 'TRUE' }, {}).trusted, true)
  assert.equal(emailClaimTrust({ email_verified: 'false' }, {}).trusted, false)
  assert.equal(emailClaimTrust({ email_verified: '0' }, {}).trusted, false)
  assert.equal(emailClaimTrust({ email_verified: 'nonsense' }, {}).trusted, true)
})

test('the override refuses an address the provider does not vouch for', () => {
  const env = { OVERLEAF_OIDC_TRUST_UNVERIFIED_EMAIL: 'false' }
  assert.equal(emailClaimTrust({ email: 'user@example.com' }, env).trusted, false)
  assert.equal(emailClaimTrust({ email_verified: true }, env).trusted, false)
})

test('the override also trusts an address marked unverified', () => {
  const env = { OVERLEAF_OIDC_TRUST_UNVERIFIED_EMAIL: 'yes' }
  assert.equal(emailClaimTrust({ email_verified: false }, env).trusted, true)
})

test('a missing or empty claim set does not throw', () => {
  assert.equal(emailClaimTrust(undefined, {}).trusted, true)
  assert.equal(emailClaimTrust(null, {}).trusted, true)
  assert.equal(emailClaimTrust({}, {}).trusted, true)
})
