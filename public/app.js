// ===============================
// Configuration
// ===============================
const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const typeColors = {
  "Public Holiday": "#EF4444",     // Red
  "Leave": "#3B82F6",               // Blue
  "Sick": "#F97316",                // Orange
  "WFH": "#14B8A6",                 // Teal
  "Work From Stavanger": "#9b59b6", // Purple ✅
  "Work From Oslo": "#16a085",      // Dark Teal ✅
  "Work Travel": "#8B5CF6"          // Violet
};

// ✅ STATUS COLORS for calendar entries
const statusColors = {
  "pending": "#3B82F6",   // Blue
  "approved": "#10B981",  // Green
  "rejected": "#EF4444"   // Red
};

const publicHolidays = {
  "2026-01-01": "New Year's Day",
  "2026-04-02": "Maundy Thursday",
  "2026-04-03": "Good Friday",
  "2026-04-05": "Easter Sunday",
  "2026-04-06": "Easter Monday",
  "2026-05-01": "Labour Day",
  "2026-05-14": "Ascension Day",
  "2026-05-17": "Constitution Day",
  "2026-05-24": "Whit Sunday",
  "2026-05-25": "Whit Monday",
  "2026-12-25": "Christmas Day",
  "2026-12-26": "Boxing Day"
};

// ===============================
// State
// ===============================
const now = new Date();
let currentMonth = now.getMonth();
let currentYear = now.getFullYear();

let entries = [];
let currentUser = null;

let isSaving = false;

// Selection toast state
let selectionToastId = null;
let selectionToastTimer = null;
let lastSelectionKey = "";

// ✅ NEW: suppress selection toast when we clear/close modal
let suppressSelectionToasts = false;

// ===============================
// Date helpers (LOCAL SAFE)
// ===============================
function toYMDLocal(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function ymdToLocalDate(dateStr) {
  // noon avoids DST edges
  return new Date(`${dateStr}T12:00:00`);
}

// ===============================
// Init
// ===============================
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 Initializing Holiday Calendar...");

  await loadUser();
  await loadEntries();

  updateMonthDisplay();
  renderCalendar();

  addColorIndicatorsToDropdown();
  setupDatePicker();

  console.log("✅ Initialization complete");
  console.log("📊 Total entries loaded:", entries.length);

  const loadingScreen = document.getElementById("loadingScreen");
  if (loadingScreen) loadingScreen.style.display = "none";
});

// ===============================
// Dropdown UI: Type color indicator
// ===============================
let dropdownListenerAdded = false;

function addColorIndicatorsToDropdown() {
  const typeSelect = document.getElementById("entryType");
  if (!typeSelect) return;

  const applyTypeStyle = (selectedType) => {
    const color = typeColors[selectedType];
    if (!color) return;

    typeSelect.style.borderLeft = `6px solid ${color}`;
    typeSelect.style.background = `linear-gradient(to right, ${color}14, transparent)`;
    typeSelect.setAttribute("data-selected", selectedType);
  };

  applyTypeStyle(typeSelect.value);

  if (!dropdownListenerAdded) {
    typeSelect.addEventListener("change", function () {
      applyTypeStyle(this.value);
    });
    dropdownListenerAdded = true;
  }
}

// ===============================
// Server Calls
// ===============================
async function loadUser() {
  try {
    const response = await fetch("/api/user");
    const user = await response.json();
    currentUser = user;

    console.log("✓ User:", user.employeeId, `(${user.email})`, `[${user.role}]`);

    const usernameEl = document.getElementById("username");
	if (usernameEl) {
	  // Show display name if available, otherwise show email without @ symbol
	  const displayText = user.displayName || user.email.split('@')[0];
	  usernameEl.textContent = `Welcome, ${displayText}`;
	}

    if (user.role === "admin") {
      const adminPanel = document.getElementById("adminPanel");
      if (adminPanel) {
        adminPanel.style.display = "block";
        adminPanel.classList.add("collapsed");

        const adminContent = document.getElementById("adminContent");
        if (adminContent) adminContent.style.display = "none";
      }
      await loadAdminUsers();
    }
  } catch (error) {
    console.error("Failed to load user:", error);
    showError("Failed to load user");
  }
}

