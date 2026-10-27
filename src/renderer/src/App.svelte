<script lang="ts">
  import { marked } from 'marked'
  import DOMPurify from 'dompurify'
  import Threads from './Threads.svelte'
  type Part = { id: string; messageID: string; type: string; text?: string; tool?: string; state?: any }

  let roles = $state<Record<string, string>>({})
  let order = $state<string[]>([])
  let parts = $state<Record<string, Part[]>>({})
  let input = $state('')
  let busy = $state(false)
  let error = $state('')
  let sessions = $state<any[]>([])
  let current = $state<string>()
  // État de chaque fil, d'après les événements : busy, wait (attend l'utilisateur), done, error.
  let status = $state<Record<string, string>>({})
  let side = $state(innerWidth >= 768) // barre latérale visible
  let threads = $state(false) // panneau « Fils de discussion »
  // Fils regroupés par dossier de projet.
  let query = $state<string>() // recherche de fils (undefined : champ fermé)
  let folded = $state<Record<string, boolean>>({}) // sections repliées
  const projects = $derived(Object.entries(Object.groupBy(sessions.filter((s) => !query || (s.title ?? '').toLowerCase().includes(query.toLowerCase())), (s) => s.location?.directory ?? '?')))
  const base = (dir: string) => dir.split(/[\\/]/).filter(Boolean).pop() ?? dir

  const refresh = () => window.oc.sessions().then((s) => (sessions = s), (err) => (error = String(err)))

  /** Ouvre un fil (sans id : nouveau fil) et recharge son historique. */
  async function open(id?: string) {
    current = id
    if (id && status[id] === 'done') delete status[id]
    roles = {}
    order = []
    parts = {}
    busy = false
    error = ''
    try {
      for (const m of await window.oc.open(id)) {
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
    } catch (err) {
      error = String(err)
    }
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

  /** Met à jour l'état du fil `sid` selon l'événement ; « prêt » seulement pour un fil qu'on ne regarde pas. */
  function track(sid: string | undefined, type: string, p: any) {
    if (!sid) return
    const kind = type === 'session.status' ? p.status?.type : type
    let next: string | undefined
    if (/^(permission|question)(\.v2)?\.asked$/.test(kind)) next = 'wait'
    else if (/^(session\.execution\.failed|session\.error)$/.test(kind)) next = 'error'
    else if (/^(idle|session\.idle|session\.execution\.succeeded)$/.test(kind)) next = status[sid] === 'busy' && sid !== current ? 'done' : status[sid] === 'busy' ? '' : undefined
    else if (/^(busy|retry|session\.(step|text|tool)\.|(permission|question)(\.v2)?\.(replied|rejected))/.test(kind)) next = 'busy'
    if (next === undefined || status[sid] === next) return
    if (next) status[sid] = next
    else delete status[sid]
    if (!sessions.some((s) => s.id === sid)) refresh() // fil créé ailleurs (ex. par le coordinateur)
  }

  window.oc.onEvent((e) => {
    const p = e.properties ?? e.data // opencode 2.x place la charge utile dans `data`
    track(p?.sessionID, e.type, p ?? {})
    if (e.other) return // événement d'un autre fil : seul son état nous intéresse
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
        refresh()
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
      case 'gui.ready':
        refresh()
        break
      case 'gui.error':
        error = p.message
        busy = false
        break
    }
  })

  // Markdown du modèle → HTML assaini.
  const md = (t = '') => DOMPurify.sanitize(marked.parse(t, { async: false, breaks: true }))
  const dot: Record<string, string> = { completed: 'bg-green-500', error: 'bg-red-500', running: 'bg-amber-400 animate-pulse' }
  const badge: Record<string, [string, string]> = {
    busy: ['bg-muted animate-pulse', 'En cours'],
    wait: ['bg-amber-400', 'Attend ta réponse'],
    done: ['bg-blue-500', 'Prêt'],
    error: ['bg-red-500', 'Échec']
  }

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
      current = await window.oc.send(text)
      refresh()
    } catch (err) {
      error = String(err)
      busy = false
    }
  }
