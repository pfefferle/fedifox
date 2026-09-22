import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discoverEndpoints, fetchServerMetadata, parseResourceMetadataUrl, discoverFromResourceMetadata } from '../src/auth/discovery.js'
import { createFetchStub } from './helpers/fetch-stub.js'

const meta = { issuer: 'https://x.test', authorization_endpoint: 'https://x.test/oauth/authorize', token_endpoint: 'https://x.test/oauth/token', registration_endpoint: 'https://x.test/oauth/clients', code_challenge_methods_supported: ['S256'] }
const json = (body, status = 200) => ({ status, body, headers: { 'content-type': 'application/json' } })

test('actor endpoints win and are merged with RFC 8414 metadata', async () => {
  const { fetch } = createFetchStub({ 'GET https://x.test/.well-known/oauth-authorization-server': json(meta) })
  const actor = { id: 'https://x.test/a', endpoints: { oauthAuthorizationEndpoint: 'https://x.test/wp-json/activitypub/1.0/oauth/authorize', oauthTokenEndpoint: 'https://x.test/wp-json/activitypub/1.0/oauth/token' } }
  const as = await discoverEndpoints(actor, { fetch })
  assert.equal(as.authorization_endpoint, 'https://x.test/wp-json/activitypub/1.0/oauth/authorize')
  assert.equal(as.token_endpoint, 'https://x.test/wp-json/activitypub/1.0/oauth/token')
  assert.equal(as.registration_endpoint, 'https://x.test/oauth/clients')
  assert.equal(as.issuer, 'https://x.test')
})

test('actor endpoints without metadata still work', async () => {
  const { fetch } = createFetchStub({ 'GET https://x.test/.well-known/oauth-authorization-server': { status: 404, body: '' } })
  const actor = { id: 'https://x.test/a', endpoints: { oauthAuthorizationEndpoint: 'https://x.test/auth', oauthTokenEndpoint: 'https://x.test/token' } }
  assert.deepEqual(await discoverEndpoints(actor, { fetch }), { issuer: 'https://x.test', authorization_endpoint: 'https://x.test/auth', token_endpoint: 'https://x.test/token' })
})

test('falls back to RFC 8414 on the actor origin', async () => {
  const { fetch } = createFetchStub({ 'GET https://x.test/.well-known/oauth-authorization-server': json(meta) })
  assert.deepEqual(await discoverEndpoints({ id: 'https://x.test/a' }, { fetch }), meta)
})

test('falls back to RFC 9728 via a 401 challenge on the outbox', async () => {
  const { fetch } = createFetchStub({
    'GET https://x.test/.well-known/oauth-authorization-server': { status: 404, body: '' },
    'GET https://x.test/a/outbox': { status: 401, body: '', headers: { 'www-authenticate': 'Bearer resource_metadata="https://x.test/.well-known/oauth-protected-resource"' } },
    'GET https://x.test/.well-known/oauth-protected-resource': json({ resource: 'https://x.test', authorization_servers: ['https://auth.test'] }),
    'GET https://auth.test/.well-known/oauth-authorization-server': json({ ...meta, issuer: 'https://auth.test' })
  })
  const as = await discoverEndpoints({ id: 'https://x.test/a', outbox: 'https://x.test/a/outbox' }, { fetch })
  assert.equal(as.issuer, 'https://auth.test')
})

test('throws a FedifoxError naming the host when nothing is advertised', async () => {
  const { fetch } = createFetchStub({
    'GET https://x.test/.well-known/oauth-authorization-server': { status: 404, body: '' },
    'GET https://x.test/a/outbox': { status: 200, body: { type: 'OrderedCollection' } }
  })
  await assert.rejects(discoverEndpoints({ id: 'https://x.test/a', outbox: 'https://x.test/a/outbox' }, { fetch }), (e) => e.step === 'discover-endpoints' && /x\.test does not advertise/.test(e.message))
})

test('a broken RFC 9728 document surfaces its own error, not the generic one', async () => {
  const { fetch } = createFetchStub({
    'GET https://x.test/.well-known/oauth-authorization-server': { status: 404, body: '' },
    'GET https://x.test/a/outbox': { status: 401, body: '', headers: { 'www-authenticate': 'Bearer resource_metadata="https://x.test/.well-known/oauth-protected-resource"' } },
    'GET https://x.test/.well-known/oauth-protected-resource': json({ resource: 'https://x.test', authorization_servers: [] })
  })
  await assert.rejects(discoverEndpoints({ id: 'https://x.test/a', outbox: 'https://x.test/a/outbox' }, { fetch }), (e) => e.step === 'discover-endpoints' && /lists no authorization server/.test(e.message))
})

test('fetchServerMetadata returns null for non-JSON', async () => {
  const { fetch } = createFetchStub({ 'GET https://x.test/.well-known/oauth-authorization-server': { status: 200, body: '<html>', headers: { 'content-type': 'text/html' } } })
  assert.equal(await fetchServerMetadata('https://x.test', { fetch }), null)
})

test('RFC 9728 resource metadata path', async () => {
  assert.equal(parseResourceMetadataUrl('Bearer realm="x", resource_metadata="https://x.test/.well-known/oauth-protected-resource"'), 'https://x.test/.well-known/oauth-protected-resource')
  assert.equal(parseResourceMetadataUrl('Bearer'), null)
  assert.equal(parseResourceMetadataUrl(null), null)
  const { fetch } = createFetchStub({
    'GET https://x.test/.well-known/oauth-protected-resource': json({ resource: 'https://x.test', authorization_servers: ['https://auth.test'] }),
    'GET https://auth.test/.well-known/oauth-authorization-server': json({ ...meta, issuer: 'https://auth.test' })
  })
  const as = await discoverFromResourceMetadata('https://x.test/.well-known/oauth-protected-resource', { fetch })
  assert.equal(as.issuer, 'https://auth.test')
})

test('fetchServerMetadata defaults issuer to the origin when the document lacks it', async () => {
  const { issuer, ...noIssuer } = meta
  const { fetch } = createFetchStub({ 'GET https://x.test/.well-known/oauth-authorization-server': json(noIssuer) })
  assert.deepEqual(await fetchServerMetadata('https://x.test', { fetch }), { ...noIssuer, issuer: 'https://x.test' })
  assert.equal((await discoverEndpoints({ id: 'https://x.test/a' }, { fetch })).issuer, 'https://x.test')
})
