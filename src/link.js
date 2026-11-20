import { FedifoxError } from './errors.js'

// What a link may ask for, by ActivityStreams activity name. A link is
// written by a third party, so everything else (block, delete, flag, move,
// undo, …) is dropped and the link only opens its target.
const ACTIONS = { follow: 'follow', like: 'like', announce: 'share', create: 'reply' }
const actionOf = (activity) => ACTIONS[String(activity || '').toLowerCase()]

const invalid = (link) => new FedifoxError('This link does not lead to a fediverse address', { step: 'link', detail: String(link).slice(0, 200) })

// An address is either a web URL or an acct: URI that WebFinger resolves.
function address (value, link) {
  const acct = /^acct:(.+)$/i.exec(value)
  if (acct) {
    if (!/^[^@]+@[^@]+$/.test(acct[1])) throw invalid(link)
    return { url: undefined, handle: acct[1] }
  }
  let url
  try { url = new URL(value) } catch { throw invalid(link) }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw invalid(link)
  // Credentials in a link are never sent anywhere (FEP-07d7).
  url.username = ''
  url.password = ''
  return { url: url.toString(), handle: undefined }
}

// The scheme stands in for https; a link that kept the https:// is tolerated.
const asHttps = (rest) => /^https?:\/\//i.test(rest) ? rest : `https://${rest.replace(/^\/+/, '')}`

const decoded = (value) => {
  try { return decodeURIComponent(value) } catch { return value }
}

// One scheme per action: the rest of the link is the address, percent-encoded
// or not.
const actionScheme = (action) => (rest, link) => ({ ...address(/^(https?|acct):/i.test(rest) ? rest : decoded(rest), link), action })

const SCHEMES = {
  // fedi-to draft: an https URL under another name.
  'web+ap': (rest, link) => {
    if (!rest.replace(/^\/+/, '')) throw invalid(link)
    return { ...address(asHttps(rest), link), action: undefined }
  },
  'web+activitypub': (rest, link) => {
    // activitypub-schema proposal: `Follow?object=…`, the activity comes first.
    // A bare word before the query is an activity, unless FEP-07d7's own
    // `intent` parameter says it is a host name.
    const activity = /^([a-z]+)\?(.*)$/is.exec(rest)
    const params = new URLSearchParams(activity?.[2] || '')
    if (activity && !params.has('intent')) {
      const action = actionOf(activity[1])
      // A reply acts on what it replies to; a new post has nothing to show.
      const object = action === 'reply' ? params.get('inReplyTo') : params.get('object')
      if (!object) throw invalid(link)
      return { ...address(object, link), action }
    }
    // FEP-07d7: `host/path?intent=follow`, the address comes first.
    const target = address(asHttps(rest), link)
    const url = new URL(target.url)
    const action = actionOf(url.searchParams.get('intent'))
    url.searchParams.delete('intent')
    return { url: url.toString(), handle: undefined, action }
  },
  'web+follow': actionScheme('follow'),
  'web+like': actionScheme('like'),
  'web+share': actionScheme('share'),
  acct: (rest, link) => ({ ...address(`acct:${rest}`, link), action: undefined }),
  // Tim Bray's draft: only the account form says where to look; a post id
  // has no defined way to become a URL.
  fedi: (rest, link) => {
    const account = /^\/\/([^@/?#]+@[^@/?#]+)\/?$/.exec(rest)
    if (!account) throw invalid(link)
    return { url: undefined, handle: account[1], action: undefined }
  }
}

// → { url, handle, action }: exactly one of url and handle is set; action is
// 'follow' | 'like' | 'share' | 'reply' or undefined.
export function parseLink (link) {
  const parts = /^([a-z+]+):(.*)$/is.exec(String(link ?? '').trim())
  const parse = parts && Object.hasOwn(SCHEMES, parts[1].toLowerCase()) && SCHEMES[parts[1].toLowerCase()]
  if (!parse) throw invalid(link)
  return parse(parts[2], link)
}
