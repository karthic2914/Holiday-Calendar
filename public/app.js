// ===============================
// Configuration
// ===============================
const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const typeColors = {
  "Public Holiday": "#EF4444",
  "Leave": "#3B82F6",
  "Sick": "#F97316",
  "WFH": "#14B8A6",
  "Work From Stavanger": "#9b59b6",
  "Work From Oslo": "#16a085",
  "Work Travel": "#8B5CF6"
};

// Norwegian public holidays (example set)
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
  
  // ✅ HIDE LOADING SCREEN
  const loadingScreen = document.getElementById('loadingScreen');
  if (loadingScreen) {
    loadingScreen.style.display = 'none';
  }
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
    if (usernameEl) usernameEl.textContent = `Welcome, ${user.email}`;

    if (user.role === 'admin') {
      const adminPanel = document.getElementById('adminPanel');
      if (adminPanel) {
        adminPanel.style.display = 'block';
        adminPanel.classList.add('collapsed');
        
        const adminContent = document.getElementById('adminContent');
        if (adminContent) {
          adminContent.style.display = 'none';
        }
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
  const container = document.getElementById('adminUsersList');
  if (!container) return;

  container.innerHTML = '';

  if (!users || users.length === 0) {
    container.innerHTML = '<div class="loading">No admins/managers found.</div>';
    return;
  }

  users.forEach(user => {
    const wrapper = document.createElement('div');
    wrapper.className = 'user-item';

    const employeeId = user.employeeId;
    const email = user.email || `${employeeId}@akersolutions.com`;
    let displayName = user.displayName || employeeId;

    if (String(displayName).includes('@')) displayName = employeeId;

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
  const panel = document.getElementById('adminPanel');
  const btn = event.target;
  const content = document.getElementById('adminContent');

  if (!panel || !btn || !content) return;

  if (panel.classList.contains('collapsed')) {
    panel.classList.remove('collapsed');
    content.style.display = 'grid';
    btn.textContent = 'Collapse Admin Panel';
  } else {
    panel.classList.add('collapsed');
    content.style.display = 'none';
    btn.textContent = 'Expand Admin Panel';
  }
}

// ===============================
// Calendar Rendering
// ===============================
function renderCalendar() {
  const calendar = document.getElementById('calendar');
  if (!calendar) return;
  
  calendar.innerHTML = '';
  
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
    const emptyDay = document.createElement('div');
    emptyDay.className = 'calendar-day empty-day';
    calendar.appendChild(emptyDay);
  }
  
  for (let day = 1; day <= daysInMonth; day++) {
    const dayElement = document.createElement('div');
    
    const currentDate = new Date(year, month, day);
    currentDate.setHours(0, 0, 0, 0);
    
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    const isPastOrToday = currentDate < tomorrow;
    const isToday = currentDate.getTime() === today.getTime();
    const isWeekend = currentDate.getDay() === 0 || currentDate.getDay() === 6;
    
    dayElement.className = 'calendar-day';
    if (isPastOrToday) dayElement.classList.add('past');
    if (isToday) dayElement.classList.add('today');
    if (isWeekend) dayElement.classList.add('weekend');
    
    const dayNumber = document.createElement('div');
    dayNumber.className = 'day-number';
    dayNumber.textContent = day;
    dayElement.appendChild(dayNumber);
    
    const entriesWrap = document.createElement('div');
    entriesWrap.className = 'day-entries';
    dayElement.appendChild(entriesWrap);
    
    if (publicHolidays[dateStr]) {
      const holidayBadge = document.createElement('div');
      holidayBadge.className = 'entry-badge public-holiday';
      holidayBadge.textContent = publicHolidays[dateStr];
      entriesWrap.appendChild(holidayBadge);
    }
    
    const dayEntries = entries.filter(e => e.date === dateStr);

    const userHasEntry = dayEntries.some(e => 
      e.employeeId === currentUser?.employeeId &&
      e.status !== 'rejected'
    );

    dayEntries.forEach(entry => {
      const badge = document.createElement('div');
      const typeClass = entry.type.toLowerCase().replace(/\s+/g, '-');
      badge.className = `entry-badge ${typeClass}`;
      badge.textContent = `${entry.email || entry.employeeId} - ${entry.type}`;
      entriesWrap.appendChild(badge);
    });

    // ✅ If user has entry, disable the day completely
    if (userHasEntry) {
      dayElement.classList.add('past');
      dayElement.classList.add('disabled');
      dayElement.style.cursor = 'not-allowed';
      dayElement.style.opacity = '0.6';
      dayElement.onclick = null;
    } else {
      const canClick = !isPastOrToday && !isWeekend;

      if (canClick) {
        dayElement.style.cursor = 'pointer';
        dayElement.onclick = () => selectDate(dateStr);
      } else {
        dayElement.style.cursor = 'not-allowed';
        dayElement.onclick = null;
      }
    }
    
    calendar.appendChild(dayElement);
  }
}

// ===============================
// Date selection
// ===============================
function selectDate(dateStr) {
  const selectedDate = new Date(dateStr);
  selectedDate.setHours(0, 0, 0, 0);

  const day = selectedDate.getDay();
  const isWeekend = day === 0 || day === 6;

  if (isWeekend) {
    showWarning("Weekend selection is not allowed. Please choose a weekday.", "Invalid Date");
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (selectedDate < tomorrow) {
    showWarning("Cannot apply for same-day or past dates. Please select a future date.", "Invalid Date");
    return;
  }

  const existingEntry = entries.find(e => 
    e.date === dateStr && 
    e.employeeId === currentUser?.employeeId &&
    e.status !== 'rejected'
  );

  if (existingEntry) {
    showWarning(`You already have a ${existingEntry.type} request for this date.`, "Entry Already Exists");
    return;
  }

  document.getElementById("entryDate").value = dateStr;
  document.getElementById("entryName").value = currentUser?.email || "";
  document.getElementById("entryNote").value = "";

  addColorIndicatorsToDropdown();

  openModal("entryModal");
}

// ===============================
// ✅ FLATPICKR DATE PICKER - DISABLES SPECIFIC DATES!
// ===============================
function setupDatePicker() {
  const dateInput = document.getElementById("entryDate");
  if (!dateInput) return;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() + 2);

  // ✅ Get all dates where user has entries
  function getDisabledDates() {
    if (!currentUser) return [];
    
    const disabledDates = [];
    
    // Add user's existing entry dates
    entries.forEach(entry => {
      if (entry.employeeId === currentUser.employeeId && entry.status !== 'rejected') {
        disabledDates.push(entry.date);
      }
    });
    
    return disabledDates;
  }

  // ✅ Initialize Flatpickr
  flatpickr(dateInput, {
    minDate: tomorrow,
    maxDate: maxDate,
    dateFormat: "Y-m-d",
    
    // ✅ Disable specific dates (user's existing entries + weekends)
    disable: [
      function(date) {
        // Disable weekends
        const day = date.getDay();
        if (day === 0 || day === 6) return true;
        
        // Disable dates where user has entries
        const dateStr = date.toISOString().split('T')[0];
        const disabledDates = getDisabledDates();
        return disabledDates.includes(dateStr);
      }
    ],
    
    // ✅ Add visual indicator for dates with entries
    onDayCreate: function(dObj, dStr, fp, dayElem) {
      const date = dayElem.dateObj;
      const dateStr = date.toISOString().split('T')[0];
      
      // Check if user has entry on this date
      const hasEntry = entries.some(e => 
        e.date === dateStr && 
        e.employeeId === currentUser?.employeeId &&
        e.status !== 'rejected'
      );
      
      if (hasEntry) {
        dayElem.classList.add('has-user-entry');
        dayElem.title = 'You already have an entry for this date';
      }
    },
    
    // Styling
    theme: "light",
    allowInput: false,
    clickOpens: true
  });
}

// ===============================
// Save Entry with validation
// ===============================
async function saveEntry() {
  if (isSaving) {
    console.log('⚠️ Already saving, ignoring duplicate click');
    return;
  }
  
  isSaving = true;

  const saveBtn = document.getElementById('saveEntryBtn');
  const cancelBtn = document.querySelector('.btn-secondary');
  
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    saveBtn.style.opacity = '0.6';
    saveBtn.style.cursor = 'not-allowed';
  }
  
  if (cancelBtn) {
    cancelBtn.disabled = true;
    cancelBtn.style.opacity = '0.6';
    cancelBtn.style.cursor = 'not-allowed';
  }

  try {
    const date = document.getElementById('entryDate').value;
    const type = document.getElementById('entryType').value;
    const name = document.getElementById('entryName').value;
    const note = document.getElementById('entryNote').value;

    if (!date || !type) {
      showWarning('Please select date and type', 'Missing Info');
      return;
    }

    const selectedDate = new Date(date);
    selectedDate.setHours(0, 0, 0, 0);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (selectedDate < tomorrow) {
      showError('Cannot apply for same-day or past dates', 'Invalid Date');
      return;
    }

    // ✅ Final duplicate check
    const existingEntry = entries.find(e => 
      e.date === date && 
      e.employeeId === currentUser?.employeeId &&
      e.status !== 'rejected'
    );

    if (existingEntry) {
      showWarning(
        `You already have a ${existingEntry.type} request for ${date}. Please select a different date.`,
        'Entry Already Exists'
      );
      return;
    }

    console.log('💾 Saving entry:', { date, type, name, note });

    const resp = await fetch('/api/entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, type, name, note })
    });

    if (resp.status === 409) {
      const msg = await resp.text();
      showWarning(msg || 'Entry already exists for this date.', 'Duplicate Entry');
      return;
    }

    if (!resp.ok) {
      const msg = await resp.text();
      showError(msg || 'Failed to save entry', 'Error');
      return;
    }

    const result = await resp.json();
    console.log('✅ Entry saved successfully:', result);

    closeModal('entryModal');

    const formattedDate = new Date(date).toLocaleDateString('en-GB', { 
      day: 'numeric', 
      month: 'short', 
      year: 'numeric' 
    });
    showSuccess(`${type} on ${formattedDate} added!`, 'Entry Added');

    await loadEntries();
    renderCalendar();

  } catch (e) {
    console.error('❌ Save error:', e);
    showError('Failed to save entry. Please try again.', 'Error');
  } finally {
    isSaving = false;
    
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Entry';
      saveBtn.style.opacity = '1';
      saveBtn.style.cursor = 'pointer';
    }
    
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.style.opacity = '1';
      cancelBtn.style.cursor = 'pointer';
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
  modal.classList.add("active");
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.remove("active");
}

document.addEventListener("click", (e) => {
  if (e.target && e.target.classList && e.target.classList.contains("modal")) {
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
  const {
    type = "info",
    title = "",
    duration = 3000,
    closable = true
  } = options;

  const container = ensureToastContainer();
  const toastId = `toast-${++toastIdCounter}`;

  const icons = {
    success: "✓",
    error: "✕",
    warning: "⚠",
    info: "ℹ"
  };

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.id = toastId;

  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-content">
      ${title ? `<div class="toast-title">${title}</div>` : ""}
      <div class="toast-message">${message}</div>
    </div>
    ${closable ? `<button class="toast-close" type="button" onclick="closeToast('${toastId}')">×</button>` : ""}
    <div class="toast-progress"></div>
  `;

  container.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);

  if (duration > 0) {
    setTimeout(() => closeToast(toastId), duration);
  }

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