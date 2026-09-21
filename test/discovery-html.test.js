import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractCandidates } from '../src/discovery/html.js'

test('extracts alternate AP links and rel=me actors, resolving relative hrefs', () => {
  const links = [
    { rel: 'stylesheet', type: 'text/css', href: '/style.css' },
    { rel: 'alternate', type: 'application/rss+xml', href: '/feed' },
    { rel: 'alternate', type: 'application/activity+json', href: '/posts/1' },
    { rel: 'alternate', type: 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"', href: 'https://y.test/posts/1' },
    { rel: 'me', type: '', href: 'https://y.test/@bob' },
    { rel: 'me nofollow', type: null, href: '/author/bob' },
    { rel: 'alternate', type: 'APPLICATION/ACTIVITY+JSON', href: '/posts/2' },
    { rel: 'alternate', type: 'application/activity+json', href: '' }
  ]
  assert.deepEqual(extractCandidates(links, 'https://y.test/blog/'), {
    objectCandidates: ['https://y.test/posts/1', 'https://y.test/posts/2'],
    actorCandidates: ['https://y.test/@bob', 'https://y.test/author/bob']
  })
})

test('empty input', () => {
  assert.deepEqual(extractCandidates([], 'https://y.test/'), { objectCandidates: [], actorCandidates: [] })
})