</script>

<main class="relative flex h-screen overflow-hidden">
  {#snippet icon(d: string)}<svg class="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path {d} /></svg>{/snippet}
  {#snippet toggle()}<button class="rounded-lg p-1.5 text-muted hover:bg-line/40 hover:text-fg" aria-label="Barre latérale" onclick={() => (side = !side)}>{@render icon('M3 5h18v14H3zM9 5v14')}</button>{/snippet}
  {#if side}
  <aside class="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-line bg-bg px-2 pb-3 pt-2 text-sm">
    <div class="px-1 pb-2">{@render toggle()}</div>
    <button class="flex items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-line/40" onclick={() => open()}>{@render icon('M12 5v14M5 12h14')}Créer</button>
    {#if query === undefined}
      <button class="flex items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-line/40" onclick={() => (query = '')}>{@render icon('M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4')}Rechercher</button>
    {:else}
      <!-- svelte-ignore a11y_autofocus -->
      <label class="flex items-center gap-3 rounded-lg bg-line/40 px-2 py-1.5">{@render icon('M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4')}<input class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" placeholder="Rechercher" autofocus bind:value={query} onkeydown={(e) => e.key === 'Escape' && (query = undefined)} onblur={() => !query && (query = undefined)} /></label>
    {/if}
    {#each projects as [dir, list] (dir)}
      <div class="mt-5">
        <button class="flex w-full items-center gap-1 px-2 pb-1 text-left text-xs font-semibold text-muted hover:text-fg" title={dir} onclick={() => (folded[dir] = !folded[dir])}>
          <span class="truncate">{base(dir)}</span><span class="inline-block transition {folded[dir] ? '-rotate-90' : ''}">▾</span>
        </button>
        {#if !folded[dir]}
        {#each list ?? [] as s (s.id)}
          <button class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-line/40 {s.id === current ? 'bg-line/70' : ''}" title={s.title} onclick={() => open(s.id)}>
            <span class="truncate">{s.title || 'Sans titre'}</span>
            {#if badge[status[s.id]]}<span class="ml-auto size-1.5 shrink-0 rounded-full {badge[status[s.id]][0]}" title={badge[status[s.id]][1]} data-status={status[s.id]}></span>{/if}
          </button>
        {/each}
        {/if}
      </div>
    {/each}
  </aside>
  {/if}
  <section class="relative flex min-w-0 flex-1 flex-col">
    {#if !side}<div class="absolute left-3 top-2 z-10">{@render toggle()}</div>{/if}
    {#if !threads}<button class="absolute right-2 top-2 z-10 rounded-lg px-2 py-1 text-sm text-muted hover:bg-line/40 hover:text-fg" onclick={() => (threads = true)}>Fils de discussion</button>{/if}
    <div class="flex-1 overflow-y-auto">
      <div class="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        {#if !order.length}
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
    <form class="mx-auto mb-4 flex w-[calc(100%-2rem)] max-w-3xl items-end gap-2 rounded-2xl border border-line bg-panel p-2 shadow-sm focus-within:border-muted" onsubmit={(e) => { e.preventDefault(); send() }}>
      <textarea rows="1" class="field-sizing-content max-h-60 flex-1 resize-none bg-transparent px-2 py-1.5 outline-none placeholder:text-muted" placeholder="Écris à opencode…  (Maj+Entrée = nouvelle ligne)" bind:value={input} onkeydown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}></textarea>
      <button class="size-9 rounded-xl bg-accent text-lg text-white disabled:opacity-40" disabled={busy || !input.trim()} aria-label="Envoyer">↑</button>
    </form>
  </section>
  <Threads {sessions} {status} visible={threads} onopen={open} onclose={() => (threads = false)} />
</main>
