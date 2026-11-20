import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createActions } from '../src/actions.js'
import { createClient } from '../src/client/activitypub.js'
import { createFetchStub } from './helpers/fetch-stub.js'
import { createStore } from '../src/state/storage.js'
import { createStorageArea } from './helpers/storage-stub.js'
import { AS_PUBLIC } from '../src/constants.js'

const account = { actorId: 'https://x.test/a', handle: 'a@x.test', outbox: 'https://x.test/a/outbox', liked: 'https://x.test/a/liked', following: 'https://x.test/a/following', followers: 'https://x.test/a/followers', accessToken: 't' }
const bobId = 'https://y.test/users/bob'
const note = { id: 'https://y.test/posts/1', kind: 'object', type: 'Note', url: 'https://y.test/@bob/1', attributedTo: { id: bobId, name: 'Bob', handle: 'bob@y.test' }, audience: { to: [AS_PUBLIC], cc: ['https://y.test/users/bob/followers', bobId] } }
const bob = { id: bobId, kind: 'actor', type: 'Person', name: 'Bob', url: 'https://y.test/@bob', audience: { to: [], cc: [] } }

function fakeClient ({ liked = [], following = [], complete = true, fail = false } = {}) {
  const posted = []
  let n = 0
  return {
    posted,
    async postActivity (_account, activity) {
      if (fail) { const e = new Error('rejected'); e.step = 'post-activity'; e.status = 403; throw e }
      posted.push(activity)
      return { activityId: `https://x.test/act/${++n}`, status: 201 }
    },
    async containsId (url, id) {
      if (url.endsWith('/liked')) return { found: liked.includes(id), complete }
      if (url.endsWith('/following')) return { found: following.includes(id), complete }
      throw new Error('unexpected collection')
    }
  }
}

test('state merges collections and local records', async () => {
  const store = createStore(createStorageArea())
  const actions = createActions({ client: fakeClient({ liked: [note.id], following: [bobId] }), store, now: () => 1 })
  assert.deepEqual(await actions.state(account, note), { liked: true, shared: false, following: false, followingAuthor: true, likeId: undefined, shareId: undefined, followId: undefined, followAuthorId: undefined })
  assert.equal((await actions.state(account, bob)).following, true)
  await store.saveActionRecord(account.actorId, 'Announce', note.id, 'https://x.test/act/9', 1)
  const s = await actions.state(account, note)
  assert.equal(s.shared, true)
  assert.equal(s.shareId, 'https://x.test/act/9')
})

test('state tolerates collection errors and inconclusive scans', async () => {
  const store = createStore(createStorageArea())
  const failing = { async containsId () { throw new Error('boom') } }
  assert.equal((await createActions({ client: failing, store }).state(account, note)).liked, false)
  await store.saveActionRecord(account.actorId, 'Like', note.id, 'https://x.test/act/1', 1)
  const inconclusive = fakeClient({ liked: [], complete: false })
  assert.equal((await createActions({ client: inconclusive, store }).state(account, note)).liked, true)
})

test('like → record → undo like → record removed, with addressing', async () => {
  const store = createStore(createStorageArea())
  const client = fakeClient()
  const actions = createActions({ client, store, now: () => 1 })
  assert.deepEqual(await actions.like(account, note), { activityId: 'https://x.test/act/1' })
  assert.deepEqual(client.posted[0], { '@context': 'https://www.w3.org/ns/activitystreams', type: 'Like', object: note.id, to: [bobId], cc: [AS_PUBLIC] })
  assert.deepEqual(await store.getActionRecord(account.actorId, 'Like', note.id), { activityId: 'https://x.test/act/1', at: 1 })
  await actions.undoLike(account, note)
  assert.equal(client.posted[1].type, 'Undo')
  assert.equal(client.posted[1].object, 'https://x.test/act/1')
  assert.equal(await store.getActionRecord(account.actorId, 'Like', note.id), null)
  await assert.rejects(actions.undoLike(account, note), (e) => e.step === 'undo')
})

test('share addresses followers, follow addresses the actor', async () => {
  const store = createStore(createStorageArea())
  const client = fakeClient()
  const actions = createActions({ client, store })
  await actions.share(account, note)
  assert.deepEqual(client.posted[0].cc, [AS_PUBLIC, account.followers])
  await actions.follow(account, bobId)
  assert.deepEqual(client.posted[1], { '@context': 'https://www.w3.org/ns/activitystreams', type: 'Follow', object: bobId, to: [bobId] })
  await actions.undoFollow(account, bobId)
  assert.equal(client.posted[2].object, 'https://x.test/act/2')
  await actions.undoShare(account, note)
  assert.equal(client.posted[3].object, 'https://x.test/act/1')
  assert.deepEqual(client.posted[3].to, [bobId])
  assert.deepEqual(client.posted[3].cc, [AS_PUBLIC, account.followers])
})

