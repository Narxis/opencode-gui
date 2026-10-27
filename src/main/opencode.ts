import { createOpencodeClient } from '@opencode-ai/sdk/v2'
import type { OpencodeClient } from '@opencode-ai/sdk/v2'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'

type Emit = (event: unknown) => void

let client: OpencodeClient | undefined
let baseUrl = ''
let ready: Promise<void> | undefined
// Mot de passe passé à opencode via OPENCODE_SERVER_PASSWORD ; utilisateur fixe « opencode ».
const password = randomBytes(24).toString('base64url')
const auth = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
let proc: ChildProcess | undefined
let sessionId: string | undefined

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Attend que le serveur réponde (quel que soit le format de sa sortie). */
async function waitReady(baseUrl: string, child: ChildProcess, log: () => string) {
  let exited = false
  child.once('exit', () => (exited = true))
  let last = 'aucune réponse'
  for (let i = 0; i < 60; i++) {
    if (exited) throw new Error(`opencode s'est arrêté au démarrage : ${log().trim()}`)
    try {
      // opencode 2.2 n'a pas de /api/health : /api/session répond 200 une fois prêt.
      const res = await fetch(`${baseUrl}/api/session`, { headers: { Authorization: auth } })
      if (res.ok) return
      last = `${res.status} ${(await res.text()).slice(0, 80)}`
    } catch (err) {
      last = String(err)
    }
    await sleep(500)
  }
  throw new Error(`opencode ne répond pas après 30 s (/api/session → ${last}) : ${log().trim()}`)
}

/** Lance `opencode serve` et relaie les événements vers le renderer. */
export function startOpencode(emit: Emit): Promise<void> {
  ready = launchOpencode(emit)
  ready.catch((err) => console.error('[opencode]', err))
  return ready
}

async function launchOpencode(emit: Emit) {
  const port = await freePort()
  baseUrl = `http://127.0.0.1:${port}`
  let output = ''
  // shell: true pour trouver `opencode.cmd` sous Windows
  proc = spawn('opencode', ['serve', '--hostname=127.0.0.1', `--port=${port}`], {
    shell: true,
    windowsHide: true,
    env: { ...process.env, OPENCODE_SERVER_PASSWORD: password }
  })
  const onData = (d: Buffer) => (output = (output + d).slice(-2000))
  proc.stdout?.on('data', onData)
  proc.stderr?.on('data', onData)
  proc.once('error', (err) => emit({ type: 'gui.error', properties: { message: String(err) } }))
  await waitReady(baseUrl, proc, () => output)
  const child = proc
  // Signale un arrêt d'opencode après le démarrage (sauf fermeture volontaire de l'app).
  child.once('exit', (code) => {
    if (proc === child) emit({ type: 'gui.error', properties: { message: `opencode s'est arrêté (code ${(code ?? 0) | 0})` } })
  })

  client = createOpencodeClient({ baseUrl, headers: { Authorization: auth } })
  const { stream } = await client.v2.event.subscribe()
  emit({ type: 'gui.ready' })
  void (async () => {
    for await (const event of stream) {
      // /api/event mélange toutes les sessions : celles des autres fils servent seulement à leur état.
      const e = event as { data?: { sessionID?: string }; properties?: { sessionID?: string } }
      const sid = e.data?.sessionID ?? e.properties?.sessionID
      emit(sid && sid !== sessionId ? { ...event, other: true } : event)
    }
  })().catch((err) => emit({ type: 'gui.error', properties: { message: String(err) } }))
}

export async function sendPrompt(text: string) {
  // Attend la fin du démarrage ; si celui-ci a échoué, on relaie sa vraie erreur.
  await ready
  if (!client) throw new Error('opencode non démarré')
  // Requêtes directes : le SDK 1.19 (dernier publié) ne colle pas à l'API d'opencode 2.2
  // (corps vide non envoyé pour la création, { prompt: { text } } au lieu de { text }).
  if (!sessionId) {
    const created = await post('/api/session', {})
    sessionId = created?.data?.id
    if (!sessionId) throw new Error(`création de session impossible : ${JSON.stringify(created)}`)
  }
  await post(`/api/session/${sessionId}/prompt`, { text })
  return sessionId
}

/** Fils (sessions) d'opencode, plus récents d'abord. */
export async function listSessions() {
  await ready
  return (await api('/api/session?order=desc&limit=100')).data
}

/** Passe sur un fil (undefined = nouveau fil, créé au premier message) et renvoie son historique. */
export async function openSession(id?: string) {
  await ready
  sessionId = id
  return id ? messages(id) : []
}

/** Historique d'un fil, sans en changer (panneau Fils de discussion). */
export async function messages(id: string) {
  await ready
  return (await api(`/api/session/${id}/message?order=asc&limit=200`)).data
}

/** Fils en cours d'exécution : { [id]: { type: 'running' } }. */
export async function activeSessions() {
  await ready
  return (await api('/api/session/active')).data
}

const post = (path: string, body: unknown) => api(path, 'POST', body)

async function api(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`)
  return res.json()
}

export function stopOpencode() {
  const child = proc
  proc = undefined
  if (!child?.pid) return
  // Sous Windows, shell: true impose de tuer tout l'arbre de processus.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
  else child.kill()
}
