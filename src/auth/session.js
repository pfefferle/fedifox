import { OAUTH_SCOPE, TOKEN_REFRESH_LEEWAY_MS } from '../constants.js'
import { FedifoxError } from '../errors.js'
import { discoverEndpoints } from './discovery.js'
import { resolveClientCreds } from './client-identity.js'

const hostOf = (url) => new URL(url).host

export function buildAuthorizationUrl (as, clientId, { redirectUri, codeChallenge, state, scope }) {
  const url = new URL(as.authorization_endpoint)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', scope)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  return url.toString()
}

export function accountFromActor (actor, tokens, { asOrigin, now }) {
  const account = {
    actorId: actor.id,
    handle: `${actor.preferredUsername || hostOf(actor.id)}@${hostOf(actor.id)}`,
    name: actor.name || actor.preferredUsername || actor.id,
    inbox: actor.inbox,
    outbox: actor.outbox,
    liked: actor.liked,
    following: actor.following,
    followers: actor.followers,
    asOrigin,
    accessToken: tokens.access_token,
    needsReauth: false
  }
  if (actor.endpoints?.proxyUrl) account.proxyUrl = actor.endpoints.proxyUrl
  if (tokens.refresh_token) account.refreshToken = tokens.refresh_token
  if (tokens.expires_in) account.expiresAt = now + tokens.expires_in * 1000
  return account
}

export function createSession ({ store, client, browser, fetch = globalThis.fetch, oauth, now = () => Date.now(), allowInsecure = false }) {
  const oauthOptions = () => ({ [oauth.customFetch]: fetch, [oauth.allowInsecureRequests]: allowInsecure })

  function oauthClient (creds) {
    return { client_id: creds.clientId, token_endpoint_auth_method: creds.clientSecret ? 'client_secret_post' : 'none' }
  }
  function clientAuth (creds) {
    return creds.clientSecret ? oauth.ClientSecretPost(creds.clientSecret) : oauth.None()
  }

  async function asFor (account) {
    const actor = await client.fetchObject(account.actorId)
    return discoverEndpoints(actor, { fetch })
  }

  async function login ({ input, manual } = {}) {
    const trimmed = (input || '').trim()
    if (!trimmed) throw new FedifoxError('Enter a handle like user@example.org or an actor URL', { step: 'login' })
    const actorUrl = /^https?:\/\//.test(trimmed) ? trimmed : await client.webfinger(trimmed)
    const actor = await client.fetchObject(actorUrl)
    if (!actor.outbox) throw new FedifoxError(`${hostOf(actorUrl)} actor has no outbox — the server does not support the ActivityPub API`, { step: 'login', detail: actorUrl })

    const as = await discoverEndpoints(actor, { fetch })
    const redirectUri = browser.identity.getRedirectURL()
    const creds = await resolveClientCreds({ as, store, redirectUri, manual, fetch })

    const codeVerifier = oauth.generateRandomCodeVerifier()
    const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier)
    const state = oauth.generateRandomState()
    const url = buildAuthorizationUrl(as, creds.clientId, { redirectUri, codeChallenge, state, scope: OAUTH_SCOPE })

    let callbackUrl
    try {
      callbackUrl = await browser.identity.launchWebAuthFlow({ url, interactive: true })
    } catch (cause) {
      throw new FedifoxError(`Authorization at ${hostOf(as.authorization_endpoint)} was cancelled or failed`, { step: 'authorize', detail: cause?.message, cause })
    }

    let params
    try {
      params = oauth.validateAuthResponse(as, oauthClient(creds), new URL(callbackUrl), state)
    } catch (cause) {
      throw new FedifoxError(`${hostOf(as.authorization_endpoint)} returned an invalid authorization response`, { step: 'authorize', detail: cause?.message, cause })
    }

    let tokens
    let response
    try {
      response = await oauth.authorizationCodeGrantRequest(as, oauthClient(creds), clientAuth(creds), params, redirectUri, codeVerifier, oauthOptions())
      tokens = await oauth.processAuthorizationCodeResponse(as, oauthClient(creds), response)
    } catch (cause) {
      throw new FedifoxError(`${hostOf(as.token_endpoint)} refused the token exchange`, { step: 'token', status: response?.status, detail: cause?.message, cause })
    }

    const account = accountFromActor(actor, tokens, { asOrigin: as.issuer, now: now() })
    await store.saveAccount(account)
    await store.setSelectedActorId(account.actorId)
    return account
  }

  async function ensureFreshToken (account) {
    // Re-read the stored account rather than trusting the caller's (possibly
    // stale) copy: several calls can share one in-flight message (e.g. an
    // action:run followed by its actions.state scans), and after the first
    // refresh those callers still hold the pre-refresh object. Deciding from
    // the store means the later calls see the just-refreshed token instead of
    // refreshing a second time — which, under refresh-token rotation, would
    // fail and incorrectly flag the account as needing reauth.
    const current = (await store.getAccount(account.actorId)) || account
    if (current.expiresAt == null || current.expiresAt - now() > TOKEN_REFRESH_LEEWAY_MS) return current.accessToken
    if (!current.refreshToken) return current.accessToken
    try {
      const as = await asFor(current)
      const creds = await store.getClientCreds(as.issuer)
      if (!creds) throw new Error('no client credentials cached')
      const response = await oauth.refreshTokenGrantRequest(as, oauthClient(creds), clientAuth(creds), current.refreshToken, oauthOptions())
      const tokens = await oauth.processRefreshTokenResponse(as, oauthClient(creds), response)
      const updated = { ...current, accessToken: tokens.access_token, needsReauth: false }
      if (tokens.refresh_token) updated.refreshToken = tokens.refresh_token
      if (tokens.expires_in) updated.expiresAt = now() + tokens.expires_in * 1000
      await store.saveAccount(updated)
      return updated.accessToken
    } catch (cause) {
      await store.saveAccount({ ...current, needsReauth: true })
      throw new FedifoxError(`Session for ${current.handle} expired — log in again`, { step: 'refresh-token', detail: cause?.message, cause })
    }
  }

  async function logout (actorId) {
    const account = await store.getAccount(actorId)
    if (!account) return
    try {
      const as = await asFor(account)
      const creds = await store.getClientCreds(as.issuer)
      if (as.revocation_endpoint && creds) {
        const res = await oauth.revocationRequest(as, oauthClient(creds), clientAuth(creds), account.accessToken, oauthOptions())
        await oauth.processRevocationResponse(res)
      }
    } catch {
      // Revocation is best effort; the local session is removed regardless.
    }
    await store.removeAccount(actorId)
  }

  return { login, ensureFreshToken, logout }
}
