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
  await assert.rejects(session.ensureFreshToken({ ...saved, expiresAt: 0 }), (e) => e.step === 'refresh-token')
  assert.equal((await store.getAccount(actor.id)).needsReauth, true)
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
