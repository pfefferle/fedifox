import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStore } from '../src/state/storage.js'
import { createStorageArea } from './helpers/storage-stub.js'

const account = (id) => ({ actorId: id, handle: 'a@x.test', name: 'A', inbox: `${id}/inbox`, outbox: `${id}/outbox`, liked: `${id}/liked`, following: `${id}/following`, followers: `${id}/followers`, asOrigin: 'https://x.test', accessToken: 't', needsReauth: false })

test('accounts: save, list, select, remove', async () => {
  const store = createStore(createStorageArea())
  assert.deepEqual(await store.getAccounts(), [])
  assert.equal(await store.getSelectedAccount(), null)
  await store.saveAccount(account('https://x.test/a'))
  await store.saveAccount(account('https://x.test/b'))
  assert.equal((await store.getAccounts()).length, 2)
  assert.equal((await store.getSelectedAccount()).actorId, 'https://x.test/a')
  await store.setSelectedActorId('https://x.test/b')
  assert.equal((await store.getSelectedAccount()).actorId, 'https://x.test/b')
  await store.removeAccount('https://x.test/b')
  assert.equal(await store.getAccount('https://x.test/b'), null)
  assert.equal((await store.getSelectedAccount()).actorId, 'https://x.test/a')
})

test('client creds keyed by authorization server origin', async () => {
  const store = createStore(createStorageArea())
  assert.equal(await store.getClientCreds('https://x.test'), null)
  await store.saveClientCreds('https://x.test', { clientId: 'c', source: 'dcr' })
  assert.deepEqual(await store.getClientCreds('https://x.test'), { clientId: 'c', source: 'dcr' })
})

test('action records', async () => {
  const store = createStore(createStorageArea())
  await store.saveActionRecord('https://x.test/a', 'Like', 'https://y.test/o', 'https://x.test/like/1', 100)
  assert.deepEqual(await store.getActionRecord('https://x.test/a', 'Like', 'https://y.test/o'), { activityId: 'https://x.test/like/1', at: 100 })
  await store.removeActionRecord('https://x.test/a', 'Like', 'https://y.test/o')
  assert.equal(await store.getActionRecord('https://x.test/a', 'Like', 'https://y.test/o'), null)
})

test('discovery cache expires after TTL', async () => {
  const store = createStore(createStorageArea())
  const resource = { id: 'https://y.test/o', kind: 'object', type: 'Note', url: 'https://y.test/o' }
  await store.saveDiscovery('https://y.test/page', resource, 1000)
  assert.deepEqual(await store.getDiscovery('https://y.test/page', 1000 + 60_000), resource)
  assert.equal(await store.getDiscovery('https://y.test/page', 1000 + 11 * 60_000), undefined)
  assert.equal(await store.getDiscovery('https://other.test', 1000), undefined)
  await store.saveDiscovery('https://y.test/none', null, 1000)
  assert.equal(await store.getDiscovery('https://y.test/none', 1000), null)
})

test('saveDiscovery prunes entries older than the TTL', async () => {
  const area = createStorageArea()
  const store = createStore(area)
  const resource = { id: 'https://y.test/o', kind: 'object', type: 'Note', url: 'https://y.test/o' }
  await store.saveDiscovery('https://y.test/old', resource, 1000)
  await store.saveDiscovery('https://y.test/new', null, 1000 + 11 * 60_000)
  const { discoveryCache } = await area.get('discoveryCache')
  assert.deepEqual(Object.keys(discoveryCache), ['https://y.test/new'])
  await store.saveDiscovery('https://y.test/newer', resource, 1000 + 12 * 60_000)
  assert.deepEqual(Object.keys((await area.get('discoveryCache')).discoveryCache), ['https://y.test/new', 'https://y.test/newer'])
})
