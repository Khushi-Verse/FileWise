let fileToManage = null;
const button = document.getElementById("manageFileBtn");

if (button) {
  button.addEventListener("click", async () => {
    try {
      const file = await window.appInfo.selectFile();

      if (!file) return;

      fileToManage = file;

      showRetentionChoices();
console.log("Selected file:", fileToManage);
console.log(
  "Retention section:",
  document.getElementById("retentionDuration").hidden
);
    } catch (error) {
      console.error("File selection failed:", error);
    }
  });
}

function showRetentionChoices() {
  const duration = document.getElementById("retentionDuration");

  if (duration) {
    duration.hidden = false;
  } else {
    alert("Next, we'll add the retention choices to the dashboard.");
  }
}

const selectFileBtn = document.getElementById("selectFileBtn");
const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const filePath = document.getElementById("filePath");
const fileSize = document.getElementById("fileSize");
const fileType = document.getElementById("fileType");
const fileMessage = document.getElementById("fileMessage");

if (selectFileBtn) {
  selectFileBtn.addEventListener("click", async () => {
    fileMessage.textContent = "";

    try {
      const file = await window.appInfo.selectFile();

      if (!file) {
        fileMessage.textContent = "No file selected.";
        return;
      }

      fileName.textContent = file.name;
      filePath.textContent = file.path;
      fileSize.textContent = `${file.size} bytes`;
      fileType.textContent = file.isFile ? "File" : "Directory";

      fileInfo.hidden = false;
      fileMessage.textContent = "File information loaded successfully.";
      await loadSavedFiles();
    } catch (error) {
      console.error("Failed to select file:", error);
      fileMessage.textContent = "Could not read the selected file.";
    }
  });
}

 const confirmRetentionBtn =
  document.getElementById("confirmRetentionBtn");

if (confirmRetentionBtn) {
  confirmRetentionBtn.addEventListener("click", async () => {

    if (!fileToManage) {
      alert("Please select a file first.");
      return;
    }

    const duration =
      document.getElementById("retentionPeriod").value;

    const customDays =
      duration === "custom"
        ? Number(document.getElementById("customDays").value)
        : 0;

    try {
      const result = await window.appInfo.manageFile(
        fileToManage.path,
        duration,
        customDays
      );

      if (result.success) {
        alert("File management preference saved!");

        document.getElementById("retentionDuration").hidden = true;

        fileToManage = null;

        await loadSavedFiles();
      }

    } catch (error) {
      console.error("Management failed:", error);
      alert(error.message || "Could not manage file.");
    }
  });
}
const copyFileBtn = document.getElementById("copyFileBtn");

if (copyFileBtn) {
  copyFileBtn.addEventListener("click", async () => {
    fileMessage.textContent = "";

    try {
      const result = await window.appInfo.copyFile();

      if (result.canceled) {
        fileMessage.textContent = "Copy cancelled.";
        return;
      }

      fileMessage.textContent =
        `Copied successfully: ${result.name}`;
        await loadSavedFiles();

      console.log("Copy destination:", result.path);
    } catch (error) {
      console.error("Failed to copy file:", error);

      fileMessage.textContent =
        "Copy failed. Check the console for details.";
    }
  });
}

const renameFileBtn = document.getElementById("renameFileBtn");
const renameControls = document.getElementById("renameControls");
const newFileNameInput = document.getElementById("newFileName");
const confirmRenameBtn = document.getElementById("confirmRenameBtn");
const cancelRenameBtn = document.getElementById("cancelRenameBtn");

let fileToRename = null;

if (renameFileBtn) {
  renameFileBtn.addEventListener("click", async () => {
    try {
      const file = await window.appInfo.selectFile();

      if (!file) {
        fileMessage.textContent = "Rename cancelled.";
        return;
      }

      fileToRename = file;

      newFileNameInput.value = file.name;
      renameControls.hidden = false;
      newFileNameInput.focus();

      fileMessage.textContent = "Enter the new filename.";
     
    } catch (error) {
      console.error("Failed to select file:", error);
      fileMessage.textContent = "Could not select the file.";
    }
  });
}

