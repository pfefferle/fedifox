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

// `undoable` is false when the action is done but cannot be taken back from
// here; the button then only shows the state.
function toggle (on, offName, offLabel, onName, onLabel, undoable = true) {
  if (!on) return { name: offName, label: offLabel, active: false }
  return undoable ? { name: onName, label: onLabel, active: true } : { name: onName, label: onLabel, active: true, disabled: true }
}

export function buttonsFor (resource, state) {
  if (resource.kind === 'actor') {
    return [
      toggle(state.following, 'follow', 'Follow', 'undoFollow', 'Unfollow'),
      { name: 'mention', label: 'Mention', active: false }
    ]
  }
  const buttons = [
    // Undoing a like or share needs the id of that activity, which is only
    // known for what fedifox sent itself and the server answered with an id.
    toggle(state.liked, 'like', 'Like', 'undoLike', state.likeId ? 'Unlike' : 'Liked', Boolean(state.likeId)),
    toggle(state.shared, 'share', 'Share', 'undoShare', state.shareId ? 'Unshare' : 'Shared', Boolean(state.shareId))
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

// The button a link asked for. A link never offers to undo: when the action
// is already done its button is an undo button and nothing is picked.
export function intendedButton (buttons, action) {
  const names = { follow: ['follow', 'followAuthor'], like: ['like'], share: ['share'], reply: ['reply'] }[action] || []
  return buttons.find((b) => names.includes(b.name))?.name
}

// What the popup offers for a link: only the action the link asked for, so
// the popup reads as a confirmation. Without such an action — none named, not
// possible here, or already done — all buttons are offered as usual.
export function offeredButtons (buttons, action) {
  const name = intendedButton(buttons, action)
  return name ? buttons.filter((b) => b.name === name) : buttons
}

export function accountLabel (account) {
  return account.needsReauth ? `${account.handle} (login required)` : account.handle
}
