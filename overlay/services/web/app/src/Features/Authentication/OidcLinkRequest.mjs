// State for the "prove you own this account" step of the OIDC login.
//
// When a provider asserts an email address that belongs to an existing local
// account which is not linked to an OIDC identity yet, the login is not
// completed silently: the identity could belong to anybody who can set that
// address at the provider. Instead the OIDC identity is parked in the session,
// the user is asked for the password of that account, and only then is the
// identity bound to it (`AuthenticationController.oidcLink`).
//
// The pending request is
//
//   - bound to the session, so it cannot be replayed from another browser
//   - short-lived (DEFAULT_LINK_TTL) so an abandoned flow does not linger
//   - single use: it is cleared as soon as the password step finishes
//
// The module also owns the messages the login page shows: a redirect carries a
// short code (`?oidc_error=<code>`), never provider text, so nothing a provider
// says can end up rendered in the page.
//
// The module has no imports, so tests/oidc-link-request.test.mjs can exercise it
// on its own.

export const LINK_REQUEST_SESSION_KEY = 'oidcLinkRequest'
export const DEFAULT_LINK_TTL_MS = 10 * 60 * 1000

export const OIDC_MESSAGES = {
  'oidc-failed':
    'The single sign-on provider did not complete the login. Please try again.',
  'oidc-email-unverified':
    'The identity provider did not verify this email address, so a new account cannot be created with it.',
  'oidc-identity-taken':
    'This account is already linked to another single sign-on identity. Ask an administrator to unlink it first.',
  'oidc-link-expired':
    'The single sign-on login expired before the account was confirmed. Please start again.',
  'oidc-link-failed':
    'That email address and password do not match. The account was not linked.',
  'oidc-token-invalid':
    'The identity token the provider returned could not be verified. Ask an administrator to check the provider configuration.',
}

// How an OIDC identity that matches an existing, unlinked account is handled:
// `password` (default) parks the identity and asks for the account password,
// `auto` links without asking - the behaviour before this step existed, still
// gated by the provider vouching for the address.
export function linkMode(env = process.env) {
  return env.OVERLEAF_OIDC_LINK_MODE === 'auto' ? 'auto' : 'password'
}

export function oidcMessageFor(code) {
  if (typeof code !== 'string') {
    return null
  }
  return OIDC_MESSAGES[code] || null
}

export function createLinkRequest({ oidcId, userId, email, now = Date.now() }) {
  if (!oidcId || !userId || !email) {
    throw new Error('a link request needs the identity, the user and the email')
  }
  return {
    oidcId: String(oidcId),
    userId: String(userId),
    email: String(email),
    createdAt: now,
  }
}

export function storeLinkRequest(req, request) {
  req.session[LINK_REQUEST_SESSION_KEY] = request
  return request
}

export function readLinkRequest(
  req,
  { now = Date.now(), ttlMs = DEFAULT_LINK_TTL_MS } = {}
) {
  const request = req.session && req.session[LINK_REQUEST_SESSION_KEY]
  if (!request) {
    return null
  }
  if (
    typeof request.createdAt !== 'number' ||
    now - request.createdAt > ttlMs
  ) {
    return null
  }
  return request
}

export function clearLinkRequest(req) {
  if (req.session && req.session[LINK_REQUEST_SESSION_KEY] != null) {
    delete req.session[LINK_REQUEST_SESSION_KEY]
  }
}

// The user types the address of the account, so accept any address of that
// account (and normalise case, which email addresses treat as insignificant).
export function attemptsToLinkAccount(request, { userId, emails = [] }) {
  if (!request) {
    return false
  }
  if (String(userId) !== request.userId) {
    return false
  }
  const wanted = request.email.trim().toLowerCase()
  return emails.some(email => String(email).trim().toLowerCase() === wanted)
}
