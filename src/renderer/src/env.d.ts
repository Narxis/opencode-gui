/// <reference types="svelte" />
declare module "*.svelte" {
  import type { Component } from "svelte"
  const c: Component
  export default c
}

interface Window {
  oc: {
    send(text: string, id?: string, model?: Model): Promise<string>
    models(): Promise<{ list: (Model & { name: string })[]; def?: Model }>
    setModel(id: string, model: Model): Promise<void>
    sessions(): Promise<any[]>
    open(id?: string): Promise<any[]>
    messages(id: string): Promise<any[]>
    active(): Promise<Record<string, unknown>>
    onEvent(cb: (event: any) => void): () => void
  }
}

type Model = { id: string; providerID: string }
