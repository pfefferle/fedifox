import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FedifoxError, describeError } from '../src/errors.js'
import { isApMediaType } from '../src/constants.js'

test('FedifoxError carries step/status/detail and describes itself', () => {
  const err = new FedifoxError('example.org does not advertise an OAuth endpoint', { step: 'discover-endpoints', status: 404, detail: 'GET /.well-known/oauth-authorization-server -> 404' })
  assert.equal(err.name, 'FedifoxError')
  assert.deepEqual(describeError(err), { message: 'example.org does not advertise an OAuth endpoint', step: 'discover-endpoints', status: 404, detail: 'GET /.well-known/oauth-authorization-server -> 404' })
})

test('describeError wraps plain errors', () => {
  assert.deepEqual(describeError(new TypeError('boom')), { message: 'boom', step: undefined, status: undefined, detail: 'TypeError' })
})

test('isApMediaType matches AP and AS2-profiled ld+json only', () => {
  assert.equal(isApMediaType('application/activity+json'), true)
  assert.equal(isApMediaType('application/activity+json; charset=utf-8'), true)
  assert.equal(isApMediaType('application/ld+json; profile="https://www.w3.org/ns/activitystreams"'), true)
  assert.equal(isApMediaType('application/ld+json'), true)
  assert.equal(isApMediaType('text/html'), false)
  assert.equal(isApMediaType(null), false)
})
