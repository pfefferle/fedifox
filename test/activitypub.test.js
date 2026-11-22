import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient, bearerAllowed } from '../src/client/activitypub.js'
import { createFetchStub } from './helpers/fetch-stub.js'

const account = { actorId: 'https://x.test/a', outbox: 'https://x.test/a/outbox', liked: 'https://x.test/a/liked', accessToken: 'tok' }

test('fetchObject uses GET + Accept without proxy, no bearer for a foreign origin', async () => {
  const { fetch, calls } = createFetchStub({ 'GET https://y.test/o': { body: { id: 'https://y.test/o', type: 'Note' } } })
  let tokenReads = 0
  const client = createClient({ fetch, getAccessToken: async () => { tokenReads++; return 'tok' } })
  const obj = await client.fetchObject('https://y.test/o', { account })
  assert.equal(obj.type, 'Note')
  assert.match(calls[0].headers.get('accept'), /activity\+json/)
  assert.equal(calls[0].headers.get('authorization'), null)
  assert.equal(tokenReads, 0)
  // never the user's site cookies: a logged-in Mastodon session answers 406 to conneg
  assert.equal(calls[0].credentials, 'omit')
})

test('bearer goes to own-origin URLs (collection walk), the outbox and the proxy only', async () => {
  const { fetch, calls } = createFetchStub({
    'GET https://x.test/a/liked': { body: { type: 'OrderedCollection', first: 'https://x.test/a/liked?page=1' } },
    'GET https://x.test/a/liked?page=1': { body: { orderedItems: ['https://y.test/1'] } },
    'GET https://x.test.evil.test/o': { body: { id: 'https://x.test.evil.test/o', type: 'Note' } },
    'GET http://x.test/o': { body: { id: 'http://x.test/o', type: 'Note' } },
    'POST https://cdn.test/proxy': { body: { id: 'https://y.test/o', type: 'Note' } }
  })
  const client = createClient({ fetch })
  await client.walkCollection('https://x.test/a/liked', { account })
  assert.equal(calls[0].headers.get('authorization'), 'Bearer tok')
  assert.equal(calls[1].headers.get('authorization'), 'Bearer tok')
  await client.fetchObject('https://x.test.evil.test/o', { account })
  assert.equal(calls[2].headers.get('authorization'), null)
  await client.fetchObject('http://x.test/o', { account })
  assert.equal(calls[3].headers.get('authorization'), null, 'scheme is part of the origin')
  await client.fetchObject('https://y.test/o', { account: { ...account, proxyUrl: 'https://cdn.test/proxy' } })
  assert.equal(calls[4].url, 'https://cdn.test/proxy')
  assert.equal(calls[4].headers.get('authorization'), 'Bearer tok')
})

// The proxy answers from the server's cache of remote objects. The account's
// own collections must be read live, or an action that was just undone still
// looks done.
test('own-origin documents are read directly, not through the proxy', async () => {
  const proxied = { ...account, proxyUrl: 'https://x.test/proxy' }
  const { fetch, calls } = createFetchStub({
    'GET https://x.test/a/following': { body: { type: 'OrderedCollection', first: 'https://x.test/a/following?page=1' } },
    'GET https://x.test/a/following?page=1': { body: { type: 'OrderedCollectionPage', orderedItems: ['https://y.test/users/bob'] } },
    'POST https://x.test/proxy': { body: { id: 'https://y.test/o', type: 'Note' } }
  })
  const client = createClient({ fetch })
  assert.deepEqual(await client.containsId('https://x.test/a/following', 'https://y.test/users/bob', { account: proxied }), { found: true, complete: true })
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['GET https://x.test/a/following', 'GET https://x.test/a/following?page=1'])
  assert.ok(calls.every((c) => c.headers.get('authorization') === 'Bearer tok'))
  await client.fetchObject('https://y.test/o', { account: proxied })
  assert.equal(calls[2].url, 'https://x.test/proxy')
})

