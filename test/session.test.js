import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as oauth from '../src/vendor/oauth4webapi.js'
import { createSession, accountFromActor, buildAuthorizationUrl } from '../src/auth/session.js'
import { createClient } from '../src/client/activitypub.js'
import { createStore } from '../src/state/storage.js'
import { createStorageArea } from './helpers/storage-stub.js'
import { createFetchStub } from './helpers/fetch-stub.js'

const redirectUri = 'https://abc123.extensions.allizom.org/'
const actor = { id: 'https://x.test/users/alice', type: 'Person', preferredUsername: 'alice', name: 'Alice', inbox: 'https://x.test/users/alice/inbox', outbox: 'https://x.test/users/alice/outbox', liked: 'https://x.test/users/alice/liked', following: 'https://x.test/users/alice/following', followers: 'https://x.test/users/alice/followers', endpoints: { oauthAuthorizationEndpoint: 'https://x.test/oauth/authorize', oauthTokenEndpoint: 'https://x.test/oauth/token', proxyUrl: 'https://x.test/proxy' } }
const json = (body, status = 200) => ({ status, body, headers: { 'content-type': 'application/json' } })

function makeBrowser (onAuth) {
  return { identity: { getRedirectURL: () => redirectUri, launchWebAuthFlow: async ({ url }) => onAuth(new URL(url)) } }
}

function setup ({ tokenBody } = {}) {
  const area = createStorageArea()
  const store = createStore(area)
  const stub = createFetchStub({
    'GET https://x.test/.well-known/webfinger?resource=acct%3Aalice%40x.test': { body: { links: [{ rel: 'self', type: 'application/activity+json', href: actor.id }] }, headers: { 'content-type': 'application/jrd+json' } },
    'GET https://x.test/users/alice': { body: actor },
    'GET https://x.test/.well-known/oauth-authorization-server': json({ issuer: 'https://x.test', authorization_endpoint: 'https://x.test/oauth/authorize', token_endpoint: 'https://x.test/oauth/token', registration_endpoint: 'https://x.test/oauth/clients', revocation_endpoint: 'https://x.test/oauth/revoke' }),
    'POST https://x.test/oauth/clients': json({ client_id: 'dcr-1' }, 201),
    'POST https://x.test/oauth/token': json(tokenBody || { access_token: 'at-1', token_type: 'bearer', expires_in: 3600, refresh_token: 'rt-1', scope: 'read write' }),
    'POST https://x.test/oauth/revoke': { status: 200, body: '' }
  })
  const client = createClient({ fetch: stub.fetch })
  return { store, stub, client }
}

test('pure helpers', () => {
  const url = new URL(buildAuthorizationUrl({ authorization_endpoint: 'https://x.test/oauth/authorize' }, 'c1', { redirectUri, codeChallenge: 'ch', state: 'st', scope: 'read write' }))
  assert.equal(url.searchParams.get('client_id'), 'c1')
  assert.equal(url.searchParams.get('redirect_uri'), redirectUri)
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('scope'), 'read write')
  assert.equal(url.searchParams.get('code_challenge'), 'ch')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('state'), 'st')

  const account = accountFromActor(actor, { access_token: 'a', refresh_token: 'r', expires_in: 60 }, { asOrigin: 'https://x.test', now: 1000 })
  assert.deepEqual(account, { actorId: actor.id, handle: 'alice@x.test', name: 'Alice', inbox: actor.inbox, outbox: actor.outbox, liked: actor.liked, following: actor.following, followers: actor.followers, proxyUrl: 'https://x.test/proxy', asOrigin: 'https://x.test', accessToken: 'a', refreshToken: 'r', expiresAt: 61000, needsReauth: false })
})

