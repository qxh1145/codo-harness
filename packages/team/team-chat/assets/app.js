/** Team chat page. Every server string reaches the DOM through textContent, never as HTML. */

const api = async (path, options = {}) => {
  const response = await fetch(`/team/api/${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.error ?? 'Something went wrong. Please try again.'), { status: response.status })
  return data
}

const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
    else if (value === true) node.setAttribute(key, '')
    else if (value !== false && value !== undefined) node.setAttribute(key, value)
  }
  node.append(...children.filter(child => child !== undefined && child !== null))
  return node
}

const app = document.getElementById('app')
const state = {
  user: null, channels: [], members: [], channelId: null, threadId: null,
  messages: [], thread: [], replyCounts: {}, online: true, stream: null,
}

const field = (label, name, attributes = {}) => el('label', {}, label, el('input', { name, required: true, ...attributes }))
const values = form => Object.fromEntries(new FormData(form).entries())
const clockTime = at => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function authPage(title, hint, fields, submitLabel, submit) {
  const error = el('p', { class: 'error', role: 'alert' })
  const button = el('button', { class: 'primary', type: 'submit' }, submitLabel)
  const form = el('form', {
    onsubmit: async (event) => {
      event.preventDefault()
      error.textContent = ''
      button.disabled = true
      try {
        await submit(values(form))
      } catch (failure) {
        error.textContent = failure.message
        button.disabled = false
      }
    },
  },
  el('img', { src: '/team/logo.svg', alt: '' }),
  el('h1', {}, title),
  hint === undefined ? undefined : el('p', { class: 'hint' }, hint),
  ...fields, error, button)
  app.replaceChildren(el('section', { class: 'auth' }, form))
  form.querySelector('input')?.focus()
}

const showSetup = () => authPage('Set up your team',
  'Enter the setup code from the server, then create the first admin account.',
  [
    field('Setup code', 'code', { autocomplete: 'off' }),
    field('Your name', 'displayName', { autocomplete: 'name' }),
    field('Username', 'username', { autocomplete: 'username' }),
    field('Password', 'password', { type: 'password', minlength: 10, autocomplete: 'new-password' }),
  ], 'Create team',
  async (input) => { await api('setup', { method: 'POST', body: input }); await boot() })

const showLogin = () => authPage('Sign in', undefined,
  [
    field('Username', 'username', { autocomplete: 'username' }),
    field('Password', 'password', { type: 'password', autocomplete: 'current-password' }),
  ], 'Sign in',
  async (input) => { await api('login', { method: 'POST', body: input }); await boot() })

const showInvite = (token, displayName) => authPage(`Welcome, ${displayName}`, 'Choose a username and password to join your team.',
  [
    field('Username', 'username', { autocomplete: 'username' }),
    field('Password', 'password', { type: 'password', minlength: 10, autocomplete: 'new-password' }),
  ], 'Join team',
  async (input) => {
    await api('invites/accept', { method: 'POST', body: { ...input, token } })
    history.replaceState(null, '', '/team')
    await boot()
  })

/** Render message text: fenced code, inline code and @mentions, using text nodes only. */
function renderText(text) {
  const body = el('div', { class: 'msg-body' })
  text.split('```').forEach((part, index) => {
    if (index % 2 === 1) {
      body.append(el('pre', {}, el('code', {}, part.replace(/^[\w-]*\n/u, '').replace(/\n$/u, ''))))
      return
    }
    part.split(/(`[^`\n]+`|@[\w.-]+)/u).forEach((piece) => {
      if (piece.startsWith('`') && piece.endsWith('`') && piece.length > 2) body.append(el('code', {}, piece.slice(1, -1)))
      else if (piece.startsWith('@')) body.append(el('span', { class: 'mention' }, piece))
      else if (piece !== '') body.append(piece)
    })
  })
  return body
}

const AGENT_LABELS = { queued: 'queued', running: 'working', failed: 'failed' }

function messageRow(message, inThread) {
  const agent = message.authorKind === 'agent'
  const status = AGENT_LABELS[message.agentStatus]
  const replies = state.replyCounts[message.id] ?? 0
  return el('article', { class: agent ? 'msg agent' : 'msg' },
    el('div', { class: 'msg-head' },
      el('strong', {}, message.authorName),
      el('time', { datetime: new Date(message.createdAt).toISOString() }, clockTime(message.createdAt)),
      status === undefined ? undefined : el('span', { class: 'badge' }, status)),
    renderText(message.text),
    inThread ? undefined : el('div', { class: 'msg-actions' },
      el('button', { class: 'plain', type: 'button', onclick: () => openThread(message.id) },
        replies === 0 ? 'Reply in thread' : `${String(replies)} ${replies === 1 ? 'reply' : 'replies'}`)))
}

function composer(placeholder, send) {
  const input = el('textarea', { rows: 1, placeholder, 'aria-label': placeholder, maxlength: 8000 })
  const error = el('p', { class: 'error', role: 'alert' })
  const submit = async () => {
    const text = input.value.trim()
    if (text === '') return
    error.textContent = ''
    input.value = ''
    try {
      await send(text)
    } catch (failure) {
      input.value = text
      error.textContent = failure.message
    }
    input.focus()
  }
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      void submit()
    }
  })
  return el('div', { class: 'composer' },
    el('form', { onsubmit: (event) => { event.preventDefault(); void submit() } },
      input, el('button', { class: 'primary', type: 'submit' }, 'Send')),
    error)
}

function openDialog(title, fields, submitLabel, submit) {
  const error = el('p', { class: 'error', role: 'alert' })
  const dialog = el('dialog', {})
  const form = el('form', {
    onsubmit: async (event) => {
      event.preventDefault()
      error.textContent = ''
      try {
        const next = await submit(values(form), dialog)
        if (next !== 'keep') dialog.close()
      } catch (failure) {
        error.textContent = failure.message
      }
    },
  }, el('h2', {}, title), ...fields, error, el('div', { class: 'dialog-actions' },
    el('button', { type: 'button', onclick: () => dialog.close() }, 'Cancel'),
    el('button', { class: 'primary', type: 'submit' }, submitLabel)))
  dialog.append(form)
  dialog.addEventListener('close', () => dialog.remove())
  document.body.append(dialog)
  dialog.showModal()
}

const channelDialog = () => openDialog('New channel', [
  field('Name', 'name', { placeholder: 'backend', pattern: '[a-z0-9][a-z0-9\\-]*' }),
  el('label', {}, 'Topic', el('input', { name: 'topic' })),
  el('label', {}, 'Repository folder', el('input', { name: 'repo', placeholder: 'my-app' })),
  el('p', { class: 'hint' }, 'A folder inside the server’s repository directory. @codo reads code from it.'),
], 'Create', async (input) => {
  const { channel } = await api('channels', { method: 'POST', body: input })
  await selectChannel(channel.id)
})

const repoDialog = channel => openDialog(`Settings for #${channel.name}`, [
  el('label', {}, 'Topic', el('input', { name: 'topic', value: channel.topic })),
  el('label', {}, 'Repository folder', el('input', { name: 'repo', value: channel.repo ?? '' })),
], 'Save', async (input) => { await api(`channels/${channel.id}`, { method: 'PATCH', body: input }) })

const inviteDialog = () => openDialog('Invite a teammate', [
  field('Their name', 'displayName'),
  el('p', { class: 'hint' }, 'You will get a link that works once, for 7 days.'),
], 'Create link', async (input, dialog) => {
  const { token } = await api('invites', { method: 'POST', body: input })
  const url = `${location.origin}/team?invite=${encodeURIComponent(token)}`
  const link = el('input', { value: url, readonly: true, 'aria-label': 'Invitation link' })
  dialog.replaceChildren(el('form', { method: 'dialog' },
    el('h2', {}, 'Invitation link'),
    el('p', { class: 'hint' }, 'Send this to your teammate privately. It will not be shown again.'),
    el('div', { class: 'copy-field' }, link,
      el('button', { type: 'button', onclick: (event) => { void navigator.clipboard?.writeText(url); event.target.textContent = 'Copied' } }, 'Copy')),
    el('div', { class: 'dialog-actions' }, el('button', { class: 'primary' }, 'Done'))))
  return 'keep'
})

async function removeMember(member) {
  if (!confirm(`Remove ${member.displayName}? They will be signed out.`)) return
  await api(`members/${member.id}`, { method: 'DELETE' })
}

function sidebar(shell) {
  const admin = state.user.role === 'admin'
  return el('nav', { class: 'side', 'aria-label': 'Team' },
    el('div', { class: 'brand' }, el('img', { src: '/team/logo.svg', alt: '' }), document.title),
    el('div', {},
      el('div', { class: 'section-head' }, 'Channels',
        admin ? el('button', { class: 'plain', type: 'button', 'aria-label': 'New channel', onclick: channelDialog }, '+') : undefined),
      el('div', { class: 'nav' }, ...state.channels.map(channel => el('button', {
        type: 'button', 'aria-current': channel.id === state.channelId ? 'true' : 'false',
        onclick: () => { shell.classList.remove('menu-open'); void selectChannel(channel.id) },
      }, `# ${channel.name}`)))),
    el('div', {},
      el('div', { class: 'section-head' }, 'Team',
        admin ? el('button', { class: 'plain', type: 'button', 'aria-label': 'Invite a teammate', onclick: inviteDialog }, '+') : undefined),
      ...state.members.map(member => el('div', { class: 'member' }, el('span', {}, member.displayName),
        admin && member.id !== state.user.id
          ? el('button', { class: 'plain', type: 'button', 'aria-label': `Remove ${member.displayName}`, onclick: () => { void removeMember(member) } }, '×')
          : undefined))),
    el('div', { class: 'foot' }, el('span', {}, state.user.displayName),
      el('button', { class: 'plain', type: 'button', onclick: async () => { await api('logout', { method: 'POST' }); location.reload() } }, 'Sign out')))
}

function channelPane(shell, channel) {
  const admin = state.user.role === 'admin'
  const head = el('header', { class: 'pane-head' },
    el('button', { class: 'menu-toggle', type: 'button', 'aria-label': 'Open menu', onclick: () => shell.classList.toggle('menu-open') }, '☰'),
    el('div', { class: 'pane-title' },
      el('h2', {}, channel === undefined ? 'Welcome' : `# ${channel.name}`),
      channel === undefined ? undefined : el('p', {}, channel.repo === null ? (channel.topic || 'No repository linked') : (channel.topic || `Repository: ${channel.repo}`))),
    channel !== undefined && admin ? el('button', { type: 'button', onclick: () => repoDialog(channel) }, 'Settings') : undefined)
  if (channel === undefined) {
    return el('section', { class: 'pane channel' }, head, el('div', { class: 'feed' }, el('p', { class: 'empty' },
      admin ? 'Create your first channel with the + next to Channels.' : 'No channels yet. Ask an admin to create one.')))
  }
  const feed = el('div', { class: 'feed', id: 'channel-feed', role: 'log', 'aria-label': `Messages in ${channel.name}` },
    ...(state.messages.length === 0
      ? [el('p', { class: 'empty' }, 'No messages yet. Say hello, or tag @codo to ask about the code.')]
      : state.messages.map(message => messageRow(message, false))))
  return el('section', { class: 'pane channel' }, head,
    state.online ? undefined : el('p', { class: 'offline' }, 'Reconnecting…'), feed,
    composer(`Message #${channel.name}, or tag @codo`, text => api(`channels/${channel.id}/messages`, { method: 'POST', body: { text } })))
}

function threadPane() {
  const channelId = state.channelId
  const threadId = state.threadId
  return el('aside', { class: 'pane thread', 'aria-label': 'Thread' },
    el('header', { class: 'pane-head' }, el('h2', {}, 'Thread'),
      el('button', { type: 'button', onclick: closeThread }, 'Close')),
    el('div', { class: 'feed', id: 'thread-feed', role: 'log' }, ...state.thread.map(message => messageRow(message, true))),
    composer('Reply, or tag @codo', text => api(`channels/${channelId}/messages`, { method: 'POST', body: { text, threadId } })))
}

function render() {
  const channel = state.channels.find(candidate => candidate.id === state.channelId)
  const shell = el('div', { class: state.threadId === null ? 'shell' : 'shell threaded' })
  shell.append(sidebar(shell), channelPane(shell, channel))
  if (state.threadId !== null) shell.append(threadPane())
  const active = document.activeElement
  const draft = active instanceof HTMLTextAreaElement ? { value: active.value, inThread: active.closest('.thread') !== null } : undefined
  app.replaceChildren(shell)
  if (draft !== undefined) {
    const input = document.querySelector(draft.inThread ? '.thread textarea' : '.channel textarea')
    if (input !== null) {
      input.value = draft.value
      input.focus()
    }
  }
  for (const id of ['channel-feed', 'thread-feed']) {
    const feed = document.getElementById(id)
    if (feed !== null) feed.scrollTop = feed.scrollHeight
  }
}

async function loadChannel() {
  if (state.channelId === null) return
  const data = await api(`channels/${state.channelId}/messages`)
  state.messages = data.messages
  state.replyCounts = data.replyCounts
}

async function loadThread() {
  if (state.threadId === null) return
  const params = new URLSearchParams({ thread: state.threadId })
  state.thread = (await api(`channels/${state.channelId}/messages?${params.toString()}`)).messages
}

async function selectChannel(id) {
  state.channelId = id
  state.threadId = null
  state.thread = []
  await loadChannel()
  render()
}

async function openThread(id) {
  state.threadId = id
  await loadThread()
  render()
}

function closeThread() {
  state.threadId = null
  state.thread = []
  render()
}

function applyMessage(message, list) {
  const index = list.findIndex(candidate => candidate.id === message.id)
  if (index === -1) list.push(message)
  else list[index] = message
}

function onEvent(event) {
  if (event.type === 'channel') {
    const index = state.channels.findIndex(channel => channel.id === event.channel.id)
    if (index === -1) state.channels.push(event.channel)
    else state.channels[index] = event.channel
  } else if (event.type === 'members-changed') {
    void api('members').then(({ members }) => { state.members = members; render() })
    return
  } else {
    const { message } = event
    if (message.channelId !== state.channelId) return
    if (message.threadId === null) applyMessage(message, state.messages)
    else if (event.type === 'message') state.replyCounts[message.threadId] = (state.replyCounts[message.threadId] ?? 0) + 1
    if (state.threadId !== null && (message.threadId === state.threadId || message.id === state.threadId)) applyMessage(message, state.thread)
  }
  render()
}

function connect() {
  state.stream?.close()
  const stream = new EventSource('/team/api/events')
  state.stream = stream
  let opened = false
  stream.onopen = async () => {
    state.online = true
    if (opened) {
      await Promise.all([loadChannel(), loadThread()]).catch(() => undefined)
    }
    opened = true
    render()
  }
  stream.onmessage = (message) => { onEvent(JSON.parse(message.data)) }
  stream.onerror = async () => {
    state.online = false
    render()
    const { user } = await api('state').catch(() => ({ user: state.user }))
    if (user === null) location.reload()
  }
}

async function boot() {
  const invite = new URLSearchParams(location.search).get('invite')
  const status = await api('state')
  if (status.setupRequired) {
    showSetup()
    return
  }
  if (status.user === null) {
    if (invite !== null) {
      try {
        const { displayName } = await api(`invites/${encodeURIComponent(invite)}`)
        showInvite(invite, displayName)
        return
      } catch {
        history.replaceState(null, '', '/team')
      }
    }
    showLogin()
    return
  }
  state.user = status.user
  const [{ channels }, { members }] = await Promise.all([api('channels'), api('members')])
  state.channels = channels
  state.members = members
  state.channelId = channels[0]?.id ?? null
  await loadChannel()
  render()
  connect()
}

void boot().catch((failure) => {
  app.replaceChildren(el('section', { class: 'auth' }, el('p', { class: 'error' }, failure.message)))
})
