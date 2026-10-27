import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    backgroundColor: '#1f1e1d',
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.mjs') }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
