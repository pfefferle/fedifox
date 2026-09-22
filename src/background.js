import * as oauth from './vendor/oauth4webapi.js'
import { createStore } from './state/storage.js'
import { createClient } from './client/activitypub.js'
import { createSession } from './auth/session.js'
import { createResolver } from './discovery/resolver.js'
import { createActions } from './actions.js'
import { createRouter, ICON_NONE } from './messages.js'

const store = createStore(browser.storage.local)
// The session uses a plain client (login has no token yet); everything else
// goes through a client that refreshes tokens transparently.
const session = createSession({ store, client: createClient(), browser, oauth })
const client = createClient({
  getAccessToken: (account) => session.ensureFreshToken(account),
  onUnauthorized: (account) => session.forceRefresh(account)
})
const resolver = createResolver({ client, store })
const actions = createActions({ client, store })
const router = createRouter({ store, session, resolver, actions, browser })

browser.runtime.onMessage.addListener((message, sender) => router.handle(message, sender))

browser.webRequest.onHeadersReceived.addListener((details) => {
  const link = (details.responseHeaders || []).find((h) => h.name.toLowerCase() === 'link')
  router.recordHeaderLinks(details.tabId, link?.value || '', details.url)
}, { urls: ['<all_urls>'], types: ['main_frame'] }, ['responseHeaders'])

browser.tabs.onRemoved.addListener((tabId) => router.forgetTab(tabId))
browser.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    // Firefox fires this twice per navigation (before and after the response),
    // so only the tab's resolved resource is cleared here — the Link header
    // captured by onHeadersReceived (which fires in between) must survive.
    router.clearResource(tabId)
    browser.action.setIcon({ tabId, path: ICON_NONE }).catch(() => {})
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
  const visible = Boolean(tab?.id != null && await router.hasResource(tab.id))
  for (const item of MENU) await browser.contextMenus.update(item.id, { visible })
  await browser.contextMenus.refresh()
})
browser.contextMenus.onClicked.addListener(async (info, tab) => {
  const item = MENU.find((m) => m.id === info.menuItemId)
  if (!item || !tab?.id) return
  if (item.name === 'copy') {
    const { resource } = await router.handle({ type: 'tab:resource', tabId: tab.id })
    if (resource) {
      try {
        await navigator.clipboard.writeText(resource.id)
      } catch (e) {
        console.warn('fedifox:', e.message, e)
      }
    }
    return
  }
  const res = await router.handle({ type: 'action:run', tabId: tab.id, name: item.name })
  if (res.error) {
    console.warn('fedifox:', res.error.message, res.error)
    await browser.action.setTitle({ tabId: tab.id, title: `fedifox — ${res.error.message}` }).catch(() => {})
  } else {
    await browser.action.setTitle({ tabId: tab.id, title: 'fedifox' }).catch(() => {})
  }
})
