const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron/main')
const path = require('node:path')
const SerialManager = require('./src/serialManager')

let mainWindow = null
const serial = new SerialManager()

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  mainWindow.loadFile('index.html')

  // forward serial status/logs to renderer
  serial.onStatus((data) => {
    if (mainWindow) mainWindow.webContents.send('serial:status', data)
  })
  serial.onLog((msg) => {
    if (mainWindow) mainWindow.webContents.send('serial:log', msg)
  })
}

ipcMain.handle('dark-mode:toggle', () => {
  if (nativeTheme.shouldUseDarkColors) {
    nativeTheme.themeSource = 'light'
  } else {
    nativeTheme.themeSource = 'dark'
  }
  return nativeTheme.shouldUseDarkColors
})

ipcMain.handle('dark-mode:system', () => {
  nativeTheme.themeSource = 'system'
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

ipcMain.handle('serial:connect', async (_e, { port, baud }) => {
  try {
    await serial.connect(port, baud)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

ipcMain.handle('serial:disconnect', async () => {
  try {
    await serial.disconnect()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

ipcMain.handle('orders:add', async (_e, order) => {
  serial.addOrders(order)
  return { ok: true }
})

ipcMain.handle('orders:start', async () => {
  serial.startQueue()
  return { ok: true }
})