// Content scripts are classic scripts; dynamic import() pulls in the ESM code.
const modules = import(browser.runtime.getURL('src/discovery/html.js'))

// <link>/<a rel> elements describe the document that was loaded; after an
// in-page (history API) navigation they are stale, so only the URL is sent
// and the background falls back to content negotiation.
const documentHref = location.href

async function discover () {
  const { extractCandidates } = await modules
  const links = location.href === documentHref
    ? [...document.querySelectorAll('link[rel], a[rel]')].map((el) => ({
      rel: el.getAttribute('rel'),
      type: el.getAttribute('type'),
      href: el.getAttribute('href')
    }))
    : []
  const { objectCandidates, actorCandidates } = extractCandidates(links, document.baseURI)
  console.debug('fedifox: candidates', { objectCandidates, actorCandidates })
  try {
    const res = await browser.runtime.sendMessage({ type: 'page:discovered', url: location.href, objectCandidates, actorCandidates })
    console.debug('fedifox: background answered', res)
  } catch (e) {
    // background not ready or page is privileged
    console.debug('fedifox: could not reach background', e?.message)
  }
}

// The background loses its per-tab state when Firefox suspends the event
// page; it then asks for discovery to be run again.
browser.runtime.onMessage.addListener((message) => {
  if (message?.type === 'page:rediscover') discover().catch((e) => console.warn('fedifox: discovery failed', e))
})

discover().catch((e) => console.warn('fedifox: discovery failed', e))

// A click on a fediverse link is passed to the background, which opens the
// popup over this page, so the page is not left — but only while an account
// is connected; without one the links are left to Firefox. The answer is
// kept, because a click has to be cancelled synchronously.
const LINKS = ['web+ap', 'web+activitypub', 'web+follow', 'web+like', 'web+share', 'acct', 'fedi']
  .map((scheme) => `a[href^="${scheme}:" i]`).join(', ')
let hooked = false
const askHooked = () => browser.runtime.sendMessage({ type: 'link:hooked' })
  .then((res) => { hooked = Boolean(res?.hooked) })
  .catch(() => { hooked = false })
askHooked()
browser.storage.onChanged.addListener((changes) => {
  if (changes.accounts || changes.selectedActorId) askHooked()
})

// Clicks made by script are ignored, and so are clicks the page handled itself.
document.addEventListener('click', (e) => {
  if (!hooked || !e.isTrusted || e.defaultPrevented) return
  const link = e.target.closest?.(LINKS)
  if (!link) return
  e.preventDefault()
  browser.runtime.sendMessage({ type: 'link:clicked', link: link.getAttribute('href') })
    .then((res) => { if (res?.error) console.warn('fedifox: cannot open link', res.error.message) })
    .catch((err) => console.debug('fedifox: could not reach background', err?.message))
})
