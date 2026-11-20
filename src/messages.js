import { describeError, FedifoxError } from './errors.js'
import { headerCandidates } from './discovery/resolver.js'
import { isApMediaType } from './constants.js'
import { parseLink } from './link.js'
import { hostOf } from './url.js'

export const ICON_FOUND = 'icons/symbol-color.svg'
export const ICON_NONE = 'icons/symbol.svg'

export function createRouter ({ store, session, resolver, actions, client, browser, now = () => Date.now() }) {
  // Per-tab state lives in memory only; Firefox suspends the event page after
  // ~30 s idle and restarts it with empty maps, so every read falls back to
  // the discovery cache keyed by the tab's URL, and failing that asks the
  // content script to run discovery again.
  const tabResources = new Map()
  const tabHeaderLinks = new Map()
  const tabIsApDocument = new Map()
  const tabGeneration = new Map()

  const generation = (tabId) => tabGeneration.get(tabId) || 0
  const bumpGeneration = (tabId) => tabGeneration.set(tabId, generation(tabId) + 1)

  // Two indicators: the toolbar symbol turns coloured, and a page action
  // appears in the address bar, when the page has an ActivityPub object.
  async function setIcon (tabId, resource) {
    try {
      await browser.action.setIcon({ tabId, path: resource ? ICON_FOUND : ICON_NONE })
      if (!browser.pageAction) console.warn('fedifox: pageAction API unavailable')
      else if (resource) await browser.pageAction.show(tabId)
      else await browser.pageAction.hide(tabId)
    } catch (e) {
      console.warn('fedifox: could not update icons for tab', tabId, e?.message)
    }
  }

  async function requireAccount () {
    const account = await store.getSelectedAccount()
    if (!account) throw new FedifoxError('Log in to a fediverse account first', { step: 'account' })
    if (account.needsReauth) throw new FedifoxError(`Session for ${account.handle} expired — log in again`, { step: 'account' })
    return account
  }

  async function resourceFor (tabId) {
    if (tabId == null) return null
    if (tabResources.has(tabId)) return tabResources.get(tabId)
    let tab
    try { tab = await browser.tabs.get(tabId) } catch { return null }
    if (!tab?.url) return null
    const cached = await store.getDiscovery(tab.url, now())
    if (cached !== undefined) {
      tabResources.set(tabId, cached)
      return cached
    }
    try { await browser.tabs.sendMessage(tabId, { type: 'page:rediscover' }) } catch { /* no content script on this tab */ }
    return null
  }

  async function requireResource (tabId) {
    const resource = await resourceFor(tabId)
    if (!resource) throw new FedifoxError('No ActivityPub object found on this page', { step: 'discover' })
    return resource
  }

  // A fediverse link is resolved on its own, keyed by the link itself in the
  // discovery cache, so it never replaces what a tab's page was discovered as.
  async function linkResource (link, { fresh = false } = {}) {
    const { url, handle, action } = parseLink(link)
    let resource = fresh ? undefined : await store.getDiscovery(link, now())
    if (resource === undefined) {
      const target = url || await client.webfinger(handle)
      const account = (await store.getSelectedAccount()) || undefined
      resource = await resolver.resolve({ pageUrl: link, objectCandidates: [target], account, fresh: true })
    }
    if (!resource) throw new FedifoxError(`${hostOf(url || `https://${handle.split('@')[1]}`)} has no ActivityPub object at this address`, { step: 'link', detail: url || handle })
    return { resource, action }
  }

  // The popup acts on the link it was opened for, otherwise on its tab's page.
  const resourceOf = async (msg) => msg.link ? (await linkResource(msg.link)).resource : requireResource(msg.tabId)

  function requireAuthor (resource) {
    const author = resource.attributedTo
    if (!author?.id) throw new FedifoxError('This object has no author to act on', { step: 'action' })
    return author
  }

  const runners = {
    like: (a, r) => actions.like(a, r),
    undoLike: (a, r) => actions.undoLike(a, r),
    share: (a, r) => actions.share(a, r),
    undoShare: (a, r) => actions.undoShare(a, r),
    follow: (a, r) => actions.follow(a, r.id),
    undoFollow: (a, r) => actions.undoFollow(a, r.id),
    followAuthor: (a, r) => actions.follow(a, requireAuthor(r).id),
    undoFollowAuthor: (a, r) => actions.undoFollow(a, requireAuthor(r).id),
    reply: (a, r, text) => actions.reply(a, r, text),
    mention: (a, r, text) => actions.mention(a, r.kind === 'actor' ? { id: r.id, handle: r.handle } : requireAuthor(r), text)
  }

  const handlers = {
    async 'page:discovered' (msg, sender) {
      const tabId = sender?.tab?.id
      const account = (await store.getSelectedAccount()) || undefined
      const gen = generation(tabId)
      const resource = await resolver.resolve({
        pageUrl: msg.url,
        objectCandidates: msg.objectCandidates || [],
        actorCandidates: msg.actorCandidates || [],
        headerLinks: tabHeaderLinks.get(tabId) || [],
        account,
        fresh: true
      })
      console.debug('fedifox: discovered', msg.url, resource ? `${resource.kind} ${resource.id}` : 'nothing', { tabId, stale: generation(tabId) !== gen })
      if (tabId != null && generation(tabId) === gen) {
        tabResources.set(tabId, resource)
        await setIcon(tabId, resource)
      }
      return { ok: true }
    },
    // The popup was opened for a fediverse link and asks what it leads to.
    async 'link:open' (msg) { return linkResource(msg.link, { fresh: true }) },
    // Clicks on fediverse links are only taken over while an account can act
    // on them; the content script asks, because it has to decide synchronously
    // when the click happens.
    async 'link:hooked' () { return { hooked: await requireAccount().then(() => true, () => false) } },
    // A clicked link: open the toolbar popup over the page, with the link
    // attached for this one opening. Firefox before 149 only opens the popup
    // on a user gesture; there the tab goes to the popup as a page instead.
    async 'link:clicked' (msg, sender) {
      await requireAccount()
      parseLink(msg.link)
      const tabId = sender.tab.id
      const popup = `${browser.runtime.getURL('src/popup/popup.html')}?link=${encodeURIComponent(msg.link)}`
      try {
        await browser.action.setPopup({ tabId, popup })
        await browser.action.openPopup({ windowId: sender.tab.windowId })
      } catch (e) {
        console.debug('fedifox: could not open the popup', e?.message)
        await browser.tabs.update(tabId, { url: popup })
      } finally {
        await browser.action.setPopup({ tabId, popup: null })
      }
      return { ok: true }
    },
    async 'tab:resource' (msg) { return { resource: (await resourceFor(msg.tabId)) || null } },
    async 'accounts:list' () { return { accounts: await store.getAccounts(), selectedActorId: await store.getSelectedActorId() } },
    async 'accounts:select' (msg) { await store.setSelectedActorId(msg.actorId); return { ok: true } },
    async 'auth:login' (msg) { return { account: await session.login({ input: msg.input, manual: msg.manual }) } },
    async 'auth:logout' (msg) { await session.logout(msg.actorId); return { ok: true } },
    async 'action:state' (msg) {
      const account = await requireAccount()
      const resource = await resourceOf(msg)
      return { state: await actions.state(account, resource) }
    },
    async 'action:run' (msg) {
      const account = await requireAccount()
      const resource = await resourceOf(msg)
      const run = runners[msg.name]
      if (!run) throw new FedifoxError(`Unknown action ${msg.name}`, { step: 'action' })
      const { activityId } = await run(account, resource, msg.text || '')
      return { activityId, state: await actions.state(account, resource) }
    }
  }

  async function handle (message, sender) {
    try {
      const handler = handlers[message?.type]
      if (!handler) throw new FedifoxError(`Unknown message type ${message?.type}`, { step: 'router' })
      return await handler(message, sender)
    } catch (e) {
      console.warn('fedifox:', message?.type, describeError(e))
      return { error: describeError(e) }
    }
  }

  return {
    handle,
    recordHeaderLinks (tabId, linkHeaderValue, baseUrl) {
      tabHeaderLinks.set(tabId, headerCandidates(linkHeaderValue, baseUrl))
    },
    recordContentType (tabId, contentType) {
      tabIsApDocument.set(tabId, isApMediaType(contentType))
    },
    // A raw ActivityPub document opens in Firefox's JSON viewer, where no
    // content script runs; resolve its URL here once the navigation completed.
    async pageLoaded (tabId, url) {
      if (!tabIsApDocument.get(tabId)) return
      await handle({ type: 'page:discovered', url }, { tab: { id: tabId } })
    },
    clearResource (tabId) {
      tabResources.delete(tabId)
      bumpGeneration(tabId)
    },
    forgetTab (tabId) {
      tabResources.delete(tabId)
      tabHeaderLinks.delete(tabId)
      tabIsApDocument.delete(tabId)
      bumpGeneration(tabId)
    },
    // A history.pushState navigation: no new document, no new response, so
    // everything known about the tab is stale and the content script has to
    // look again at the new URL.
    async tabNavigated (tabId) {
      tabResources.delete(tabId)
      tabHeaderLinks.delete(tabId)
      tabIsApDocument.delete(tabId)
      bumpGeneration(tabId)
      await setIcon(tabId, null)
      try { await browser.tabs.sendMessage(tabId, { type: 'page:rediscover' }) } catch { /* no content script on this tab */ }
    },
    hasResource: async (tabId) => Boolean(await resourceFor(tabId))
  }
}
