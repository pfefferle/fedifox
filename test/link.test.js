import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseLink } from '../src/link.js'

// One row per link form; `scheme` ties the row to a registered protocol.
const LINKS = [
  // fedi-to draft: an https URL under another name, no action.
  { scheme: 'web+ap', link: 'web+ap://y.test/users/bob', url: 'https://y.test/users/bob' },
  { scheme: 'web+ap', link: 'WEB+AP://y.test/notice/1?x=1#top', url: 'https://y.test/notice/1?x=1#top' },
  { scheme: 'web+ap', link: 'web+ap://user:secret@y.test/users/bob', url: 'https://y.test/users/bob' },
  // FEP-07d7: address plus an optional intent.
  { scheme: 'web+activitypub', link: 'web+activitypub:y.test/users/bob', url: 'https://y.test/users/bob' },
  { scheme: 'web+activitypub', link: 'web+activitypub:y.test/users/bob?intent=follow', url: 'https://y.test/users/bob', action: 'follow' },
  { scheme: 'web+activitypub', link: 'web+activitypub:y.test/posts/1?page=2&intent=Like', url: 'https://y.test/posts/1?page=2', action: 'like' },
  { scheme: 'web+activitypub', link: 'web+activitypub:y.test/posts/1?intent=announce', url: 'https://y.test/posts/1', action: 'share' },
  { scheme: 'web+activitypub', link: 'web+activitypub:y.test/posts/1?intent=create', url: 'https://y.test/posts/1', action: 'reply' },
  { scheme: 'web+activitypub', link: 'web+activitypub:https://y.test/posts/1?intent=like', url: 'https://y.test/posts/1', action: 'like' },
  // activitypub-schema proposal: activity type plus properties.
  { scheme: 'web+activitypub', link: 'web+activitypub:Follow?object=https%3A%2F%2Fy.test%2Fusers%2Fbob', url: 'https://y.test/users/bob', action: 'follow' },
  { scheme: 'web+activitypub', link: 'web+activitypub:Announce?object=https%3A%2F%2Fy.test%2Fposts%2F1', url: 'https://y.test/posts/1', action: 'share' },
  { scheme: 'web+activitypub', link: 'web+activitypub:Create?inReplyTo=https%3A%2F%2Fy.test%2Fposts%2F1', url: 'https://y.test/posts/1', action: 'reply' },
  { scheme: 'web+activitypub', link: 'web+activitypub:Create?object=https%3A%2F%2Fy.test%2Fposts%2F2&inReplyTo=https%3A%2F%2Fy.test%2Fposts%2F1', url: 'https://y.test/posts/1', action: 'reply' },
  { scheme: 'web+activitypub', link: 'web+activitypub:Follow?object=acct%3Abob%40y.test', handle: 'bob@y.test', action: 'follow' },
  { scheme: 'web+activitypub', link: 'web+activitypub:localhost?intent=follow', url: 'https://localhost/', action: 'follow' },
  // One scheme per action, the value is the address.
  { scheme: 'web+follow', link: 'web+follow:https%3A%2F%2Fy.test%2Fusers%2Fbob', url: 'https://y.test/users/bob', action: 'follow' },
  { scheme: 'web+follow', link: 'web+follow:https://y.test/users/bob', url: 'https://y.test/users/bob', action: 'follow' },
  { scheme: 'web+like', link: 'web+like:https://y.test/posts/1', url: 'https://y.test/posts/1', action: 'like' },
  { scheme: 'web+share', link: 'web+share:https://y.test/posts/1', url: 'https://y.test/posts/1', action: 'share' },
  // Not registrable in Firefox; these arrive from the content script.
  { scheme: 'acct', link: 'acct:bob@y.test', handle: 'bob@y.test' },
  { scheme: 'acct', link: 'ACCT:bob@y.test', handle: 'bob@y.test' },
  { scheme: 'fedi', link: 'fedi://bob@y.test/', handle: 'bob@y.test' },
  { scheme: 'fedi', link: 'fedi://bob@y.test', handle: 'bob@y.test' }
]

test('parseLink turns every supported link form into an address and an action', () => {
  for (const { link, url, handle, action } of LINKS) {
    assert.deepEqual(parseLink(link), { url, handle, action }, link)
  }
})

// A link is written by a third party: activities that could hurt the user are
// never offered, the link then only opens its target.
test('parseLink drops every activity that is not follow, like, share or reply', () => {
  for (const activity of ['block', 'delete', 'dislike', 'flag', 'ignore', 'leave', 'move', 'offer', 'remove', 'undo', 'update', 'add', 'arrive', 'invite', 'nonsense']) {
    assert.equal(parseLink(`web+activitypub:y.test/posts/1?intent=${activity}`).action, undefined, activity)
    assert.equal(parseLink(`web+activitypub:${activity}?object=https%3A%2F%2Fy.test%2Fposts%2F1`).action, undefined, activity)
  }
})

test('parseLink rejects what it cannot turn into a web address or a handle', () => {
  const rejected = [
    '',
    'https://y.test/users/bob',
    'web+nope://y.test/users/bob',
    'web+ap:',
    'web+follow:javascript:alert(1)',
    'web+follow:data:text/html,x',
    'web+like:file:///etc/passwd',
    'web+share:moz-extension://abc/page.html',
    'web+activitypub:Follow?object=javascript%3Aalert(1)',
    'web+activitypub:Create?content=hello',
    'web+activitypub:Create?object=https%3A%2F%2Fy.test%2Fposts%2F1',
    'web+activitypub:Like?inReplyTo=https%3A%2F%2Fy.test%2Fposts%2F1',
    'acct:',
    'acct:bob',
    'fedi://bob@y.test/111506589124254741',
    'fedi://hashtag/fediverse'
  ]
  for (const link of rejected) {
    assert.throws(() => parseLink(link), (e) => e.name === 'FedifoxError' && e.step === 'link', link)
  }
})

// A protocol registered in the manifest without a decision here would open
// the handler page with a link nobody parses.
test('every protocol registered in the manifest has a link form above', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'))
  const registered = manifest.protocol_handlers.map((h) => h.protocol)
  assert.deepEqual(registered, ['web+ap', 'web+activitypub', 'web+follow', 'web+like', 'web+share'])
  for (const protocol of registered) {
    assert.ok(LINKS.some((l) => l.scheme === protocol), protocol)
  }
  for (const handler of manifest.protocol_handlers) {
    assert.equal(handler.uriTemplate, '/src/popup/popup.html?link=%s', handler.protocol)
  }
})

// The content script is a classic script and cannot import the parser, so
// its list of link schemes is a copy; a scheme missing there is never taken
// over on click, one too many is cancelled and then rejected.
test('the content script takes over exactly the schemes parseLink knows', () => {
  const source = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8')
  const hooked = JSON.parse(/const LINKS = (\[[^\]]+\])/.exec(source)[1].replaceAll("'", '"'))
  assert.deepEqual([...hooked].sort(), [...new Set(LINKS.map((l) => l.scheme))].sort())
})
