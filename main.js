
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

app.setPath(
  "userData",
  path.join(app.getPath("appData"), "SmartFileManager")
);
const databasePath = path.join(
  app.getPath("userData"),
  "filewise.db"
);

const db = new DatabaseSync(databasePath);

db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expiry_at TEXT,
    status TEXT NOT NULL DEFAULT 'unmanaged'
  );

  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    retention TEXT
  );

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
  );
`);

db.exec("PRAGMA foreign_keys = ON");

console.log("FileWise database connected successfully.");

function recordFileHistory(filePath, action) {
  const findFile = db.prepare(`
    SELECT id
    FROM files
    WHERE path = ?
  `);

  const file = findFile.get(filePath);

  if (!file) {
    return;
  }

  const saveHistory = db.prepare(`
    INSERT INTO history (file_id, action)
    VALUES (?, ?)
  `);

  saveHistory.run(file.id, action);
}
function saveFileRecord(name, filePath) {
  const saveFile = db.prepare(`
    INSERT INTO files (name, path)
    VALUES (?, ?)
    ON CONFLICT(path) DO UPDATE SET
      name = excluded.name
  `);

  saveFile.run(name, filePath);
}

function updateSavedFileRecord(oldPath, newPath, newName) {
  const updateFile = db.prepare(`
    UPDATE files
    SET name = ?, path = ?
    WHERE path = ?
  `);

  const result = updateFile.run(newName, newPath, oldPath);

  // If the original file wasn't in the database, save its new location.
  if (result.changes === 0) {
    saveFileRecord(newName, newPath);
  }
}


ipcMain.handle("file:select", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"]
  });

  if (result.canceled) {
    return null;
  }

  const filePath = result.filePaths[0];
  const stats = await fs.stat(filePath);

  const fileInfo = {
    name: path.basename(filePath),
    path: filePath,
    size: stats.size,
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory()
  };

  const saveFile = db.prepare(`
    INSERT INTO files (name, path)
    VALUES (?, ?)
    ON CONFLICT(path) DO UPDATE SET
      name = excluded.name
  `);

  saveFile.run(fileInfo.name, fileInfo.path);
recordFileHistory(fileInfo.path, "selected");
  console.log("File saved in database:", fileInfo.name);

  return fileInfo;
});


ipcMain.handle("database:get-files", () => {
  const getFiles = db.prepare(`
    SELECT id, name, path, added_at, expiry_at, status
    FROM files
    ORDER BY id DESC
  `);

  return getFiles.all();
});
ipcMain.handle("database:get-history", () => {
  const getHistory = db.prepare(`
    SELECT
      history.id,
      files.name,
      files.path,
      history.action,
      history.timestamp
    FROM history
    JOIN files ON history.file_id = files.id
    ORDER BY history.id DESC
  `);

  return getHistory.all();
});
ipcMain.handle("database:delete-file-record", (_event, filePath) => {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("A valid file path is required.");
  }

  const deleteRecord = db.prepare(`
    DELETE FROM files
    WHERE path = ?
  `);

  return deleteRecord.run(filePath);
});

ipcMain.handle("file:copy", async () => {
  // 1. Select the original file.
  const sourceResult = await dialog.showOpenDialog({
    title: "Select a file to copy",
    properties: ["openFile"]
  });

  if (sourceResult.canceled) {
    return { canceled: true };
  }

  const sourcePath = sourceResult.filePaths[0];

  // 2. Select the destination folder.
  const destinationResult = await dialog.showOpenDialog({
    title: "Choose the destination folder",
    properties: ["openDirectory"]
  });

  if (destinationResult.canceled) {
    return { canceled: true };
  }

  const destinationFolder = destinationResult.filePaths[0];
  const originalName = path.basename(sourcePath);
  const parsed = path.parse(originalName);

  let copyNumber = 0;

  while (true) {
    // First try the original name; then (1), (2), and so on.
    const newName =
      copyNumber === 0
        ? originalName
        : `${parsed.name} (${copyNumber})${parsed.ext}`;

    const destinationPath = path.join(
      destinationFolder,
      newName
    );

    try {
      // Never overwrite an existing destination file.
      await fs.copyFile(
        sourcePath,
        destinationPath,
        constants.COPYFILE_EXCL
      );
saveFileRecord(newName, destinationPath);
      return {
        canceled: false,
        name: newName,
        path: destinationPath
      };
    } catch (error) {
      if (error.code === "EEXIST") {
        copyNumber++;
        continue;
      }

      throw error;
    }
  }
});

ipcMain.handle("file:rename", async (_event, oldPath, newName) => {
  if (
    typeof oldPath !== "string" ||
    typeof newName !== "string" ||
    !newName.trim() ||
    newName !== path.basename(newName) ||
    newName === "." ||
    newName === ".."
  ) {
    throw new Error("Invalid file name.");
  }

  const directory = path.dirname(oldPath);
  const newPath = path.join(directory, newName.trim());

  // Prevent accidentally overwriting an existing file.
  try {
    await fs.lstat(newPath);
    throw new Error("A file or folder with that name already exists.");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  await fs.rename(oldPath, newPath);
updateSavedFileRecord(oldPath, newPath, path.basename(newPath));
recordFileHistory(newPath, "renamed");
  return {
    oldName: path.basename(oldPath),
    newName: path.basename(newPath),
    newPath
  };
});

ipcMain.handle("file:move", async () => {
  // Step 1: Ask the user to select a file.
  const sourceResult = await dialog.showOpenDialog({
    title: "Select a file to move",
    properties: ["openFile"]
  });

  if (sourceResult.canceled) {
    return { canceled: true };
  }

  const sourcePath = sourceResult.filePaths[0];

  // Step 2: Ask where the file should go.
  const destinationResult = await dialog.showOpenDialog({
    title: "Choose the destination folder",
    properties: ["openDirectory"]
  });

  if (destinationResult.canceled) {
    return { canceled: true };
  }

  const destinationFolder = destinationResult.filePaths[0];

  // Step 3: Keep the original filename.
  const fileName = path.basename(sourcePath);
  const destinationPath = path.join(
    destinationFolder,
    fileName
  );

  // Step 4: Do not overwrite an existing file.
  try {
    await fs.lstat(destinationPath);
    throw new Error(
      "A file or folder with that name already exists in the destination."
    );
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  // Step 5: Move the file.
  await fs.rename(sourcePath, destinationPath);
updateSavedFileRecord(
  sourcePath,
  destinationPath,
  fileName
);
recordFileHistory(destinationPath, "moved");
  return {
    canceled: false,
    name: fileName,
    path: destinationPath
  };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    title: "Smart File Manager",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.webContents.openDevTools();

  win.loadFile("index.html").catch((error) => {
    console.error("Failed to load index.html:", error);
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
