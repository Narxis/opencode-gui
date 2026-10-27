import { createOpencode } from '@opencode-ai/sdk'
import type { OpencodeClient } from '@opencode-ai/sdk'
import { createServer } from 'node:net'

type Emit = (event: unknown) => void

let client: OpencodeClient | undefined
let close: (() => void) | undefined
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

/** Lance `opencode serve` et relaie les événements vers le renderer. */
export async function startOpencode(emit: Emit) {
  const oc = await createOpencode({ port: await freePort() })
  client = oc.client
  close = oc.server.close
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
  close?.()
}
