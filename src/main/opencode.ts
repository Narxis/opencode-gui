import { createOpencodeClient } from '@opencode-ai/sdk'
import type { OpencodeClient } from '@opencode-ai/sdk'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'

type Emit = (event: unknown) => void

let client: OpencodeClient | undefined
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
  for (let i = 0; i < 120; i++) {
    if (exited) throw new Error(`opencode s'est arrêté au démarrage : ${log().trim()}`)
    try {
      await fetch(`${baseUrl}/global/health`)
      return
    } catch {
      await sleep(500)
    }
  }
  throw new Error(`opencode ne répond pas après 60 s : ${log().trim()}`)
}

/** Lance `opencode serve` et relaie les événements vers le renderer. */
export async function startOpencode(emit: Emit) {
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  let output = ''
  // shell: true pour trouver `opencode.cmd` sous Windows
  proc = spawn('opencode', ['serve', '--hostname=127.0.0.1', `--port=${port}`], {
    shell: true,
    windowsHide: true
  })
  proc.stdout?.on('data', (d) => (output = (output + d).slice(-2000)))
  proc.stderr?.on('data', (d) => (output = (output + d).slice(-2000)))
  proc.once('error', (err) => emit({ type: 'gui.error', properties: { message: String(err) } }))
  await waitReady(baseUrl, proc, () => output)

  client = createOpencodeClient({ baseUrl })
  const { stream } = await client.event.subscribe()
  void (async () => {
    for await (const event of stream) emit(event)
  })().catch((err) => emit({ type: 'gui.error', properties: { message: String(err) } }))
}

export async function sendPrompt(text: string) {
  if (!client) throw new Error('opencode non démarré')
  if (!sessionId) {
    const res = await client.session.create({ body: {} })
    if (!res.data) throw new Error('création de session impossible')
    sessionId = res.data.id
  }
  await client.session.promptAsync({
    path: { id: sessionId },
    body: { parts: [{ type: 'text', text }] }
  })
}

export function stopOpencode() {
  if (!proc?.pid) return
  // Sous Windows, shell: true impose de tuer tout l'arbre de processus.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'])
  else proc.kill()
}
