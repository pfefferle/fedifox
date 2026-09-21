import { isApMediaType } from '../constants.js'

const rels = (rel) => String(rel || '').toLowerCase().split(/\s+/).filter(Boolean)

function absolute (href, baseUrl) {
  if (!href) return null
  try { return new URL(href, baseUrl).toString() } catch { return null }
}

// Implements the <link rel="alternate"> mechanism from ActivityPub HTML
// Discovery; rel="me" links are only actor *hints* for the resolver.
export function extractCandidates (links, baseUrl) {
  const objectCandidates = []
  const actorCandidates = []
  for (const link of links) {
    const url = absolute(link.href, baseUrl)
    if (!url) continue
    const r = rels(link.rel)
    if (r.includes('alternate') && isApMediaType(link.type) && !objectCandidates.includes(url)) objectCandidates.push(url)
    if (r.includes('me') && !actorCandidates.includes(url)) actorCandidates.push(url)
  }
  return { objectCandidates, actorCandidates }
}
