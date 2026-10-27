/// <reference types="svelte" />
declare module "*.svelte" {
  import type { Component } from "svelte"
  const c: Component
  export default c
}

interface Window {
  oc: {
    send(text: string): Promise<string>
    sessions(): Promise<any[]>
    open(id?: string): Promise<any[]>
    onEvent(cb: (event: any) => void): void
  }
}
