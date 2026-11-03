const { app } = require("electron");

app.whenReady().then(() => {
  console.log("Electron started successfully");
  console.log("Electron version:", process.versions.electron);

  try {
    const sqlite = require("node:sqlite");
    console.log("SQLite module loaded:", !!sqlite.DatabaseSync);
  } catch (error) {
    console.error("SQLite load failed:", error.message);
  }

  app.quit();
});