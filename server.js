// server.js
// SMART MULTI-DAY VERSION - FAST UI
// ✅ Batch endpoint: /api/entry/batch (partial save: skips duplicates)
// ✅ Approve/Reject token-only: /api/leave/approve?token=...  /api/leave/reject?token=...
// ✅ Beautiful status pages prevent double-approval/rejection
// ✅ FAST UI: response returns immediately; email sent async
//
// ✅ FULL SSO SUPPORT (DOES NOT REMOVE ANYTHING)
// This file supports TWO ways to get the logged-in user:
//
// 1) HEADER-BASED SSO (Azure EasyAuth / Reverse Proxy)
//    - x-ms-client-principal (base64 JSON) ✅ best
//    - x-ms-client-principal-name (email)
//    - x-forwarded-user (email)
//    - x-user-email (custom)
//
// 2) WINDOWS SSO (node-expose-sspi) ✅ for internal VM without EasyAuth/IIS
//    - Uses Windows Integrated Auth in browser (Negotiate)
//    - Needs node-expose-sspi installed
//
// IMPORTANT:
// - If headers are null and SSPI is not active/working, user will be "unknown".
// - Enable SSPI by env: USE_SSPI=true
// - TEMP test identity (only for testing): TEST_USER_EMAIL=you@akersolutions.com

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// uses your emailService.js
const {
  sendLeaveRequestEmail,
  sendApprovalEmail,
  sendRejectionEmail,
} = require("./emailService");

const app = express();

// ----------------------------
// ✅ OPTIONAL: SSPI (Windows Integrated Auth)
// ----------------------------
let sso = null;
let sspiLoadError = null;

try {
  // node-expose-sspi exports { sso } (not sspi.auth)
  const mod = require("node-expose-sspi");
  // handle both styles just in case
  sso = mod.sso || null;
} catch (e) {
  sso = null;
  sspiLoadError = e?.message || String(e);
}

const USE_SSPI = String(process.env.USE_SSPI || "").toLowerCase() === "true";
let sspiMiddlewareLoaded = false;

if (USE_SSPI) {
  if (!sso) {
    console.error("❌ USE_SSPI=true but node-expose-sspi (sso) is not available.");
    if (sspiLoadError) console.error("Reason:", sspiLoadError);
  } else if (typeof sso.auth !== "function") {
    console.error("❌ node-expose-sspi loaded but sso.auth() not found (unexpected export).");
  } else {
    // MUST be before routes
    app.use(sso.auth());
    sspiMiddlewareLoaded = true;
    console.log("✅ SSPI enabled (node-expose-sspi) via sso.auth().");
  }
}

app.use(express.json({ limit: "1mb" }));

// ----------------------------
// Config / storage
// ----------------------------
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "0.0.0.0";

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const ENTRIES_FILE = path.join(DATA_DIR, "entries.json");
const ROLES_FILE = path.join(DATA_DIR, "roles.json"); // optional

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error("✗ readJson failed:", file, e.message);
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function ensureEntriesFile() {
  if (!fs.existsSync(ENTRIES_FILE)) writeJson(ENTRIES_FILE, []);
}
ensureEntriesFile();

function loadEntries() {
  ensureEntriesFile();
  const data = readJson(ENTRIES_FILE, []);
  const map = new Map();
  (data || []).forEach((e) => {
    if (e && e.id) map.set(e.id, e);
  });
  return Array.from(map.values());
}

function saveEntries(entries) {
  writeJson(ENTRIES_FILE, entries || []);
}

