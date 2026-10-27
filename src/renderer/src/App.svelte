<script lang="ts">
  type Part = { id: string; messageID: string; type: string; text?: string; tool?: string; state?: any }

  let roles = $state<Record<string, string>>({})
  let order = $state<string[]>([])
  let parts = $state<Record<string, Part[]>>({})
  let input = $state('')
  let busy = $state(false)
  let error = $state('')

  function touch(messageID: string) {
    if (!order.includes(messageID)) order.push(messageID)
  }

  function upsert(messageID: string, part: Part) {
    touch(messageID)
    const list = (parts[messageID] ??= [])
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

  window.oc.onEvent((e) => {
    const p = e.properties ?? e.data // opencode 2.x place la charge utile dans `data`
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
        const part = (parts[p.messageID] ??= []).find((x) => x.id === p.partID) as any
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
  })

  // ```code``` → [texte, code, texte, …]
  const chunks = (t = '') => t.split(/```\w*\n?([\s\S]*?)```/)
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
      await window.oc.send(text)
    } catch (err) {
      error = String(err)
      busy = false
    }
  }
</script>

<main class="flex h-screen">
  <aside class="w-60 border-r border-line bg-panel p-4 text-sm text-muted">Projets</aside>
  <section class="flex flex-1 flex-col">
    <div class="flex-1 overflow-y-auto">
      <div class="mx-auto max-w-3xl space-y-6 px-6 py-8">
        {#if !order.length}
          <p class="pt-32 text-center text-2xl text-muted">Que veux-tu faire ?</p>
        {/if}
        {#each order as id (id)}
          <div class={roles[id] === 'user' ? 'ml-auto w-fit max-w-[80%] rounded-2xl bg-panel px-4 py-2.5' : 'space-y-2'}>
            {#each parts[id] ?? [] as part (part.id)}
              {#if part.type === 'text'}
                {#each chunks(part.text) as c, i}
                  {#if i % 2 === 0}
                    {#if c.trim()}<p class="whitespace-pre-wrap">{c.trim()}</p>{/if}
                  {:else}
                    <pre class="overflow-x-auto rounded-lg border border-line bg-panel p-3 font-mono text-[13px]">{c}</pre>
                  {/if}
                {/each}
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
    <form class="mx-auto mb-4 flex w-full max-w-3xl items-end gap-2 rounded-2xl border border-line bg-panel p-2 shadow-sm focus-within:border-muted" onsubmit={(e) => { e.preventDefault(); send() }}>
      <textarea rows="1" class="field-sizing-content max-h-60 flex-1 resize-none bg-transparent px-2 py-1.5 outline-none placeholder:text-muted" placeholder="Écris à opencode…  (Maj+Entrée = nouvelle ligne)" bind:value={input} onkeydown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}></textarea>
      <button class="size-9 rounded-xl bg-accent text-lg text-white disabled:opacity-40" disabled={busy || !input.trim()} aria-label="Envoyer">↑</button>
    </form>
  </section>
</main>
