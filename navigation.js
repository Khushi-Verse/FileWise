
// Get all navigation links
const navLinks = document.querySelectorAll(".nav-link");

// Get the page heading
const pageTitle = document.getElementById("currentPageTitle");

// Get the All Files section
const allFilesSection = document.getElementById("allFilesSection");

// Get all sections inside the main content
const allSections = document.querySelectorAll(".main-content > section");
const expiringSoonSection =
    document.getElementById("expiringSoonSection");

    const recentlyDeletedSection =
    document.getElementById("recentlyDeletedSection");

// Handle navigation clicks
navLinks.forEach((link) => {
    link.addEventListener("click", async (event) => {
        event.preventDefault();

        const selectedPage = link.dataset.page;

        // Check whether this page is implemented yet
        if (
            selectedPage !== "dashboard" &&
            selectedPage !== "all-files" &&
            selectedPage !== "expiring-soon"&&
    selectedPage !== "recently-deleted"
        ) {
            alert("This section will be implemented next!");
            return;
        }

        // Update active navigation link
        navLinks.forEach((navLink) => {
            navLink.classList.remove("active");
        });

        link.classList.add("active");

        // Dashboard: Show all dashboard sections
        if (selectedPage === "dashboard") {
            pageTitle.textContent = "Dashboard";

            allSections.forEach((section) => {
                section.hidden = false;
            });
        }

        // All Files: Show only the saved files section
        else if (selectedPage === "all-files") {
            pageTitle.textContent = "All Files";

            allSections.forEach((section) => {
                section.hidden = section !== allFilesSection;
            });

            // Refresh files from SQLite
            await loadSavedFiles();
        }

        // Expiring Soon: Show only expiring files
        else if (selectedPage === "expiring-soon") {
            pageTitle.textContent = "Expiring Soon";

            allSections.forEach((section) => {
                section.hidden = section !== expiringSoonSection;
            });

            // Fetch and display expiring files
            await loadExpiringSoonFiles();
        }
        // Recently Deleted: Show deleted files
          else if (selectedPage === "recently-deleted") {

    pageTitle.textContent = "Recently Deleted";

    allSections.forEach((section) => {
        section.hidden = section !== recentlyDeletedSection;
    });

    await loadRecentlyDeletedFiles();
}
    });
});

async function loadExpiringSoonFiles() {
    // Find the HTML container where files will be displayed.
    const expiringSoonList =
        document.getElementById("expiringSoonList");

    if (!expiringSoonList) {
        return;
    }

    try {
        // Request expiring files through preload.js.
        const files = await window.appInfo.getExpiringSoon();

        // Clear previously displayed records.
        expiringSoonList.replaceChildren();

        // Show a message if no files are expiring soon.
        if (files.length === 0) {
            const message = document.createElement("p");
            message.textContent = "No files expiring in the next 7 days.";
            expiringSoonList.appendChild(message);
            return;
        }

        // Create one row for every file.
        for (const file of files) {
            const row = document.createElement("div");
            row.className = "file-row";

            // File name and location
            const fileNameContainer = document.createElement("div");
            fileNameContainer.className = "file-name";

            const details = document.createElement("div");

            const name = document.createElement("strong");
            name.textContent = file.name;

            const location = document.createElement("p");
            location.textContent = file.path;

            details.append(name, location);
            fileNameContainer.appendChild(details);

            // Retention type
            const retention = document.createElement("div");
            retention.className = "retention";
            retention.textContent = "Time-limited";

            // Expiry date
            const expiry = document.createElement("div");
            expiry.className = "expiry";

            const expiryDate = new Date(file.expiry_at);

            expiry.textContent = expiryDate.toLocaleDateString();

            // File status
            const statusContainer = document.createElement("div");
            const status = document.createElement("span");

            status.className = `status ${file.status}`;
            status.textContent = file.status;

            statusContainer.appendChild(status);

            // Add all four columns to the row.
            row.append(
                fileNameContainer,
                retention,
                expiry,
                statusContainer
            );

            expiringSoonList.appendChild(row);
        }

    } catch (error) {
        console.error("Failed to load expiring files:", error);
        expiringSoonList.textContent =
            "Could not load expiring files.";
    }
}

// Load recently deleted files
async function loadRecentlyDeletedFiles() {

    // Find the HTML container
    const recentlyDeletedList =
        document.getElementById("recentlyDeletedList");

    if (!recentlyDeletedList) {
        return;
    }

    try {
        // Fetch deleted files from SQLite through preload.js
        const files = await window.appInfo.getRecentlyDeleted();

        // Clear previously displayed records
        recentlyDeletedList.replaceChildren();

        // Show a message if there are no deleted files
        if (files.length === 0) {
            const message = document.createElement("p");
            message.textContent = "No recently deleted files.";
            recentlyDeletedList.appendChild(message);
            return;
        }

        // Create a row for every deleted file
        for (const file of files) {

            const row = document.createElement("div");
            row.className = "file-row";

            // File name
            const name = document.createElement("div");
            name.className = "file-name";
            name.textContent = file.name;

            // Original location
            const location = document.createElement("div");
            location.textContent = file.path;

            // Deletion date
            const deletedDate = document.createElement("div");

            if (file.deleted_at) {
                deletedDate.textContent =
                    new Date(file.deleted_at).toLocaleString();
            } else {
                deletedDate.textContent = "Unknown";
            }

            // Status
            const statusContainer = document.createElement("div");
            const status = document.createElement("span");

            status.className = "status deleted";
            status.textContent = "Deleted";

            statusContainer.appendChild(status);

            // Add all four columns
            row.append(
                name,
                location,
                deletedDate,
                statusContainer
            );

            recentlyDeletedList.appendChild(row);
        }

    } catch (error) {
        console.error("Failed to load recently deleted files:", error);

        recentlyDeletedList.textContent =
            "Could not load recently deleted files.";
    }
}