// ----------------------------
// ✅ ROLES loader (unchanged)
// Supports BOTH:
// 1) { roles: { "408275a":"admin" }, defaultRole:"developer" }
// 2) { users: [{employeeId,displayName,email,role}], defaultRole:"developer" }
// Normalized to { users:[...], rolesMap:{...}, defaultRole }
// ----------------------------
function normalizeRolesFile(raw) {
  const obj = raw && typeof raw === "object" ? raw : {};
  const defaultRole = String(obj.defaultRole || "developer").toLowerCase();

  let users = Array.isArray(obj.users) ? obj.users : [];
  const rolesMap = obj.roles && typeof obj.roles === "object" ? obj.roles : {};

  if (users.length === 0 && Object.keys(rolesMap).length > 0) {
    users = Object.entries(rolesMap).map(([employeeId, role]) => ({
      employeeId: String(employeeId).trim(),
      role: String(role || defaultRole).toLowerCase(),
      displayName: String(employeeId).trim(),
      email: `${String(employeeId).trim()}@akersolutions.com`,
    }));
  }

  users = users
    .filter((u) => u && u.employeeId)
    .map((u) => ({
      employeeId: String(u.employeeId).trim(),
      role: String(u.role || defaultRole).toLowerCase(),
      displayName: String(u.displayName || u.employeeId).trim(),
      email: String(u.email || `${u.employeeId}@akersolutions.com`).trim(),
    }));

  const normalizedRolesMap = {};
  users.forEach((u) => {
    normalizedRolesMap[u.employeeId] = u.role;
  });

  return { users, rolesMap: normalizedRolesMap, defaultRole };
}

function loadRoles() {
  const raw = readJson(ROLES_FILE, { users: [], defaultRole: "developer" });
  return normalizeRolesFile(raw);
}

function saveRolesNormalized(normalized) {
  const payload = {
    users: normalized.users || [],
    defaultRole: normalized.defaultRole || "developer",
  };
  writeJson(ROLES_FILE, payload);
}

function upsertRoleUser(user) {
  const roles = loadRoles();
  const idx = roles.users.findIndex((u) => u.employeeId === user.employeeId);

  const merged = {
    employeeId: String(user.employeeId).trim(),
    displayName: String(user.displayName || user.employeeId).trim(),
    role: String(user.role || roles.defaultRole).toLowerCase(),
    email: String(user.email || `${user.employeeId}@akersolutions.com`).trim(),
  };

  if (idx >= 0) roles.users[idx] = { ...roles.users[idx], ...merged };
  else roles.users.push(merged);

  saveRolesNormalized(roles);
}

function deleteRoleUser(employeeId) {
  const roles = loadRoles();
  roles.users = (roles.users || []).filter((u) => u.employeeId !== employeeId);
  saveRolesNormalized(roles);
}

// ----------------------------
// Helpers
// ----------------------------
function isoTodayLocal() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function isoTomorrowLocal() {
  const t = isoTodayLocal();
  t.setDate(t.getDate() + 1);
  return t;
}
function parseYMD(dateStr) {
  return new Date(`${dateStr}T12:00:00`);
}
function isWeekend(dateObj) {
  const day = dateObj.getDay();
  return day === 0 || day === 6;
}
function newId() {
  return crypto.randomBytes(12).toString("hex");
}
function newToken() {
  return crypto.randomBytes(18).toString("hex");
}
function normalizeType(type) {
  return String(type || "").trim();
}
function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hasActiveEntry(entries, employeeId, dateStr) {
  return entries.some(
    (e) =>
      e.employeeId === employeeId &&
      e.date === dateStr &&
      String(e.status || "").toLowerCase() !== "rejected"
  );
}

// ----------------------------
// ✅ HEADER SSO (EasyAuth / Proxy)
// ----------------------------
function tryParseEasyAuthPrincipal(req) {
  const b64 = req.headers["x-ms-client-principal"];
  if (!b64) return null;

  try {
    const json = Buffer.from(String(b64), "base64").toString("utf8");
    const obj = JSON.parse(json);

    const userDetails = obj.userDetails ? String(obj.userDetails) : "";
    if (userDetails.includes("@")) return userDetails.toLowerCase();

    const claims = Array.isArray(obj.claims) ? obj.claims : [];
    const emailClaim =
      claims.find((c) => c.typ === "preferred_username") ||
      claims.find((c) => c.typ === "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress") ||
      claims.find((c) => c.typ === "email");

    if (emailClaim && emailClaim.val) return String(emailClaim.val).toLowerCase();
  } catch (e) {
    console.error("⚠️ Failed to parse x-ms-client-principal:", e.message);
  }
  return null;
}

