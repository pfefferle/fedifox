// Both url and id come from a remote document; only http(s) may become an href.
const httpUrl = (value) => {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:' ? value : null
  } catch { return null }
}
const safeLink = (resource) => httpUrl(resource.url) || httpUrl(resource.id)

export function resourceView (resource) {
  if (resource.kind === 'actor') {
    return { title: resource.name || resource.handle || resource.id, subtitle: resource.handle ? `@${resource.handle}` : '', kind: 'actor', link: safeLink(resource) }
  }
  const author = resource.attributedTo
  const who = author?.handle ? `@${author.handle}` : author?.name || ''
  return { title: resource.name || resource.type, subtitle: who ? `by ${who}` : '', kind: 'object', link: safeLink(resource) }
}

function toggle (on, offName, offLabel, onName, onLabel) {
  return on ? { name: onName, label: onLabel, active: true } : { name: offName, label: offLabel, active: false }
}

export function buttonsFor (resource, state) {
  if (resource.kind === 'actor') {
    return [
      toggle(state.following, 'follow', 'Follow', 'undoFollow', 'Unfollow'),
      { name: 'mention', label: 'Mention', active: false }
    ]
  }
  const buttons = [
    toggle(state.liked, 'like', 'Like', 'undoLike', 'Unlike'),
    toggle(state.shared, 'share', 'Share', 'undoShare', 'Unshare')
  ]
  const author = resource.attributedTo
  if (author?.id) {
    const who = author.handle ? `@${author.handle}` : author.name || 'author'
    buttons.push(toggle(state.followingAuthor, 'followAuthor', `Follow ${who}`, 'undoFollowAuthor', `Unfollow ${who}`))
  }
  buttons.push({ name: 'reply', label: 'Reply', active: false })
  if (author?.id) buttons.push({ name: 'mention', label: 'Mention', active: false })
  return buttons
}

export function accountLabel (account) {
  return account.needsReauth ? `${account.handle} (login required)` : account.handle
}
