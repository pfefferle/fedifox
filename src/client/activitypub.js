import { AP_ACCEPT, AP_CONTENT_TYPE, COLLECTION_PAGE_LIMIT, isApMediaType } from '../constants.js'
import { FedifoxError } from '../errors.js'
import { hostOf, originOf } from '../url.js'

// The bearer token is only ever sent to the account's own server: its proxy,
// its outbox, or any URL on the actor's origin (own collections). Everything
// else — foreign objects, actors, page URLs — is fetched unauthenticated so a
// crafted page can never make fedifox hand its token to a third party.
export function bearerAllowed (account, url) {
  if (!account) return false
  if (url === account.proxyUrl || url === account.outbox) return true
  const origin = originOf(url)
  return origin !== null && origin === originOf(account.actorId)
}

function itemId (item) {
  if (typeof item === 'string') return item
  if (!item || typeof item !== 'object') return null
  if (item.object && (item.type === 'Like' || item.type === 'Announce' || item.type === 'Follow')) return itemId(item.object)
  return item.id || null
}

export function createClient ({ fetch = globalThis.fetch, getAccessToken = async (account) => account.accessToken } = {}) {
  async function authHeaders (account, url) {
    if (!bearerAllowed(account, url)) return {}
    return { Authorization: `Bearer ${await getAccessToken(account)}` }
  }

  async function request (url, init, step) {
    try {
      return await fetch(url, init)
    } catch (cause) {
      throw new FedifoxError(`Could not reach ${hostOf(url)}`, { step, status: undefined, detail: cause?.message, cause })
    }
  }

  async function readJson (res, step, url) {
    const contentType = res.headers.get('content-type')
    if (!res.ok) {
      throw new FedifoxError(`${hostOf(url)} answered ${res.status}`, { step, status: res.status, detail: `${url} -> ${res.status}` })
    }
    if (step !== 'webfinger' && !isApMediaType(contentType)) {
      throw new FedifoxError(`${hostOf(url)} did not return an ActivityPub document`, { step, status: res.status, detail: `content-type: ${contentType}` })
    }
    try { return await res.json() } catch (cause) {
      throw new FedifoxError(`${hostOf(url)} returned invalid JSON`, { step, status: res.status, detail: String(cause), cause })
    }
  }

  async function fetchObject (url, { account } = {}) {
    const step = 'fetch-object'
    let res
    if (account?.proxyUrl) {
      res = await request(account.proxyUrl, {
        method: 'POST',
        headers: { Accept: AP_ACCEPT, 'Content-Type': 'application/x-www-form-urlencoded', ...(await authHeaders(account, account.proxyUrl)) },
        body: new URLSearchParams({ id: url }).toString()
      }, step)
    } else {
      res = await request(url, { headers: { Accept: AP_ACCEPT, ...(await authHeaders(account, url)) } }, step)
    }
    return readJson(res, step, url)
  }

  async function postActivity (account, activity) {
    const res = await request(account.outbox, {
      method: 'POST',
      headers: { 'Content-Type': AP_CONTENT_TYPE, Accept: AP_ACCEPT, ...(await authHeaders(account, account.outbox)) },
      body: JSON.stringify(activity)
    }, 'post-activity')
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new FedifoxError(`${hostOf(account.outbox)} rejected the ${activity.type} (${res.status})`, { step: 'post-activity', status: res.status, detail })
    }
    let activityId = res.headers.get('location')
    if (!activityId) {
      const text = await res.text().catch(() => '')
      try { activityId = JSON.parse(text).id || null } catch { activityId = null }
    }
    return { activityId, status: res.status }
  }

  async function walkCollection (url, { account, limit = COLLECTION_PAGE_LIMIT } = {}) {
    const items = []
    let page = await fetchObject(url, { account })
    let pages = 0
    let next = page.first
    const collect = (p) => { for (const it of p.orderedItems || p.items || []) { const id = itemId(it); if (id) items.push(id) } }
    if (!next) { collect(page); return { items, complete: true } }
    while (next && pages < limit) {
      page = typeof next === 'string' ? await fetchObject(next, { account }) : next
      collect(page)
      pages++
      next = page.next
    }
    return { items, complete: !next }
  }

  async function containsId (url, id, opts) {
    const { items, complete } = await walkCollection(url, opts)
    return { found: items.includes(id), complete }
  }

  async function webfinger (handle) {
    const clean = handle.trim().replace(/^@/, '')
    const [user, domain] = clean.split('@')
    if (!user || !domain) throw new FedifoxError(`"${handle}" is not a user@domain handle`, { step: 'webfinger' })
    const url = `https://${domain}/.well-known/webfinger?resource=${encodeURIComponent(`acct:${clean}`)}`
    const res = await request(url, { headers: { Accept: 'application/jrd+json, application/json' } }, 'webfinger')
    const jrd = await readJson(res, 'webfinger', url)
    const link = (jrd.links || []).find((l) => l.rel === 'self' && isApMediaType(l.type))
    if (!link?.href) throw new FedifoxError(`${domain} has no ActivityPub actor for ${clean}`, { step: 'webfinger', detail: JSON.stringify(jrd.links || []) })
    return link.href
  }

  return { fetchObject, postActivity, walkCollection, containsId, webfinger }
}
