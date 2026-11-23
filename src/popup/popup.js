import { resourceView, buttonsFor, accountLabel, intendedButton, offeredButtons, confirmTitle, doneMessage } from './render.js'
import { hasApi, intentLinks } from '../intents.js'
import { hostOf } from '../url.js'

const $ = (id) => document.getElementById(id)
const send = (msg) => browser.runtime.sendMessage(msg)

let tabId
let account = null
let resource = null
let composeAction = null
// Set when the popup was opened for a fediverse link: it then shows and acts
// on the link's target instead of the tab's page. `intended` is what the link
// asked for: only that button is offered, and the click on it is the
// confirmation.
const link = new URLSearchParams(location.search).get('link') || undefined
let intended

function setStatus (text, error, detail = '') {
  const footer = $('status')
  footer.hidden = !text
  footer.classList.toggle('error', Boolean(error))
  $('status-text').textContent = text || ''
  if (error) detail = [error.step, error.status, error.detail].filter(Boolean).join(' · ')
  $('status-details').hidden = !detail
  $('status-pre').textContent = detail
}

function fail (error) {
  setStatus(error.message, error)
}

async function loadAccounts () {
  const { accounts, selectedActorId } = await send({ type: 'accounts:list' })
  account = accounts.find((a) => a.actorId === selectedActorId) || accounts[0] || null
  const select = $('account')
  select.innerHTML = ''
  for (const account of accounts) {
    const opt = document.createElement('option')
    opt.value = account.actorId
    opt.textContent = accountLabel(account)
    opt.selected = account.actorId === selectedActorId
    select.append(opt)
  }
  const opt = document.createElement('option')
  opt.value = '__add__'
  opt.textContent = '+ add account'
  select.append(opt)
  select.hidden = accounts.length === 0
  $('logout').hidden = accounts.length === 0
  $('login').hidden = accounts.length > 0
  return accounts
}

// Buttons act here and need the API, so there are none without a state.
// Links open the page the account's server has for an action (FEP-3b86).
function render (state) {
  const wrap = $('buttons')
  wrap.innerHTML = ''
  const all = state ? buttonsFor(resource, state) : []
  const links = intentLinks(resource, account?.intents)
  // Opened for one action: the headline asks, and the only other button
  // leaves without doing anything.
  const asked = intendedButton(state ? all : links, intended)
  $('title').textContent = asked ? confirmTitle(resource, asked) : resourceView(resource).title
  wrap.classList.toggle('confirm', Boolean(asked))
  // Never focused: a key pressed while the popup opens must not run an action.
  for (const b of offeredButtons(all, intended)) {
    const btn = document.createElement('button')
    btn.textContent = b.label
    btn.title = b.label
    btn.dataset.name = b.name
    btn.classList.toggle('active', b.active)
    btn.classList.toggle('primary', b.name === asked)
    btn.disabled = Boolean(b.disabled)
    btn.addEventListener('click', () => {
      if (b.name === 'reply' || b.name === 'mention') { openCompose(b.name); return }
      runAction(b.name).catch((e) => fail({ message: e.message }))
    })
    wrap.append(btn)
  }
  if (asked) {
    const cancel = document.createElement('button')
    cancel.textContent = 'Cancel'
    // As a page the popup took the place of the page the link was on.
    cancel.addEventListener('click', () => { if (window.history.length > 1) window.history.back(); else window.close() })
    wrap.append(cancel)
  }
  const offered = asked ? links.filter((l) => l.name === asked) : links
  $('links').hidden = offered.length === 0
  $('links-label').textContent = offered.length ? `On ${hostOf(offered[0].href)}` : ''
  $('links-list').innerHTML = ''
  for (const l of offered) {
    const a = document.createElement('a')
    a.href = l.href
    a.target = '_blank'
    a.rel = 'noopener'
    a.dataset.name = l.name
    // The toolbar popup stays open over a new tab, so it opens the page itself
    // and closes. As a page, the popup makes way for the server's page.
    a.addEventListener('click', async (e) => {
      e.preventDefault()
      if (await browser.tabs.getCurrent()) { window.location.assign(l.href); return }
      await browser.tabs.create({ url: l.href })
      window.close()
    })
    const label = document.createElement('span')
    label.textContent = l.label
    a.append(label)
    $('links-list').append(a)
  }
  return offered.length
}

