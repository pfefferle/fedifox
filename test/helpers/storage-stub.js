// In-memory stand-in for browser.storage.local.
export function createStorageArea () {
  let data = {}
  return {
    async get (keys) {
      if (keys == null) return structuredClone(data)
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys)
      const out = {}
      for (const k of list) {
        if (k in data) out[k] = structuredClone(data[k])
        else if (!Array.isArray(keys) && typeof keys === 'object') out[k] = structuredClone(keys[k])
      }
      return out
    },
    async set (obj) { data = { ...data, ...structuredClone(obj) } },
    async remove (keys) { for (const k of [].concat(keys)) delete data[k] },
    async clear () { data = {} }
  }
}
