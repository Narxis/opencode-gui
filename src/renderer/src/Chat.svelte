<script lang="ts">
  import { marked } from 'marked'
  import DOMPurify from 'dompurify'
  import { untrack } from 'svelte'
  // Vue d'un fil : messages en direct + saisie avec sélecteur de modèle.
  // `main` : fil principal (suit le fil courant d'opencode) ; sinon fil fixe du panneau latéral.
  type Part = { id: string; messageID: string; type: string; text?: string; tool?: string; state?: any }
  let { sid = $bindable(), main = false, model, onchange }: {
    sid?: string; main?: boolean; model?: Model; onchange: () => void
  } = $props()

  let roles = $state<Record<string, string>>({})
  let order = $state<string[]>([])
  let parts = $state<Record<string, Part[]>>({})
  let input = $state('')
  let busy = $state(false)
  let error = $state('')
  let models = $state.raw<(Model & { name: string })[]>([]) // brut : passe tel quel par l'IPC
  let pick = $state('') // modèle choisi, « fournisseur/id »
  const key = (m?: Model) => (m ? `${m.providerID}/${m.id}` : '')

  // Historique (le chat principal passe aussi opencode sur ce fil) et modèles.
  untrack(() => (main ? window.oc.open(sid) : window.oc.messages(sid!))).then((list) => {
    for (const m of list) {
      if (m.type === 'user') {
        roles[m.id] = 'user'
        upsert(m.id, { id: m.id + ':text', messageID: m.id, type: 'text', text: m.text })
      } else if (m.type === 'assistant') {
        roles[m.id] = 'assistant'
        for (const [i, c] of m.content.entries()) {
          if (c.type === 'text') upsert(m.id, { id: c.id ?? `${m.id}:${i}`, messageID: m.id, type: 'text', text: c.text })
          else if (c.type === 'tool')
            upsert(m.id, { id: c.id, messageID: m.id, type: 'tool', tool: c.name, state: { ...c.state, output: c.state.content ? text(c.state.content) : c.state.error?.message } })
        }
      }
    }
  }, (err) => (error = String(err)))
  window.oc.models().then((r) => ((models = r.list), (pick = key(model ?? r.def))), () => {})

  function choose() {
    const m = models.find((x) => key(x) === pick)
    if (m && sid) window.oc.setModel(sid, m).catch((err) => (error = errText(err)))
  }

  function touch(messageID: string) {
    if (!order.includes(messageID)) order.push(messageID)
  }

  function upsert(messageID: string, part: Part) {
    touch(messageID)
    // Relire parts[...] après ??= : sinon on pousse dans le tableau brut, sans réactivité.
    parts[messageID] ??= []
    const list = parts[messageID]
    const i = list.findIndex((x) => x.id === part.id)
    if (i >= 0) list[i] = { ...list[i], ...part }
    else list.push(part)
  }

  let lastAssistant = ''
  const text = (c: any) => (Array.isArray(c) ? c.map((x) => x.text ?? JSON.stringify(x)).join('\n') : JSON.stringify(c))
  // Résumé d'un appel d'outil : première valeur texte de l'entrée, sur une ligne.
  const brief = (i: any) => String(Object.values(i ?? {}).find((v) => typeof v === 'string') ?? '').replace(/\s+/g, ' ').slice(0, 80)
  let sent = 0
  const errText = (err: any) => err?.data?.message ?? err?.message ?? JSON.stringify(err)

  $effect(() => window.oc.onEvent((e) => {
    const p = e.properties ?? e.data // opencode 2.x place la charge utile dans `data`
    if (main ? e.other : p?.sessionID !== sid) return // événement d'un autre fil
    switch (e.type) {
      // Événements « classiques »
      case 'message.updated':
        roles[p.info.id] = p.info.role
        touch(p.info.id)
        break
      case 'message.part.updated':
        upsert(p.part.messageID, p.part)
        break
      case 'message.part.delta': {
        // Texte reçu au fil de l'eau : on l'ajoute à la partie correspondante.
        const part = parts[p.messageID]?.find((x) => x.id === p.partID) as any
        if (part) part[p.field] = (part[p.field] ?? '') + p.delta
        break
      }
      // Événements d'opencode 2.2 (observés sur /api/event)
      // Le message de l'utilisateur est affiché à l'envoi (send), pas depuis l'écho d'opencode.
      case 'session.step.started':
        lastAssistant = p.assistantMessageID
        roles[lastAssistant] = 'assistant'
        touch(lastAssistant)
        break
      case 'session.text.started':
      case 'session.text.delta':
      case 'session.text.ended': {
        // Un texte = assistantMessageID + ordinal ; `delta` s'ajoute, `text` remplace.
        const id = `${p.assistantMessageID}:${p.ordinal}`
        roles[p.assistantMessageID] = 'assistant'
        const part = parts[p.assistantMessageID]?.find((x) => x.id === id)
        const text = p.text ?? (part?.text ?? '') + (p.delta ?? '')
        upsert(p.assistantMessageID, { id, messageID: p.assistantMessageID, type: 'text', text })
        break
      }
      case 'session.tool.input.started':
      case 'session.tool.called':
      case 'session.tool.success':
      case 'session.tool.failed': {
        const mid = p.assistantMessageID ?? lastAssistant
        const prev = parts[mid]?.find((x) => x.id === p.id)
        const status = e.type.endsWith('success') ? 'completed' : e.type.endsWith('failed') ? 'error' : 'running'
        upsert(mid, {
          id: p.id, messageID: mid, type: 'tool', tool: p.name ?? p.tool ?? prev?.tool,
          state: { ...prev?.state, status, ...(p.input ? { input: p.input } : {}), ...(p.content ? { output: text(p.content) } : {}) }
        })
        break
      }
      case 'session.execution.succeeded':
        busy = false
        onchange()
        break
      case 'session.execution.failed':
        error = errText(p.error ?? p)
        busy = false
        break
      case 'session.error':
        error = errText(p.error)
        busy = false
        break
      case 'session.idle':
        busy = false
        break
      case 'gui.error':
        error = p.message
        busy = false
        break
    }
  }))

  // Markdown du modèle → HTML assaini.
  const md = (t = '') => DOMPurify.sanitize(marked.parse(t, { async: false, breaks: true }))
  const dot: Record<string, string> = { completed: 'bg-green-500', error: 'bg-red-500', running: 'bg-amber-400 animate-pulse' }

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    input = ''
    busy = true
    const id = `local:${sent++}`
    roles[id] = 'user'
    upsert(id, { id: id + ':text', messageID: id, type: 'text', text })
    error = ''
    try {
      sid = await window.oc.send(text, sid, models.find((x) => key(x) === pick))
      onchange()
    } catch (err) {
      error = String(err)
      busy = false
    }
  }
