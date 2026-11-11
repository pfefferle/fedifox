import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveClientCreds, registrationRequestBody } from '../src/auth/client-identity.js'
import { createStore } from '../src/state/storage.js'
import { createStorageArea } from './helpers/storage-stub.js'
import { createFetchStub } from './helpers/fetch-stub.js'
import { CLIENT_NAME, CLIENT_URI, SOFTWARE_ID, SOFTWARE_VERSION } from '../src/constants.js'

const redirectUri = 'https://abc123.extensions.allizom.org/'
const as = { issuer: 'https://x.test', authorization_endpoint: 'https://x.test/auth', token_endpoint: 'https://x.test/token', registration_endpoint: 'https://x.test/oauth/clients' }

test('manual creds win and are cached', async () => {
  const store = createStore(createStorageArea())
  const { fetch, calls } = createFetchStub()
  const creds = await resolveClientCreds({ as, store, redirectUri, fetch, manual: { clientId: 'm', clientSecret: 's' } })
  assert.deepEqual(creds, { clientId: 'm', clientSecret: 's', source: 'manual' })
  assert.equal(calls.length, 0)
  assert.deepEqual(await store.getClientCreds('https://x.test'), creds)
})

test('CIMD is used when configured', async () => {
  const store = createStore(createStorageArea())
  const { fetch, calls } = createFetchStub()
  const creds = await resolveClientCreds({ as, store, redirectUri, fetch, cimdUrl: 'https://fedifox.test/client.json' })
  assert.deepEqual(creds, { clientId: 'https://fedifox.test/client.json', source: 'cimd' })
  assert.equal(calls.length, 0)
})

test('dynamic registration when no CIMD', async () => {
  const store = createStore(createStorageArea())
  const { fetch, calls } = createFetchStub({ 'POST https://x.test/oauth/clients': { status: 201, body: { client_id: 'dcr-1', client_secret: 'sec' }, headers: { 'content-type': 'application/json' } } })
  const creds = await resolveClientCreds({ as, store, redirectUri, fetch, cimdUrl: null })
  assert.deepEqual(creds, { clientId: 'dcr-1', clientSecret: 'sec', source: 'dcr' })
  const sent = JSON.parse(calls[0].body)
  assert.deepEqual(sent, registrationRequestBody(redirectUri))
  assert.equal(sent.client_name, CLIENT_NAME)
  assert.deepEqual(sent.redirect_uris, [redirectUri])
  assert.equal(sent.token_endpoint_auth_method, 'none')
  assert.equal(sent.client_uri, CLIENT_URI)
  assert.equal(sent.software_id, SOFTWARE_ID)
  assert.equal(sent.software_version, SOFTWARE_VERSION)
  assert.equal(calls[0].headers.get('content-type'), 'application/json')
  // second call is served from cache
  await resolveClientCreds({ as, store, redirectUri, fetch, cimdUrl: null })
  assert.equal(calls.length, 1)
})

test('registration failure and no options -> FedifoxError', async () => {
  const store = createStore(createStorageArea())
  const { fetch } = createFetchStub({ 'POST https://x.test/oauth/clients': { status: 400, body: { error: 'invalid_redirect_uri' }, headers: { 'content-type': 'application/json' } } })
  await assert.rejects(resolveClientCreds({ as, store, redirectUri, fetch, cimdUrl: null }), (e) => e.step === 'client-identity' && e.status === 400)
  const bare = { issuer: 'https://y.test', authorization_endpoint: 'https://y.test/auth', token_endpoint: 'https://y.test/token' }
  await assert.rejects(resolveClientCreds({ as: bare, store, redirectUri, fetch, cimdUrl: null }), (e) => e.step === 'client-identity' && /y\.test/.test(e.message))
})

test('network failure during registration is wrapped as FedifoxError', async () => {
  const store = createStore(createStorageArea())
  const fetch = async () => { throw new Error('network down') }
  await assert.rejects(
    resolveClientCreds({ as, store, redirectUri, fetch, cimdUrl: null }),
    (e) => e.step === 'client-identity' && /x\.test/.test(e.message)
  )
})
