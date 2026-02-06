// clearEntries.js
// Clears entries.json used by server.js (C:\HolidayApp\entries.json)

const fs = require("fs");
const path = require("path");

const ENTRIES_FILE = path.join(__dirname, 'data', 'entries.json');

console.log("🗑️  Clearing all entries from calendar...");

try {
  if (!fs.existsSync(ENTRIES_FILE)) {
    console.log("⚠️ entries.json not found at:", ENTRIES_FILE);
    process.exit(0);
  }

  // Backup first
  const currentData = fs.readFileSync(ENTRIES_FILE, "utf8");
  const backupFile = path.join(__dirname, `entries_backup_${Date.now()}.json`);
  fs.writeFileSync(backupFile, currentData, "utf8");
  console.log(`✅ Backup created: ${backupFile}`);

  // Clear
  fs.writeFileSync(ENTRIES_FILE, JSON.stringify([], null, 2), "utf8");
  console.log("✅ All entries cleared from entries.json");
  console.log("📋 Calendar is now empty - ready for testing!");
} catch (error) {
  console.error("❌ Error:", error.message);
}
