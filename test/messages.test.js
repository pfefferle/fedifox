import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRouter } from '../src/messages.js'
import { createStore } from '../src/state/storage.js'
import { createStorageArea } from './helpers/storage-stub.js'

const account = { actorId: 'https://x.test/a', handle: 'a@x.test', outbox: 'https://x.test/a/outbox', liked: 'https://x.test/a/liked', following: 'https://x.test/a/following', followers: 'https://x.test/a/followers', accessToken: 't', needsReauth: false }
const note = { id: 'https://y.test/posts/1', kind: 'object', type: 'Note', url: 'https://y.test/@bob/1', attributedTo: { id: 'https://y.test/users/bob', handle: 'bob@y.test' }, audience: { to: [], cc: [] } }

function makeBrowser ({ tabs = {} } = {}) {
  const icons = []
  const sent = []
  return {
    icons,
    sent,
    action: { setIcon: async (o) => icons.push(o) }, pageAction: { show: async (tabId) => icons.push({ tabId, shown: true }), hide: async (tabId) => icons.push({ tabId, shown: false }) },
    tabs: {
      async get (tabId) { if (!tabs[tabId]) throw new Error(`Invalid tab ID: ${tabId}`); return { id: tabId, ...tabs[tabId] } },
      async sendMessage (tabId, msg) { sent.push([tabId, msg]); if (!tabs[tabId]) throw new Error('Could not establish connection') }
    }
  }
}

const NOW = 1_000_000

function setup ({ resource = note, store = createStore(createStorageArea()), browser = makeBrowser() } = {}) {
  const calls = []
  // Like the real resolver, the stub persists its result in the discovery cache.
  const resolver = { async resolve (args) { calls.push(['resolve', args]); await store.saveDiscovery(args.pageUrl, resource, NOW); return resource } }
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
  const router = createRouter({ store, session, resolver, actions, browser, now: () => NOW })
  return { router, store, browser, calls }
}

test('page:discovered resolves, caches per tab and switches the icon', async () => {
  const { router, browser, calls } = setup()
  const res = await router.handle({ type: 'page:discovered', url: 'https://y.test/page', objectCandidates: ['https://y.test/posts/1'], actorCandidates: [] }, { tab: { id: 7 } })
  assert.deepEqual(res, { ok: true })
  assert.equal(calls[0][1].pageUrl, 'https://y.test/page')
  assert.deepEqual(browser.icons.at(-2), { tabId: 7, path: 'icons/symbol-color.svg' })
  assert.deepEqual(browser.icons.at(-1), { tabId: 7, shown: true })
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
  assert.ok(!browser.icons.some((i) => i.tabId === 7 && (i.path === 'icons/symbol-color.svg' || i.shown === true)))
})

test('after an event-page restart the resource is restored from the discovery cache', async () => {
  const a = setup()
  await a.router.handle({ type: 'page:discovered', url: 'https://y.test/page', objectCandidates: [], actorCandidates: [] }, { tab: { id: 7 } })
  // Router B: same store, fresh in-memory maps, as after Firefox suspended the event page.
  const b = setup({ store: a.store, browser: makeBrowser({ tabs: { 7: { url: 'https://y.test/page' } } }) })
  assert.deepEqual(await b.router.handle({ type: 'tab:resource', tabId: 7 }), { resource: note })
  assert.equal(await b.router.hasResource(7), true)
  assert.deepEqual(b.browser.sent, [])
  await b.store.saveAccount(account)
  const like = await b.router.handle({ type: 'action:run', tabId: 7, name: 'like' })
  assert.equal(like.activityId, 'https://x.test/act/1')
  assert.deepEqual(b.calls.filter((c) => c[0] === 'resolve'), [])
})

test('with nothing cached the content script is asked to rediscover and null is returned', async () => {
  const browser = makeBrowser({ tabs: { 7: { url: 'https://y.test/page' } } })
  const { router, store } = setup({ browser })
  await store.saveAccount(account)
  assert.deepEqual(await router.handle({ type: 'tab:resource', tabId: 7 }), { resource: null })
  assert.deepEqual(browser.sent, [[7, { type: 'page:rediscover' }]])
  assert.equal(await router.hasResource(7), false)
  const state = await router.handle({ type: 'action:state', tabId: 7 })
  assert.match(state.error.message, /no activitypub object/i)
  // A tab that no longer exists, or one whose content script is unreachable, is not an error.
  assert.deepEqual(await router.handle({ type: 'tab:resource', tabId: 99 }), { resource: null })
  assert.equal(await router.hasResource(99), false)
})

test('a cached "no resource" verdict is not re-discovered', async () => {
  const browser = makeBrowser({ tabs: { 7: { url: 'https://y.test/page' } } })
  const { router, store } = setup({ browser })
  await store.saveDiscovery('https://y.test/page', null, NOW)
  assert.deepEqual(await router.handle({ type: 'tab:resource', tabId: 7 }), { resource: null })
  assert.deepEqual(browser.sent, [])
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

test('an in-page (pushState) navigation clears the tab and asks the content script to rediscover', async () => {
  const { router, browser, calls } = setup({ browser: makeBrowser({ tabs: { 7: { url: 'https://m.test/@alice' } } }) })
  await router.handle({ type: 'page:discovered', url: 'https://m.test/@alice/1', objectCandidates: ['https://m.test/users/alice/statuses/1'], actorCandidates: [] }, { tab: { id: 7 } })
  router.recordHeaderLinks(7, '<https://m.test/users/alice/statuses/1>; rel="alternate"; type="application/activity+json"', 'https://m.test/@alice/1')
  await router.tabNavigated(7)
  assert.deepEqual(browser.icons.at(-2), { tabId: 7, path: 'icons/symbol.svg' })
  assert.deepEqual(browser.icons.at(-1), { tabId: 7, shown: false })
  assert.deepEqual(browser.sent.at(-1), [7, { type: 'page:rediscover' }])
  // the Link header of the previous document must not leak into the new discovery
  await router.handle({ type: 'page:discovered', url: 'https://m.test/@alice', objectCandidates: [], actorCandidates: [] }, { tab: { id: 7 } })
  assert.deepEqual(calls.at(-1)[1].headerLinks, [])
  assert.equal(calls.at(-1)[1].pageUrl, 'https://m.test/@alice')
})