test('login runs webfinger → actor → discovery → registration → PKCE → token and stores the account', async () => {
  const { store, stub, client } = setup()
  let authUrl
  const browser = makeBrowser((url) => { authUrl = url; return `${redirectUri}?code=abc&state=${url.searchParams.get('state')}` })
  const session = createSession({ store, client, browser, fetch: stub.fetch, oauth, now: () => 5000 })
  const account = await session.login({ input: '@alice@x.test' })
  assert.equal(authUrl.origin + authUrl.pathname, 'https://x.test/oauth/authorize')
  assert.equal(authUrl.searchParams.get('client_id'), 'dcr-1')
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(account.accessToken, 'at-1')
  assert.equal(account.refreshToken, 'rt-1')
  assert.equal(account.expiresAt, 5000 + 3600 * 1000)
  assert.equal((await store.getSelectedAccount()).actorId, actor.id)
  const tokenCall = stub.calls.find((c) => c.url === 'https://x.test/oauth/token')
  const params = new URLSearchParams(String(tokenCall.body))
  assert.equal(params.get('grant_type'), 'authorization_code')
  assert.equal(params.get('code'), 'abc')
  assert.equal(params.get('redirect_uri'), redirectUri)
  assert.ok(params.get('code_verifier'))
})

test('login accepts an actor URL and surfaces user cancellation', async () => {
  const { store, stub, client } = setup()
  const browser = makeBrowser(() => { throw new Error('User cancelled or denied access.') })
  const session = createSession({ store, client, browser, fetch: stub.fetch, oauth, now: () => 5000 })
  await assert.rejects(session.login({ input: 'https://x.test/users/alice' }), (e) => e.step === 'authorize' && /cancelled/i.test(e.message))
  assert.deepEqual(await store.getAccounts(), [])
})

test('a network failure at the token endpoint is a FedifoxError', async () => {
  const { store, stub, client } = setup()
  stub.routes['POST https://x.test/oauth/token'] = () => { throw new TypeError('NetworkError when attempting to fetch resource.') }
  const browser = makeBrowser((url) => `${redirectUri}?code=abc&state=${url.searchParams.get('state')}`)
  const session = createSession({ store, client, browser, fetch: stub.fetch, oauth, now: () => 5000 })
  await assert.rejects(session.login({ input: 'alice@x.test' }), (e) => e.name === 'FedifoxError' && e.step === 'token' && /x\.test/.test(e.message))
  assert.deepEqual(await store.getAccounts(), [])
})

test('ensureFreshToken refreshes near expiry and flags failure', async () => {
  const { store, stub, client } = setup({ tokenBody: { access_token: 'at-2', token_type: 'bearer', expires_in: 3600, refresh_token: 'rt-2' } })
  const session = createSession({ store, client, browser: makeBrowser(() => ''), fetch: stub.fetch, oauth, now: () => 10_000 })
  const account = accountFromActor(actor, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 30 }, { asOrigin: 'https://x.test', now: 0 })
  await store.saveAccount(account)
  await store.saveClientCreds('https://x.test', { clientId: 'dcr-1', source: 'dcr' })
  assert.equal(await session.ensureFreshToken(account), 'at-2')
  const saved = await store.getAccount(actor.id)
  assert.equal(saved.refreshToken, 'rt-2')
  assert.equal(saved.expiresAt, 10_000 + 3600 * 1000)
  const fresh = { ...saved, expiresAt: 10_000 + 3600 * 1000 }
  assert.equal(await session.ensureFreshToken(fresh), 'at-2')

  stub.routes['POST https://x.test/oauth/token'] = { status: 400, body: { error: 'invalid_grant' }, headers: { 'content-type': 'application/json' } }
  // ensureFreshToken now decides from the stored account, not the caller's
  // copy — so forcing expiry means actually persisting it, not just
  // overriding the local object passed in.
  await store.saveAccount({ ...saved, expiresAt: 0 })
  await assert.rejects(session.ensureFreshToken({ ...saved, expiresAt: 0 }), (e) => e.step === 'refresh-token')
  assert.equal((await store.getAccount(actor.id)).needsReauth, true)
})