async function loadEntries() {
  console.log("📥 Loading entries from server...");
  try {
    const response = await fetch("/api/entries");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    const map = new Map();
    (data || []).forEach((e) => {
      if (e && e.id) map.set(e.id, e);
    });
    entries = Array.from(map.values());

    console.log("✅ Loaded", entries.length, "entries from server");
    return entries;
  } catch (error) {
    console.error("❌ Failed to load entries:", error);
    entries = [];
    showError("Failed to load calendar data");
    return [];
  }
}

// ===============================
// Admin panel
// ===============================
async function loadAdminUsers() {
  try {
    const response = await fetch("/api/admin/users");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const users = await response.json();
    renderAdminUsers((users || []).filter((u) => u.role === "admin" || u.role === "manager"));
  } catch (error) {
    console.error("Failed to load admin users:", error);
    showError("Failed to load admin users");
  }
}

function renderAdminUsers(users) {
  const container = document.getElementById("adminUsersList");
  if (!container) return;

  container.innerHTML = "";

  if (!users || users.length === 0) {
    container.innerHTML = '<div class="loading">No admins/managers found.</div>';
    return;
  }

  users.forEach((user) => {
    const wrapper = document.createElement("div");
    wrapper.className = "user-item";

    const employeeId = user.employeeId;
    const email = user.email || `${employeeId}@akersolutions.com`;
    let displayName = user.displayName || employeeId;

    if (String(displayName).includes("@")) displayName = employeeId;

    wrapper.innerHTML = `
      <div class="user-id-email">
        <code>${employeeId}</code>
        <div class="user-email">${displayName}</div>
        <div class="user-email">${email}</div>
      </div>

      <span class="user-role ${user.role}">${user.role}</span>

      <div class="user-actions">
        <button class="btn-edit-user" onclick="changeUserRole('${employeeId}', '${displayName}', '${user.role}')">Change Role</button>
        <button class="btn-delete-user" onclick="deleteUserRole('${employeeId}', '${displayName}')">Remove</button>
      </div>
    `;

    container.appendChild(wrapper);
  });
}

async function addUser() {
  const employeeId = document.getElementById("newEmployeeId")?.value.trim();
  const displayName = document.getElementById("newDisplayName")?.value.trim();
  const role = document.getElementById("newUserRole")?.value;

  if (!employeeId || !displayName || role === "Select Role...") {
    showWarning("Please fill in all fields", "Incomplete Form");
    return;
  }

  try {
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, displayName, role })
    });

    if (response.ok) {
      showSuccess(`${displayName} added as ${role}!`, "User Added");
      document.getElementById("newEmployeeId").value = "";
      document.getElementById("newDisplayName").value = "";
      document.getElementById("newUserRole").value = "Select Role...";
      await loadAdminUsers();
    } else {
      showError("Failed to add user");
    }
  } catch (error) {
    console.error("Failed to add user:", error);
    showError("Failed to add user");
  }
}

function changeUserRole(employeeId, displayName, currentRole) {
  const newRole = prompt(
    `Change role for ${displayName}\nCurrent: ${currentRole}\n\nEnter new role (admin/manager/developer):`,
    currentRole
  );

  if (newRole && ["admin", "manager", "developer"].includes(newRole.toLowerCase())) {
    updateUserRole(employeeId, newRole.toLowerCase());
  }
}

