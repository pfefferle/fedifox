import { ACTOR_TYPES, isApMediaType } from '../constants.js'
import { FedifoxError } from '../errors.js'
import { hostOf, originOf } from '../url.js'

export function parseLinkHeader (value) {
  if (!value) return []
  return value.split(/,\s*(?=<)/).map((part) => {
    const m = /^<([^>]*)>\s*(.*)$/.exec(part.trim())
    if (!m) return null
    const link = { href: m[1], rel: undefined, type: undefined }
    for (const param of m[2].split(';')) {
      const [k, v] = param.split('=').map((s) => s?.trim())
      if (!k || v === undefined) continue
      const clean = v.replace(/^"|"$/g, '')
      if (k === 'rel') link.rel = clean
      if (k === 'type') link.type = clean
    }
    return link
  }).filter(Boolean)
}

export function headerCandidates (value, baseUrl) {
  return parseLinkHeader(value)
    .filter((l) => String(l.rel || '').toLowerCase().split(/\s+/).includes('alternate') && isApMediaType(l.type))
    .map((l) => { try { return new URL(l.href, baseUrl).toString() } catch { return null } })
    .filter(Boolean)
}

const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]).map((x) => (typeof x === 'string' ? x : x?.id)).filter(Boolean)
const handleOf = (obj) => (obj?.preferredUsername && originOf(obj.id)) ? `${obj.preferredUsername}@${hostOf(obj.id)}` : undefined

function author (attributedTo) {
  const first = Array.isArray(attributedTo) ? attributedTo[0] : attributedTo
  if (!first) return undefined
  if (typeof first === 'string') return { id: first }
  if (!first.id) return undefined
  const out = { id: first.id }
  if (first.name) out.name = first.name
  const handle = handleOf(first)
  if (handle) out.handle = handle
  return out
}

function htmlUrl (json, pageUrl) {
  const u = json.url
  if (typeof u === 'string') return u
  if (Array.isArray(u)) {
    const first = u.find((x) => typeof x === 'string') || u.find((x) => x?.href)
    return typeof first === 'string' ? first : first?.href || pageUrl
  }
  return u?.href || pageUrl
}

export function classify (json, pageUrl) {
  if (!json || typeof json !== 'object' || !json.id || !json.type) {
    throw new FedifoxError('Document is not an ActivityPub object', { step: 'classify', detail: JSON.stringify(json).slice(0, 200) })
  }
  const type = Array.isArray(json.type) ? json.type[0] : json.type
  const kind = ACTOR_TYPES.includes(type) ? 'actor' : 'object'
  return {
    id: json.id,
    kind,
    type,
    name: json.name || undefined,
    summary: json.summary || undefined,
    handle: kind === 'actor' ? handleOf(json) : undefined,
    url: htmlUrl(json, pageUrl),
    attributedTo: author(json.attributedTo),
    audience: { to: list(json.to), cc: list(json.cc) }
  }
}

export async function resolveAuthor (resource, { client, account }) {
  const a = resource.attributedTo
  if (!a || (a.name && a.handle)) return resource
  try {
    const actor = await client.fetchObject(a.id, { account })
    // Only the origin that owns the id may describe the author (name, handle).
    if (originOf(actor?.id) !== originOf(a.id)) return resource
    const filled = { ...a }
    if (actor.name || actor.preferredUsername) filled.name = actor.name || actor.preferredUsername
    const handle = handleOf(actor)
    if (handle) filled.handle = handle
    return { ...resource, attributedTo: filled }
  } catch {
    return resource
  }
}

// Id authority: a document is only trusted for ids on the origin it was
// fetched from. When a candidate claims an id elsewhere, the id itself is
// fetched (directly, without account or proxy) and that document is used;
// if it in turn claims a third origin the candidate is rejected.
async function fetchAuthoritative (client, url, account) {
  const json = await client.fetchObject(url, { account })
  if (typeof json?.id !== 'string' || originOf(json.id) === originOf(url)) return json
  const authoritative = await client.fetchObject(json.id)
  if (originOf(authoritative?.id) !== originOf(json.id)) {
    throw new FedifoxError(`${hostOf(json.id)} serves an object with a foreign id`, { step: 'discover', detail: `${json.id} -> ${authoritative?.id}` })
  }
  return authoritative
}

export function createResolver ({ client, store, now = () => Date.now() }) {
  async function tryCandidate (url, pageUrl, account, { actorsOnly = false } = {}) {
    try {
      const json = await fetchAuthoritative(client, url, account)
      const resource = classify(json, pageUrl)
      if (actorsOnly && resource.kind !== 'actor') return null
      return resource
    } catch {
      return null
    }
  }

  async function resolve ({ pageUrl, objectCandidates = [], actorCandidates = [], headerLinks = [], account }) {
    const cached = await store.getDiscovery(pageUrl, now())
    if (cached !== undefined) return cached

    let resource = null
    const ordered = [...objectCandidates, ...headerLinks.filter((u) => !objectCandidates.includes(u))]
    for (const url of ordered) {
      resource = await tryCandidate(url, pageUrl, account)
      if (resource) break
    }
    // The page URL is never sent to the proxy and never gets a bearer:
    // a plain conneg GET is all the fallback needs.
    if (!resource) resource = await tryCandidate(pageUrl, pageUrl, undefined)
    if (!resource) {
      for (const url of actorCandidates) {
        resource = await tryCandidate(url, pageUrl, account, { actorsOnly: true })
        if (resource) break
      }
    }
    if (resource) resource = await resolveAuthor(resource, { client, account })
    await store.saveDiscovery(pageUrl, resource, now())
    return resource
  }

  return { resolve }
}
