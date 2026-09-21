import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRouter } from '../src/messages.js'
import { createStore } from '../src/state/storage.js'
import { createStorageArea } from './helpers/storage-stub.js'

const account = { actorId: 'https://x.test/a', handle: 'a@x.test', outbox: 'https://x.test/a/outbox', liked: 'https://x.test/a/liked', following: 'https://x.test/a/following', followers: 'https://x.test/a/followers', accessToken: 't', needsReauth: false }
const note = { id: 'https://y.test/posts/1', kind: 'object', type: 'Note', url: 'https://y.test/@bob/1', attributedTo: { id: 'https://y.test/users/bob', handle: 'bob@y.test' }, audience: { to: [], cc: [] } }

function makeBrowser () {
  const badges = []
  return { badges, action: { setBadgeText: async (o) => badges.push(o), setBadgeBackgroundColor: async () => {} } }
}

function setup ({ resource = note } = {}) {
  const store = createStore(createStorageArea())
  const browser = makeBrowser()
  const calls = []
  const resolver = { async resolve (args) { calls.push(['resolve', args]); return resource } }
  const actions = {
    async state () { return { liked: false, shared: false, following: false, followingAuthor: false } },
    async like (acc, res) { calls.push(['like', acc.actorId, res.id]); return { activityId: 'https://x.test/act/1' } },
    async follow (acc, actorId) { calls.push(['follow', actorId]); return { activityId: 'https://x.test/act/2' } },
    async reply (acc, res, text) { calls.push(['reply', text]); return { activityId: 'https://x.test/act/3' } },
    async mention (acc, actor, text) { calls.push(['mention', actor.id, text]); return { activityId: 'https://x.test/act/4' } }
  }
  const session = {
    async login ({ input }) { calls.push(['login', input]); await store.saveAccount(account); await store.setSelectedActorId(account.actorId); return account },
    async logout (actorId) { calls.push(['logout', actorId]); await store.removeAccount(actorId) }
  }
  const router = createRouter({ store, session, resolver, actions, browser })
  return { router, store, browser, calls }
}

test('page:discovered resolves, caches per tab and sets badge', async () => {
  const { router, browser, calls } = setup()
  const res = await router.handle({ type: 'page:discovered', url: 'https://y.test/page', objectCandidates: ['https://y.test/posts/1'], actorCandidates: [] }, { tab: { id: 7 } })
  assert.deepEqual(res, { ok: true })
  assert.equal(calls[0][1].pageUrl, 'https://y.test/page')
  assert.deepEqual(browser.badges.at(-1), { text: 'AP', tabId: 7 })
  assert.deepEqual(await router.handle({ type: 'tab:resource', tabId: 7 }), { resource: note })
  assert.deepEqual(await router.handle({ type: 'tab:resource', tabId: 8 }), { resource: null })
})

test('header links are merged into discovery', async () => {
  const { router, calls } = setup()
  router.recordHeaderLinks(7, '</posts/1>; rel="alternate"; type="application/activity+json"', 'https://y.test/page')
  await router.handle({ type: 'page:discovered', url: 'https://y.test/page', objectCandidates: [], actorCandidates: [] }, { tab: { id: 7 } })
  assert.deepEqual(calls[0][1].headerLinks, ['https://y.test/posts/1'])
  router.forgetTab(7)
  assert.deepEqual(await router.handle({ type: 'tab:resource', tabId: 7 }), { resource: null })
})

test('accounts and auth messages', async () => {
  const { router, calls } = setup()
  assert.deepEqual(await router.handle({ type: 'accounts:list' }), { accounts: [], selectedActorId: null })
  const login = await router.handle({ type: 'auth:login', input: 'a@x.test' })
  assert.equal(login.account.actorId, account.actorId)
  assert.deepEqual(calls.at(-1), ['login', 'a@x.test'])
  assert.deepEqual(await router.handle({ type: 'accounts:select', actorId: account.actorId }), { ok: true })
  assert.equal((await router.handle({ type: 'accounts:list' })).selectedActorId, account.actorId)
  assert.deepEqual(await router.handle({ type: 'auth:logout', actorId: account.actorId }), { ok: true })
  assert.deepEqual(await router.handle({ type: 'accounts:list' }), { accounts: [], selectedActorId: null })
})

test('action:run dispatches with account and resource, returns fresh state', async () => {
  const { router, store, calls } = setup()
  await store.saveAccount(account)
  await router.handle({ type: 'page:discovered', url: 'https://y.test/page', objectCandidates: [], actorCandidates: [] }, { tab: { id: 7 } })
  const like = await router.handle({ type: 'action:run', tabId: 7, name: 'like' })
  assert.equal(like.activityId, 'https://x.test/act/1')
  assert.deepEqual(like.state, { liked: false, shared: false, following: false, followingAuthor: false })
  assert.deepEqual(calls.at(-1), ['like', account.actorId, note.id])
  await router.handle({ type: 'action:run', tabId: 7, name: 'followAuthor' })
  assert.deepEqual(calls.at(-1), ['follow', 'https://y.test/users/bob'])
  await router.handle({ type: 'action:run', tabId: 7, name: 'reply', text: 'hi' })
  assert.deepEqual(calls.at(-1), ['reply', 'hi'])
  await router.handle({ type: 'action:run', tabId: 7, name: 'mention', text: 'yo' })
  assert.deepEqual(calls.at(-1), ['mention', 'https://y.test/users/bob', 'yo'])
})

test('a page:discovered that resolves after the tab navigated away does not resurrect a stale resource', async () => {
  const store = createStore(createStorageArea())
  const browser = makeBrowser()
  let router
  const resolver = {
    async resolve () {
      // Simulate the tab navigating away while this resolve is still in flight.
      router.clearResource(7)
      return note
    }
  }
  const actions = {
    async state () { return { liked: false, shared: false, following: false, followingAuthor: false } }
  }
  const session = { async login () {}, async logout () {} }
  router = createRouter({ store, session, resolver, actions, browser })

  const res = await router.handle({ type: 'page:discovered', url: 'https://y.test/page', objectCandidates: [], actorCandidates: [] }, { tab: { id: 7 } })
  assert.deepEqual(res, { ok: true })
  assert.deepEqual(await router.handle({ type: 'tab:resource', tabId: 7 }), { resource: null })
  assert.ok(!browser.badges.some((b) => b.tabId === 7 && b.text === 'AP'))
})

test('errors are returned, not thrown', async () => {
  const { router } = setup()
  const noAccount = await router.handle({ type: 'action:run', tabId: 7, name: 'like' })
  assert.match(noAccount.error.message, /log in/i)
  const unknown = await router.handle({ type: 'nope' })
  assert.match(unknown.error.message, /unknown message/i)
  const badAction = await router.handle({ type: 'action:state', tabId: 99 })
  assert.match(badAction.error.message, /log in/i)
})
