// Whether the `email` claim of a userinfo response may be used to *identify* an
// account: to link an existing Overleaf account to an OIDC identity, or to
// rewrite the address stored on an account.
//
// The claim on its own is not proof of ownership. A provider that lets users
// type an address without verifying it - and plenty of self-hosted ones do -
// would let anybody claim `admin@example.com` and take over the matching
// Overleaf account, because the first OIDC login links the identity to
// whatever account carries that address.
//
// OpenID Connect answers this with the `email_verified` claim, so it decides:
//
//   email_verified: true    the address is trusted
//   email_verified: false   not trusted: linking an existing account and
//                           rewriting the stored address are refused
//   claim missing           trusted, because providers that verify addresses
//                           often omit the claim; the login is logged so the
//                           administrator can see what is being relied on
//
// OVERLEAF_OIDC_TRUST_UNVERIFIED_EMAIL overrides the claim in both directions
// (`true` trusts it even when the provider says it is unverified, `false`
// refuses to trust an unstated claim), for providers whose claim is wrong.
//
// The module has no imports, so tests/oidc-email-trust.test.mjs can exercise it
// on its own.

const TRUTHY = ['true', 'yes', '1', 'on']
const FALSY = ['false', 'no', '0', 'off']

function asBoolean(value) {
  if (value === true || value === false) {
    return value
  }
  if (typeof value === 'string') {
    const normalised = value.trim().toLowerCase()
    if (TRUTHY.includes(normalised)) {
      return true
    }
    if (FALSY.includes(normalised)) {
      return false
    }
  }
  return undefined
}

export function emailClaimTrust(claims, env = process.env) {
  const override = asBoolean(env.OVERLEAF_OIDC_TRUST_UNVERIFIED_EMAIL)
  if (override === true) {
    return {
      trusted: true,
      reason: 'OVERLEAF_OIDC_TRUST_UNVERIFIED_EMAIL is set',
    }
  }
  if (override === false) {
    return {
      trusted: false,
      reason: 'OVERLEAF_OIDC_TRUST_UNVERIFIED_EMAIL is disabled',
    }
  }

  const verified = asBoolean(claims && claims.email_verified)
  if (verified === false) {
    return {
      trusted: false,
      reason: 'the provider reports email_verified: false',
    }
  }
  if (verified === true) {
    return { trusted: true, reason: 'the provider reports email_verified: true' }
  }
  return {
    trusted: true,
    reason: 'the provider does not state whether the address is verified',
  }
}
