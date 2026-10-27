import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('oc', {
  send: (text: string): Promise<string> => ipcRenderer.invoke('oc:send', text),
  sessions: () => ipcRenderer.invoke('oc:sessions'),
  open: (id?: string) => ipcRenderer.invoke('oc:open', id),
  onEvent: (cb: (event: any) => void) => {
    ipcRenderer.on('oc:event', (_e, event) => cb(event))
  }
})
