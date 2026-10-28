// Serveur MCP stdio (JSON-RPC, une ligne par message), lancé par opencode dans le dossier du projet.
// Outils du coordinateur : start_thread (rend la main aussitôt), message_thread, list_threads.
import { createInterface } from 'node:readline'

const { OC_URL, OC_AUTH } = process.env
const MAX = 3 // fils en parallèle par projet
// opencode lance ce serveur dans le dossier du projet : un projet = un dossier.
const directory = process.cwd()

async function api(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(OC_URL + path, {
    method,
    headers: { Authorization: OC_AUTH ?? '', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`)
  return res.status === 204 ? undefined : res.json()
}

const str = (description: string) => ({ type: 'string', description })
const schema = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties) })
const tools = [
  {
    name: 'start_thread',
    description: `Délègue une tâche à un nouveau fil (agent séparé, même dossier). Rend la main tout de suite avec l'id du fil ; ne pas attendre son résultat : un message « [fil …] » arrivera à sa fin. ${MAX} fils en cours au maximum.`,
    inputSchema: schema({ titre: str('Titre court du fil (3 à 6 mots)'), consigne: str('Consigne complète et autonome pour le fil') })
  },
  {
    name: 'message_thread',
    description: "Envoie un message à un fil existant (précision, correction, suite). Rend la main tout de suite.",
    inputSchema: schema({ id: str('Id du fil (ses_…)'), texte: str('Message pour le fil') })
  },
  {
    name: 'list_threads',
    description: 'Liste les fils lancés par ce chat : id, titre, état (en cours ou inactif).',
    inputSchema: schema({})
  }
]

/** Fils du projet ; `parent` filtre ceux lancés par ce chat. */
async function threads(parent?: string) {
  const [list, active] = await Promise.all([api(`/api/session?directory=${encodeURIComponent(directory)}&limit=100`), api('/api/session/active')])
  return (list.data as any[])
    .filter((s) => s.metadata?.thread && (!parent || s.metadata.parent === parent))
    .map((s) => ({ id: s.id as string, titre: s.title as string, etat: active.data?.[s.id] ? 'en cours' : 'inactif' }))
}

const run = {
  async start_thread({ titre, consigne }: { titre: string; consigne: string }, parent?: string) {
    const running = (await threads()).filter((t) => t.etat === 'en cours')
    if (running.length >= MAX) throw new Error(`${MAX} fils déjà en cours (${running.map((t) => t.titre).join(', ')}) : réessaie quand l'un d'eux aura fini.`)
    // metadata.parent : l'app prévient ce chat quand le fil finit.
    const created = await api('/api/session', 'POST', { title: titre, location: { directory }, metadata: { thread: true, parent } })
    const id = created?.data?.id
    if (!id) throw new Error(`création du fil impossible : ${JSON.stringify(created)}`)
    await api(`/api/session/${id}/prompt`, 'POST', { text: consigne })
    return `Fil « ${titre} » lancé (id ${id}). Il tourne en arrière-plan.`
  },
  async message_thread({ id, texte }: { id: string; texte: string }) {
    if (!(await threads()).some((t) => t.id === id)) throw new Error(`fil inconnu dans ce projet : ${id}`)
    await api(`/api/session/${id}/prompt`, 'POST', { text: texte })
    return `Message envoyé au fil ${id}.`
  },
  async list_threads(_: unknown, parent?: string) {
    const list = await threads(parent)
    return list.length ? list.map((t) => `${t.id} · ${t.titre} · ${t.etat}`).join('\n') : 'Aucun fil.'
  }
}

async function handle(msg: any) {
  switch (msg.method) {
    case 'initialize':
      return { protocolVersion: msg.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'opencode-gui', version: '0.1.0' } }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools }
    case 'tools/call': {
      const fn = run[msg.params?.name as keyof typeof run]
      if (!fn) throw new Error(`outil inconnu : ${msg.params?.name}`)
      try {
        // opencode passe le chat appelant dans _meta.
        return { content: [{ type: 'text', text: await fn(msg.params.arguments ?? {}, msg.params._meta?.['ai.opencode/sessionID']) }] }
      } catch (err) {
        // Erreur d'outil (et non de protocole) : le modèle la lit et peut réagir.
        return { content: [{ type: 'text', text: String(err instanceof Error ? err.message : err) }], isError: true }
      }
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
