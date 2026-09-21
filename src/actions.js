import { AS_PUBLIC } from './constants.js'
import { FedifoxError } from './errors.js'
import * as build from './client/activities.js'

const authorId = (resource) => resource.attributedTo?.id

export function createActions ({ client, store, now = () => Date.now() }) {
  async function inCollection (account, url, id) {
    if (!url || !id) return { found: false, complete: true }
    try { return await client.containsId(url, id, { account }) } catch { return { found: false, complete: false } }
  }

  async function flag (account, type, collectionUrl, id) {
    const record = await store.getActionRecord(account.actorId, type, id)
    if (record) return { on: true, activityId: record.activityId }
    if (!collectionUrl) return { on: false, activityId: undefined }
    const { found } = await inCollection(account, collectionUrl, id)
    return { on: found, activityId: undefined }
  }

  async function state (account, resource) {
    const isActor = resource.kind === 'actor'
    const like = isActor ? { on: false } : await flag(account, 'Like', account.liked, resource.id)
    const share = isActor ? { on: false } : await flag(account, 'Announce', null, resource.id)
    const follow = isActor ? await flag(account, 'Follow', account.following, resource.id) : { on: false }
    const followAuthor = !isActor && authorId(resource) ? await flag(account, 'Follow', account.following, authorId(resource)) : { on: false }
    return {
      liked: like.on, shared: share.on, following: follow.on, followingAuthor: followAuthor.on,
      likeId: like.activityId, shareId: share.activityId, followId: follow.activityId, followAuthorId: followAuthor.activityId
    }
  }

  // POST first, record only on success so a rejected activity leaves no trace.
  async function perform (account, type, targetId, activity) {
    const { activityId } = await client.postActivity(account, activity)
    if (activityId) await store.saveActionRecord(account.actorId, type, targetId, activityId, now())
    return { activityId }
  }

  async function undoOf (account, type, targetId, addressing) {
    const record = await store.getActionRecord(account.actorId, type, targetId)
    if (!record) throw new FedifoxError(`Nothing to undo: fedifox has no ${type} of this on record`, { step: 'undo', detail: targetId })
    const result = await client.postActivity(account, build.undo(record.activityId, addressing))
    await store.removeActionRecord(account.actorId, type, targetId)
    return { activityId: result.activityId }
  }

  const objectAddressing = (resource) => ({ to: authorId(resource) ? [authorId(resource)] : [], cc: [AS_PUBLIC] })

  return {
    state,
    like: (account, resource) => perform(account, 'Like', resource.id, build.like(resource.id, objectAddressing(resource))),
    undoLike: (account, resource) => undoOf(account, 'Like', resource.id, objectAddressing(resource)),
    share: (account, resource) => perform(account, 'Announce', resource.id, build.announce(resource.id, { to: objectAddressing(resource).to, cc: [AS_PUBLIC, account.followers].filter(Boolean) })),
    undoShare: (account, resource) => undoOf(account, 'Announce', resource.id, { to: objectAddressing(resource).to, cc: [AS_PUBLIC, account.followers].filter(Boolean) }),
    follow: (account, actorId) => perform(account, 'Follow', actorId, build.follow(actorId)),
    undoFollow: (account, actorId) => undoOf(account, 'Follow', actorId, { to: [actorId] }),
    async reply (account, resource, text) {
      const author = resource.attributedTo
      const mentions = author?.handle ? [{ id: author.id, handle: author.handle }] : []
      const to = author ? [author.id] : []
      const inherited = [...resource.audience.to, ...resource.audience.cc].filter((a) => a !== AS_PUBLIC && a !== author?.id && a !== account.actorId)
      const cc = [AS_PUBLIC, ...new Set(inherited)]
      const activity = build.createNote({ content: text, inReplyTo: resource.id, mentions, to, cc })
      const { activityId } = await client.postActivity(account, activity)
      return { activityId }
    },
    async mention (account, actor, text) {
      const mentions = actor.handle ? [{ id: actor.id, handle: actor.handle }] : []
      const activity = build.createNote({ content: text, mentions, to: [actor.id], cc: [AS_PUBLIC] })
      const { activityId } = await client.postActivity(account, activity)
      return { activityId }
    }
  }
}
