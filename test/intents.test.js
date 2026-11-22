import { test } from 'node:test'
import assert from 'node:assert/strict'
import { intentTemplates, intentUrl, intentLinks, hasApi } from '../src/intents.js'
import { buttonsFor, intendedButton } from '../src/popup/render.js'

const REL = 'https://w3id.org/fep/3b86/'
const note = { id: 'https://y.test/posts/1', kind: 'object', type: 'Note', url: 'https://y.test/@bob/1', attributedTo: { id: 'https://y.test/users/bob', name: 'Bob', handle: 'bob@y.test' } }
const bob = { id: 'https://y.test/users/bob', kind: 'actor', type: 'Person', name: 'Bob', handle: 'bob@y.test' }
const all = {
  Like: 'https://x.test/intents/like?id={object}',
  Announce: 'https://x.test/intents/announce?id={object}',
  Create: 'https://x.test/share?text={content}&reply={inReplyTo}',
  Follow: 'https://x.test/authorize_interaction?uri={object}',
  Flag: 'https://x.test/intents/flag?id={object}',
  Block: 'https://x.test/intents/block?id={object}'
}

test('intentTemplates reads the FEP-3b86 links of a WebFinger document', () => {
  const jrd = {
    links: [
      { rel: 'self', type: 'application/activity+json', href: 'https://x.test/users/alice' },
      { rel: 'http://ostatus.org/schema/1.0/subscribe', template: 'https://x.test/authorize_interaction?uri={uri}' },
      { rel: `${REL}Follow`, template: all.Follow },
      { rel: `${REL}Like`, template: all.Like },
      { rel: `${REL}Create`, template: 'http://localhost:8888/share?text={content}' }
    ]
  }
  assert.deepEqual(intentTemplates(jrd), { Follow: all.Follow, Like: all.Like, Create: 'http://localhost:8888/share?text={content}' })
  assert.deepEqual(intentTemplates({}), {})
  assert.deepEqual(intentTemplates(null), {})
})

test('intentTemplates drops what is not a named web template', () => {
  const links = [
    { rel: `${REL}Like`, template: 'javascript:alert({object})' },
    { rel: `${REL}Follow`, template: 'data:text/html,{object}' },
    { rel: `${REL}Announce`, href: all.Announce },
    { rel: `${REL}Block`, template: 42 },
    { rel: `${REL}__proto__`, template: all.Like },
    { rel: `${REL}Like/../Flag`, template: all.Flag },
    { rel: REL, template: all.Like },
    { rel: 42, template: all.Like },
    null
  ]
  assert.deepEqual(intentTemplates({ links }), {})
})

test('intentUrl fills a template, percent-encoded, and empties what it does not know', () => {
  assert.equal(intentUrl(all.Like, { object: 'https://y.test/posts/1?a=b&c=d' }), 'https://x.test/intents/like?id=https%3A%2F%2Fy.test%2Fposts%2F1%3Fa%3Db%26c%3Dd')
  assert.equal(intentUrl('https://x.test/i?o={object}&ok={on-success}&no={on-cancel}', { object: 'https://y.test/1' }), 'https://x.test/i?o=https%3A%2F%2Fy.test%2F1&ok=&no=')
  assert.equal(intentUrl('https://x.test/i{?object}', { object: 'https://y.test/1' }), 'https://x.test/i')
  assert.equal(intentUrl('https://x.test/i?o={constructor}', {}), 'https://x.test/i?o=')
})

test('intentUrl only ever yields a web address', () => {
  assert.equal(intentUrl('{object}', { object: 'javascript:alert(1)' }), null)
  assert.equal(intentUrl('{object}', { object: 'https://evil.test/' }), null)
  assert.equal(intentUrl('not a url {object}', { object: 'x' }), null)
})

test('intentLinks for an object and for an actor', () => {
  const links = intentLinks(note, all)
  assert.deepEqual(links.map((l) => [l.name, l.label]), [['like', 'Like'], ['share', 'Share'], ['reply', 'Reply'], ['followAuthor', 'Follow @bob@y.test'], ['report', 'Report'], ['blockAuthor', 'Block @bob@y.test']])
  assert.equal(links[0].href, 'https://x.test/intents/like?id=https%3A%2F%2Fy.test%2Fposts%2F1')
  assert.equal(links[2].href, 'https://x.test/share?text=&reply=https%3A%2F%2Fy.test%2Fposts%2F1')
  assert.equal(links[3].href, 'https://x.test/authorize_interaction?uri=https%3A%2F%2Fy.test%2Fusers%2Fbob')
  const actor = intentLinks(bob, all)
  assert.deepEqual(actor.map((l) => [l.name, l.label]), [['follow', 'Follow'], ['mention', 'Mention'], ['report', 'Report'], ['block', 'Block']])
  assert.equal(actor[1].href, 'https://x.test/share?text=%40bob%40y.test%20&reply=')
  assert.deepEqual(intentLinks({ ...note, attributedTo: undefined }, all).map((l) => l.name), ['like', 'share', 'reply', 'report'])
})

test('intentLinks only offers what the server publishes and can address', () => {
  assert.deepEqual(intentLinks(note, {}), [])
  assert.deepEqual(intentLinks(note, undefined), [])
  assert.deepEqual(intentLinks(note, { Follow: all.Follow }).map((l) => l.name), ['followAuthor'])
  // A composer that cannot take what is replied to would open an empty post.
  assert.deepEqual(intentLinks(note, { Create: 'https://x.test/share?text={content}' }), [])
  assert.deepEqual(intentLinks(bob, { Create: 'https://x.test/share?text={content}' }).map((l) => l.name), ['mention'])
  assert.deepEqual(intentLinks(note, { Like: 'https://x.test/intents/like' }), [])
  assert.deepEqual(intentLinks(note, { Like: 'javascript:alert({object})' }), [])
})

test('every link stands for an action the popup knows, so a link can ask for it', () => {
  const off = { liked: false, shared: false, following: false, followingAuthor: false }
  for (const resource of [note, bob]) {
    const links = intentLinks(resource, all)
    const buttons = buttonsFor(resource, off)
    for (const action of ['like', 'share', 'reply', 'follow']) {
      assert.equal(intendedButton(links, action), intendedButton(buttons, action), `${resource.kind} ${action}`)
    }
  }
})

test('hasApi tells a logged-in account from one that only has intents', () => {
  assert.equal(hasApi({ actorId: 'https://x.test/a', accessToken: 't' }), true)
  assert.equal(hasApi({ actorId: 'https://x.test/a', intents: all }), false)
  assert.equal(hasApi(null), false)
})
