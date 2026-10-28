// Serveur MCP stdio (JSON-RPC, une ligne par message), lancé par opencode.
// Outil `start_thread` : crée un fil (session opencode) dans le dossier du projet et rend la main aussitôt.
import { createInterface } from 'node:readline'

const { OC_URL, OC_AUTH } = process.env
const MAX = 3 // fils en parallèle par projet

async function api(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(OC_URL + path, {
    method,
    headers: { Authorization: OC_AUTH ?? '', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`)
  return res.status === 204 ? undefined : res.json()
}

const tools = [
  {
    name: 'start_thread',
    description: `Délègue une tâche à un nouveau fil (agent séparé, même dossier). Rend la main tout de suite avec l'id du fil ; ne pas attendre son résultat. ${MAX} fils en cours au maximum.`,
    inputSchema: {
      type: 'object',
      properties: {
        titre: { type: 'string', description: 'Titre court du fil (3 à 6 mots)' },
        consigne: { type: 'string', description: 'Consigne complète et autonome pour le fil' }
      },
      required: ['titre', 'consigne']
    }
  }
]

async function startThread({ titre, consigne }: { titre: string; consigne: string }) {
  // opencode lance ce serveur dans le dossier du projet : un projet = un dossier.
  const directory = process.cwd()
  const [list, active] = await Promise.all([
    api(`/api/session?directory=${encodeURIComponent(directory)}&limit=100`),
    api('/api/session/active')
  ])
  const running = list.data.filter((s: any) => s.metadata?.thread && active.data?.[s.id])
  if (running.length >= MAX) throw new Error(`${MAX} fils déjà en cours (${running.map((s: any) => s.title).join(', ')}) : réessaie quand l'un d'eux aura fini.`)
  const created = await api('/api/session', 'POST', { title: titre, location: { directory }, metadata: { thread: true } })
  const id = created?.data?.id
  if (!id) throw new Error(`création du fil impossible : ${JSON.stringify(created)}`)
  await api(`/api/session/${id}/prompt`, 'POST', { text: consigne })
  return `Fil « ${titre} » lancé (id ${id}). Il tourne en arrière-plan.`
}

async function handle(msg: any) {
  switch (msg.method) {
    case 'initialize':
      return { protocolVersion: msg.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'opencode-gui', version: '0.1.0' } }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools }
    case 'tools/call':
      if (msg.params?.name !== 'start_thread') throw new Error(`outil inconnu : ${msg.params?.name}`)
      try {
        return { content: [{ type: 'text', text: await startThread(msg.params.arguments ?? {}) }] }
      } catch (err) {
        // Erreur d'outil (et non de protocole) : le modèle la lit et peut réagir.
        return { content: [{ type: 'text', text: String(err instanceof Error ? err.message : err) }], isError: true }
      }
    default:
      throw Object.assign(new Error(`méthode inconnue : ${msg.method}`), { code: -32601 })
  }
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return
  const msg = JSON.parse(line)
  if (msg.id === undefined) return // notification (ex. notifications/initialized)
  const reply = await handle(msg).then(
    (result) => ({ jsonrpc: '2.0', id: msg.id, result }),
    (err) => ({ jsonrpc: '2.0', id: msg.id, error: { code: err.code ?? -32603, message: String(err.message ?? err) } })
  )
  process.stdout.write(JSON.stringify(reply) + '\n')
})