test('fetchObject goes through proxyUrl when the account has one', async () => {
  const { fetch, calls } = createFetchStub({ 'POST https://x.test/proxy': { body: { id: 'https://y.test/o', type: 'Note' } } })
  const client = createClient({ fetch })
  await client.fetchObject('https://y.test/o', { account: { ...account, proxyUrl: 'https://x.test/proxy' } })
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].headers.get('content-type'), 'application/x-www-form-urlencoded')
  assert.equal(String(calls[0].body), 'id=https%3A%2F%2Fy.test%2Fo')
})

test('fetchObject rejects non-AP content types and errors', async () => {
  const { fetch } = createFetchStub({
    'GET https://y.test/html': { body: '<html>', headers: { 'content-type': 'text/html' } },
    'GET https://y.test/404': { status: 404, body: { error: 'nope' } }
  })
  const client = createClient({ fetch })
  await assert.rejects(client.fetchObject('https://y.test/html'), (e) => e.step === 'fetch-object' && /text\/html/.test(e.detail))
  await assert.rejects(client.fetchObject('https://y.test/404'), (e) => e.status === 404)
})

test('postActivity sends JSON-LD with bearer and reads Location then body id', async () => {
  const { fetch, calls } = createFetchStub({
    'POST https://x.test/a/outbox': ({ body }) => JSON.parse(body).type === 'Like'
      ? { status: 201, headers: { location: 'https://x.test/like/1' }, body: '' }
      : { status: 201, body: { id: 'https://x.test/announce/1', type: 'Announce' } }
  })
  const client = createClient({ fetch })
  assert.deepEqual(await client.postActivity(account, { type: 'Like', object: 'o' }), { activityId: 'https://x.test/like/1', status: 201 })
  assert.deepEqual(await client.postActivity(account, { type: 'Announce', object: 'o' }), { activityId: 'https://x.test/announce/1', status: 201 })
  assert.match(calls[0].headers.get('content-type'), /ld\+json; profile=/)
  assert.equal(calls[0].headers.get('authorization'), 'Bearer tok')
})

test('postActivity throws FedifoxError on 4xx', async () => {
  const { fetch } = createFetchStub({ 'POST https://x.test/a/outbox': { status: 403, body: { error: 'scope' } } })
  const client = createClient({ fetch })
  await assert.rejects(client.postActivity(account, { type: 'Like' }), (e) => e.step === 'post-activity' && e.status === 403)
})

test('walkCollection follows first/next, normalises ids, honours limit', async () => {
  const { fetch } = createFetchStub({
    'GET https://x.test/a/liked': { body: { type: 'OrderedCollection', first: 'https://x.test/a/liked?page=1' } },
    'GET https://x.test/a/liked?page=1': { body: { orderedItems: ['https://y.test/1', { id: 'https://y.test/2' }, { type: 'Like', object: { id: 'https://y.test/3' } }], next: 'https://x.test/a/liked?page=2' } },
    'GET https://x.test/a/liked?page=2': { body: { orderedItems: ['https://y.test/4'], next: 'https://x.test/a/liked?page=3' } },
    'GET https://x.test/a/liked?page=3': { body: { items: ['https://y.test/5'] } }
  })
  const client = createClient({ fetch })
  assert.deepEqual(await client.walkCollection('https://x.test/a/liked', { account, limit: 2 }), { items: ['https://y.test/1', 'https://y.test/2', 'https://y.test/3', 'https://y.test/4'], complete: false })
  assert.deepEqual(await client.walkCollection('https://x.test/a/liked', { account, limit: 5 }), { items: ['https://y.test/1', 'https://y.test/2', 'https://y.test/3', 'https://y.test/4', 'https://y.test/5'], complete: true })
  assert.deepEqual(await client.containsId('https://x.test/a/liked', 'https://y.test/4', { account, limit: 5 }), { found: true, complete: true })
})

test('walkCollection handles inline items without first', async () => {
  const { fetch } = createFetchStub({ 'GET https://x.test/a/following': { body: { type: 'Collection', items: ['https://y.test/bob'] } } })
  const client = createClient({ fetch })
  assert.deepEqual(await client.walkCollection('https://x.test/a/following', { account }), { items: ['https://y.test/bob'], complete: true })
})

