const { contextBridge, ipcRenderer } = require("electron");
//ipcRenderer rqst main process to perform file operations and database operations, 
// and then return the result back to the renderer process.
//contextBridge is used to expose a safe API to the renderer process, 
// allowing it to communicate with the main process without exposing the entire ipcRenderer module.
contextBridge.exposeInMainWorld("appInfo", {
  name: "Smart File Manager",
//exposeInMainWorld is used to expose a safe API to the renderer process, allowing it to 
// communicate with the main process without exposing the entire ipcRenderer module.

  selectFile: () => ipcRenderer.invoke("file:select"),
//file:select is an IPC channel that requests the main process to open a file dialog and return the selected file path.
  copyFile: () => ipcRenderer.invoke("file:copy"),
  renameFile: (oldPath, newName) =>
    ipcRenderer.invoke("file:rename", oldPath, newName),
  getSavedFiles: () => ipcRenderer.invoke("database:get-files"),
  //database:get-files is an IPC channel that requests the main process to retrieve the list of saved files from the database.
  moveFile: () => ipcRenderer.invoke("file:move"),
  getHistory: () => ipcRenderer.invoke("database:get-history"),
  deleteFileRecord: (filePath) =>
    ipcRenderer.invoke("database:delete-file-record", filePath),
  manageFile: (filePath, duration,
  customDays) =>
  ipcRenderer.invoke("file:manage", filePath, duration,
    customDays),
});