test('ensureFreshToken re-reads the stored account, so a second call with the same stale object does not refresh twice', async () => {
  const { store, stub, client } = setup({ tokenBody: { access_token: 'at-2', token_type: 'bearer', expires_in: 3600, refresh_token: 'rt-2' } })
  const session = createSession({ store, client, browser: makeBrowser(() => ''), fetch: stub.fetch, oauth, now: () => 10_000 })
  const stale = accountFromActor(actor, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 30 }, { asOrigin: 'https://x.test', now: 0 })
  await store.saveAccount(stale)
  await store.saveClientCreds('https://x.test', { clientId: 'dcr-1', source: 'dcr' })

  assert.equal(await session.ensureFreshToken(stale), 'at-2')
  // Same in-memory (now stale) object passed again, as callers within one
  // action:run message would do before receiving the refreshed account back.
  assert.equal(await session.ensureFreshToken(stale), 'at-2')

  const tokenCalls = stub.calls.filter((c) => c.url === 'https://x.test/oauth/token')
  assert.equal(tokenCalls.length, 1)
})

async function expiring (store, { refreshToken = 'rt-1' } = {}) {
  const account = accountFromActor(actor, { access_token: 'at-1', refresh_token: refreshToken, expires_in: 30 }, { asOrigin: 'https://x.test', now: 0 })
  await store.saveAccount(account)
  await store.saveClientCreds('https://x.test', { clientId: 'dcr-1', source: 'dcr' })
  return account
}

test('concurrent ensureFreshToken calls share one token request', async () => {
  const { store, stub, client } = setup()
  let release
  const gate = new Promise((resolve) => { release = resolve })
  stub.routes['POST https://x.test/oauth/token'] = async () => { await gate; return json({ access_token: 'at-2', token_type: 'bearer', expires_in: 3600, refresh_token: 'rt-2' }) }
  const session = createSession({ store, client, browser: makeBrowser(() => ''), fetch: stub.fetch, oauth, now: () => 10_000 })
  const account = await expiring(store)
  const first = session.ensureFreshToken(account)
  const second = session.ensureFreshToken(account)
  await new Promise((resolve) => setTimeout(resolve, 5))
  release()
  assert.deepEqual(await Promise.all([first, second]), ['at-2', 'at-2'])
  assert.equal(stub.calls.filter((c) => c.url === 'https://x.test/oauth/token').length, 1)
  // Once settled, the in-flight slot is free again.
  await store.saveAccount({ ...(await store.getAccount(actor.id)), expiresAt: 0 })
  assert.equal(await session.ensureFreshToken(account), 'at-2')
  assert.equal(stub.calls.filter((c) => c.url === 'https://x.test/oauth/token').length, 2)
})

test('a transient refresh failure does not lock the account', async () => {
  const { store, stub, client } = setup()
  stub.routes['POST https://x.test/oauth/token'] = () => { throw new TypeError('NetworkError when attempting to fetch resource.') }
  const session = createSession({ store, client, browser: makeBrowser(() => ''), fetch: stub.fetch, oauth, now: () => 10_000 })
  const account = await expiring(store)
  await assert.rejects(session.ensureFreshToken(account), (e) => e.name === 'FedifoxError' && e.step === 'refresh-token' && /Could not reach x\.test/.test(e.message))
  assert.deepEqual(await store.getAccount(actor.id), account)
  // A 5xx is transient too.
  stub.routes['POST https://x.test/oauth/token'] = { status: 503, body: 'down', headers: { 'content-type': 'text/plain' } }
  await assert.rejects(session.ensureFreshToken(account), (e) => e.step === 'refresh-token')
  assert.equal((await store.getAccount(actor.id)).needsReauth, false)
})

