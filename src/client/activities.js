import { AS2_CONTEXT } from '../constants.js'

export function escapeHtml (text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function mentionLink ({ id, handle }) {
  return `<a href="${escapeHtml(id)}" class="u-url mention">@${escapeHtml(handle)}</a>`
}

export function mentionTag ({ id, handle }) {
  return { type: 'Mention', href: id, name: `@${handle}` }
}

// Renders user text as a single <p>, linking any @handle that belongs to a
// known mention. The first mention is prepended when the user did not type it.
export function renderContent (text, mentions = []) {
  let html = escapeHtml(text.trim())
  for (const m of mentions) {
    html = html.replaceAll(`@${escapeHtml(m.handle)}`, mentionLink(m))
  }
  const first = mentions[0]
  if (first && !text.trim().startsWith(`@${first.handle}`)) {
    html = `${mentionLink(first)} ${html}`
  }
  return `<p>${html.replaceAll('\n', '<br>')}</p>`
}

function addressed (activity, { to = [], cc = [] } = {}) {
  if (to.length) activity.to = to
  if (cc.length) activity.cc = cc
  return activity
}

export function like (objectId, addressing) {
  return addressed({ '@context': AS2_CONTEXT, type: 'Like', object: objectId }, addressing)
}

export function announce (objectId, addressing) {
  return addressed({ '@context': AS2_CONTEXT, type: 'Announce', object: objectId }, addressing)
}

export function follow (actorId) {
  return addressed({ '@context': AS2_CONTEXT, type: 'Follow', object: actorId }, { to: [actorId] })
}

export function undo (activityId, addressing) {
  return addressed({ '@context': AS2_CONTEXT, type: 'Undo', object: activityId }, addressing)
}

export function createNote ({ content, inReplyTo, mentions = [], to = [], cc = [] }) {
  const note = addressed({ type: 'Note', content: renderContent(content, mentions), tag: mentions.map(mentionTag) }, { to, cc })
  if (inReplyTo) note.inReplyTo = inReplyTo
  return addressed({ '@context': AS2_CONTEXT, type: 'Create', object: note }, { to, cc })
}
