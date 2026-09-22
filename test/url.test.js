import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hostOf, originOf } from '../src/url.js'

test('hostOf returns the host, or the input when unparsable', () => {
  assert.equal(hostOf('https://x.test:8443/a?b#c'), 'x.test:8443')
  assert.equal(hostOf('not a url'), 'not a url')
  assert.equal(hostOf(undefined), undefined)
})

test('originOf returns the origin, or null when unparsable or opaque', () => {
  assert.equal(originOf('https://x.test/a/b'), 'https://x.test')
  assert.equal(originOf('http://localhost:8888/?p=1'), 'http://localhost:8888')
  assert.equal(originOf('not a url'), null)
  assert.equal(originOf('urn:uuid:1234'), null)
  assert.equal(originOf(null), null)
})
