import { test } from 'node:test'
import assert from 'node:assert/strict'
import { like, announce, follow, undo, createNote, renderContent, mentionTag, escapeHtml } from '../src/client/activities.js'
import { AS2_CONTEXT, AS_PUBLIC } from '../src/constants.js'

const author = 'https://y.test/users/bob'
const bob = { id: author, handle: 'bob@y.test' }

test('like/announce/follow/undo carry context, object and addressing', () => {
  assert.deepEqual(like('https://y.test/o', { to: [author], cc: [AS_PUBLIC] }), { '@context': AS2_CONTEXT, type: 'Like', object: 'https://y.test/o', to: [author], cc: [AS_PUBLIC] })
  assert.deepEqual(announce('https://y.test/o', { to: [author], cc: [AS_PUBLIC, 'https://x.test/a/followers'] }), { '@context': AS2_CONTEXT, type: 'Announce', object: 'https://y.test/o', to: [author], cc: [AS_PUBLIC, 'https://x.test/a/followers'] })
  assert.deepEqual(follow(author), { '@context': AS2_CONTEXT, type: 'Follow', object: author, to: [author] })
  assert.deepEqual(undo('https://x.test/like/1', { to: [author] }), { '@context': AS2_CONTEXT, type: 'Undo', object: 'https://x.test/like/1', to: [author] })
})

test('createNote builds a reply with mention tag and HTML content', () => {
  const note = createNote({ content: 'hi <there>', inReplyTo: 'https://y.test/o', mentions: [bob], to: [author], cc: [AS_PUBLIC] })
  assert.equal(note.type, 'Create')
  assert.equal(note.object.type, 'Note')
  assert.equal(note.object.inReplyTo, 'https://y.test/o')
  assert.equal(note.object.content, '<p><a href="https://y.test/users/bob" class="u-url mention">@bob@y.test</a> hi &lt;there&gt;</p>')
  assert.deepEqual(note.object.tag, [{ type: 'Mention', href: author, name: '@bob@y.test' }])
  assert.deepEqual(note.to, [author])
  assert.deepEqual(note.object.to, [author])
  assert.deepEqual(note.cc, [AS_PUBLIC])
})

test('renderContent links handles already present and escapes the rest', () => {
  assert.equal(renderContent('@bob@y.test thanks & bye\nline2', [bob]), '<p><a href="https://y.test/users/bob" class="u-url mention">@bob@y.test</a> thanks &amp; bye<br>line2</p>')
  assert.equal(renderContent('plain', []), '<p>plain</p>')
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;')
  assert.deepEqual(mentionTag(bob), { type: 'Mention', href: author, name: '@bob@y.test' })
})

test('empty addressing arrays are omitted', () => {
  assert.deepEqual(like('https://y.test/o', { to: [], cc: [] }), { '@context': AS2_CONTEXT, type: 'Like', object: 'https://y.test/o' })
})
