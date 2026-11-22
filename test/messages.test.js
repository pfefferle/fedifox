import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRouter } from '../src/messages.js'
import { createStore } from '../src/state/storage.js'
import { FedifoxError } from '../src/errors.js'
import { createStorageArea } from './helpers/storage-stub.js'

const account = { actorId: 'https://x.test/a', handle: 'a@x.test', outbox: 'https://x.test/a/outbox', liked: 'https://x.test/a/liked', following: 'https://x.test/a/following', followers: 'https://x.test/a/followers', accessToken: 't', needsReauth: false }
const note = { id: 'https://y.test/posts/1', kind: 'object', type: 'Note', url: 'https://y.test/@bob/1', attributedTo: { id: 'https://y.test/users/bob', handle: 'bob@y.test' }, audience: { to: [], cc: [] } }

function makeBrowser ({ tabs = {}, openPopup = async () => {} } = {}) {
  const icons = []
  const sent = []
  const popups = []
  return {
    icons,
    sent,
    popups,
    action: {
      setIcon: async (o) => icons.push(o),
      setPopup: async (o) => { popups.push(['setPopup', o]) },
      openPopup: async (o) => { popups.push(['openPopup', o]); await openPopup(o) }
    }, pageAction: { show: async (tabId) => icons.push({ tabId, shown: true }), hide: async (tabId) => icons.push({ tabId, shown: false }) },
    runtime: { getURL: (path) => `moz-extension://fedifox/${path}` },
    tabs: {
      async update (tabId, props) { sent.push([tabId, props]) },
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
  const client = {
    async webfinger (handle) {
      calls.push(['webfinger', handle])
      if (handle !== 'bob@y.test') throw new FedifoxError('y.test has no ActivityPub actor', { step: 'webfinger' })
      return 'https://y.test/users/bob'
    }
  }
  const router = createRouter({ store, session, resolver, actions, client, browser, now: () => NOW })
  return { router, store, browser, calls }
}

test('page:discovered resolves, caches per tab and switches the icon', async () => {
  const { router, browser, calls } = setup()
  const res = await router.handle({ type: 'page:discovered', url: 'https://y.test/page', objectCandidates: ['https://y.test/posts/1'], actorCandidates: [] }, { tab: { id: 7 } })
  assert.deepEqual(res, { ok: true })
  assert.equal(calls[0][1].pageUrl, 'https://y.test/page')
  assert.equal(calls[0][1].fresh, true)
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

const POPUP = 'moz-extension://fedifox/src/popup/popup.html'

test('link:open resolves a link without touching the resource of the tab', async () => {
  const link = 'web+activitypub:y.test/posts/1?intent=like'
  const { router, calls } = setup()
  assert.deepEqual(await router.handle({ type: 'link:open', link }), { resource: note, action: 'like' })
  const [, args] = calls.find(([name]) => name === 'resolve')
  assert.deepEqual(args.objectCandidates, ['https://y.test/posts/1'])
  assert.equal(args.pageUrl, link)
  assert.equal(args.fresh, true)
  assert.equal((await router.handle({ type: 'tab:resource', tabId: 7 })).resource, null)
})

test('link:open looks a handle up with WebFinger first', async () => {
  const { router, calls } = setup()
  const res = await router.handle({ type: 'link:open', link: 'acct:bob@y.test' })
  assert.equal(res.action, undefined)
  assert.deepEqual(calls[0], ['webfinger', 'bob@y.test'])
  assert.deepEqual(calls[1][1].objectCandidates, ['https://y.test/users/bob'])
})

test('link:open reports a link that leads nowhere', async () => {
  const { router } = setup({ resource: null })
  const nothing = await router.handle({ type: 'link:open', link: 'web+ap://y.test/gone' })
  assert.equal(nothing.error.step, 'link')
  assert.match(nothing.error.message, /y\.test/)
  const unparsable = await router.handle({ type: 'link:open', link: 'web+follow:javascript:alert(1)' })
  assert.equal(unparsable.error.step, 'link')
  const unknown = await router.handle({ type: 'link:open', link: 'acct:nobody@y.test' })
  assert.equal(unknown.error.step, 'webfinger')
})

test('actions for a link act on the link target, not on the page of the tab', async () => {
  const page = { ...note, id: 'https://m.test/posts/9' }
  const link = 'web+like:https://y.test/posts/1'
  const { router, store, calls } = setup({ browser: makeBrowser({ tabs: { 7: { url: 'https://m.test/9' } } }) })
  await store.saveAccount(account)
  await store.saveDiscovery('https://m.test/9', page, NOW)
  await router.handle({ type: 'link:open', link })
  const resolved = calls.filter(([name]) => name === 'resolve').length
  assert.deepEqual((await router.handle({ type: 'action:state', tabId: 7, link })).state, { liked: false, shared: false, following: false, followingAuthor: false })
  const res = await router.handle({ type: 'action:run', tabId: 7, link, name: 'like' })
  assert.equal(res.activityId, 'https://x.test/act/1')
  assert.deepEqual(calls.find(([name]) => name === 'like'), ['like', account.actorId, note.id])
  // The link was resolved once; state and run are served from the cache.
  assert.equal(calls.filter(([name]) => name === 'resolve').length, resolved)
  // Without a link the same tab still acts on its own page.
  await router.handle({ type: 'action:run', tabId: 7, name: 'like' })
  assert.deepEqual(calls.filter(([name]) => name === 'like')[1], ['like', account.actorId, page.id])
})

test('link clicks are only taken over while an account is connected', async () => {
  const { router, store, browser } = setup()
  assert.deepEqual(await router.handle({ type: 'link:hooked' }), { hooked: false })
  const refused = await router.handle({ type: 'link:clicked', link: 'acct:bob@y.test' }, { tab: { id: 7, windowId: 1 } })
  assert.equal(refused.error.step, 'account')
  assert.deepEqual(browser.popups, [])
  await store.saveAccount({ ...account, needsReauth: true })
  assert.deepEqual(await router.handle({ type: 'link:hooked' }), { hooked: false })
  await store.saveAccount(account)
  assert.deepEqual(await router.handle({ type: 'link:hooked' }), { hooked: true })
})

test('link:clicked opens the toolbar popup with the link and leaves the page alone', async () => {
  const { router, store, browser } = setup()
  await store.saveAccount(account)
  assert.deepEqual(await router.handle({ type: 'link:clicked', link: 'acct:bob@y.test' }, { tab: { id: 7, windowId: 1 } }), { ok: true })
  // Set for this tab, opened, and put back to the default popup.
  assert.deepEqual(browser.popups, [
    ['setPopup', { tabId: 7, popup: `${POPUP}?link=acct%3Abob%40y.test` }],
    ['openPopup', { windowId: 1 }],
    ['setPopup', { tabId: 7, popup: null }]
  ])
  assert.deepEqual(browser.sent, [])
  const bad = await router.handle({ type: 'link:clicked', link: 'fedi://hashtag/fediverse' }, { tab: { id: 7, windowId: 1 } })
  assert.equal(bad.error.step, 'link')
  assert.equal(browser.popups.length, 3)
})

test('link:clicked falls back to the handler page when the popup cannot be opened', async () => {
  const { router, store, browser } = setup({ browser: makeBrowser({ openPopup: async () => { throw new Error('openPopup requires a user gesture') } }) })
  await store.saveAccount(account)
  assert.deepEqual(await router.handle({ type: 'link:clicked', link: 'acct:bob@y.test' }, { tab: { id: 7, windowId: 1 } }), { ok: true })
  assert.deepEqual(browser.sent, [[7, { url: `${POPUP}?link=acct%3Abob%40y.test` }]])
  assert.deepEqual(browser.popups.at(-1), ['setPopup', { tabId: 7, popup: null }])
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

// Raw ActivityPub documents open in Firefox's JSON viewer, which runs no
// content script; the background resolves them once the navigation completed.
test('a raw ActivityPub response is resolved by the background, other pages are left to the content script', async () => {
  const { router, browser, calls } = setup()
  const types = { 7: 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"', 8: 'application/activity+json', 9: 'text/html; charset=utf-8' }
  for (const [tabId, type] of Object.entries(types)) {
    router.recordContentType(Number(tabId), type)
    router.clearResource(Number(tabId)) // the second tabs.onUpdated "loading" fires after the headers
    await router.pageLoaded(Number(tabId), `https://y.test/raw/${tabId}`)
  }
  assert.deepEqual(calls.map(([, args]) => args.pageUrl), ['https://y.test/raw/7', 'https://y.test/raw/8'])
  assert.deepEqual(await router.handle({ type: 'tab:resource', tabId: 7 }), { resource: note })
  assert.deepEqual(browser.icons.filter((i) => i.tabId === 8).at(-1), { tabId: 8, shown: true })
  router.forgetTab(7)
  await router.pageLoaded(7, 'https://y.test/raw/7')
  assert.equal(calls.length, 2, 'a forgotten tab does not resolve again')
})

const connected = { actorId: 'https://m.test/users/a', handle: 'a@m.test', name: 'A', intents: { Like: 'https://m.test/intents/like?id={object}', Follow: 'https://m.test/authorize_interaction?uri={object}' }, needsReauth: false }

test('every message that needs the API refuses an account that only has intents', async () => {
  const { router, store, calls } = setup()
  await store.saveAccount(connected)
  await router.handle({ type: 'page:discovered', url: 'https://y.test/page', objectCandidates: ['https://y.test/posts/1'], actorCandidates: [] }, { tab: { id: 7 } })
  for (const message of [{ type: 'action:state', tabId: 7 }, ...['like', 'undoLike', 'share', 'undoShare', 'follow', 'undoFollow', 'followAuthor', 'undoFollowAuthor', 'reply', 'mention'].map((name) => ({ type: 'action:run', tabId: 7, name, text: 'hi' }))]) {
    const res = await router.handle(message)
    assert.equal(res.error?.step, 'account', message.name || message.type)
    assert.match(res.error.message, /use the links to m\.test/, message.name || message.type)
  }
  assert.deepEqual(calls.filter(([name]) => name !== 'resolve'), [])
  // Links are still taken over: the account can act on them, on its server.
  assert.deepEqual(await router.handle({ type: 'link:hooked' }), { hooked: true })
})

test('link:clicked goes straight to the server when the only account has only intents', async () => {
  const { router, store, browser } = setup()
  await store.saveAccount(connected)
  assert.deepEqual(await router.handle({ type: 'link:clicked', link: 'web+like:https://y.test/posts/1' }, { tab: { id: 7, windowId: 1 } }), { ok: true })
  assert.deepEqual(browser.sent, [[7, { url: 'https://m.test/intents/like?id=https%3A%2F%2Fy.test%2Fposts%2F1' }]])
  assert.deepEqual(browser.popups, [])
  await router.handle({ type: 'link:clicked', link: 'web+follow:https://y.test/posts/1' }, { tab: { id: 7, windowId: 1 } })
  assert.deepEqual(browser.sent.at(-1), [7, { url: 'https://m.test/authorize_interaction?uri=https%3A%2F%2Fy.test%2Fusers%2Fbob' }])
})

test('link:clicked still opens the popup when there is something to choose or nothing to open', async () => {
  const open = async (accounts, link) => {
    const { router, store, browser } = setup()
    for (const a of accounts) await store.saveAccount(a)
    await store.setSelectedActorId(accounts[0].actorId)
    assert.deepEqual(await router.handle({ type: 'link:clicked', link }, { tab: { id: 7, windowId: 1 } }), { ok: true })
    return browser
  }
  for (const [accounts, link, why] of [
    [[connected, account], 'web+like:https://y.test/posts/1', 'two accounts'],
    [[account], 'web+like:https://y.test/posts/1', 'an account with the API'],
    [[connected], 'web+ap://y.test/posts/1', 'a link without an action'],
    [[connected], 'web+share:https://y.test/posts/1', 'an action the server has no intent for']
  ]) {
    const browser = await open(accounts, link)
    assert.deepEqual(browser.sent, [], why)
    assert.deepEqual(browser.popups.map(([name]) => name), ['setPopup', 'openPopup', 'setPopup'], why)
  }
})