function getEmailFromSSOHeaders(req) {
  const direct =
    req.headers["x-user-email"] ||
    req.headers["x-ms-client-principal-name"] ||
    req.headers["x-forwarded-user"] ||
    req.headers["remote_user"] ||
    req.headers["x-auth-user"];

  if (direct && String(direct).includes("@")) return String(direct).toLowerCase();

  const fromPrincipal = tryParseEasyAuthPrincipal(req);
  if (fromPrincipal) return fromPrincipal;

  return "";
}

// ----------------------------
// ✅ SSPI SSO (Windows Integrated Auth) - FIXED VERSION
// node-expose-sspi attaches identity to req.sso / req.sspi depending on version
// We'll check both safely.
// ----------------------------
function getEmailFromSSPI(req) {
  // Check if SSPI data exists
  const ssoUser = req.sso?.user;
  const sspiUser = req.sspi?.user;
  
  // Try req.sso.user first (most common)
  if (ssoUser && typeof ssoUser === 'object') {
    
    // ✅ PRIORITY 1: Extract PRIMARY SMTP from proxyAddresses
    // The primary SMTP address is prefixed with uppercase "SMTP:" (not lowercase "smtp:")
    if (ssoUser.adUser && Array.isArray(ssoUser.adUser.proxyAddresses)) {
      const primarySMTP = ssoUser.adUser.proxyAddresses.find(addr => 
        String(addr).startsWith('SMTP:')
      );
      
      if (primarySMTP) {
        // Remove "SMTP:" prefix and get the email
        const email = String(primarySMTP).substring(5).toLowerCase();
        console.log('✓ Using primary SMTP from proxyAddresses:', email);
        return email;
      }
    }
    
    // ✅ PRIORITY 2: Check adUser.mail for full email
    if (ssoUser.adUser && Array.isArray(ssoUser.adUser.mail) && ssoUser.adUser.mail[0]) {
      const fullEmail = String(ssoUser.adUser.mail[0]).toLowerCase();
      console.log('✓ Using email from adUser.mail:', fullEmail);
      return fullEmail;
    }
    
    // ✅ PRIORITY 3: Check adUser.userPrincipalName
    if (ssoUser.adUser && Array.isArray(ssoUser.adUser.userPrincipalName) && ssoUser.adUser.userPrincipalName[0]) {
      const upn = String(ssoUser.adUser.userPrincipalName[0]).toLowerCase();
      console.log('✓ Using email from adUser.userPrincipalName:', upn);
      return upn;
    }
    
    // ✅ FALLBACK: Construct from username (only if nothing else available)
    const username = ssoUser.name || ssoUser.username;
    if (username) {
      const constructedEmail = `${String(username)}@akersolutions.com`.toLowerCase();
      console.log('⚠ Fallback: Constructed email from username:', constructedEmail);
      return constructedEmail;
    }
  }
  
  // Fallback to req.sspi.user
  if (sspiUser && typeof sspiUser === 'object') {
    const username = sspiUser.name || sspiUser.username;
    if (username) {
      return `${String(username)}@akersolutions.com`.toLowerCase();
    }
  }
  
  // Last resort: check for string values
  const rawSso = req.sso?.user || req.sso?.username;
  const rawSspi = req.sspi?.user || req.sspi?.username;
  const raw = rawSso || rawSspi || "";
  
  if (!raw || typeof raw === 'object') return "";
  // raw often like "DOMAIN\\username"
  const username = String(raw).includes("\\") ? String(raw).split("\\")[1] : String(raw);
  // map username -> email
  return `${username}@akersolutions.com`.toLowerCase();
}

