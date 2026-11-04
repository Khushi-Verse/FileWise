
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
// Add the folder_policy_path column if it doesn't exist.
const fileColumns = db.prepare(
  "PRAGMA table_info(files)"
).all();

const hasFolderPolicyColumn = fileColumns.some(
  (column) => column.name === "folder_policy_path"
);

if (!hasFolderPolicyColumn) {
  db.exec(`
    ALTER TABLE files
    ADD COLUMN folder_policy_path TEXT
  `);
}
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


function calculateExpiryDate(startDate, duration, customDays = 0) {
    if (duration === "forever") {
        return null;
    }

    const expiryDate = new Date(startDate);

    switch (duration) {
        case "custom":
            expiryDate.setDate(expiryDate.getDate() + customDays);
            break;

        case "1day":
            expiryDate.setDate(expiryDate.getDate() + 1);
            break;

        case "7days":
            expiryDate.setDate(expiryDate.getDate() + 7);
            break;

        case "1month":
        case "6months": {
            const months = duration === "1month" ? 1 : 6;
            const originalDay = expiryDate.getDate();

            expiryDate.setDate(1);
            expiryDate.setMonth(expiryDate.getMonth() + months);

            const lastDay = new Date(
                expiryDate.getFullYear(),
                expiryDate.getMonth() + 1,
                0
            ).getDate();

            expiryDate.setDate(Math.min(originalDay, lastDay));
            break;
        }

        default:
            throw new Error("Invalid retention duration.");
    }

    return expiryDate;
}

// Check whether a file is inside a folder.
function isInsideFolder(filePath, folderPath) {
  const relativePath = path.relative(
    folderPath,
    filePath
  );

  return (
    relativePath === "" ||
    (
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath)
    )
  );
}


// Find the retention policy of a file's folder.
function findFolderPolicy(filePath) {

  const folders = db.prepare(`
    SELECT path, retention
    FROM folders
  `).all();

  // If multiple policies match, use the nearest folder.
  const matchingFolders = folders
    .filter(folder =>
      isInsideFolder(filePath, folder.path)
    )
    .sort((a, b) =>
      b.path.length - a.path.length
    );

  return matchingFolders[0] || null;
}


// Apply the folder policy to a file.
function applyFolderPolicy(filePath) {

  const file = db.prepare(`
    SELECT *
    FROM files
    WHERE path = ?
  `).get(filePath);

  if (!file) return;

  const folderPolicy = findFolderPolicy(filePath);

  // No folder policy exists.
  if (!folderPolicy) {

    // Only remove retention if it came from a folder.
    if (file.folder_policy_path) {

      db.prepare(`
        UPDATE files
        SET expiry_at = NULL,
            status = 'unmanaged',
            folder_policy_path = NULL
        WHERE path = ?
      `).run(filePath);

      recordFileHistory(
        filePath,
        "folder-policy-removed"
      );
    }

    return;
  }

  // Calculate a fresh expiry date.
  const expiryDate = calculateExpiryDate(
    new Date(),
    folderPolicy.retention
  );

  const expiryAt = expiryDate
    ? expiryDate.toISOString()
    : null;

  const status = folderPolicy.retention === "forever"
    ? "unmanaged"
    : "managed";

  // Update the file's database record.
  db.prepare(`
    UPDATE files
    SET expiry_at = ?,
        status = ?,
        folder_policy_path = ?
    WHERE path = ?
  `).run(
    expiryAt,
    status,
    folderPolicy.path,
    filePath
  );

  recordFileHistory(
    filePath,
    "folder-policy-applied"
  );
}

ipcMain.handle(
  "folder:set-policy",
  async (_event, retention) => {

    const validDurations = [
      "forever",
      "1day",
      "7days",
      "1month",
      "6months"
    ];

    if (!validDurations.includes(retention)) {
      throw new Error("Invalid folder retention.");
    }

    // Ask the user to select a folder.
    const result = await dialog.showOpenDialog({
      title: "Select a folder for retention policy",
      properties: ["openDirectory"]
    });

    if (result.canceled) {
      return { canceled: true };
    }

    const folderPath = path.resolve(
      result.filePaths[0]
    );

    // Verify that it is a directory.
    const stats = await fs.stat(folderPath);

    if (!stats.isDirectory()) {
      throw new Error("Please select a valid folder.");
    }

    // Save or update the folder policy.
    db.prepare(`
      INSERT INTO folders (path, retention)
      VALUES (?, ?)
      ON CONFLICT(path) DO UPDATE SET
        retention = excluded.retention
    `).run(folderPath, retention);

    // Apply the policy to files already recorded
    // inside this folder.
    const savedFiles = db.prepare(`
      SELECT path FROM files
    `).all();

    for (const file of savedFiles) {
      if (isInsideFolder(file.path, folderPath)) {
        applyFolderPolicy(file.path);
      }
    }

    return {
      success: true,
      folderPath,
      retention
    };
  }
);

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

  
  return fileInfo;
});

ipcMain.handle("file:manage", async (_event, filePath, duration, customDays) => {

  // 1. Validate the file path.
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("Invalid file path.");
  }

  // 2. Validate the selected duration.
  const validDurations = [
    "forever",
    "1day",
    "7days",
    "1month",
    "6months",
    "custom"
  ];
  if (
  duration === "custom" &&
  (!Number.isInteger(customDays) || customDays < 1)
) {
  throw new Error("Enter a valid number of days.");
}

  if (!validDurations.includes(duration)) {
    throw new Error("Invalid retention duration.");
  }

  // 3. Check whether the file actually exists.
  const stats = await fs.stat(filePath);

  if (!stats.isFile()) {
    throw new Error("Please select a valid file.");
  }

  // 4. Calculate the expiry date.
  const expiryDate = calculateExpiryDate(
    new Date(),
    duration,
    customDays
  );

  // 5. Convert the date into a database-friendly string.
  const expiryAt = expiryDate
    ? expiryDate.toISOString()
    : null;

  // 6. Determine the file status.
  const status = duration === "forever"
    ? "unmanaged"
    : "managed";

  // 7. Insert or update the database record.
  const saveFile = db.prepare(`
    INSERT INTO files (name, path, expiry_at, status)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      name = excluded.name,
      expiry_at = excluded.expiry_at,
      status = excluded.status
  `);

  saveFile.run(
    path.basename(filePath),
    filePath,
    expiryAt,
    status
  );

  // 8. Record the action in history.
  recordFileHistory(
    filePath,
    duration === "forever" ? "kept-forever" : "managed"
  );

  return {
    success: true,
    name: path.basename(filePath),
    expiryAt,
    status
  };
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
applyFolderPolicy(destinationPath);
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
applyFolderPolicy(destinationPath);
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
