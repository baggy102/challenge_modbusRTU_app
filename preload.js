const { contextBridge, ipcRenderer } = require('electron/renderer')

contextBridge.exposeInMainWorld('darkMode', {
  toggle: () => ipcRenderer.invoke('dark-mode:toggle'),
  system: () => ipcRenderer.invoke('dark-mode:system')
})

contextBridge.exposeInMainWorld('api', {
  connect: (port, baud) => ipcRenderer.invoke('serial:connect', { port, baud }),
  disconnect: () => ipcRenderer.invoke('serial:disconnect'),
  addOrder: (dose, yieldMl, count) => ipcRenderer.invoke('orders:add', { dose, yield: yieldMl, count }),
  startQueue: () => ipcRenderer.invoke('orders:start'),
  onStatus: (cb) => ipcRenderer.on('serial:status', (_e, data) => cb(data)),
  onLog: (cb) => ipcRenderer.on('serial:log', (_e, data) => cb(data))
})