// ----------------------------
// Build user using roles.json
// ----------------------------
function buildUserFromEmail(email, sspiDisplayName = null) {
  const roles = loadRoles();
  const employeeId = email.includes("@") ? email.split("@")[0] : email;
  const roleUser = (roles.users || []).find((u) => u.employeeId === employeeId);
  const roleFromMap = roles.rolesMap?.[employeeId];

  // Use SSPI display name if available, otherwise fall back to roles.json or employeeId
  const displayName = sspiDisplayName || roleUser?.displayName || employeeId;

  return {
    employeeId,
    email: roleUser?.email || email || `${employeeId}@akersolutions.com`,
    displayName: displayName,
    role: roleUser?.role || roleFromMap || roles.defaultRole || "developer",
  };
}

// ----------------------------
// Attach user to every request (dynamic)
// Priority:
// 1) EasyAuth/proxy headers
// 2) SSPI (Windows)
// 3) TEST_USER_EMAIL (optional)
// 4) unknown
// ----------------------------
app.use((req, res, next) => {
  const emailFromHeaders = getEmailFromSSOHeaders(req);
  const emailFromSSPI = getEmailFromSSPI(req);

  const testEmail = process.env.TEST_USER_EMAIL
    ? String(process.env.TEST_USER_EMAIL).toLowerCase()
    : "";

  const email = emailFromHeaders || emailFromSSPI || testEmail;

  if (!email) {
    req.user = { employeeId: "unknown", email: "", displayName: "Unknown", role: "developer" };
    return next();
  }

  // Extract SSPI display name if available
  let sspiDisplayName = null;
  const ssoUser = req.sso?.user;
  if (ssoUser && typeof ssoUser === 'object') {
    // Try displayName first (e.g., "Sivasubramanian Karthic, Mahadevan")
    if (ssoUser.displayName) {
      sspiDisplayName = String(ssoUser.displayName);
    }
    // Or try givenName from adUser (e.g., "Mahadevan")
    else if (ssoUser.adUser && Array.isArray(ssoUser.adUser.givenName) && ssoUser.adUser.givenName[0]) {
      sspiDisplayName = String(ssoUser.adUser.givenName[0]);
    }
    // Or try displayName from adUser
    else if (ssoUser.adUser && Array.isArray(ssoUser.adUser.displayName) && ssoUser.adUser.displayName[0]) {
      sspiDisplayName = String(ssoUser.adUser.displayName[0]);
    }
  }

  req.user = buildUserFromEmail(email, sspiDisplayName);
  next();
});

function getUserFromRequest(req) {
  return req.user;
}

// ----------------------------
// ✅ DEBUG endpoint
// ----------------------------
app.get("/api/debug/headers", (req, res) => {
  res.set("Cache-Control", "no-store");

  const authHeader = req.headers["authorization"] || "";
  const authorizationPresent = Boolean(authHeader);

  res.json({
    // Header-based SSO
    "x-user-email": req.headers["x-user-email"] || null,
    "x-ms-client-principal-name": req.headers["x-ms-client-principal-name"] || null,
    "x-ms-client-principal": req.headers["x-ms-client-principal"] ? "(present)" : null,
    "x-forwarded-user": req.headers["x-forwarded-user"] || null,
    "remote_user": req.headers["remote_user"] || null,
    "x-auth-user": req.headers["x-auth-user"] || null,

    // Authorization header (for Negotiate/Kerberos)
    "authorization.present": authorizationPresent,
    "authorization.scheme": authorizationPresent ? String(authHeader).split(" ")[0] : null,

    // SSPI info
    "req.sso.user": req.sso?.user || null,
    "req.sso.username": req.sso?.username || null,
    "req.sspi.user": req.sspi?.user || null,
    "req.sspi.username": req.sspi?.username || null,

    USE_SSPI,
    sspiMiddlewareLoaded,
    sspiLoadError: sspiLoadError || null,

    // Final resolved user
    resolvedUser: getUserFromRequest(req),
  });
});

// ----------------------------
// Static UI
// ----------------------------
app.use(express.static(path.join(__dirname, "public")));

// ----------------------------
// API: user + entries
// ----------------------------
app.get("/api/user", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(getUserFromRequest(req));
});