</script>

<div class="flex-1 overflow-y-auto">
  <div class="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
    {#if !order.length && main}
      <p class="pt-32 text-center text-2xl text-muted">Que veux-tu faire ?</p>
    {/if}
    {#each order as id (id)}
      <div class={roles[id] === 'user' ? 'ml-auto w-fit max-w-[80%] rounded-2xl bg-panel px-4 py-2.5' : 'space-y-2'}>
        {#each parts[id] ?? [] as part (part.id)}
          {#if part.type === 'text'}
            {#if roles[id] === 'user'}<p class="whitespace-pre-wrap">{part.text}</p>
            {:else}<div class="md">{@html md(part.text)}</div>{/if}
          {:else if part.type === 'tool'}
            <details class="group rounded-lg border border-line text-sm">
              <summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-muted hover:text-fg">
                <span class="size-2 rounded-full {dot[part.state?.status] ?? 'bg-line'}"></span>
                <span class="font-mono text-fg">{part.tool ?? 'outil'}</span>
                <span class="truncate">{part.state?.title ?? brief(part.state?.input)}</span>
                <span class="ml-auto transition group-open:rotate-90">›</span>
              </summary>
              <pre class="max-h-80 overflow-auto border-t border-line p-3 font-mono text-xs text-muted">{JSON.stringify(part.state?.input ?? {}, null, 2)}{part.state?.output ? '\n\n' + part.state.output : ''}</pre>
            </details>
          {/if}
        {/each}
      </div>
    {/each}
    {#if busy}<p class="animate-pulse text-accent">✻ <span class="text-muted">Réflexion…</span></p>{/if}
    {#if error}<p class="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-500">{error}</p>{/if}
  </div>
</div>
<form class="mx-auto mb-4 flex w-[calc(100%-2rem)] max-w-3xl flex-col gap-1 rounded-2xl border border-line bg-panel p-2 shadow-sm focus-within:border-muted" onsubmit={(e) => { e.preventDefault(); send() }}>
  <textarea rows="1" class="field-sizing-content max-h-60 resize-none bg-transparent px-2 py-1.5 outline-none placeholder:text-muted" placeholder="Écris à opencode…  (Maj+Entrée = nouvelle ligne)" bind:value={input} onkeydown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}></textarea>
  <div class="flex items-center gap-2">
    {#if models.length}
      <select class="ml-auto max-w-48 truncate rounded-lg bg-transparent px-2 py-1 text-sm text-muted outline-none hover:bg-line/40 hover:text-fg" aria-label="Modèle" bind:value={pick} onchange={choose}>
        {#each models as m (key(m))}<option class="bg-panel text-fg" value={key(m)}>{m.name}</option>{/each}
      </select>
    {/if}
    <button class="{models.length ? '' : 'ml-auto'} size-9 rounded-xl bg-accent text-lg text-white disabled:opacity-40" disabled={busy || !input.trim()} aria-label="Envoyer">↑</button>
  </div>
</form>
