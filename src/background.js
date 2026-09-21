import * as oauth from './vendor/oauth4webapi.js'
import { createStore } from './state/storage.js'
import { createClient } from './client/activitypub.js'
import { createSession } from './auth/session.js'
import { createResolver } from './discovery/resolver.js'
import { createActions } from './actions.js'
import { createRouter } from './messages.js'

const store = createStore(browser.storage.local)
// The session uses a plain client (login has no token yet); everything else
// goes through a client that refreshes tokens transparently.
const session = createSession({ store, client: createClient(), browser, oauth })
const client = createClient({ getAccessToken: (account) => session.ensureFreshToken(account) })
const resolver = createResolver({ client, store })
const actions = createActions({ client, store })
const router = createRouter({ store, session, resolver, actions, browser })

browser.runtime.onMessage.addListener((message, sender) => router.handle(message, sender))

browser.webRequest.onHeadersReceived.addListener((details) => {
  const link = (details.responseHeaders || []).find((h) => h.name.toLowerCase() === 'link')
  if (link?.value) router.recordHeaderLinks(details.tabId, link.value, details.url)
}, { urls: ['<all_urls>'], types: ['main_frame'] }, ['responseHeaders'])

browser.tabs.onRemoved.addListener((tabId) => router.forgetTab(tabId))
browser.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    router.forgetTab(tabId)
    browser.action.setBadgeText({ text: '', tabId }).catch(() => {})
  }
})

const MENU = [
  { id: 'fedifox-like', title: 'Like on the fediverse', name: 'like' },
  { id: 'fedifox-share', title: 'Share on the fediverse', name: 'share' },
  { id: 'fedifox-copy', title: 'Copy fediverse link', name: 'copy' }
]
browser.runtime.onInstalled.addListener(() => {
  for (const item of MENU) browser.contextMenus.create({ id: item.id, title: item.title, contexts: ['page'], visible: false })
})
browser.contextMenus.onShown.addListener(async (info, tab) => {
  const visible = Boolean(tab?.id != null && router.hasResource(tab.id))
  for (const item of MENU) await browser.contextMenus.update(item.id, { visible })
  await browser.contextMenus.refresh()
})
browser.contextMenus.onClicked.addListener(async (info, tab) => {
  const item = MENU.find((m) => m.id === info.menuItemId)
  if (!item || !tab?.id) return
  if (item.name === 'copy') {
    const { resource } = await router.handle({ type: 'tab:resource', tabId: tab.id })
    if (resource) await navigator.clipboard.writeText(resource.id).catch(() => {})
    return
  }
  await router.handle({ type: 'action:run', tabId: tab.id, name: item.name })
})