app.get("/api/entries", (req, res) => {
  const entries = loadEntries();
  const roles = loadRoles();
  
  // ✅ ENRICH ENTRIES WITH DISPLAY NAME
  const enrichedEntries = entries.map(entry => {
    // If entry already has displayName, keep it
    if (entry.displayName) {
      return entry;
    }
    
    // Otherwise, try to get it from roles.json
    if (entry.employeeId) {
      const roleUser = (roles.users || []).find(u => u.employeeId === entry.employeeId);
      if (roleUser && roleUser.displayName) {
        return { ...entry, displayName: roleUser.displayName };
      }
    }
    
    // Fallback: use email or employeeId
    return entry;
  });
  
  res.json(enrichedEntries);
});

// ----------------------------
// ✅ Admin guard
// ----------------------------
function requireAdmin(req, res, next) {
  const user = getUserFromRequest(req);
  if (String(user.role).toLowerCase() !== "admin") {
    return res.status(403).json({ ok: false, message: "Admin only" });
  }
  next();
}

// ----------------------------
// Admin APIs
// ----------------------------
app.get("/api/admin/users", requireAdmin, (req, res) => {
  const roles = loadRoles();
  res.json(roles.users || []);
});

app.post("/api/admin/users", requireAdmin, (req, res) => {
  const { employeeId, displayName, role, email } = req.body || {};
  if (!employeeId || !displayName || !role) return res.status(400).send("Missing fields");

  upsertRoleUser({
    employeeId: String(employeeId).trim(),
    displayName: String(displayName).trim(),
    role: String(role).trim().toLowerCase(),
    email: (email || `${employeeId}@akersolutions.com`).trim(),
  });

  res.json({ ok: true });
});

app.patch("/api/admin/users/:employeeId", requireAdmin, (req, res) => {
  const { employeeId } = req.params;
  const { role } = req.body || {};
  if (!role) return res.status(400).send("Missing role");

  const roles = loadRoles();
  const existing = (roles.users || []).find((u) => u.employeeId === employeeId);
  if (!existing) return res.status(404).send("User not found");

  upsertRoleUser({ ...existing, role: String(role).trim().toLowerCase() });
  res.json({ ok: true });
});

app.delete("/api/admin/users/:employeeId", requireAdmin, (req, res) => {
  const { employeeId } = req.params;
  deleteRoleUser(employeeId);
  res.json({ ok: true });
});

// ----------------------------
// ✅ BATCH create - FAST UI (email async)
// ----------------------------
app.post("/api/entry/batch", async (req, res) => {
  const user = getUserFromRequest(req);

  if (!user?.email) {
    return res.status(401).json({
      ok: false,
      message: "Not authenticated. No SSO identity reached Node. Check /api/debug/headers",
    });
  }

  const body = req.body || {};
  const dates = Array.isArray(body.dates) ? body.dates : [];
  const type = normalizeType(body.type);
  const note = String(body.note || "").trim();

  const name = user.email;

  if (!dates.length) return res.status(400).send("No dates provided");
  if (!type) return res.status(400).send("Missing type");

  const tomorrow = isoTomorrowLocal();
  const allEntries = loadEntries();

  const groupId = newId();
  const token = newToken();

  const created = [];
  const skipped = [];

  for (const dateStrRaw of dates) {
    const dateStr = String(dateStrRaw).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      skipped.push({ date: dateStr, reason: "invalid_format" });
      continue;
    }

    const dt = parseYMD(dateStr);

    if (isWeekend(dt)) {
      skipped.push({ date: dateStr, reason: "weekend" });
      continue;
    }

    dt.setHours(0, 0, 0, 0);
    if (dt < tomorrow) {
      skipped.push({ date: dateStr, reason: "past_or_today" });
      continue;
    }

    if (hasActiveEntry(allEntries, user.employeeId, dateStr)) {
      skipped.push({ date: dateStr, reason: "duplicate_existing" });
      continue;
    }

    const entry = {
      id: newId(),
      groupId,
      token,
      date: dateStr,
      type,
      employeeId: user.employeeId,
      email: user.email,
      displayName: user.displayName,
      name,
      note,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    allEntries.push(entry);
    created.push(entry);
  }

  if (created.length === 0) {
    const msg =
      skipped.length > 0
        ? `No dates were saved. All selected dates were skipped (duplicates/weekends/past).`
        : `No dates were saved.`;
    return res.status(409).json({ ok: false, message: msg, created: [], skipped });
  }

  saveEntries(allEntries);

  const sortedCreatedDates = created.map((e) => e.date).sort();

  const leaveData = {
    id: created[0].id,
    groupId,
    token,
    employeeId: user.employeeId,
    email: user.email,
    displayName: user.displayName,
    leaveType: type,
    reason: note,
    startDate: sortedCreatedDates[0],
    endDate: sortedCreatedDates[sortedCreatedDates.length - 1],
    dates: sortedCreatedDates,
    totalDays: sortedCreatedDates.length,
    isMultiDay: sortedCreatedDates.length > 1,
  };

  res.json({
    ok: true,
    message: `Saved ${created.length} date(s). Skipped ${skipped.length}.`,
    createdCount: created.length,
    skippedCount: skipped.length,
    created: created.map((e) => ({ id: e.id, date: e.date, type: e.type, status: e.status })),
    skipped,
    groupId,
    token,
    emailStatus: { queued: true },
  });

  setImmediate(async () => {
    try {
      const emailStatus = await sendLeaveRequestEmail(leaveData);
      console.log("✓ Email sent async:", emailStatus?.messageId || emailStatus);
    } catch (e) {
      console.error("✗ Email async failed:", e.message);
    }
  });
});