test('webfinger resolves acct handle to the AP self link', async () => {
  const { fetch, calls } = createFetchStub({
    'GET https://y.test/.well-known/webfinger?resource=acct%3Abob%40y.test': { body: { subject: 'acct:bob@y.test', links: [{ rel: 'http://webfinger.net/rel/profile-page', type: 'text/html', href: 'https://y.test/@bob' }, { rel: 'self', type: 'application/activity+json', href: 'https://y.test/users/bob' }] }, headers: { 'content-type': 'application/jrd+json' } }
  })
  const client = createClient({ fetch })
  assert.equal(await client.webfinger('@bob@y.test'), 'https://y.test/users/bob')
  assert.equal(calls[0].headers.get('accept'), 'application/jrd+json, application/json')
})

test('webfinger errors are FedifoxErrors', async () => {
  const { fetch } = createFetchStub({ 'GET https://y.test/.well-known/webfinger?resource=acct%3Anobody%40y.test': { status: 404, body: '' } })
  const client = createClient({ fetch })
  await assert.rejects(client.webfinger('nobody@y.test'), (e) => e.step === 'webfinger' && e.status === 404)
  await assert.rejects(client.webfinger('not-a-handle'), (e) => e.step === 'webfinger')
})

test('webfinger accepts an acct: URI', async () => {
  const { fetch } = createFetchStub({
    'GET https://y.test/.well-known/webfinger?resource=acct%3Abob%40y.test': { body: { links: [{ rel: 'self', type: 'application/activity+json', href: 'https://y.test/users/bob' }] }, headers: { 'content-type': 'application/jrd+json' } }
  })
  const client = createClient({ fetch })
  assert.equal(await client.webfinger('acct:bob@y.test'), 'https://y.test/users/bob')
  assert.equal(await client.webfinger('ACCT:bob@y.test'), 'https://y.test/users/bob')
})

// The handle can come from a link in a web page, so the lookup must stay a
// WebFinger request to a host and its answer must be a web address.
test('webfinger only requests the well-known path of a host', async () => {
  const { fetch, calls } = createFetchStub({})
  const client = createClient({ fetch })
  for (const handle of ['bob@y.test/admin?x=', 'bob@y.test?x=', 'bob@y.test#', 'bob@y.test\\@z.test']) {
    await assert.rejects(client.webfinger(handle), (e) => e.step === 'webfinger', handle)
  }
  assert.equal(calls.length, 0)
})

test('webfinger rejects an actor link that is not a web URL', async () => {
  for (const href of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'moz-extension://x/y', '//y.test/users/bob', '/users/bob']) {
    const { fetch } = createFetchStub({
      'GET https://y.test/.well-known/webfinger?resource=acct%3Abob%40y.test': { body: { links: [{ rel: 'self', type: 'application/activity+json', href }] }, headers: { 'content-type': 'application/jrd+json' } }
    })
    const client = createClient({ fetch })
    await assert.rejects(client.webfinger('bob@y.test'), (e) => e.step === 'webfinger' && /no ActivityPub actor/.test(e.message), href)
  }
})

test('network failures become FedifoxErrors naming the host', async () => {
  const fetch = async () => { throw new TypeError('NetworkError when attempting to fetch resource.') }
  const client = createClient({ fetch })
  await assert.rejects(client.fetchObject('https://down.test/o'), (e) => e.name === 'FedifoxError' && e.step === 'fetch-object' && /down\.test/.test(e.message))
  await assert.rejects(client.postActivity(account, { type: 'Like' }), (e) => e.name === 'FedifoxError' && e.step === 'post-activity' && /x\.test/.test(e.message))
  await assert.rejects(client.webfinger('bob@down.test'), (e) => e.name === 'FedifoxError' && e.step === 'webfinger')
})

