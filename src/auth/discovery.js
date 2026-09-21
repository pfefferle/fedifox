import { FedifoxError } from '../errors.js'

const originOf = (url) => new URL(url).origin
const hostOf = (url) => new URL(url).host

export async function fetchServerMetadata (origin, { fetch = globalThis.fetch } = {}) {
  const url = `${origin}/.well-known/oauth-authorization-server`
  let res
  try { res = await fetch(url, { headers: { Accept: 'application/json' } }) } catch { return null }
  if (!res.ok) return null
  try {
    const doc = await res.json()
    return doc && doc.authorization_endpoint && doc.token_endpoint ? doc : null
  } catch { return null }
}

// ActivityPub §4.1 actor endpoints come first; RFC 8414 fills in optional
// fields (registration, revocation) or serves as the fallback.
export async function discoverEndpoints (actor, { fetch = globalThis.fetch } = {}) {
  const ep = actor.endpoints || {}
  if (ep.oauthAuthorizationEndpoint && ep.oauthTokenEndpoint) {
    const origin = originOf(ep.oauthTokenEndpoint)
    const extra = (await fetchServerMetadata(origin, { fetch })) || {}
    return {
      ...extra,
      issuer: extra.issuer || origin,
      authorization_endpoint: ep.oauthAuthorizationEndpoint,
      token_endpoint: ep.oauthTokenEndpoint
    }
  }
  const origin = originOf(actor.id)
  const meta = await fetchServerMetadata(origin, { fetch })
  if (meta) return meta
  const viaChallenge = await discoverFromChallenge(actor, { fetch })
  if (viaChallenge) return viaChallenge
  throw new FedifoxError(`${hostOf(actor.id)} does not advertise an OAuth endpoint`, {
    step: 'discover-endpoints',
    detail: `no endpoints.oauthAuthorizationEndpoint on ${actor.id}; ${origin}/.well-known/oauth-authorization-server unavailable`
  })
}

// RFC 9728: an unauthenticated request to a protected resource may point at
// the resource metadata document, which names the authorization server.
async function discoverFromChallenge (actor, { fetch }) {
  if (!actor.outbox) return null
  let res
  try { res = await fetch(actor.outbox, { headers: { Accept: 'application/activity+json' } }) } catch { return null }
  if (res.status !== 401) return null
  const url = parseResourceMetadataUrl(res.headers.get('www-authenticate'))
  if (!url) return null
  // The server advertised RFC 9728; a broken document is a diagnosable error, not a fall-through.
  return discoverFromResourceMetadata(url, { fetch })
}

export function parseResourceMetadataUrl (wwwAuthenticate) {
  if (!wwwAuthenticate) return null
  const m = /resource_metadata="([^"]+)"/.exec(wwwAuthenticate)
  return m ? m[1] : null
}

export async function discoverFromResourceMetadata (url, { fetch = globalThis.fetch } = {}) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new FedifoxError(`${hostOf(url)} resource metadata unavailable`, { step: 'discover-endpoints', status: res.status })
  const doc = await res.json()
  const as = (doc.authorization_servers || [])[0]
  if (!as) throw new FedifoxError(`${hostOf(url)} lists no authorization server`, { step: 'discover-endpoints', detail: JSON.stringify(doc) })
  const meta = await fetchServerMetadata(originOf(as), { fetch })
  if (!meta) throw new FedifoxError(`${hostOf(as)} has no OAuth server metadata`, { step: 'discover-endpoints' })
  return meta
}
