import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('oc', {
  send: (text: string, id?: string, model?: unknown): Promise<string> => ipcRenderer.invoke('oc:send', text, id, model),
  models: () => ipcRenderer.invoke('oc:models'),
  setModel: (id: string, model: unknown) => ipcRenderer.invoke('oc:model', id, model),
  sessions: () => ipcRenderer.invoke('oc:sessions'),
  open: (id?: string) => ipcRenderer.invoke('oc:open', id),
  messages: (id: string) => ipcRenderer.invoke('oc:messages', id),
  active: () => ipcRenderer.invoke('oc:active'),
  onEvent: (cb: (event: any) => void) => {
    const fn = (_e: unknown, event: any) => cb(event)
    ipcRenderer.on('oc:event', fn)
    return () => void ipcRenderer.removeListener('oc:event', fn)
  }
})