async function loadResource () {
  // Nothing can be done with a page before an account is connected: the
  // popup is only the form then.
  if (!account) {
    $('resource').hidden = true
    $('empty').hidden = true
    setStatus('')
    return
  }
  const res = await send(link ? { type: 'link:open', link } : { type: 'tab:resource', tabId })
  resource = res.resource || null
  intended = res.action
  $('resource').hidden = !resource
  $('empty').hidden = Boolean(resource)
  if (res.error) fail(res.error)
  if (!resource) return
  const view = resourceView(resource)
  $('title').textContent = view.title
  if (view.link) $('title').href = view.link
  else $('title').removeAttribute('href')
  $('subtitle').textContent = view.subtitle
  if (account && !hasApi(account)) {
    if (!render(null)) setStatus(`${hostOf(account.actorId)} has no page for this`)
    return
  }
  const st = await send({ type: 'action:state', tabId, link })
  if (st.error) {
    render(null)
    if (st.error.step === 'account') {
      setStatus(st.error.message)
      if (st.error.message.includes('expired')) $('login').hidden = false
    } else {
      fail(st.error)
    }
    return
  }
  render(st.state)
  if (intendedButton(buttonsFor(resource, st.state), intended) === 'reply') openCompose('reply')
}

async function runAction (name, text) {
  intended = undefined
  setStatus('Working…')
  const res = await send({ type: 'action:run', tabId, link, name, text })
  if (res.error) return fail(res.error)
  render(res.state)
  setStatus(doneMessage(name), null, res.activityId)
}

function openCompose (name) {
  composeAction = name
  $('compose').hidden = false
  $('compose-text').value = ''
  $('compose-text').focus()
}

$('compose').addEventListener('submit', async (e) => {
  e.preventDefault()
  const text = $('compose-text').value.trim()
  if (!text) return
  $('compose').hidden = true
  await runAction(composeAction, text)
})
$('compose-cancel').addEventListener('click', () => { $('compose').hidden = true })

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  setStatus('Logging in…')
  const manual = $('client-id').value ? { clientId: $('client-id').value, clientSecret: $('client-secret').value || undefined } : undefined
  const res = await send({ type: 'auth:login', input: $('login-input').value, manual })
  if (res.error) return fail(res.error)
  setStatus(hasApi(res.account) ? `Logged in as ${res.account.handle}` : `Connected ${res.account.handle}: actions open on ${hostOf(res.account.actorId)}`)
  await loadAccounts()
  await loadResource()
})

$('account').addEventListener('change', async (e) => {
  if (e.target.value === '__add__') {
    $('login').hidden = false
    return
  }
  const res = await send({ type: 'accounts:select', actorId: e.target.value })
  if (res.error) return fail(res.error)
  await loadAccounts()
  await loadResource()
})

$('logout').addEventListener('click', async () => {
  const actorId = $('account').value
  if (!actorId || actorId === '__add__') return
  const res = await send({ type: 'auth:logout', actorId })
  if (res.error) return fail(res.error)
  await loadAccounts()
  await loadResource()
})

$('copy').addEventListener('click', async () => {
  if (!resource) return
  try {
    await navigator.clipboard.writeText(resource.id)
    setStatus('Copied fediverse link')
  } catch (e) {
    fail({ message: e.message })
  }
})

;(async () => {
  // Never inside a frame: a page that embeds this could cover the buttons.
  if (window.top !== window) return
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  tabId = tab.id
  await loadAccounts()
  await loadResource()
})().catch((e) => fail({ message: e.message }))