// ----------------------------
// ✅ APPROVE / REJECT + status pages (unchanged)
// ----------------------------

app.get("/api/leave/approve", async (req, res) => {
  const token = String(req.query.token || "").trim();
  if (!token) return res.status(400).send("Missing token");

  const entries = loadEntries();
  const affected = entries.filter((e) => e.token === token);

  if (!affected.length) {
    return res.send(
      renderSimplePage("Entry Not Found", "❌", "#dc2626", "This leave request does not exist or has been deleted.")
    );
  }

  const first = affected[0];
  const sortedDates = affected.map((e) => e.date).sort();

  if (first.status === "approved") {
    return res.send(
      renderAlreadyPage("Already Approved", "✅", "APPROVED", "#059669", {
        employee: first.displayName || first.email,
        type: first.type,
        total: sortedDates.length,
        dates: sortedDates,
        footer: `This request was already approved on ${new Date(first.approvedAt).toLocaleString()}.`,
      })
    );
  }

  if (first.status === "rejected") {
    return res.send(
      renderAlreadyPage("Already Rejected", "❌", "REJECTED", "#dc2626", {
        employee: first.displayName || first.email,
        type: first.type,
        total: sortedDates.length,
        dates: sortedDates,
        footer: `This request was already rejected on ${new Date(first.rejectedAt).toLocaleString()}.`,
      })
    );
  }

  const approverEmail = getUserFromRequest(req)?.email || "Manager";

  affected.forEach((e) => {
    e.status = "approved";
    e.approvedAt = new Date().toISOString();
    e.approvedBy = approverEmail;
  });

  saveEntries(entries);

  try {
    await sendApprovalEmail({
      id: first.id,
      groupId: first.groupId,
      token: first.token,
      employeeId: first.employeeId,
      email: first.email,
      displayName: first.displayName,
      leaveType: first.type,
      startDate: sortedDates[0],
      endDate: sortedDates[sortedDates.length - 1],
      dates: sortedDates,
      totalDays: sortedDates.length,
      approvedBy: approverEmail,
    });
  } catch (e) {
    console.error("✗ sendApprovalEmail failed (non-blocking):", e.message);
  }

  return res.send(
    renderSuccessPage("Leave Request Approved!", "✅", "#059669", {
      employee: first.displayName || first.email,
      type: first.type,
      total: sortedDates.length,
      dates: sortedDates,
      timeLabel: "Approved",
    })
  );
});