if (confirmRenameBtn) {
  confirmRenameBtn.addEventListener("click", async () => {
    if (!fileToRename) {
      fileMessage.textContent = "Please select a file first.";
      return;
    }

    const newName = newFileNameInput.value.trim();

    if (!newName) {
      fileMessage.textContent = "Filename cannot be empty.";
      return;
    }

    try {
      const result = await window.appInfo.renameFile(
        fileToRename.path,
        newName
      );

      fileMessage.textContent =
        `Renamed successfully to ${result.newName}`;
await loadSavedFiles();
      console.log("New file path:", result.newPath);

      renameControls.hidden = true;
      fileToRename = null;
    } catch (error) {
      console.error("Failed to rename file:", error);
      fileMessage.textContent =
        error.message || "Rename failed.";
    }
  });
}

if (cancelRenameBtn) {
  cancelRenameBtn.addEventListener("click", () => {
    renameControls.hidden = true;
    fileToRename = null;
    fileMessage.textContent = "Rename cancelled.";
  });
}

const moveFileBtn = document.getElementById("moveFileBtn");

if (moveFileBtn) {
  moveFileBtn.addEventListener("click", async () => {
    fileMessage.textContent = "";

    try {
      const result = await window.appInfo.moveFile();

      if (result.canceled) {
        fileMessage.textContent = "Move cancelled.";
        return;
      }

      fileMessage.textContent =
        `Moved successfully: ${result.name}`;
await loadSavedFiles();
      console.log("New file location:", result.path);
    } catch (error) {
      console.error("Failed to move file:", error);

      fileMessage.textContent =
        error.message || "Move failed.";
    }
  });
}

async function loadSavedFiles() {
  const savedFilesList = document.getElementById("savedFilesList");

  if (!savedFilesList) {
    return;
  }

  try {
    const files = await window.appInfo.getSavedFiles();

    savedFilesList.replaceChildren();

    if (files.length === 0) {
      const message = document.createElement("p");
      message.textContent = "No saved file records yet.";
      savedFilesList.appendChild(message);
      return;
    }

    for (const file of files) {
      const row = document.createElement("div");
      row.className = "file-row";

      const fileNameContainer = document.createElement("div");
      fileNameContainer.className = "file-name";

      const details = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = file.name;

      const location = document.createElement("p");
      location.textContent = file.path;

      details.append(name, location);
      fileNameContainer.appendChild(details);

      const retention = document.createElement("div");
      retention.className = "retention";
      retention.textContent = file.expiry_at
        ? "Time-limited"
        : "No expiry set";

      const expiry = document.createElement("div");
      expiry.className = "expiry";
      expiry.textContent = file.expiry_at || "—";

      const statusContainer = document.createElement("div");
      const status = document.createElement("span");
      status.className = `status ${file.status}`;
      status.textContent = file.status;

      statusContainer.appendChild(status);
      row.append(fileNameContainer, retention, expiry, statusContainer);
      savedFilesList.appendChild(row);
    }
  } catch (error) {
    console.error("Failed to load saved files:", error);
  }
}
const retentionPeriod =
  document.getElementById("retentionPeriod");

const customDurationInput =
  document.getElementById("customDurationInput");

// Show custom duration input only when Custom is selected
if (retentionPeriod && customDurationInput) {
  retentionPeriod.addEventListener("change", () => {
    customDurationInput.hidden =
      retentionPeriod.value !== "custom";
  });
}
loadSavedFiles();

const setFolderPolicyBtn =
  document.getElementById("setFolderPolicyBtn");

const folderPolicyMessage =
  document.getElementById("folderPolicyMessage");

if (setFolderPolicyBtn) {

  setFolderPolicyBtn.addEventListener(
    "click",
    async () => {

      const retention =
        document.getElementById("folderRetention").value;

      try {

        const result =
          await window.appInfo.setFolderPolicy(retention);

        if (result.canceled) {
          if (folderPolicyMessage) {
            folderPolicyMessage.textContent =
              "Folder selection cancelled.";
          }
          return;
        }

        if (folderPolicyMessage) {
          folderPolicyMessage.textContent =
            `Folder policy applied successfully: ${retention}`;
        }

        await loadSavedFiles();

      } catch (error) {

        console.error("Folder policy failed:", error);

        if (folderPolicyMessage) {
          folderPolicyMessage.textContent =
            error.message || "Could not set folder policy.";
        }
      }
    }
  );
}