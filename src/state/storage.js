import { DISCOVERY_TTL_MS } from '../constants.js'

const recordKey = (actorId, type, objectId) => `${actorId} ${type} ${objectId}`

export function createStore (area) {
  async function read (key, fallback) {
    const out = await area.get({ [key]: fallback })
    return out[key]
  }

  return {
    async getAccounts () { return Object.values(await read('accounts', {})) },
    async getAccount (actorId) { return (await read('accounts', {}))[actorId] || null },
    async saveAccount (account) {
      const accounts = await read('accounts', {})
      accounts[account.actorId] = account
      await area.set({ accounts })
    },
    async removeAccount (actorId) {
      const accounts = await read('accounts', {})
      delete accounts[actorId]
      await area.set({ accounts })
      if ((await read('selectedActorId', null)) === actorId) await area.remove('selectedActorId')
    },
    async getSelectedActorId () { return read('selectedActorId', null) },
    async setSelectedActorId (actorId) { await area.set({ selectedActorId: actorId }) },
    async getSelectedAccount () {
      const accounts = await read('accounts', {})
      const selected = await read('selectedActorId', null)
      if (selected && accounts[selected]) return accounts[selected]
      return Object.values(accounts)[0] || null
    },

    async getClientCreds (asOrigin) { return (await read('clientCreds', {}))[asOrigin] || null },
    async saveClientCreds (asOrigin, creds) {
      const clientCreds = await read('clientCreds', {})
      clientCreds[asOrigin] = creds
      await area.set({ clientCreds })
    },

    async getActionRecord (actorId, type, objectId) {
      return (await read('actionRecords', {}))[recordKey(actorId, type, objectId)] || null
    },
    async saveActionRecord (actorId, type, objectId, activityId, at) {
      const actionRecords = await read('actionRecords', {})
      actionRecords[recordKey(actorId, type, objectId)] = { activityId, at }
      await area.set({ actionRecords })
    },
    async removeActionRecord (actorId, type, objectId) {
      const actionRecords = await read('actionRecords', {})
      delete actionRecords[recordKey(actorId, type, objectId)]
      await area.set({ actionRecords })
    },

    async getDiscovery (url, now) {
      const entry = (await read('discoveryCache', {}))[url]
      if (!entry || now - entry.at > DISCOVERY_TTL_MS) return undefined
      return entry.resource
    },
    async saveDiscovery (url, resource, now) {
      const discoveryCache = await read('discoveryCache', {})
      discoveryCache[url] = { resource, at: now }
      await area.set({ discoveryCache })
    }
  }
}
