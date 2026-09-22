// Content scripts are classic scripts; dynamic import() pulls in the ESM code.
const modules = import(browser.runtime.getURL('src/discovery/html.js'))

async function discover () {
  const { extractCandidates } = await modules
  const links = [...document.querySelectorAll('link[rel], a[rel]')].map((el) => ({
    rel: el.getAttribute('rel'),
    type: el.getAttribute('type'),
    href: el.getAttribute('href')
  }))
  const { objectCandidates, actorCandidates } = extractCandidates(links, document.baseURI)
  try {
    await browser.runtime.sendMessage({ type: 'page:discovered', url: location.href, objectCandidates, actorCandidates })
  } catch {
    // background not ready or page is privileged
  }
}

// The background loses its per-tab state when Firefox suspends the event
// page; it then asks for discovery to be run again.
browser.runtime.onMessage.addListener((message) => {
  if (message?.type === 'page:rediscover') discover().catch(() => {})
})

discover().catch(() => {})
