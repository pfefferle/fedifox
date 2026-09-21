import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLinkHeader, headerCandidates, classify, createResolver, resolveAuthor } from '../src/discovery/resolver.js'
import { createClient } from '../src/client/activitypub.js'
import { createStore } from '../src/state/storage.js'
import { createStorageArea } from './helpers/storage-stub.js'
import { createFetchStub } from './helpers/fetch-stub.js'

const note = { id: 'https://y.test/posts/1', type: 'Note', content: 'hi', url: 'https://y.test/@bob/1', attributedTo: 'https://y.test/users/bob', to: ['https://www.w3.org/ns/activitystreams#Public'], cc: ['https://y.test/users/bob/followers'] }
const bob = { id: 'https://y.test/users/bob', type: 'Person', preferredUsername: 'bob', name: 'Bob', url: 'https://y.test/@bob' }

test('parseLinkHeader and headerCandidates', () => {
  const value = '</posts/1>; rel="alternate"; type="application/activity+json", <https://y.test/feed>; rel=alternate; type="application/rss+xml", <https://y.test/x>; rel="me"'
  assert.deepEqual(parseLinkHeader(value), [
    { href: '/posts/1', rel: 'alternate', type: 'application/activity+json' },
    { href: 'https://y.test/feed', rel: 'alternate', type: 'application/rss+xml' },
    { href: 'https://y.test/x', rel: 'me', type: undefined }
  ])
  assert.deepEqual(headerCandidates(value, 'https://y.test/page'), ['https://y.test/posts/1'])
  assert.deepEqual(parseLinkHeader(''), [])
})

test('classify actors and objects', () => {
  assert.deepEqual(classify(bob, 'https://y.test/@bob'), { id: bob.id, kind: 'actor', type: 'Person', name: 'Bob', summary: undefined, handle: 'bob@y.test', url: 'https://y.test/@bob', attributedTo: undefined, audience: { to: [], cc: [] } })
  assert.deepEqual(classify(note, 'https://y.test/page'), { id: note.id, kind: 'object', type: 'Note', name: undefined, summary: undefined, handle: undefined, url: 'https://y.test/@bob/1', attributedTo: { id: bob.id }, audience: { to: note.to, cc: note.cc } })
  assert.equal(classify({ ...note, url: [{ type: 'Link', href: 'https://y.test/alt' }], attributedTo: bob }, 'p').attributedTo.handle, 'bob@y.test')
  assert.equal(classify({ ...note, url: undefined, to: 'https://z.test/a' }, 'https://y.test/page').url, 'https://y.test/page')
  assert.deepEqual(classify({ ...note, to: 'https://z.test/a', cc: undefined }, 'p').audience, { to: ['https://z.test/a'], cc: [] })
  assert.throws(() => classify({ type: 'Note' }, 'p'), (e) => e.step === 'classify')
})

test('resolveAuthor fills name and handle', async () => {
  const { fetch } = createFetchStub({ 'GET https://y.test/users/bob': { body: bob } })
  const client = createClient({ fetch })
  const resource = await resolveAuthor(classify(note, 'p'), { client })
  assert.deepEqual(resource.attributedTo, { id: bob.id, name: 'Bob', handle: 'bob@y.test' })
})

test('resolver: HTML candidate wins, result cached', async () => {
  const stub = createFetchStub({ 'GET https://y.test/posts/1': { body: note }, 'GET https://y.test/users/bob': { body: bob } })
  const client = createClient({ fetch: stub.fetch })
  const store = createStore(createStorageArea())
  const resolver = createResolver({ client, store, now: () => 1 })
  const resource = await resolver.resolve({ pageUrl: 'https://y.test/page', objectCandidates: ['https://y.test/posts/1'], headerLinks: [] })
  assert.equal(resource.id, note.id)
  assert.equal(resource.attributedTo.handle, 'bob@y.test')
  const again = await resolver.resolve({ pageUrl: 'https://y.test/page', objectCandidates: ['https://y.test/posts/1'] })
  assert.deepEqual(again, resource)
  assert.equal(stub.calls.length, 2)
})

test('resolver: falls through failing candidates to header then conneg', async () => {
  const stub = createFetchStub({
    'GET https://y.test/broken': { status: 500, body: '' },
    'GET https://y.test/page': { body: { id: 'https://y.test/page', type: 'Article', attributedTo: bob } }
  })
  const client = createClient({ fetch: stub.fetch })
  const store = createStore(createStorageArea())
  const resolver = createResolver({ client, store, now: () => 1 })
  const resource = await resolver.resolve({ pageUrl: 'https://y.test/page', objectCandidates: ['https://y.test/broken'], headerLinks: [] })
  assert.equal(resource.type, 'Article')
})

test('resolver: rel=me only accepted when it is an actor; null cached otherwise', async () => {
  const stub = createFetchStub({
    'GET https://y.test/page': { status: 200, body: '<html>', headers: { 'content-type': 'text/html' } },
    'GET https://y.test/@bob': { body: bob },
    'GET https://y.test/nothing': { status: 404, body: '' }
  })
  const client = createClient({ fetch: stub.fetch })
  const store = createStore(createStorageArea())
  const resolver = createResolver({ client, store, now: () => 1 })
  const resource = await resolver.resolve({ pageUrl: 'https://y.test/page', actorCandidates: ['https://y.test/nothing', 'https://y.test/@bob'] })
  assert.equal(resource.kind, 'actor')
  const none = await resolver.resolve({ pageUrl: 'https://y.test/other', headerLinks: [] })
  assert.equal(none, null)
})
