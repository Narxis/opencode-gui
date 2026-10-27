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

  window.oc.onEvent((e) => {
    const p = e.properties
    if (e.type === 'message.updated') {
      roles[p.info.id] = p.info.role
      touch(p.info.id)
    } else if (e.type === 'message.part.updated') {
      const part: Part = p.part
      touch(part.messageID)
      const list = (parts[part.messageID] ??= [])
      const i = list.findIndex((x) => x.id === part.id)
      if (i >= 0) list[i] = part
      else list.push(part)
    } else if (e.type === 'session.idle') {
      busy = false
    } else if (e.type === 'gui.error') {
      error = p.message
      busy = false
    }
  })

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    input = ''
    busy = true
    error = ''
    try {
      await window.oc.send(text)
    } catch (err) {
      error = String(err)
      busy = false
    }
  }
</script>

<main class="flex h-screen bg-stone-900 text-stone-100">
  <aside class="w-64 border-r border-stone-700 p-4">Projets</aside>
  <section class="flex flex-1 flex-col">
    <div class="flex-1 space-y-4 overflow-y-auto p-6">
      {#each order as id (id)}
        <div class={roles[id] === 'user' ? 'ml-auto max-w-[80%] rounded-lg bg-stone-800 p-3' : 'max-w-[90%]'}>
          {#each parts[id] ?? [] as part (part.id)}
            {#if part.type === 'text'}
              <p class="whitespace-pre-wrap">{part.text}</p>
            {:else if part.type === 'tool'}
              <details class="my-1 rounded border border-stone-700 p-2 text-sm text-stone-400">
                <summary>{part.tool} · {part.state?.status}</summary>
                <pre class="overflow-x-auto">{JSON.stringify(part.state?.input ?? {}, null, 2)}</pre>
              </details>
            {/if}
          {/each}
        </div>
      {/each}
      {#if error}<p class="text-red-400">{error}</p>{/if}
    </div>
    <form class="flex gap-2 border-t border-stone-700 p-4" onsubmit={(e) => { e.preventDefault(); send() }}>
      <input class="flex-1 rounded bg-stone-800 p-2 outline-none" placeholder="Écris à opencode…" bind:value={input} />
      <button class="rounded bg-orange-600 px-4 disabled:opacity-50" disabled={busy}>Envoyer</button>
    </form>
  </section>
</main>
