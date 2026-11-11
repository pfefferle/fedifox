import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resourceView, buttonsFor, accountLabel } from '../src/popup/render.js'

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
  const on = buttonsFor(note, { ...off, liked: true, shared: true, followingAuthor: true })
  assert.deepEqual(on.slice(0, 3), [{ name: 'undoLike', label: 'Unlike', active: true }, { name: 'undoShare', label: 'Unshare', active: true }, { name: 'undoFollowAuthor', label: 'Unfollow @bob@y.test', active: true }])
  assert.deepEqual(buttonsFor({ ...note, attributedTo: undefined }, off).map((b) => b.name), ['like', 'share', 'reply'])
  assert.deepEqual(buttonsFor(bob, { ...off, following: true }), [{ name: 'undoFollow', label: 'Unfollow', active: true }, { name: 'mention', label: 'Mention', active: false }])
})

test('accountLabel', () => {
  assert.equal(accountLabel({ handle: 'a@x.test', needsReauth: false }), 'a@x.test')
  assert.equal(accountLabel({ handle: 'a@x.test', needsReauth: true }), 'a@x.test (login required)')
})