test('an OAuth error response marks the account as needing reauth', async () => {
  const { store, stub, client } = setup()
  stub.routes['POST https://x.test/oauth/token'] = json({ error: 'invalid_grant' }, 400)
  const session = createSession({ store, client, browser: makeBrowser(() => ''), fetch: stub.fetch, oauth, now: () => 10_000 })
  const account = await expiring(store)
  await assert.rejects(session.ensureFreshToken(account), (e) => e.step === 'refresh-token' && /log in again/.test(e.message))
  assert.equal((await store.getAccount(actor.id)).needsReauth, true)
  // Same for a bare 401 challenge without a JSON body.
  await store.saveAccount({ ...account, needsReauth: false })
  stub.routes['POST https://x.test/oauth/token'] = { status: 401, body: '', headers: { 'www-authenticate': 'Bearer error="invalid_token"' } }
  await assert.rejects(session.ensureFreshToken(account), (e) => e.step === 'refresh-token')
  assert.equal((await store.getAccount(actor.id)).needsReauth, true)
})

test('a refresh that finishes after logout does not resurrect the account', async () => {
  const { store, stub, client } = setup()
  stub.routes['POST https://x.test/oauth/token'] = async () => { await store.removeAccount(actor.id); return json({ access_token: 'at-2', token_type: 'bearer', expires_in: 3600 }) }
  const session = createSession({ store, client, browser: makeBrowser(() => ''), fetch: stub.fetch, oauth, now: () => 10_000 })
  const account = await expiring(store)
  assert.equal(await session.ensureFreshToken(account), 'at-2')
  assert.equal(await store.getAccount(actor.id), null)
  // Likewise a rejection after logout must not write a needsReauth stub.
  stub.routes['POST https://x.test/oauth/token'] = async () => { await store.removeAccount(actor.id); return json({ error: 'invalid_grant' }, 400) }
  await expiring(store)
  await assert.rejects(session.ensureFreshToken(account), (e) => e.step === 'refresh-token')
  assert.equal(await store.getAccount(actor.id), null)
})

test('a refresh response without expires_in drops the stored expiry', async () => {
  const { store, stub, client } = setup({ tokenBody: { access_token: 'at-2', token_type: 'bearer' } })
  const session = createSession({ store, client, browser: makeBrowser(() => ''), fetch: stub.fetch, oauth, now: () => 10_000 })
  const account = await expiring(store)
  assert.equal(await session.ensureFreshToken(account), 'at-2')
  const saved = await store.getAccount(actor.id)
  assert.equal(saved.accessToken, 'at-2')
  assert.equal('expiresAt' in saved, false)
  assert.equal(saved.refreshToken, 'rt-1', 'refresh token is kept when not rotated')
})

test('forceRefresh refreshes regardless of expiry, or yields null without a refresh token', async () => {
  const { store, stub, client } = setup({ tokenBody: { access_token: 'at-2', token_type: 'bearer', expires_in: 3600, refresh_token: 'rt-2' } })
  const session = createSession({ store, client, browser: makeBrowser(() => ''), fetch: stub.fetch, oauth, now: () => 10_000 })
  const account = accountFromActor(actor, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 }, { asOrigin: 'https://x.test', now: 10_000 })
  await store.saveAccount(account)
  await store.saveClientCreds('https://x.test', { clientId: 'dcr-1', source: 'dcr' })
  assert.equal(await session.ensureFreshToken(account), 'at-1')
  assert.equal(await session.forceRefresh(account), 'at-2')
  assert.equal((await store.getAccount(actor.id)).refreshToken, 'rt-2')
  assert.equal(stub.calls.filter((c) => c.url === 'https://x.test/oauth/token').length, 1)

  const noRefresh = { ...(await store.getAccount(actor.id)) }
  delete noRefresh.refreshToken
  await store.saveAccount(noRefresh)
  assert.equal(await session.forceRefresh(noRefresh), null)
  assert.equal(stub.calls.filter((c) => c.url === 'https://x.test/oauth/token').length, 1)
})

