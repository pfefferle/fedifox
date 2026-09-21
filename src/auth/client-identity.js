import { CIMD_URL, CLIENT_NAME, CLIENT_URI, SOFTWARE_ID, SOFTWARE_VERSION } from '../constants.js'
import { FedifoxError } from '../errors.js'

const hostOf = (url) => new URL(url).host

export function registrationRequestBody (redirectUri) {
  return {
    client_name: CLIENT_NAME,
    client_uri: CLIENT_URI,
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    software_id: SOFTWARE_ID,
    software_version: SOFTWARE_VERSION
  }
}

async function registerDynamically (as, redirectUri, fetch) {
  let res
  try {
    res = await fetch(as.registration_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(registrationRequestBody(redirectUri))
    })
  } catch (cause) {
    throw new FedifoxError(`Could not reach ${hostOf(as.registration_endpoint)}`, { step: 'client-identity', detail: cause?.message, cause })
  }
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    throw new FedifoxError(`${hostOf(as.registration_endpoint)} refused to register fedifox (${res.status})`, { step: 'client-identity', status: res.status, detail: text })
  }
  let doc
  try { doc = JSON.parse(text) } catch (cause) {
    throw new FedifoxError(`${hostOf(as.registration_endpoint)} returned invalid registration JSON`, { step: 'client-identity', detail: text, cause })
  }
  if (!doc.client_id) throw new FedifoxError(`${hostOf(as.registration_endpoint)} registration response has no client_id`, { step: 'client-identity', detail: text })
  const creds = { clientId: doc.client_id, source: 'dcr' }
  if (doc.client_secret) creds.clientSecret = doc.client_secret
  return creds
}

// Precedence: cached → manual → CIMD → RFC 7591. Each result is cached per
// authorization server so login on a known server never re-registers.
export async function resolveClientCreds ({ as, store, redirectUri, manual, fetch = globalThis.fetch, cimdUrl = CIMD_URL }) {
  const cached = await store.getClientCreds(as.issuer)
  if (cached && !(manual?.clientId)) return cached

  let creds
  if (manual?.clientId) {
    creds = { clientId: manual.clientId, source: 'manual' }
    if (manual.clientSecret) creds.clientSecret = manual.clientSecret
  } else if (cimdUrl) {
    creds = { clientId: cimdUrl, source: 'cimd' }
  } else if (as.registration_endpoint) {
    creds = await registerDynamically(as, redirectUri, fetch)
  } else {
    throw new FedifoxError(`${hostOf(as.issuer)} supports neither client registration nor CIMD — enter a client ID under "Advanced"`, { step: 'client-identity' })
  }
  await store.saveClientCreds(as.issuer, creds)
  return creds
}

export async function forgetClientCreds ({ as, store }) {
  await store.saveClientCreds(as.issuer, null)
}
