export function resourceView (resource) {
  if (resource.kind === 'actor') {
    return { title: resource.name || resource.handle || resource.id, subtitle: resource.handle ? `@${resource.handle}` : '', kind: 'actor', link: resource.url }
  }
  const author = resource.attributedTo
  const who = author?.handle ? `@${author.handle}` : author?.name || ''
  return { title: resource.name || resource.type, subtitle: who ? `by ${who}` : '', kind: 'object', link: resource.url }
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
