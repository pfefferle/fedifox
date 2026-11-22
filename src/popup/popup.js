import { resourceView, buttonsFor, accountLabel, intendedButton, offeredButtons, confirmTitle, doneMessage } from './render.js'

const $ = (id) => document.getElementById(id)
const send = (msg) => browser.runtime.sendMessage(msg)

let tabId
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

function renderButtons (state) {
  const wrap = $('buttons')
  wrap.innerHTML = ''
  const all = buttonsFor(resource, state)
  // Opened for one action: the headline asks, and the only other button
  // leaves without doing anything.
  const asked = intendedButton(all, intended)
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
}

async function loadResource () {
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
  const st = await send({ type: 'action:state', tabId, link })
  if (st.error) {
    $('buttons').innerHTML = ''
    if (st.error.step === 'account') {
      setStatus(st.error.message)
      if (st.error.message.includes('expired')) $('login').hidden = false
    } else {
      fail(st.error)
    }
    return
  }
  renderButtons(st.state)
  if (intendedButton(buttonsFor(resource, st.state), intended) === 'reply') openCompose('reply')
}

async function runAction (name, text) {
  intended = undefined
  setStatus('Working…')
  const res = await send({ type: 'action:run', tabId, link, name, text })
  if (res.error) return fail(res.error)
  renderButtons(res.state)
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
  setStatus(`Logged in as ${res.account.handle}`)
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
