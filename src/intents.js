// FEP-3b86 Activity Intents: a server lists, in WebFinger, the addresses of
// its own pages for an activity. Opening one hands the action to that server,
// where the user is logged in and confirms it.
const REL = 'https://w3id.org/fep/3b86/'
// The older way to say where an account can be followed from; its template
// names the actor `{uri}`.
const SUBSCRIBE = 'http://ostatus.org/schema/1.0/subscribe'

// Only a login gives an account the ActivityPub API; without one it can still
// have intents.
export const hasApi = (account) => Boolean(account?.accessToken)

const webUrl = (value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch { return null }
}

// → { Follow: template, … } from a WebFinger document.
export function intentTemplates (jrd) {
  const out = {}
  const links = jrd?.links || []
  // First, so that a Follow intent the server lists replaces it.
  const subscribe = links.find((l) => l?.rel === SUBSCRIBE && typeof l.template === 'string' && webUrl(l.template))
  if (subscribe) out.Follow = subscribe.template.replaceAll('{uri}', '{object}')
  for (const link of links) {
    if (typeof link?.rel !== 'string' || !link.rel.startsWith(REL)) continue
    const name = link.rel.slice(REL.length)
    if (!/^[A-Z][A-Za-z]*$/.test(name) || typeof link.template !== 'string' || !webUrl(link.template)) continue
    out[name] = link.template
  }
  return out
}

// `{name}` becomes the percent-encoded value. What is not given, and any
// other kind of expression, becomes empty (FEP-3b86). The server named in the
// template stays the one that is opened, whatever the values are.
export function intentUrl (template, params) {
  const filled = template.replace(/\{([^}]*)\}/g, (_, name) => Object.hasOwn(params, name) ? encodeURIComponent(params[name]) : '')
  const url = webUrl(filled)
  return url && url.origin === webUrl(template)?.origin ? filled : null
}

const who = (author) => author.handle ? `@${author.handle}` : author.name || 'author'

// [name, intent, label, params]; the names are those of the popup's buttons
// where there is one.
function candidates (resource) {
  if (resource.kind === 'actor') {
    return [
      ['follow', 'Follow', 'Follow', { object: resource.id }],
      resource.handle && ['mention', 'Create', 'Mention', { content: `@${resource.handle} ` }],
      ['report', 'Flag', 'Report', { object: resource.id }],
      ['block', 'Block', 'Block', { object: resource.id }],
      ['open', 'Object', 'Open', { object: resource.id }]
    ]
  }
  const author = resource.attributedTo?.id ? resource.attributedTo : null
  return [
    ['like', 'Like', 'Like', { object: resource.id }],
    ['share', 'Announce', 'Share', { object: resource.id }],
    ['reply', 'Create', 'Reply', { inReplyTo: resource.id }],
    author && ['followAuthor', 'Follow', `Follow ${who(author)}`, { object: author.id }],
    ['report', 'Flag', 'Report', { object: resource.id }],
    author && ['blockAuthor', 'Block', `Block ${who(author)}`, { object: author.id }],
    ['open', 'Object', 'Open', { object: resource.id }]
  ]
}

// → [{ name, label, href }]: what an account's server offers for a resource.
export function intentLinks (resource, intents) {
  return candidates(resource).filter(Boolean).flatMap(([name, intent, label, params]) => {
    const template = intents && Object.hasOwn(intents, intent) ? intents[intent] : null
    // A template with no place for what the action is about opens something else.
    if (typeof template !== 'string' || !Object.keys(params).every((key) => template.includes(`{${key}}`))) return []
    const href = intentUrl(template, params)
    return href ? [{ name, label, href }] : []
  })
}
