/// <reference types="svelte" />
declare module "*.svelte" {
  import type { Component } from "svelte"
  const c: Component
  export default c
}