test('logout revokes best-effort and removes the account', async () => {
  const { store, stub, client } = setup()
  const session = createSession({ store, client, browser: makeBrowser(() => ''), fetch: stub.fetch, oauth, now: () => 0 })
  await store.saveAccount(accountFromActor(actor, { access_token: 'a' }, { asOrigin: 'https://x.test', now: 0 }))
  await store.saveClientCreds('https://x.test', { clientId: 'dcr-1', source: 'dcr' })
  await session.logout(actor.id)
  assert.equal(await store.getAccount(actor.id), null)
  assert.ok(stub.calls.some((c) => c.url === 'https://x.test/oauth/revoke'))
})

const intentLinks = [{ rel: 'https://w3id.org/fep/3b86/Follow', template: 'https://x.test/authorize_interaction?uri={object}' }, { rel: 'https://w3id.org/fep/3b86/Like', template: 'https://x.test/intents/like?id={object}' }]
const intents = { Follow: 'https://x.test/authorize_interaction?uri={object}', Like: 'https://x.test/intents/like?id={object}' }
const withIntents = (stub) => { stub.routes['GET https://x.test/.well-known/webfinger?resource=acct%3Aalice%40x.test'].body.links.push(...intentLinks) }
const noAuth = () => { throw new Error('the authorization window must not open') }

test('a login keeps the intents the server publishes next to the tokens', async () => {
  for (const input of ['alice@x.test', 'https://x.test/users/alice']) {
    const { store, stub, client } = setup()
    withIntents(stub)
    const browser = makeBrowser((url) => `${redirectUri}?code=abc&state=${url.searchParams.get('state')}`)
    const account = await createSession({ store, client, browser, fetch: stub.fetch, oauth, now: () => 5000 }).login({ input })
    assert.equal(account.accessToken, 'at-1', input)
    assert.deepEqual(account.intents, intents, input)
    assert.deepEqual((await store.getSelectedAccount()).intents, intents, input)
  }
})

test('a login without published intents stores none', async () => {
  const { store, stub, client } = setup()
  const browser = makeBrowser((url) => `${redirectUri}?code=abc&state=${url.searchParams.get('state')}`)
  const account = await createSession({ store, client, browser, fetch: stub.fetch, oauth, now: () => 5000 }).login({ input: 'alice@x.test' })
  assert.deepEqual(account.intents, {})
})

test('a server without the API but with intents is connected without a login', async () => {
  // No outbox at all, and an outbox but nowhere to authorize (Mastodon).
  const noOutbox = { ...actor, outbox: undefined }
  const noOAuth = { ...actor, endpoints: {} }
  for (const [served, input] of [[noOutbox, 'alice@x.test'], [noOAuth, 'alice@x.test'], [noOAuth, 'https://x.test/users/alice']]) {
    const { store, stub, client } = setup()
    withIntents(stub)
    stub.routes['GET https://x.test/users/alice'] = { body: served }
    stub.routes['GET https://x.test/.well-known/oauth-authorization-server'] = { status: 404, body: '' }
    const account = await createSession({ store, client, browser: makeBrowser(noAuth), fetch: stub.fetch, oauth, now: () => 5000 }).login({ input })
    assert.deepEqual(account, { actorId: actor.id, handle: 'alice@x.test', name: 'Alice', intents, needsReauth: false })
    assert.deepEqual(await store.getSelectedAccount(), account)
    assert.equal(stub.calls.some((c) => c.method === 'POST'), false)
  }
})

test('a server with neither the API nor intents is still refused', async () => {
  const { store, stub, client } = setup()
  stub.routes['GET https://x.test/users/alice'] = { body: { ...actor, outbox: undefined } }
  const session = createSession({ store, client, browser: makeBrowser(noAuth), fetch: stub.fetch, oauth, now: () => 5000 })
  await assert.rejects(session.login({ input: 'alice@x.test' }), (e) => e.step === 'login' && /no outbox/.test(e.message))
  await assert.rejects(session.login({ input: 'https://x.test/users/alice' }), (e) => e.step === 'login' && /no outbox/.test(e.message))
  assert.deepEqual(await store.getAccounts(), [])
})