test('a 401 on a bearer request triggers one forced refresh and a retry', async () => {
  let attempts = 0
  const { fetch, calls } = createFetchStub({
    'GET https://x.test/a/liked': ({ headers }) => headers.get('authorization') === 'Bearer at-2' ? { body: { type: 'Collection', items: [] } } : { status: 401, body: '' },
    'POST https://x.test/a/outbox': ({ headers }) => headers.get('authorization') === 'Bearer at-2' ? { status: 201, headers: { location: 'https://x.test/like/1' }, body: '' } : { status: 401, body: '' }
  })
  const refreshed = []
  const client = createClient({ fetch, getAccessToken: async () => 'at-1', onUnauthorized: async (acc) => { attempts++; refreshed.push(acc.actorId); return 'at-2' } })
  assert.deepEqual(await client.walkCollection('https://x.test/a/liked', { account }), { items: [], complete: true })
  assert.equal(calls.length, 2)
  assert.equal(calls[1].headers.get('authorization'), 'Bearer at-2')
  assert.deepEqual(refreshed, [account.actorId])
  assert.deepEqual(await client.postActivity(account, { type: 'Like', object: 'o' }), { activityId: 'https://x.test/like/1', status: 201 })
  assert.equal(calls[3].headers.get('authorization'), 'Bearer at-2')
  assert.equal(String(calls[3].body), String(calls[2].body))
  assert.equal(attempts, 2)
})

test('a second 401 after the refresh is a FedifoxError with status 401; no refresh without a token or a handler', async () => {
  const { fetch, calls } = createFetchStub({
    'GET https://x.test/a/liked': { status: 401, body: '' },
    'GET https://y.test/o': { status: 401, body: '' }
  })
  let attempts = 0
  const client = createClient({ fetch, onUnauthorized: async () => { attempts++; return 'at-2' } })
  await assert.rejects(client.fetchObject('https://x.test/a/liked', { account }), (e) => e.name === 'FedifoxError' && e.status === 401)
  assert.equal(attempts, 1)
  assert.equal(calls.length, 2)
  // Foreign origin: no bearer was sent, so a 401 there is not ours to fix.
  await assert.rejects(client.fetchObject('https://y.test/o', { account }), (e) => e.status === 401)
  assert.equal(attempts, 1)
  // Refresh yields nothing (no refresh token): the 401 stands, no retry.
  const none = createClient({ fetch, onUnauthorized: async () => null })
  await assert.rejects(none.fetchObject('https://x.test/a/liked', { account }), (e) => e.status === 401)
  assert.equal(calls.length, 4)
  // No handler wired at all: plain 401.
  const plain = createClient({ fetch })
  await assert.rejects(plain.fetchObject('https://x.test/a/liked', { account }), (e) => e.status === 401)
  assert.equal(calls.length, 5)
})

test('webfingerAccount also returns the intents the server publishes', async () => {
  const { fetch } = createFetchStub({
    'GET https://y.test/.well-known/webfinger?resource=acct%3Abob%40y.test': { body: { links: [{ rel: 'self', type: 'application/activity+json', href: 'https://y.test/users/bob' }, { rel: 'https://w3id.org/fep/3b86/Follow', template: 'https://y.test/authorize_interaction?uri={object}' }] }, headers: { 'content-type': 'application/jrd+json' } }
  })
  const client = createClient({ fetch })
  assert.deepEqual(await client.webfingerAccount('bob@y.test'), { actorUrl: 'https://y.test/users/bob', intents: { Follow: 'https://y.test/authorize_interaction?uri={object}' } })
  assert.equal(await client.webfinger('bob@y.test'), 'https://y.test/users/bob')
})

test('an account without a login never gets an Authorization header', async () => {
  const connected = { actorId: 'https://x.test/a', handle: 'a@x.test', intents: { Like: 'https://x.test/intents/like?id={object}' } }
  assert.equal(bearerAllowed(connected, 'https://x.test/a/liked'), false)
  const { fetch, calls } = createFetchStub({ 'GET https://x.test/a/liked': { body: { type: 'OrderedCollection', orderedItems: [] } } })
  await createClient({ fetch }).fetchObject('https://x.test/a/liked', { account: connected })
  assert.equal(calls[0].headers.has('authorization'), false)
})