app.get("/api/leave/reject", async (req, res) => {
  const token = String(req.query.token || "").trim();
  if (!token) return res.status(400).send("Missing token");

  const reason = String(req.query.reason || "").trim();

  const entries = loadEntries();
  const affected = entries.filter((e) => e.token === token);

  if (!affected.length) {
    return res.send(
      renderSimplePage("Entry Not Found", "❌", "#dc2626", "This leave request does not exist or has been deleted.")
    );
  }

  const first = affected[0];
  const sortedDates = affected.map((e) => e.date).sort();

  if (first.status === "approved") {
    return res.send(
      renderSimplePage(
        "Cannot Reject - Already Approved",
        "⚠️",
        "#f59e0b",
        `This request was already approved on ${new Date(first.approvedAt).toLocaleString()} and cannot be rejected.`
      )
    );
  }

  if (first.status === "rejected") {
    return res.send(
      renderAlreadyPage("Already Rejected", "❌", "REJECTED", "#dc2626", {
        employee: first.displayName || first.email,
        type: first.type,
        total: sortedDates.length,
        dates: sortedDates,
        footer: `This request was already rejected on ${new Date(first.rejectedAt).toLocaleString()}.`,
      })
    );
  }

  const rejectorEmail = getUserFromRequest(req)?.email || "Manager";

  affected.forEach((e) => {
    e.status = "rejected";
    e.rejectedAt = new Date().toISOString();
    e.rejectedBy = rejectorEmail;
  });

  saveEntries(entries);

  try {
    await sendRejectionEmail(
      {
        id: first.id,
        groupId: first.groupId,
        token: first.token,
        employeeId: first.employeeId,
        email: first.email,
        displayName: first.displayName,
        leaveType: first.type,
        startDate: sortedDates[0],
        endDate: sortedDates[sortedDates.length - 1],
        dates: sortedDates,
        totalDays: sortedDates.length,
        rejectedBy: rejectorEmail,
      },
      reason
    );
  } catch (e) {
    console.error("✗ sendRejectionEmail failed (non-blocking):", e.message);
  }

  return res.send(
    renderSuccessPage("Leave Request Rejected", "❌", "#dc2626", {
      employee: first.displayName || first.email,
      type: first.type,
      total: sortedDates.length,
      dates: sortedDates,
      timeLabel: "Rejected",
      reason,
    })
  );
});

// ----------------------------
// HTML helpers for status pages (unchanged)
// ----------------------------
function basePage({ title, bg, bodyHtml }) {
  return `
<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Segoe UI, Arial, sans-serif; background: ${bg}; padding: 40px; margin: 0; }
    .container { max-width: 680px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 42px; box-shadow: 0 12px 40px rgba(0,0,0,0.10); }
    .center { text-align: center; }
    .icon { font-size: 72px; margin-bottom: 14px; }
    h1 { margin: 0 0 10px; font-size: 34px; }
    .sub { color: #374151; margin: 0 0 18px; font-size: 16px; }
    .badge { display:inline-block; padding: 8px 16px; border-radius: 999px; font-weight: 700; font-size: 13px; color: #fff; margin: 14px 0 18px; }
    .info { border-radius: 12px; padding: 18px 18px; margin: 16px 0; border-left: 6px solid; }
    .info p { margin: 8px 0; font-size: 15px; }
    .dates { background: #f9fafb; border-radius: 12px; padding: 16px 18px; margin-top: 16px; }
    .dates ul { margin: 10px 0 0; padding-left: 22px; }
    .dates li { margin: 7px 0; }
    .note { color: #6b7280; font-size: 14px; margin-top: 26px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="container">
    ${bodyHtml}
  </div>
</body>
</html>`;
}

function renderSimplePage(title, icon, color, text) {
  return basePage({
    title,
    bg: "#f5f5f5",
    bodyHtml: `
      <div class="center">
        <div class="icon">${icon}</div>
        <h1 style="color:${color}">${escapeHtml(title)}</h1>
        <p class="sub">${escapeHtml(text)}</p>
        <p class="note">You can safely close this window.</p>
      </div>`,
  });
}