test('a POST that returns no activity id still records the action, and undo explains why it cannot', async () => {
  const store = createStore(createStorageArea())
  const client = fakeClient()
  client.postActivity = async () => ({ activityId: null, status: 202 })
  const actions = createActions({ client, store })
  await actions.share(account, note)
  assert.equal((await actions.state(account, note)).shared, true)
  await assert.rejects(actions.undoShare(account, note), (e) => e.step === 'undo' && /did not return an id/.test(e.message))
})

// A follow made elsewhere (another client, another browser profile) is only
// known from the following collection. An Undo that embeds the Follow needs no
// activity id: servers match it on the Follow's actor and target.
test('unfollow without a recorded Follow embeds the Follow in the Undo', async () => {
  const store = createStore(createStorageArea())
  const client = fakeClient({ following: [bobId] })
  const actions = createActions({ client, store })
  assert.equal((await actions.state(account, bob)).following, true)
  assert.deepEqual(await actions.undoFollow(account, bobId), { activityId: 'https://x.test/act/1' })
  assert.deepEqual(client.posted[0], {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Undo',
    object: { type: 'Follow', actor: account.actorId, object: bobId },
    to: [bobId]
  })
})

test('unfollow embeds the Follow when the server never returned an id for it', async () => {
  const store = createStore(createStorageArea())
  const client = fakeClient()
  const post = client.postActivity
  client.postActivity = async () => ({ activityId: null, status: 202 })
  const actions = createActions({ client, store })
  await actions.follow(account, bobId)
  client.postActivity = post
  await actions.undoFollow(account, bobId)
  assert.deepEqual(client.posted[0].object, { type: 'Follow', actor: account.actorId, object: bobId })
  assert.equal(await store.getActionRecord(account.actorId, 'Follow', bobId), null)
})

// Like and Announce have no such fallback on servers, so state says whether
// an undo can be sent at all.
test('state tells whether a like or share can be undone', async () => {
  const store = createStore(createStorageArea())
  const client = fakeClient({ liked: [note.id] })
  const actions = createActions({ client, store })
  const elsewhere = await actions.state(account, note)
  assert.equal(elsewhere.liked, true)
  assert.equal(elsewhere.likeId, undefined)
  await store.saveActionRecord(account.actorId, 'Like', note.id, 'https://x.test/act/9', 1)
  assert.equal((await actions.state(account, note)).likeId, 'https://x.test/act/9')
})

test('reply inherits audience and mentions the author; mention targets the actor', async () => {
  const store = createStore(createStorageArea())
  const client = fakeClient()
  const actions = createActions({ client, store })
  await actions.reply(account, note, 'nice post')
  const create = client.posted[0]
  assert.equal(create.type, 'Create')
  assert.equal(create.object.inReplyTo, note.id)
  assert.deepEqual(create.to, [bobId])
  assert.deepEqual(create.cc, [AS_PUBLIC, 'https://y.test/users/bob/followers'])
  assert.deepEqual(create.object.tag, [{ type: 'Mention', href: bobId, name: '@bob@y.test' }])
  assert.match(create.object.content, /^<p><a href="https:\/\/y\.test\/users\/bob" class="u-url mention">@bob@y\.test<\/a> nice post<\/p>$/)

  await actions.mention(account, { id: bobId, handle: 'bob@y.test' }, 'hello')
  const m = client.posted[1]
  assert.deepEqual(m.to, [bobId])
  assert.deepEqual(m.cc, [AS_PUBLIC])
  assert.equal(m.object.inReplyTo, undefined)
})

test('failed POST writes no record', async () => {
  const store = createStore(createStorageArea())
  const actions = createActions({ client: fakeClient({ fail: true }), store })
  await assert.rejects(actions.like(account, note), (e) => e.status === 403)
  assert.equal(await store.getActionRecord(account.actorId, 'Like', note.id), null)
})

// Invariant: every activity fedifox sends names the account as its actor;
// servers like ONI do not fill it in. A new sending action must be added here.
test('every sent activity carries the account as actor', async () => {
  let n = 0
  const { fetch, calls } = createFetchStub({ [`POST ${account.outbox}`]: () => ({ status: 201, headers: { location: `https://x.test/act/${++n}` }, body: '' }) })
  const actions = createActions({ client: createClient({ fetch }), store: createStore(createStorageArea()) })
  const sends = {
    like: () => actions.like(account, note),
    undoLike: () => actions.undoLike(account, note),
    share: () => actions.share(account, note),
    undoShare: () => actions.undoShare(account, note),
    follow: () => actions.follow(account, bobId),
    undoFollow: () => actions.undoFollow(account, bobId),
    reply: () => actions.reply(account, note, 'hi'),
    mention: () => actions.mention(account, { id: bobId, handle: 'bob@y.test' }, 'hi')
  }
  const sending = Object.keys(actions).filter((k) => k !== 'state')
  assert.deepEqual(sending.sort(), Object.keys(sends).sort(), 'decide how a new action is covered here')
  for (const [name, send] of Object.entries(sends)) {
    const before = calls.length
    await send()
    const activity = JSON.parse(calls[before].body)
    assert.equal(activity.actor, account.actorId, `${name}: actor`)
  }
})
