import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resourceView, buttonsFor, accountLabel, intendedButton, offeredButtons, confirmTitle, doneMessage } from '../src/popup/render.js'

const note = { id: 'https://y.test/posts/1', kind: 'object', type: 'Note', url: 'https://y.test/@bob/1', attributedTo: { id: 'https://y.test/users/bob', name: 'Bob', handle: 'bob@y.test' }, audience: { to: [], cc: [] } }
const bob = { id: 'https://y.test/users/bob', kind: 'actor', type: 'Person', name: 'Bob', handle: 'bob@y.test', url: 'https://y.test/@bob', audience: { to: [], cc: [] } }

test('resourceView', () => {
  assert.deepEqual(resourceView(note), { title: 'Note', subtitle: 'by @bob@y.test', kind: 'object', link: 'https://y.test/@bob/1' })
  assert.deepEqual(resourceView({ ...note, name: 'A title' }).title, 'A title')
  assert.deepEqual(resourceView(bob), { title: 'Bob', subtitle: '@bob@y.test', kind: 'actor', link: 'https://y.test/@bob' })
})

test('resourceView only links to http(s) URLs', () => {
  assert.equal(resourceView({ ...note, url: 'javascript:alert(1)' }).link, note.id)
  assert.equal(resourceView({ ...note, url: 'javascript:alert(1)', id: 'data:text/html,hi' }).link, null)
  assert.equal(resourceView({ ...note, url: undefined }).link, note.id)
  assert.equal(resourceView({ ...bob, url: 'ftp://y.test/bob' }).link, bob.id)
  assert.equal(resourceView({ ...bob, url: 'http://y.test/@bob' }).link, 'http://y.test/@bob')
})

test('buttonsFor object and actor', () => {
  const off = { liked: false, shared: false, following: false, followingAuthor: false }
  assert.deepEqual(buttonsFor(note, off).map((b) => b.name), ['like', 'share', 'followAuthor', 'reply', 'mention'])
  const on = buttonsFor(note, { ...off, liked: true, likeId: 'https://x.test/act/1', shared: true, shareId: 'https://x.test/act/2', followingAuthor: true })
  assert.deepEqual(on.slice(0, 3), [{ name: 'undoLike', label: 'Unlike', active: true }, { name: 'undoShare', label: 'Unshare', active: true }, { name: 'undoFollowAuthor', label: 'Unfollow @bob@y.test', active: true }])
  // A like or share without a known activity cannot be undone: the state is
  // shown, the undo is not offered. A follow can always be undone.
  const elsewhere = buttonsFor(note, { ...off, liked: true, shared: true, followingAuthor: true })
  assert.deepEqual(elsewhere.slice(0, 3), [{ name: 'undoLike', label: 'Liked', active: true, disabled: true }, { name: 'undoShare', label: 'Shared', active: true, disabled: true }, { name: 'undoFollowAuthor', label: 'Unfollow @bob@y.test', active: true }])
  assert.deepEqual(buttonsFor({ ...note, attributedTo: undefined }, off).map((b) => b.name), ['like', 'share', 'reply'])
  assert.deepEqual(buttonsFor(bob, { ...off, following: true }), [{ name: 'undoFollow', label: 'Unfollow', active: true }, { name: 'mention', label: 'Mention', active: false }])
})

test('accountLabel', () => {
  assert.equal(accountLabel({ handle: 'a@x.test', needsReauth: false }), 'a@x.test')
  assert.equal(accountLabel({ handle: 'a@x.test', needsReauth: true }), 'a@x.test (login required)')
})

test('intendedButton picks the button a link asked for, never an undo', () => {
  const fresh = { liked: false, shared: false, following: false, followingAuthor: false }
  const done = { liked: true, likeId: 'https://x.test/act/1', shared: true, shareId: 'https://x.test/act/2', following: true, followingAuthor: true }
  assert.equal(intendedButton(buttonsFor(note, fresh), 'like'), 'like')
  assert.equal(intendedButton(buttonsFor(note, fresh), 'share'), 'share')
  assert.equal(intendedButton(buttonsFor(note, fresh), 'reply'), 'reply')
  assert.equal(intendedButton(buttonsFor(note, fresh), 'follow'), 'followAuthor')
  assert.equal(intendedButton(buttonsFor(bob, fresh), 'follow'), 'follow')
  // An actor cannot be liked, and a link does not undo what is already done.
  assert.equal(intendedButton(buttonsFor(bob, fresh), 'like'), undefined)
  for (const action of ['like', 'share', 'follow']) assert.equal(intendedButton(buttonsFor(note, done), action), undefined)
  assert.equal(intendedButton(buttonsFor(bob, done), 'follow'), undefined)
  assert.equal(intendedButton(buttonsFor(note, fresh), undefined), undefined)
  assert.equal(intendedButton(buttonsFor(note, fresh), 'undoLike'), undefined)
})

test('offeredButtons narrows to the one action a link asked for', () => {
  const fresh = { liked: false, shared: false, following: false, followingAuthor: false }
  const all = buttonsFor(note, fresh)
  assert.deepEqual(offeredButtons(all, 'like').map((b) => b.name), ['like'])
  assert.deepEqual(offeredButtons(all, 'follow').map((b) => b.name), ['followAuthor'])
  assert.deepEqual(offeredButtons(all, 'reply').map((b) => b.name), ['reply'])
  // Nothing to narrow to: no action, an action this resource does not have,
  // or one that is already done (the undo button then shows why).
  assert.deepEqual(offeredButtons(all, undefined), all)
  assert.deepEqual(offeredButtons(buttonsFor(bob, fresh), 'like'), buttonsFor(bob, fresh))
  const liked = buttonsFor(note, { ...fresh, liked: true, likeId: 'https://x.test/act/1' })
  assert.deepEqual(offeredButtons(liked, 'like'), liked)
})

test('confirmTitle asks about the one action a link wants', () => {
  assert.equal(confirmTitle(note, 'like'), 'Like this note?')
  assert.equal(confirmTitle({ ...note, type: 'Article' }, 'share'), 'Share this article?')
  assert.equal(confirmTitle({ ...note, name: 'A title' }, 'like'), 'Like “A title”?')
  assert.equal(confirmTitle({ ...note, type: undefined }, 'like'), 'Like this post?')
  assert.equal(confirmTitle(note, 'followAuthor'), 'Follow @bob@y.test?')
  assert.equal(confirmTitle({ ...note, attributedTo: { id: 'https://y.test/users/bob', name: 'Bob' } }, 'followAuthor'), 'Follow Bob?')
  assert.equal(confirmTitle(bob, 'follow'), 'Follow Bob?')
  assert.equal(confirmTitle(note, 'reply'), 'Reply to @bob@y.test')
  assert.equal(confirmTitle({ ...note, attributedTo: undefined }, 'reply'), 'Reply to this note')
})

test('doneMessage has words for every action the popup can run', () => {
  const off = { liked: false, shared: false, following: false, followingAuthor: false }
  const on = { liked: true, likeId: 'https://x.test/act/1', shared: true, shareId: 'https://x.test/act/2', following: true, followingAuthor: true }
  const names = [note, bob].flatMap((r) => [off, on].flatMap((state) => buttonsFor(r, state).map((b) => b.name)))
  for (const name of new Set(names)) assert.notEqual(doneMessage(name), 'Done', name)
  assert.equal(doneMessage('like'), 'Liked')
  assert.equal(doneMessage('undoFollowAuthor'), 'Unfollowed')
  assert.equal(doneMessage('somethingNew'), 'Done')
})
