import { resourceView, buttonsFor, accountLabel } from './render.js'

const $ = (id) => document.getElementById(id)
const send = (msg) => browser.runtime.sendMessage(msg)

let tabId
let resource = null
let composeAction = null

function setStatus (text, error) {
  const footer = $('status')
  footer.hidden = !text
  footer.classList.toggle('error', Boolean(error))
  $('status-text').textContent = text || ''
  const detail = error ? [error.step, error.status, error.detail].filter(Boolean).join(' · ') : ''
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
  for (const b of buttonsFor(resource, state)) {
    const btn = document.createElement('button')
    btn.textContent = b.label
    btn.classList.toggle('active', b.active)
    btn.addEventListener('click', () => (b.name === 'reply' || b.name === 'mention') ? openCompose(b.name) : runAction(b.name))
    wrap.append(btn)
  }
}

async function loadResource () {
  const res = await send({ type: 'tab:resource', tabId })
  resource = res.resource
  $('resource').hidden = !resource
  $('empty').hidden = Boolean(resource)
  if (!resource) return
  const view = resourceView(resource)
  $('kind').textContent = view.kind
  $('title').textContent = view.title
  $('title').href = view.link
  $('subtitle').textContent = view.subtitle
  renderButtons({ liked: false, shared: false, following: false, followingAuthor: false })
  const st = await send({ type: 'action:state', tabId })
  if (st.error) { if (st.error.step !== 'account') fail(st.error); return }
  renderButtons(st.state)
}

async function runAction (name, text) {
  setStatus('Working…')
  const res = await send({ type: 'action:run', tabId, name, text })
  if (res.error) return fail(res.error)
  renderButtons(res.state)
  setStatus(res.activityId ? `Done: ${res.activityId}` : 'Done')
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
  await send({ type: 'accounts:select', actorId: e.target.value })
  await loadResource()
})

$('logout').addEventListener('click', async () => {
  const actorId = $('account').value
  if (!actorId || actorId === '__add__') return
  await send({ type: 'auth:logout', actorId })
  await loadAccounts()
  await loadResource()
})

$('copy').addEventListener('click', async () => {
  if (!resource) return
  await navigator.clipboard.writeText(resource.id)
  setStatus('Copied fediverse link')
})

;(async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  tabId = tab.id
  await loadAccounts()
  await loadResource()
})().catch((e) => fail({ message: e.message }))