async function updateUserRole(employeeId, newRole) {
  try {
    const response = await fetch(`/api/admin/users/${employeeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole })
    });

    if (response.ok) {
      showSuccess(`Role updated to ${newRole}!`);
      await loadAdminUsers();
    } else {
      showError("Failed to update role");
    }
  } catch (error) {
    console.error("Failed to update role:", error);
    showError("Failed to update role");
  }
}

function deleteUserRole(employeeId, displayName) {
  showConfirmationModal({
    title: "Remove User Role",
    message: `Remove role assignment for ${displayName}?`,
    submessage: "They will become a developer by default.",
    icon: "warning",
    iconEmoji: "⚠️",
    confirmText: "Remove",
    cancelText: "Cancel",
    confirmStyle: "danger",
    userInfo: { name: displayName, email: `${employeeId}@akersolutions.com` },
    onConfirm: async () => {
      try {
        const response = await fetch(`/api/admin/users/${employeeId}`, { method: "DELETE" });
        if (response.ok) {
          showSuccess("User role removed!");
          await loadAdminUsers();
        } else {
          showError("Failed to remove user");
        }
      } catch (error) {
        console.error("Failed to delete user:", error);
        showError("Failed to remove user");
      }
    }
  });
}

function toggleAdminPanel(event) {
  const panel = document.getElementById("adminPanel");
  const btn = event.target;
  const content = document.getElementById("adminContent");

  if (!panel || !btn || !content) return;

  if (panel.classList.contains("collapsed")) {
    panel.classList.remove("collapsed");
    content.style.display = "grid";
    btn.textContent = "Collapse Admin Panel";
  } else {
    panel.classList.add("collapsed");
    content.style.display = "none";
    btn.textContent = "Expand Admin Panel";
  }
}

// ===============================
// Calendar Rendering
// ===============================
function renderCalendar() {
  const calendar = document.getElementById("calendar");
  if (!calendar) return;

  calendar.innerHTML = "";

  const year = currentYear;
  const month = currentMonth;

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();

  let startDay = firstDay.getDay() - 1;
  if (startDay === -1) startDay = 6;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  for (let i = 0; i < startDay; i++) {
    const emptyDay = document.createElement("div");
    emptyDay.className = "calendar-day empty-day";
    calendar.appendChild(emptyDay);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dayElement = document.createElement("div");

    const currentDate = new Date(year, month, day);
    currentDate.setHours(0, 0, 0, 0);

    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    const isPastOrToday = currentDate < tomorrow;
    const isToday = currentDate.getTime() === today.getTime();
    const isWeekend = currentDate.getDay() === 0 || currentDate.getDay() === 6;

    dayElement.className = "calendar-day";
    if (isPastOrToday) dayElement.classList.add("past");
    if (isToday) dayElement.classList.add("today");
    if (isWeekend) dayElement.classList.add("weekend");

    const dayNumber = document.createElement("div");
    dayNumber.className = "day-number";
    dayNumber.textContent = day;
    dayElement.appendChild(dayNumber);

    const entriesWrap = document.createElement("div");
    entriesWrap.className = "day-entries";
    dayElement.appendChild(entriesWrap);

    if (publicHolidays[dateStr]) {
      const holidayBadge = document.createElement("div");
      holidayBadge.className = "entry-badge public-holiday";
      holidayBadge.textContent = publicHolidays[dateStr];
      entriesWrap.appendChild(holidayBadge);
    }

    const dayEntries = entries.filter((e) => e.date === dateStr);

    const userHasEntry = dayEntries.some(
      (e) => e.employeeId === currentUser?.employeeId && e.status !== "rejected"
    );

    dayEntries.forEach((entry) => {
      const badge = document.createElement("div");
      const typeClass = entry.type.toLowerCase().replace(/\s+/g, "-");
      const status = (entry.status || "pending").toLowerCase();
      
      // ✅ ADD BOTH STATUS AND TYPE CLASSES for color-coding
      badge.className = `entry-badge status-${status} ${typeClass}`;
      
      // ✅ FIXED: Use displayName instead of email
      badge.textContent = `${entry.displayName || entry.email || entry.employeeId} - ${entry.type}`;
      
      // ✅ ADD STATUS ICON
      if (status === "approved") {
        badge.textContent = `✅ ${badge.textContent}`;
      } else if (status === "rejected") {
        badge.textContent = `❌ ${badge.textContent}`;
        badge.style.textDecoration = "line-through";
        badge.style.opacity = "0.7";
      } else {
        badge.textContent = `⏱️ ${badge.textContent}`;
      }
      
      entriesWrap.appendChild(badge);
    });

    // ✅ ADD STATUS CLASS TO DAY ELEMENT
    if (userHasEntry) {
      const userEntry = dayEntries.find(
        (e) => e.employeeId === currentUser?.employeeId && e.status !== "rejected"
      );
      if (userEntry) {
        const status = (userEntry.status || "pending").toLowerCase();
        const typeClass = userEntry.type.toLowerCase().replace(/\s+/g, "-");
        dayElement.classList.add("has-user-entry", `status-${status}`, typeClass);
      }
      
      dayElement.classList.add("past", "disabled");
      dayElement.style.cursor = "not-allowed";
      dayElement.style.opacity = "0.6";
      dayElement.onclick = null;
    } else {
      const canClick = !isPastOrToday && !isWeekend;
      if (canClick) {
        dayElement.style.cursor = "pointer";
        dayElement.onclick = () => selectDate(dateStr);
      } else {
        dayElement.style.cursor = "not-allowed";
        dayElement.onclick = null;
      }
    }

    calendar.appendChild(dayElement);
  }
}

// ===============================
// Date selection (calendar click)
// ===============================
function selectDate(dateStr) {
  console.log('═══════════════════════════════════════');
  console.log('🖱️ CALENDAR DATE CLICKED');
  console.log('═══════════════════════════════════════');
  console.log('📅 Date clicked:', dateStr);
  
  const selectedDate = ymdToLocalDate(dateStr);
  selectedDate.setHours(0, 0, 0, 0);

  const day = selectedDate.getDay();
  const isWeekend = day === 0 || day === 6;
  
  console.log('📊 Date info:');
  console.log('  - Day of week:', day, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]);
  console.log('  - Is weekend?', isWeekend);

  if (isWeekend) {
    console.log('❌ BLOCKED: Weekend date');
    showWarning("Weekend selection is not allowed. Please choose a weekday.", "Invalid Date");
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  console.log('📅 Date validation:');
  console.log('  - Today:', toYMDLocal(today));
  console.log('  - Tomorrow:', toYMDLocal(tomorrow));
  console.log('  - Selected:', toYMDLocal(selectedDate));
  console.log('  - Is past/today?', selectedDate < tomorrow);

  if (selectedDate < tomorrow) {
    console.log('❌ BLOCKED: Past or same-day date');
    showWarning("Cannot apply for same-day or past dates. Please select a future date.", "Invalid Date");
    return;
  }

  const existingEntry = entries.find(
    (e) => e.date === dateStr && e.employeeId === currentUser?.employeeId && e.status !== "rejected"
  );
  
  console.log('🔍 Checking existing entries...');
  console.log('  - Found existing entry?', !!existingEntry);

  if (existingEntry) {
    console.log('❌ BLOCKED: Entry already exists');
    console.log('  - Type:', existingEntry.type);
    console.log('  - Status:', existingEntry.status);
    showWarning(`You already have a ${existingEntry.type} request for this date.`, "Entry Already Exists");
    return;
  }

  console.log('✅ VALIDATION PASSED - Opening modal with date');

  // ✅ SET DATE IN FLATPICKR - Use Date object, not string!
  const dateInput = document.getElementById("entryDate");
  if (dateInput) {
    console.log('📝 Setting date in Flatpickr...');
    dateInput.placeholder = "";
    
    if (dateInput._flatpickr) {
      console.log('  → Flatpickr exists, setting date...');
      // ✅ CRITICAL: Use Date object at noon to avoid timezone issues
      const dateObj = new Date(dateStr + 'T12:00:00');
      dateInput._flatpickr.setDate(dateObj, false);
      dateInput.value = dateStr;
      console.log('  ✓ Date set:', dateStr);
      console.log('  - Flatpickr selected:', dateInput._flatpickr.selectedDates);
      console.log('  - Input value:', dateInput.value);
    } else {
      console.log('  → Flatpickr not initialized, setting value directly');
      dateInput.value = dateStr;
    }
  }

  document.getElementById("entryName").value = currentUser?.email || "";
  document.getElementById("entryNote").value = "";

  addColorIndicatorsToDropdown();
  
  console.log('🚀 Opening modal...');
  openModal("entryModal");
  console.log('═══════════════════════════════════════');
}

// ===============================
// Selection toast while picking
// ===============================
function showSelectionToast(dateStrings) {
  if (suppressSelectionToasts) return;

  if (!Array.isArray(dateStrings)) dateStrings = [];
  const count = dateStrings.length;

  const key = dateStrings.join("|");
  if (key === lastSelectionKey) return;
  lastSelectionKey = key;

  if (selectionToastTimer) clearTimeout(selectionToastTimer);
  selectionToastTimer = setTimeout(() => {
    if (suppressSelectionToasts) return;

    if (selectionToastId) closeToast(selectionToastId);

    if (count === 0) {
      // ✅ don't spam this; only show if user really cleared manually
      selectionToastId = showInfo("No dates selected", "Selection");
      return;
    }

    if (count === 1) {
      selectionToastId = showInfo(`Selected: ${dateStrings[0]}`, "Selection");
      return;
    }

    const start = dateStrings[0];
    const end = dateStrings[dateStrings.length - 1];
    const msg = `✅ ${count} weekdays selected: ${start} to ${end}`;

    selectionToastId = showToast(msg, { type: "success", title: "Dates Selected", duration: 2500 });
  }, 120);
}

// ===============================
// Flatpickr setup (multi select + drag)
// ===============================
function setupDatePicker() {
  const dateInput = document.getElementById("entryDate");
  if (!dateInput) return;

  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() + 2);

  function getDisabledDates() {
    if (!currentUser) return [];
    const disabledDates = [];
    entries.forEach((entry) => {
      if (entry.employeeId === currentUser.employeeId && entry.status !== "rejected") {
        disabledDates.push(entry.date);
      }
    });
    return disabledDates;
  }

  const fp = flatpickr(dateInput, {
    mode: "multiple",
    minDate: tomorrow,
    maxDate: maxDate,
    dateFormat: "Y-m-d",
    conjunction: " to ",
    static: true,
    allowInput: false,
    clickOpens: true,

    disable: [
      function (date) {
        const day = date.getDay();
        if (day === 0 || day === 6) return true;

        const dateStr = toYMDLocal(date);
        return getDisabledDates().includes(dateStr);
      }
    ],

    onReady: function (selectedDates, dateStr, instance) {
      const calendar = instance.calendarContainer;
      let isDragging = false;
      let dragStartDate = null;

      calendar.addEventListener("mousedown", function (e) {
        const dayElem = e.target.closest(".flatpickr-day");
        if (dayElem && !dayElem.classList.contains("flatpickr-disabled")) {
          isDragging = true;
          dragStartDate = dayElem.dateObj;
          e.preventDefault();
        }
      });

      calendar.addEventListener("mouseover", function (e) {
        if (!isDragging) return;

        const dayElem = e.target.closest(".flatpickr-day");
        if (dayElem && !dayElem.classList.contains("flatpickr-disabled")) {
          const currentDate = dayElem.dateObj;

          const startStr = toYMDLocal(dragStartDate);
          const endStr = toYMDLocal(currentDate);

          const startLocal = ymdToLocalDate(startStr);
          const endLocal = ymdToLocalDate(endStr);

          const earlierStr = startLocal <= endLocal ? startStr : endStr;
          const laterStr = startLocal <= endLocal ? endStr : startStr;

          const selected = [];
          const cur = ymdToLocalDate(earlierStr);
          const end = ymdToLocalDate(laterStr);

          while (cur <= end) {
            const dow = cur.getDay();
            if (dow !== 0 && dow !== 6) {
              const ymd = toYMDLocal(cur);
              if (!getDisabledDates().includes(ymd)) {
                selected.push(new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), 12, 0, 0));
              }
            }
            cur.setDate(cur.getDate() + 1);
          }

          instance.setDate(selected, false);
        }
      });

      document.addEventListener("mouseup", function () {
        if (isDragging) {
          isDragging = false;
          dragStartDate = null;

          // force onChange after drag
          if (instance.config.onChange && instance.config.onChange.length > 0) {
            instance.config.onChange.forEach((fn) => {
              fn(instance.selectedDates, instance.input.value, instance);
            });
          }
        }
      });

      calendar.style.userSelect = "none";
    },

    onDayCreate: function (dObj, dStr, fp, dayElem) {
      const date = dayElem.dateObj;
      const dateStr = toYMDLocal(date);

      const userEntry = entries.find(
        (e) => e.date === dateStr && e.employeeId === currentUser?.employeeId && e.status !== "rejected"
      );

      if (userEntry) {
        dayElem.classList.add("has-user-entry");
        const status = userEntry.status || "pending";
        dayElem.classList.add(status);
        dayElem.title = `You already have a ${userEntry.type} (${status}) for this date`;
      }
    },

    onChange: function (selectedDates, dateStr, instance) {
      if (suppressSelectionToasts) return;

      if (selectedDates.length > 0) {
        const sortedDates = [...selectedDates].sort((a, b) => a - b);
        const dateStrings = sortedDates.map((d) => toYMDLocal(d));

        console.log(`📅 Selected ${dateStrings.length} weekday(s):`, dateStrings);

        showSelectionToast(dateStrings);

        if (dateStrings.length === 1) {
          dateInput.value = dateStrings[0];
        } else {
          const startDate = dateStrings[0];
          const endDate = dateStrings[dateStrings.length - 1];
          dateInput.value = `${startDate} to ${endDate} (${dateStrings.length} weekdays)`;
        }

        const helpText = document.querySelector(".date-selection-help");
        if (helpText) {
          if (dateStrings.length === 1) {
            helpText.innerHTML = '💡 <strong>Drag</strong> to more dates or click to add individual days';
            helpText.style.color = "var(--text-muted)";
            helpText.style.fontWeight = "normal";
          } else {
            helpText.innerHTML = `✅ <strong>${dateStrings.length} weekdays selected:</strong> ${dateStrings.join(", ")}`;
            helpText.style.color = "#059669";
            helpText.style.fontWeight = "600";
          }
        }
      } else {
        // only show if user manually cleared (not when closing)
        showSelectionToast([]);

        const helpText = document.querySelector(".date-selection-help");
        if (helpText) {
          helpText.innerHTML = '💡 <strong>Click & drag</strong> to select multiple dates, or click individual dates (weekends auto-skipped)';
          helpText.style.color = "var(--text-muted)";
          helpText.style.fontWeight = "normal";
        }
      }
    },

    onValueUpdate: function (selectedDates) {
      if (suppressSelectionToasts) return;

      if (selectedDates.length > 1) {
        const sortedDates = [...selectedDates].sort((a, b) => a - b);
        const dateStrings = sortedDates.map((d) => toYMDLocal(d));
        dateInput.value = `${dateStrings[0]} to ${dateStrings[dateStrings.length - 1]} (${dateStrings.length} weekdays)`;
      }
    }
  });

  dateInput._flatpickr = fp;
}

// ===============================
// Save Entry (✅ BATCH ENDPOINT)
// ===============================
async function saveEntry() {
  if (isSaving) return;
  isSaving = true;

  const saveBtn = document.getElementById("saveEntryBtn");
  const cancelBtn = document.querySelector(".btn-secondary");

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
    saveBtn.style.opacity = "0.6";
    saveBtn.style.cursor = "not-allowed";
  }
  if (cancelBtn) {
    cancelBtn.disabled = true;
    cancelBtn.style.opacity = "0.6";
    cancelBtn.style.cursor = "not-allowed";
  }

  try {
    const dateInput = document.getElementById("entryDate");
    const type = document.getElementById("entryType").value;
    const name = document.getElementById("entryName").value;
    const note = document.getElementById("entryNote").value;

    const fp = dateInput?._flatpickr;
    const selectedDates = fp?.selectedDates || [];

    if (!type) {
      showWarning("Please select type", "Missing Info");
      return;
    }

    if (selectedDates.length === 0) {
      showWarning("Please select at least one date", "No Date Selected");
      return;
    }

    const datesToCreate = [...selectedDates]
      .map((d) => toYMDLocal(d))
      .sort();

    console.log(`💾 Creating ${datesToCreate.length} entries:`, datesToCreate);

    // ✅ USE BATCH ENDPOINT - ONE EMAIL PER REQUEST!
    const resp = await fetch("/api/entry/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dates: datesToCreate, type, name, note })
    });

    if (resp.status === 409) {
      const data = await resp.json();
      const msg = data.message || "Some entries already exist.";
      showWarning(msg, "Duplicate Entry");
      
      // ✅ Still refresh calendar to show what was created
      if (data.createdCount && data.createdCount > 0) {
        await loadEntries();
        renderCalendar();
      }
      return;
    }

    if (!resp.ok) {
      const msg = await resp.text();
      showError(msg || "Failed to save entries", "Error");
      return;
    }

    const result = await resp.json();

    // ✅ close modal without triggering "No dates selected" toast
    closeModal("entryModal");

    const message =
      datesToCreate.length === 1
        ? `${type} entry added for ${datesToCreate[0]}`
        : `${datesToCreate.length} ${type} entries added (${datesToCreate[0]} to ${datesToCreate[datesToCreate.length - 1]})`;

    showSuccess(message + "\n\n✉️ Manager notified via ONE email", "Entries Added");

    await loadEntries();
    renderCalendar();
  } catch (e) {
    console.error("❌ Save error:", e);
    showError("Failed to save entries. Please try again.", "Error");
  } finally {
    isSaving = false;

    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Entry";
      saveBtn.style.opacity = "1";
      saveBtn.style.cursor = "pointer";
    }
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.style.opacity = "1";
      cancelBtn.style.cursor = "pointer";
    }
  }
}

// ===============================
// Month/Year controls
// ===============================
function changeMonth(delta) {
  currentMonth += delta;

  if (currentMonth < 0) {
    currentMonth = 11;
    currentYear--;
  } else if (currentMonth > 11) {
    currentMonth = 0;
    currentYear++;
  }

  updateMonthDisplay();
  renderCalendar();
}

function changeYear() {
  const yearSelect = document.getElementById("yearSelect");
  currentYear = parseInt(yearSelect.value, 10);

  updateMonthDisplay();
  renderCalendar();
}

function updateMonthDisplay() {
  const monthLabel = document.getElementById("currentMonth");
  const yearSelect = document.getElementById("yearSelect");

  if (monthLabel) monthLabel.textContent = `${monthNames[currentMonth]} ${currentYear}`;
  if (yearSelect) yearSelect.value = String(currentYear);
}

// ===============================
// Modal
// ===============================
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  if (modalId === "entryModal") {
    const dateInput = document.getElementById("entryDate");
    if (dateInput && !dateInput._flatpickr) {
      console.log('⚠️ Flatpickr not initialized in modal, initializing now...');
      setupDatePicker();
    }
    
    // ✅ After modal opens, check if there's a value to apply
    setTimeout(() => {
      if (dateInput && dateInput.value && dateInput._flatpickr) {
        console.log('✓ Applying preselected date:', dateInput.value);
        const dateObj = new Date(dateInput.value + 'T12:00:00');
        dateInput._flatpickr.setDate(dateObj, false);
        dateInput.placeholder = '';
      }
    }, 100);
  }

  modal.classList.add("active");
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  if (modalId === "entryModal") {
    const dateInput = document.getElementById("entryDate");
    if (dateInput && dateInput._flatpickr) {
      // ✅ suppress "No dates selected" toast caused by flatpickr.clear()
      suppressSelectionToasts = true;
      lastSelectionKey = "";
      if (selectionToastId) closeToast(selectionToastId);

      dateInput._flatpickr.clear();
      dateInput.value = "";
      dateInput.placeholder = "Select date or date range...";

      setTimeout(() => {
        suppressSelectionToasts = false;
      }, 200);
    }
  }

  modal.classList.remove("active");
}

document.addEventListener("click", (e) => {
  if (e.target && e.target.classList && e.target.classList.contains("modal")) {
    if (e.target.id === "entryModal") return; // ✅ don't close on outside click
    e.target.classList.remove("active");
  }
});

// ===============================
// Toasts
// ===============================
let toastContainer = null;
let toastIdCounter = 0;

function ensureToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.className = "toast-container";
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

function showToast(message, options = {}) {
  const { type = "info", title = "", duration = 3000, closable = true } = options;

  const container = ensureToastContainer();
  const toastId = `toast-${++toastIdCounter}`;

  const icons = { success: "✓", error: "✕", warning: "⚠", info: "ℹ" };

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.id = toastId;

  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-content">
      ${title ? `<div class="toast-title">${title}</div>` : ""}
      <div class="toast-message">${String(message).replace(/\n/g, "<br/>")}</div>
    </div>
    ${closable ? `<button class="toast-close" type="button" onclick="closeToast('${toastId}')">×</button>` : ""}
    <div class="toast-progress"></div>
  `;

  container.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);

  if (duration > 0) setTimeout(() => closeToast(toastId), duration);

  return toastId;
}

function closeToast(toastId) {
  const toast = document.getElementById(toastId);
  if (!toast) return;
  toast.classList.remove("show");
  setTimeout(() => toast.remove(), 250);
}

function showSuccess(message, title = "Success") {
  return showToast(message, { type: "success", title });
}
function showError(message, title = "Error") {
  return showToast(message, { type: "error", title, duration: 5000 });
}
function showWarning(message, title = "Warning") {
  return showToast(message, { type: "warning", title, duration: 4000 });
}
function showInfo(message, title = "Info") {
  return showToast(message, { type: "info", title });
}

// ===============================
// Confirmation Modal
// ===============================
function showConfirmationModal(options) {
  const {
    title = "Confirm Action",
    message = "Are you sure?",
    submessage = "",
    icon = "warning",
    iconEmoji = "⚠️",
    confirmText = "Confirm",
    cancelText = "Cancel",
    confirmStyle = "primary",
    userInfo = null,
    onConfirm = () => {},
    onCancel = () => {}
  } = options;

  const existing = document.getElementById("confirmationModal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "confirmationModal";
  overlay.className = "confirmation-modal-overlay";

  overlay.innerHTML = `
    <div class="confirmation-modal">
      <button class="confirmation-modal-close" type="button" aria-label="Close">×</button>

      <div class="confirmation-modal-icon ${icon}">
        ${iconEmoji}
      </div>

      <div class="confirmation-modal-header">
        <div class="confirmation-modal-title">${title}</div>
        <div class="confirmation-modal-message">${message}</div>
        ${submessage ? `<div class="confirmation-modal-submessage">${submessage}</div>` : ""}
      </div>

      ${userInfo ? `
        <div class="confirmation-user-info">
          <div class="confirmation-user-name">${userInfo.name}</div>
          <div class="confirmation-user-email">${userInfo.email}</div>
        </div>
      ` : ""}

      <div class="confirmation-modal-actions">
        <button class="confirmation-modal-btn btn-confirm-cancel" type="button">${cancelText}</button>
        <button class="confirmation-modal-btn ${confirmStyle === "danger" ? "btn-confirm-danger" : "btn-confirm-primary"}" type="button">
          ${confirmText}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const [cancelBtn, confirmBtn] = overlay.querySelectorAll(".confirmation-modal-btn");
  const closeBtn = overlay.querySelector(".confirmation-modal-close");

  cancelBtn.onclick = () => {
    onCancel();
    closeConfirmationModal();
  };

  confirmBtn.onclick = () => {
    onConfirm();
    closeConfirmationModal();
  };

  closeBtn.onclick = () => {
    onCancel();
    closeConfirmationModal();
  };

  overlay.onclick = (e) => {
    if (e.target === overlay) {
      onCancel();
      closeConfirmationModal();
    }
  };

  const escHandler = (e) => {
    if (e.key === "Escape") {
      onCancel();
      closeConfirmationModal();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);
}

function closeConfirmationModal() {
  const modal = document.getElementById("confirmationModal");
  if (modal) modal.remove();
}

// ===============================
// Global functions
// ===============================
window.changeMonth = changeMonth;
window.changeYear = changeYear;
window.openModal = openModal;
window.closeModal = closeModal;

window.selectDate = selectDate;
window.saveEntry = saveEntry;

window.addUser = addUser;
window.toggleAdminPanel = toggleAdminPanel;
window.changeUserRole = changeUserRole;
window.deleteUserRole = deleteUserRole;