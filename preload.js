const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  checkAdmin: () => ipcRenderer.invoke('check-admin'),
  scanSystem: () => ipcRenderer.invoke('scan-system'),
  createBackup: (config) => ipcRenderer.invoke('create-backup', config),
  restoreBackup: (filePath) => ipcRenderer.invoke('restore-backup', filePath),
  backupDrivers: (dirPath) => ipcRenderer.invoke('backup-drivers', dirPath),
  restoreDrivers: (dirPath) => ipcRenderer.invoke('restore-drivers', dirPath),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  selectFile: () => ipcRenderer.invoke('select-file'),
  onLog: (callback) => ipcRenderer.on('log-message', (event, value) => callback(value)),
  onProgress: (callback) => ipcRenderer.on('progress', (event, value) => callback(value))
});
