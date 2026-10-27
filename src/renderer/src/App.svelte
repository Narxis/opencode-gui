<script lang="ts">
  import Threads from './Threads.svelte'
  import Chat from './Chat.svelte'

  let error = $state('')
  let sessions = $state<any[]>([])
  let current = $state<string>()
  let view = $state(0) // change à chaque ouverture : recrée le chat principal
  // État de chaque fil, d'après les événements : busy, wait (attend l'utilisateur), done, error.
  let status = $state<Record<string, string>>({})
  let side = $state(innerWidth >= 768) // barre latérale visible
  let threads = $state(false) // panneau « Fils de discussion »
  let split = $state<string>() // fil ouvert dans le panneau scindé de droite
  let mini = $state(false) // panneau scindé réduit
  let wide = $state(false) // panneau scindé agrandi
  let width = $state(innerWidth)
  // Trop étroit pour deux colonnes de 480 px (+ barre latérale) : le panneau passe en plein écran.
  const narrow = $derived(width < (side ? 1216 : 960))
  // Fils regroupés par dossier de projet.
  const projects = $derived(Object.entries(Object.groupBy(sessions, (s) => s.location?.directory ?? '?')))
  const base = (dir: string) => dir.split(/[\/]/).filter(Boolean).pop() ?? dir
  const find = (id?: string) => sessions.find((s) => s.id === id)

  const refresh = () => window.oc.sessions().then((s) => (sessions = s), (err) => (error = String(err)))

  /** Ouvre un fil dans le chat principal (sans id : nouveau fil). */
  function open(id?: string) {
    current = id
    if (id && status[id] === 'done') delete status[id]
    error = ''
    view++
  }

  /** Ouvre un fil dans le panneau scindé, à la place de la liste des fils. */
  function openSplit(id: string) {
    if (status[id] === 'done') delete status[id]
    split = id
    threads = false
    mini = false
  }

  /** Met à jour l'état du fil `sid` selon l'événement ; « prêt » seulement pour un fil qu'on ne regarde pas. */
  function track(sid: string | undefined, type: string, p: any) {
    if (!sid) return
    const kind = type === 'session.status' ? p.status?.type : type
    const seen = sid === current || (sid === split && !mini)
    let next: string | undefined
    if (/^(permission|question)(\.v2)?\.asked$/.test(kind)) next = 'wait'
    else if (/^(session\.execution\.failed|session\.error)$/.test(kind)) next = 'error'
    else if (/^(idle|session\.idle|session\.execution\.succeeded)$/.test(kind)) next = status[sid] === 'busy' && !seen ? 'done' : status[sid] === 'busy' ? '' : undefined
    else if (/^(busy|retry|session\.(step|text|tool)\.|(permission|question)(\.v2)?\.(replied|rejected))/.test(kind)) next = 'busy'
    if (next === undefined || status[sid] === next) return
    if (next) status[sid] = next
    else delete status[sid]
    if (!sessions.some((s) => s.id === sid)) refresh() // fil créé ailleurs (ex. par le coordinateur)
  }

  window.oc.onEvent((e) => {
    const p = e.properties ?? e.data // opencode 2.x place la charge utile dans `data`
    track(p?.sessionID, e.type, p ?? {})
    if (e.type === 'gui.ready') refresh()
  })

  const badge: Record<string, [string, string]> = {
    busy: ['bg-muted animate-pulse', 'En cours'],
    wait: ['bg-amber-400', 'Attend ta réponse'],
    done: ['bg-blue-500', 'Prêt'],
    error: ['bg-red-500', 'Échec']
  }
  const icon = 'rounded p-1 text-muted hover:bg-line/40 hover:text-fg'
</script>

<svelte:window bind:innerWidth={width} />

<main class="relative flex h-screen overflow-hidden">
  {#if side}
  <aside class="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-panel p-3 text-sm">
    <button class="rounded-lg border border-line px-3 py-2 text-left hover:bg-line/40" onclick={() => open()}>+ Nouveau fil</button>
    {#each projects as [dir, list] (dir)}
      <div>
        <p class="truncate px-2 pb-1 text-xs font-medium uppercase text-muted" title={dir}>{base(dir)}</p>
        {#each list ?? [] as s (s.id)}
          <button class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-line/40 {s.id === current ? 'bg-line/60 text-fg' : 'text-muted'}" title={s.title} onclick={() => open(s.id)}>
            <span class="truncate">{s.title || 'Sans titre'}</span>
            {#if badge[status[s.id]]}<span class="ml-auto size-2 shrink-0 rounded-full {badge[status[s.id]][0]}" title={badge[status[s.id]][1]} data-status={status[s.id]}></span>{/if}
          </button>
        {/each}
      </div>
    {/each}
  </aside>
  {/if}
  <section class="relative flex min-w-0 flex-1 flex-col">
    <button class="absolute left-2 top-2 z-10 rounded-lg px-2 py-1 text-muted hover:bg-line/40 hover:text-fg" aria-label="Barre latérale" onclick={() => (side = !side)}>☰</button>
    {#if !threads && (!split || mini)}<button class="absolute right-2 top-2 z-10 rounded-lg px-2 py-1 text-sm text-muted hover:bg-line/40 hover:text-fg" onclick={() => (threads = true)}>Fils de discussion</button>{/if}
    {#if error}<p class="mx-auto mt-12 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-500">{error}</p>{/if}
    {#key view}<Chat main bind:sid={current} model={find(current)?.model} onchange={refresh} />{/key}
  </section>
  {#if split}
    <aside class="{mini || threads ? 'hidden' : 'flex'} {wide || narrow ? 'absolute inset-0 z-20' : 'w-[45%] min-w-[480px] shrink-0 border-l border-line'} flex-col bg-bg" data-panel="thread">
      <header class="flex items-center gap-1 border-b border-line px-3 py-2 text-sm">
        <nav class="flex min-w-0 flex-1 items-center gap-1.5">
          <button class="shrink-0 text-muted hover:text-fg" onclick={() => (threads = true)}>Fils de discussion</button>
          <span class="text-muted">›</span>
          <span class="truncate">{find(split)?.title || 'Sans titre'}</span>
        </nav>
        <button class={icon} aria-label="Réduire" onclick={() => ((mini = true), (wide = false))}>
          <svg class="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 8h10" /></svg>
        </button>
        {#if !narrow}
          <button class={icon} aria-label={wide ? 'Rétablir' : 'Agrandir'} onclick={() => (wide = !wide)}>
            <svg class="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">{#if wide}<path d="M9 3v4h4M7 13V9H3M9 7l5-5M7 9l-5 5" />{:else}<path d="M10 2h4v4M6 14H2v-4M14 2 9 7M2 14l5-5" />{/if}</svg>
          </button>
        {/if}
        <button class={icon} aria-label="Fermer" onclick={() => ((split = undefined), (wide = false))}>
          <svg class="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m3 3 10 10M13 3 3 13" /></svg>
        </button>
      </header>
      {#key split}<Chat sid={split} model={find(split)?.model} onchange={refresh} />{/key}
    </aside>
    {#if mini}
      <button class="absolute right-2 top-12 z-10 max-w-60 truncate rounded-lg border border-line bg-panel px-3 py-1 text-sm text-muted shadow-sm hover:text-fg" title="Rouvrir le fil" onclick={() => (mini = false)}>▢ {find(split)?.title || 'Sans titre'}</button>
    {/if}
  {/if}
  <Threads {sessions} {status} visible={threads} onopen={openSplit} onclose={() => (threads = false)} />
</main>
