// Minimal fetch double: routes are keyed by "METHOD url". A handler may
// return {status, headers, body} (body objects are JSON-encoded) or a Response.
export function createFetchStub (routes = {}) {
  const calls = []
  async function fetch (input, init = {}) {
    const url = typeof input === 'string' ? input : input.url
    const method = (init.method || 'GET').toUpperCase()
    const headers = new Headers(init.headers || {})
    const body = init.body
    calls.push({ method, url, headers, body })
    const handler = routes[`${method} ${url}`]
    if (!handler) throw new Error(`fetch-stub: no route for ${method} ${url}`)
    const out = typeof handler === 'function' ? await handler({ method, url, headers, body }) : handler
    if (out instanceof Response) return out
    const { status = 200, headers: h = {}, body: b } = out
    const isObject = b !== undefined && typeof b !== 'string'
    const responseHeaders = new Headers(h)
    if (isObject && !responseHeaders.has('content-type')) responseHeaders.set('content-type', 'application/activity+json')
    return new Response(isObject ? JSON.stringify(b) : b, { status, headers: responseHeaders })
  }
  return { fetch, calls, routes }
}
