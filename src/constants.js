export const AS2_CONTEXT = 'https://www.w3.org/ns/activitystreams'
export const AS_PUBLIC = 'https://www.w3.org/ns/activitystreams#Public'
export const AP_ACCEPT = 'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
export const AP_CONTENT_TYPE = 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
export const AP_MEDIA_TYPES = ['application/activity+json', 'application/ld+json']
export const ACTOR_TYPES = ['Person', 'Group', 'Organization', 'Service', 'Application']

export const OAUTH_SCOPE = 'read write'
// Set to the published client.json URL once it is hosted; null disables CIMD.
export const CIMD_URL = null
export const CLIENT_NAME = 'fedifox'
export const CLIENT_URI = 'https://github.com/pfefferle/fedifox'
export const SOFTWARE_ID = '7f3c2b1e-6d4a-4f8e-9b0c-fedif0x00001'
export const SOFTWARE_VERSION = '0.1.0'

export const COLLECTION_PAGE_LIMIT = 5
export const DISCOVERY_TTL_MS = 10 * 60 * 1000
export const TOKEN_REFRESH_LEEWAY_MS = 60 * 1000

export function isApMediaType (contentType) {
  if (!contentType) return false
  const essence = contentType.split(';')[0].trim().toLowerCase()
  return AP_MEDIA_TYPES.includes(essence)
}
