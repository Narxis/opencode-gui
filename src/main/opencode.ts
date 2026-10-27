import { createOpencodeClient } from '@opencode-ai/sdk/v2'
import type { OpencodeClient } from '@opencode-ai/sdk/v2'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'

type Emit = (event: unknown) => void

let client: OpencodeClient | undefined
let baseUrl = ''
let ready: Promise<void> | undefined
let password = randomBytes(16).toString('hex')
let useAuth = true
const auth = () => (useAuth ? `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` : '')
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
      for (const withAuth of [useAuth, !useAuth]) {
        useAuth = withAuth
        const res = await fetch(`${baseUrl}/api/health`, { headers: { Authorization: auth() } })
        if (res.ok) return
        last = `${res.status} ${(await res.text()).slice(0, 120)}`
      }
    } catch (err) {
      last = String(err)
    }
    await sleep(500)
  }
  throw new Error(`opencode ne répond pas après 30 s (/api/health → ${last}) : ${log().trim()}`)
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
    env: { ...process.env, OPENCODE_SERVER_USERNAME: 'opencode', OPENCODE_SERVER_PASSWORD: password }
  })
  const onData = (d: Buffer) => {
    output = (output + d).slice(-2000)
    // opencode 2.x affiche le mot de passe réellement utilisé au lancement.
    const m = output.match(/server password\W+(\S+)/i)
    if (m) password = m[1]
  }
  proc.stdout?.on('data', onData)
  proc.stderr?.on('data', onData)
  proc.once('error', (err) => emit({ type: 'gui.error', properties: { message: String(err) } }))
  await waitReady(baseUrl, proc, () => output)
  const child = proc
  // Signale un arrêt d'opencode après le démarrage (sauf fermeture volontaire de l'app).
  child.once('exit', (code) => {
    if (proc === child) emit({ type: 'gui.error', properties: { message: `opencode s'est arrêté (code ${(code ?? 0) | 0})` } })
  })

  client = createOpencodeClient({ baseUrl, headers: { Authorization: auth() } })
  const { stream } = await client.v2.event.subscribe()
  void (async () => {
    for await (const event of stream) emit(event)
  })().catch((err) => emit({ type: 'gui.error', properties: { message: String(err) } }))
}

export async function sendPrompt(text: string) {
  // Attend la fin du démarrage ; si celui-ci a échoué, on relaie sa vraie erreur.
  await ready
  if (!client) throw new Error('opencode non démarré')
  if (!sessionId) {
    const res = await client.v2.session.create({})
    const created = res.data as { id?: string; data?: { id?: string } } | undefined
    const id = created?.id ?? created?.data?.id
    if (!id) throw new Error(`création de session impossible : ${JSON.stringify(res.error ?? res.data)}`)
    sessionId = id
  }
  const res = await client.v2.session.prompt({ sessionID: sessionId, prompt: { text } })
  if (res.error) throw new Error(`envoi impossible : ${JSON.stringify(res.error)}`)
}

export function stopOpencode() {
  const child = proc
  proc = undefined
  if (!child?.pid) return
  // Sous Windows, shell: true impose de tuer tout l'arbre de processus.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
  else child.kill()
}