test('an API login that the server refuses falls back to the intents', async () => {
  const refusals = {
    'the client registration': (stub) => { stub.routes['POST https://x.test/oauth/clients'] = json({ error: 'unauthorized' }, 401) },
    'no way to register': (stub) => { stub.routes['GET https://x.test/.well-known/oauth-authorization-server'] = json({ issuer: 'https://x.test', authorization_endpoint: 'https://x.test/oauth/authorize', token_endpoint: 'https://x.test/oauth/token' }) },
    'the token exchange': (stub) => { stub.routes['POST https://x.test/oauth/token'] = json({ error: 'invalid_client' }, 401) }
  }
  for (const [what, refuse] of Object.entries(refusals)) {
    const browser = makeBrowser((url) => `${redirectUri}?code=abc&state=${url.searchParams.get('state')}`)
    const withOnes = setup()
    withIntents(withOnes.stub)
    refuse(withOnes.stub)
    const account = await createSession({ store: withOnes.store, client: withOnes.client, browser, fetch: withOnes.stub.fetch, oauth, now: () => 5000 }).login({ input: 'alice@x.test' })
    assert.deepEqual(account, { actorId: actor.id, handle: 'alice@x.test', name: 'Alice', intents, needsReauth: false }, what)
    assert.deepEqual(await withOnes.store.getSelectedAccount(), account, what)
    // Without intents the refusal is the answer, as before.
    const without = setup()
    refuse(without.stub)
    await assert.rejects(createSession({ store: without.store, client: without.client, browser, fetch: without.stub.fetch, oauth, now: () => 5000 }).login({ input: 'alice@x.test' }), (e) => e.name === 'FedifoxError', what)
    assert.deepEqual(await without.store.getAccounts(), [], what)
  }
})

test('cancelling the authorization does not connect the account another way', async () => {
  const { store, stub, client } = setup()
  withIntents(stub)
  const browser = makeBrowser(() => { throw new Error('User cancelled or denied access.') })
  const session = createSession({ store, client, browser, fetch: stub.fetch, oauth, now: () => 5000 })
  await assert.rejects(session.login({ input: 'alice@x.test' }), (e) => e.step === 'authorize')
  assert.deepEqual(await store.getAccounts(), [])
})

test('an actor document that cannot be read still connects through the intents of its handle', async () => {
  // A server in authorized-fetch mode answers 401 to an unsigned request.
  const locked = (stub) => { stub.routes['GET https://x.test/users/alice'] = { status: 401, body: '' } }
  for (const input of ['alice@x.test', '@alice@x.test', 'acct:alice@x.test']) {
    const { store, stub, client } = setup()
    withIntents(stub)
    locked(stub)
    const account = await createSession({ store, client, browser: makeBrowser(noAuth), fetch: stub.fetch, oauth, now: () => 5000 }).login({ input })
    assert.deepEqual(account, { actorId: actor.id, handle: 'alice@x.test', name: 'alice@x.test', intents, needsReauth: false }, input)
    assert.deepEqual(await store.getSelectedAccount(), account, input)
  }
  // Nothing to fall back to: no intents, or an actor URL, which names no handle.
  const none = setup()
  locked(none.stub)
  await assert.rejects(createSession({ store: none.store, client: none.client, browser: makeBrowser(noAuth), fetch: none.stub.fetch, oauth, now: () => 5000 }).login({ input: 'alice@x.test' }), (e) => e.step === 'fetch-object' && e.status === 401)
  const byUrl = setup()
  withIntents(byUrl.stub)
  locked(byUrl.stub)
  await assert.rejects(createSession({ store: byUrl.store, client: byUrl.client, browser: makeBrowser(noAuth), fetch: byUrl.stub.fetch, oauth, now: () => 5000 }).login({ input: 'https://x.test/users/alice' }), (e) => e.step === 'fetch-object' && e.status === 401)
  assert.deepEqual([...await none.store.getAccounts(), ...await byUrl.store.getAccounts()], [])
})
