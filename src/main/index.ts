import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { listSessions, openSession, sendPrompt, startOpencode, stopOpencode } from './opencode'

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 480,
    minHeight: 400,
    backgroundColor: '#1f1e1d',
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs') }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'))

  const emit = (event: unknown) => {
    if (!win.isDestroyed()) win.webContents.send('oc:event', event)
  }
  win.webContents.once('did-finish-load', () => {
    startOpencode(emit).catch((err) =>
      emit({ type: 'gui.error', properties: { message: String(err) } })
    )
  })
}

ipcMain.handle('oc:send', (_e, text: string) => sendPrompt(text))
ipcMain.handle('oc:sessions', () => listSessions())
ipcMain.handle('oc:open', (_e, id?: string) => openSession(id))

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
app.on('quit', stopOpencode)
