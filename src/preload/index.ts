import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('oc', {
  send: (text: string): Promise<void> => ipcRenderer.invoke('oc:send', text),
  onEvent: (cb: (event: any) => void) => {
    ipcRenderer.on('oc:event', (_e, event) => cb(event))
  }
})
