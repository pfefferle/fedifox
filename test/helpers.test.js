import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFetchStub } from './helpers/fetch-stub.js'
import { createStorageArea } from './helpers/storage-stub.js'

test('fetch stub returns JSON bodies and records calls', async () => {
  const { fetch, calls } = createFetchStub({ 'GET https://x.test/a': { body: { id: 'a' } } })
  const res = await fetch('https://x.test/a', { headers: { Accept: 'application/activity+json' } })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { id: 'a' })
  assert.equal(calls[0].headers.get('accept'), 'application/activity+json')
  await assert.rejects(fetch('https://x.test/missing'), /no route/)
})

test('storage stub round-trips and deep-clones', async () => {
  const area = createStorageArea()
  await area.set({ a: { n: 1 } })
  const got = await area.get('a')
  got.a.n = 2
  assert.deepEqual(await area.get(['a']), { a: { n: 1 } })
  assert.deepEqual(await area.get({ missing: 'default' }), { missing: 'default' })
  await area.remove('a')
  assert.deepEqual(await area.get('a'), {})
})
