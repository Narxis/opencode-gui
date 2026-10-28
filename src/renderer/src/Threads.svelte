<script lang="ts">
  import { untrack } from 'svelte'
  // Panneau « Fils de discussion » : fils groupés par état, comme dans Claude.
  type Info = { todos?: { status: string }[]; files: string[]; last?: string }
  let { sessions, status, visible, onopen, onclose }: {
    sessions: any[]; status: Record<string, string>; visible: boolean
    onopen: (id: string) => void; onclose: () => void
  } = $props()

  let info = $state<Record<string, Info>>({})
  let running = $state<Record<string, unknown>>({})
  let query = $state('')
  let searching = $state(false)
  let sortBy = $state<'updated' | 'title' | 'created'>('updated')
  let sortMenu = $state(false)
  let wide = $state(false)
  let folded = $state<Record<string, boolean>>({ done: true })
  let now = $state(Date.now())
  setInterval(() => (now = Date.now()), 30_000)

  const FILE_TOOLS = /^(write|edit|multiedit|patch|apply_patch)$/
  // Relire info[sid] après ??= : sinon on modifie l'objet brut, sans réactivité.
  const get = (sid: string) => ((info[sid] ??= { files: [] }), info[sid])
  const loaded = new Set<string>()
  const addFile = (sid: string, f?: string) => f && !get(sid).files.includes(f) && get(sid).files.push(f)
  const name = (f: string) => f.split(/[\\/]/).pop()
  /** Lit un appel d'outil : checklist (todowrite) ou fichier écrit. */
  function tool(sid: string, tool?: string, input?: any) {
    if (tool === 'todowrite' && Array.isArray(input?.todos)) get(sid).todos = input.todos
    else if (tool && FILE_TOOLS.test(tool)) addFile(sid, input?.filePath ?? input?.path)
  }

  /** Charge checklist, fichiers et dernier message d'un fil depuis son historique. */
  async function load(sid: string) {
    if (loaded.has(sid)) return
    loaded.add(sid)
    const i = get(sid)
    for (const m of await window.oc.messages(sid).catch(() => [])) {
      if (m.type === 'user' && m.text) i.last = m.text
      for (const c of m.content ?? []) {
        if (c.type === 'text' && c.text) i.last = c.text
        else if (c.type === 'tool') tool(sid, c.name, c.state?.input)
      }
    }
  }

  // Ouverture du panneau : fils en cours (état initial) et détails de chaque fil.
  $effect(() => {
    if (!visible) return
    window.oc.active().then((a) => (running = a ?? {}), () => {})
    const ids = sessions.map((s) => s.id)
    untrack(() => ids.forEach(load))
  })

  window.oc.onEvent((e) => {
    const p = e.properties ?? e.data ?? {}
    const sid = p.sessionID
    if (!sid) return
    if (e.type === 'todo.updated') get(sid).todos = p.todos
    else if (e.type === 'session.diff') for (const d of p.diff ?? []) addFile(sid, d.file)
    else if (e.type === 'session.tool.called') tool(sid, p.name ?? p.tool, p.input)
    else if (e.type === 'session.text.ended' && p.text) get(sid).last = p.text
    else if (/^(session\.execution\.(succeeded|failed)|session\.idle|session\.error)$/.test(e.type)) delete running[sid]
  })

  const stateOf = (s: any) =>
    s.time?.archived ? 'done' : status[s.id] === 'wait' ? 'wait' : status[s.id] === 'busy' || (running[s.id] && !status[s.id]) ? 'busy' : 'idle'
  const SECTIONS = [
    ['wait', 'En attente de votre action'],
    ['busy', 'En cours'],
    ['idle', 'Inactif'],
    ['done', 'Résolu']
  ] as const
  const SORTS = [['updated', 'Dernière activité'], ['title', 'Nom'], ['created', 'Date de création']] as const
  const sorted = $derived(
    sessions
      .filter((s) => (s.title ?? '').toLowerCase().includes(query.trim().toLowerCase()))
      .toSorted((a, b) => (sortBy === 'title' ? (a.title ?? '').localeCompare(b.title ?? '') : (b.time?.[sortBy] ?? 0) - (a.time?.[sortBy] ?? 0)))
  )
  const groups = $derived(Object.groupBy(sorted, stateOf))

  /** Heure relative : maintenant, 5 min, 1h, 3j. */
  function ago(t?: number) {
    const m = Math.floor((now - (t ?? now)) / 60_000)
    return m < 1 ? 'maintenant' : m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}j`
  }
  const line = (t?: string) => t?.replace(/\s+/g, ' ').trim().slice(0, 140)
</script>

{#snippet spinner(cls = 'size-3.5')}
  <span class="{cls} inline-block shrink-0 animate-spin rounded-full border-2 border-muted border-t-transparent"></span>
{/snippet}

<aside class="{visible ? 'flex' : 'hidden'} {wide ? 'absolute inset-0 z-20' : 'w-96 shrink-0 border-l border-line'} flex-col bg-bg text-sm" data-panel="threads">
  <header class="flex items-center gap-1 border-b border-line px-3 py-2">
    {#if searching}
      <!-- svelte-ignore a11y_autofocus -->
      <input class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" placeholder="Rechercher des fils" autofocus bind:value={query} onkeydown={(e) => e.key === 'Escape' && ((searching = false), (query = ''))} />
    {:else}
      <span class="flex-1 text-muted">Fils de discussion</span>
    {/if}
    <button class="rounded p-1 text-muted hover:bg-line/40 hover:text-fg" aria-label="Rechercher" onclick={() => ((searching = !searching), (query = ''))}>
      <svg class="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" /></svg>
    </button>
    <div class="relative">
      <button class="rounded p-1 text-muted hover:bg-line/40 hover:text-fg" aria-label="Trier par" onclick={() => (sortMenu = !sortMenu)}>
        <svg class="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 4h12M4 8h8M6 12h4" /></svg>
      </button>
      {#if sortMenu}
        <button class="fixed inset-0 z-20 cursor-default" aria-label="Fermer le menu" onclick={() => (sortMenu = false)}></button>
        <div class="absolute right-0 top-8 z-30 w-48 rounded-lg border border-line bg-panel p-1 shadow-lg">
          <p class="px-2 py-1 text-xs text-muted">Trier par</p>
          {#each SORTS as [k, label] (k)}
            <button class="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/40" onclick={() => ((sortBy = k), (sortMenu = false))}>
              {label}{#if sortBy === k}<span class="ml-auto text-blue-500">✓</span>{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <button class="rounded p-1 text-muted hover:bg-line/40 hover:text-fg" aria-label={wide ? 'Réduire' : 'Agrandir'} onclick={() => (wide = !wide)}>
      <svg class="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">{#if wide}<path d="M9 3v4h4M7 13V9H3M9 7l5-5M7 9l-5 5" />{:else}<path d="M10 2h4v4M6 14H2v-4M14 2 9 7M2 14l5-5" />{/if}</svg>
    </button>
    <button class="rounded p-1 text-muted hover:bg-line/40 hover:text-fg" aria-label="Fermer" onclick={onclose}>
      <svg class="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m3 3 10 10M13 3 3 13" /></svg>
    </button>
  </header>

  <div class="flex-1 space-y-5 overflow-y-auto px-4 py-4">
    {#each SECTIONS as [key, label] (key)}
      {@const list = groups[key] ?? []}
      <section data-section={key}>
        {#if key === 'wait'}
          <p class="pb-2 text-muted">{label} · {list.length}</p>
          {#if !list.length}
            <p class="rounded-lg border border-dashed border-line px-3 py-4 text-center text-muted">Décisions, révisions et demandes d'autorisation.</p>
          {/if}
        {:else}
          <button class="flex items-center gap-1 pb-2 text-muted hover:text-fg" onclick={() => (folded[key] = !folded[key])}>
            {label} · {list.length} <span class="text-[10px]">{folded[key] ? '▶' : '▼'}</span>
          </button>
        {/if}
        {#if !folded[key]}
          {#each list as s (s.id)}
            {@const i = info[s.id]}
            {@const todos = i?.todos ?? []}
            <button class="flex w-full gap-3 rounded-lg px-2 py-2 text-left hover:bg-line/40" onclick={() => onopen(s.id)}>
              <span class="mt-1">
                {#if key === 'busy'}{@render spinner()}
                {:else if key === 'wait'}<svg class="size-3.5 text-amber-400" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="6" /><path d="M7 4v6" /></svg>
                {:else if status[s.id] === 'done'}<span class="m-0.5 block size-2.5 rounded-full bg-blue-500" title="Prêt"></span>
                {:else if status[s.id] === 'error'}<span class="m-0.5 block size-2.5 rounded-full bg-red-500" title="Échec"></span>
                {:else if key === 'done'}<svg class="size-3.5 text-muted" viewBox="0 0 14 14"><circle cx="7" cy="7" r="7" fill="currentColor" /><path d="m4 7.2 2 2 4-4.2" fill="none" stroke="var(--bg)" stroke-width="1.6" /></svg>
                {:else}<svg class="size-3.5 text-muted" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 2.2"><circle cx="7" cy="7" r="6" /></svg>{/if}
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex gap-2">
                  <span class="min-w-0 flex-1 truncate">
                    <span class={key === 'done' ? 'text-muted' : 'font-semibold'}>{s.title || 'Sans titre'}</span>
                    {#if i?.last}<span class="text-muted"> — {line(i.last)}</span>{/if}
                  </span>
                  <span class="shrink-0 text-xs text-muted">{ago(s.time?.updated)}</span>
                </span>
                {#if todos.length || i?.files.length}
                  <span class="mt-1 flex gap-1.5 text-xs text-muted">
                    {#if todos.length}
                      <span class="flex items-center gap-1 rounded-md bg-panel px-1.5 py-0.5" title="Checklist">
                        {#if key === 'busy'}{@render spinner('size-2.5')}{:else}<span class="size-2.5 rounded-full border-2 border-muted"></span>{/if}
                        {todos.filter((t) => t.status === 'completed').length}/{todos.length}
                      </span>
                    {/if}
                    {#if i?.files.length}
                      <span class="flex items-center gap-1 rounded-md bg-panel px-1.5 py-0.5" title={i.files.map(name).join('\n')}>
                        <svg class="size-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="5" width="8" height="9" rx="1.5" /><path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H10" /></svg>
                        {i.files.length}
                      </span>
                    {/if}
                  </span>
                {/if}
              </span>
            </button>
          {/each}
        {/if}
      </section>
    {/each}
  </div>
</aside>