function renderAlreadyPage(title, icon, badgeText, badgeColor, data) {
  return basePage({
    title,
    bg: badgeColor === "#059669" ? "#f0fdf4" : "#fef2f2",
    bodyHtml: `
      <div class="center">
        <div class="icon">${icon}</div>
        <h1 style="color:${badgeColor}">${escapeHtml(title)}</h1>
        <div class="badge" style="background:${badgeColor}">${escapeHtml(badgeText)}</div>
      </div>

      <div class="info" style="background:${badgeColor === "#059669" ? "#d1fae5" : "#fee2e2"}; border-left-color:${badgeColor}">
        <p><strong>Employee:</strong> ${escapeHtml(data.employee)}</p>
        <p><strong>Leave Type:</strong> ${escapeHtml(data.type)}</p>
        <p><strong>Total Days:</strong> ${escapeHtml(String(data.total))}</p>
      </div>

      <div class="dates">
        <strong>${badgeText === "APPROVED" ? "Approved Dates:" : "Rejected Dates:"}</strong>
        <ul>${data.dates.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ul>
      </div>

      <p class="note">ℹ️ ${escapeHtml(data.footer)}<br><br>You can safely close this window.</p>
    `,
  });
}

function renderSuccessPage(title, icon, color, data) {
  const bg = color === "#059669" ? "#f0fdf4" : "#fef2f2";
  const boxBg = color === "#059669" ? "#d1fae5" : "#fee2e2";
  const boxText = color === "#059669" ? "#065f46" : "#991b1b";

  return basePage({
    title,
    bg,
    bodyHtml: `
      <div class="center">
        <div class="icon">${icon}</div>
        <h1 style="color:${color}">${escapeHtml(title)}</h1>
        <p class="sub" style="font-weight:700; color:${color}">The employee has been notified via email.</p>
      </div>

      <div class="info" style="background:${boxBg}; border-left-color:${color}; color:${boxText}">
        <p><strong>Employee:</strong> ${escapeHtml(data.employee)}</p>
        <p><strong>Leave Type:</strong> ${escapeHtml(data.type)}</p>
        <p><strong>Total Days:</strong> ${escapeHtml(String(data.total))}</p>
        <p><strong>${escapeHtml(data.timeLabel)}:</strong> ${escapeHtml(new Date().toLocaleString())}</p>
        ${data.reason ? `<p><strong>Reason:</strong> ${escapeHtml(data.reason)}</p>` : ""}
      </div>

      <div class="dates">
        <strong>${escapeHtml(data.timeLabel)} Dates:</strong>
        <ul>${data.dates.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ul>
      </div>

      <p class="note" style="text-align:center">
        ✓ Calendar has been updated<br>
        ✓ Employee notified via email<br>
        ✓ You can safely close this window
      </p>
    `,
  });
}

// ----------------------------
// Banner + start
// ----------------------------
app.listen(PORT, HOST, () => {
  const roles = loadRoles();
  const adminCount = (roles.users || []).filter((u) => u.role === "admin").length;

  console.log("");
  console.log("┌────────────────────────────────────────────────┐");
  console.log("│  SMART MULTI-DAY VERSION - FAST UI              │");
  console.log("│  Holiday Calendar - ONE Email Per Request       │");
  console.log("│  ✅ SSO: Headers + Optional SSPI (FIXED)        │");
  console.log("└────────────────────────────────────────────────┘");
  console.log(`Server: http://hcg-mapp105:${PORT}`);
  console.log(`Roles: ${(roles.users || []).length} configured`);
  console.log(`Users: ${adminCount} admins`);
  console.log(`SSPI: ${USE_SSPI ? "ENABLED" : "disabled"} (set USE_SSPI=true)`);
  console.log(`SSPI middleware: ${sspiMiddlewareLoaded ? "loaded" : "NOT loaded"}`);
  console.log("✓ Batch endpoint: /api/entry/batch");
  console.log("✓ Debug: /api/debug/headers");
  console.log("--------------------------------------------------");
});