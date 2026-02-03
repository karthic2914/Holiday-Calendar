const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const crypto = require('crypto');

const {
  sendLeaveRequestEmail,
  sendApprovalEmail,
  sendRejectionEmail
} = require('./emailService');

const app = express();

// ----------------------------
// Middleware
// ----------------------------
app.use(express.json());
app.use(express.static('public'));

app.use(
  session({
    secret: 'holiday-calendar-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false, // internal HTTP
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

// ----------------------------
// Data files
// ----------------------------
const DATA_DIR = path.join(__dirname, 'data');
const ENTRIES_FILE = path.join(DATA_DIR, 'entries.json');
const ROLES_FILE = path.join(DATA_DIR, 'roles.json');

function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(ENTRIES_FILE)) fs.writeFileSync(ENTRIES_FILE, JSON.stringify([], null, 2));

  if (!fs.existsSync(ROLES_FILE)) {
    const defaultRoles = {
      "336899": { role: "admin", displayName: "336899" },
      "408275": { role: "admin", displayName: "408275" },
      "408275a": { role: "admin", displayName: "408275a" }
    };
    fs.writeFileSync(ROLES_FILE, JSON.stringify(defaultRoles, null, 2));
  }
}

ensureFiles();

function readJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`❌ Error reading ${filePath}:`, e.message);
    return fallback;
  }
}

function writeJsonSafe(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error(`❌ Error writing ${filePath}:`, e.message);
    return false;
  }
}

let roles = readJsonSafe(ROLES_FILE, {});
console.log('✓ Loaded roles configuration');

function saveRoles() {
  writeJsonSafe(ROLES_FILE, roles);
}

function getUserRole(employeeId) {
  return roles?.[employeeId]?.role || 'developer';
}

function getUserDisplayName(employeeId) {
  // keep displayName as "name" not email, so UI doesn’t duplicate
  return roles?.[employeeId]?.displayName || employeeId;
}

// ----------------------------
// Auth/session population middleware
// IMPORTANT: logs only once per session
// ----------------------------
app.use((req, res, next) => {
  // Avoid spam logging for static assets
  const isAsset =
    req.path.startsWith('/styles.css') ||
    req.path.startsWith('/app.js') ||
    req.path.startsWith('/favicon.ico') ||
    req.path.startsWith('/fonts') ||
    req.path.startsWith('/images');

  // Header used by Azure/App Service auth, etc.
  const authHeader =
    req.headers['x-ms-client-principal-name'] ||
    req.headers['x-authenticated-user'];

  if (authHeader) {
    const email = String(authHeader).trim();
    const employeeId = email.split('@')[0];

    req.session.employeeId = employeeId;
    req.session.email = email;
    req.session.displayName = getUserDisplayName(employeeId);
    req.session.role = getUserRole(employeeId);
  } else if (!req.session.employeeId) {
    // Local/test fallback
    const testUser = '408275a';
    req.session.employeeId = testUser;
    req.session.email = `${testUser}@akersolutions.com`;
    req.session.displayName = getUserDisplayName(testUser);
    req.session.role = getUserRole(testUser);
  }

  // Log only once per session (and skip noisy asset requests)
  if (!isAsset && !req.session._loggedUser) {
    console.log(`✓ User: ${req.session.employeeId} (${req.session.email}) [${req.session.role}]`);
    req.session._loggedUser = true;
  }

  next();
});

// ----------------------------
// API: Current user
// ----------------------------
app.get('/api/user', (req, res) => {
  res.json({
    employeeId: req.session.employeeId,
    email: req.session.email,
    displayName: req.session.displayName,
    role: req.session.role
  });
});

// ----------------------------
// API: Entries
// ----------------------------
app.get('/api/entries', (req, res) => {
  const entries = readJsonSafe(ENTRIES_FILE, []);
  res.json(entries);
});

// ----------------------------
// API: Create entry (with server-side de-dupe + email)
// ----------------------------
app.post('/api/entry', async (req, res) => {
  console.log('📝 POST /api/entry - Adding new entry');

  try {
    const { date, type, name, note } = req.body;

    if (!date || !type) {
      return res.status(400).json({ success: false, error: 'date and type are required' });
    }

    const entries = readJsonSafe(ENTRIES_FILE, []);

    // ✅ HARD DUPLICATE PROTECTION (prevents 3–5 times)
    // Same user + same date + same type (ignore rejected)
    const alreadyExists = entries.some(e =>
      e.date === date &&
      e.employeeId === req.session.employeeId &&
      e.type === type &&
      e.status !== 'rejected'
    );

    if (alreadyExists) {
      return res.status(409).send('Entry already exists for this date/type for this user.');
    }

    const newEntry = {
      id: crypto.randomBytes(16).toString('hex'),
      approvalToken: crypto.randomBytes(32).toString('hex'),
      date,
      type,
      name: name || req.session.email,
      note: note || '',
      reason: note || '',
      employeeId: req.session.employeeId,
      email: req.session.email,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    entries.push(newEntry);

    const ok = writeJsonSafe(ENTRIES_FILE, entries);
    if (!ok) {
      return res.status(500).json({ success: false, error: 'Failed to write entries.json' });
    }

    console.log('✅ Entry saved:', newEntry.id);

    // Send email notification
    const leaveData = {
      id: newEntry.id,
      token: newEntry.approvalToken,
      employeeId: req.session.employeeId,
      email: req.session.email,
      displayName: req.session.displayName,
      leaveType: newEntry.type,
      startDate: newEntry.date,
      endDate: newEntry.endDate || newEntry.date,
      reason: newEntry.reason || newEntry.note || ''
    };

    console.log('📧 Attempting to send email for leave request:', newEntry.id);

    try {
      const emailResult = await sendLeaveRequestEmail(leaveData);
      if (emailResult && emailResult.success) {
        console.log('✅ Email sent successfully:', emailResult.messageId);
      } else {
        console.log('⚠️ Email failed:', emailResult?.error || 'Unknown error');
      }
    } catch (emailError) {
      console.error('❌ Email exception:', emailError.message);
    }

    return res.json({ success: true, entry: newEntry });
  } catch (error) {
    console.error('❌ Server error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Optional bulk save endpoint (keep if you need it)
app.post('/api/entries', (req, res) => {
  try {
    const newEntries = req.body;
    const ok = writeJsonSafe(ENTRIES_FILE, newEntries);
    if (!ok) return res.status(500).json({ success: false, error: 'Failed to save entries' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving entries:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------
// ✅ APPROVAL/REJECTION ENDPOINTS
// 1) Old style: /api/approve/:id/:token
// 2) Your emailService style: /api/leave/approve?id=...&token=...
// ----------------------------
async function processApprovalOrRejection(req, res, newStatus) {
  try {
    const id = req.params.id || req.query.id;
    const token = req.params.token || req.query.token;

    if (!id || !token) return res.status(400).send('Missing id or token');

    const entries = readJsonSafe(ENTRIES_FILE, []);
    const entry = entries.find(e => e.id === id && e.approvalToken === token);

    if (!entry) return res.status(404).send('Entry not found or invalid token');

    if (entry.status !== 'pending') {
      return res.send(`<h1>Already Processed</h1><p>This leave request was already ${entry.status}.</p>`);
    }

    entry.status = newStatus;

    // Session may not exist when clicking from email
    const actorId = req.session?.employeeId || 'unknown';
    const actorName = req.session?.displayName || 'Approver';

    if (newStatus === 'approved') {
      entry.approvedBy = actorId;
      entry.approvedAt = new Date().toISOString();

      writeJsonSafe(ENTRIES_FILE, entries);

      // Notify employee
      try {
        await sendApprovalEmail({
          email: entry.email,
          displayName: entry.name,
          leaveType: entry.type,
          startDate: entry.date,
          endDate: entry.endDate || entry.date,
          approvedBy: actorName
        });
      } catch (e) {
        console.error('Approval email failed:', e.message);
      }

      return res.send(`
        <html>
        <head><title>Leave Approved</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1 style="color: #10b981;">✓ Leave Request Approved</h1>
          <p>Leave for ${entry.name} has been approved.</p>
          <p><strong>Date:</strong> ${entry.date}</p>
          <p><strong>Type:</strong> ${entry.type}</p>
        </body>
        </html>
      `);
    }

    if (newStatus === 'rejected') {
      entry.rejectedBy = actorId;
      entry.rejectedAt = new Date().toISOString();

      writeJsonSafe(ENTRIES_FILE, entries);

      try {
        await sendRejectionEmail({
          email: entry.email,
          displayName: entry.name,
          leaveType: entry.type,
          startDate: entry.date,
          endDate: entry.endDate || entry.date,
          rejectedBy: actorName
        });
      } catch (e) {
        console.error('Rejection email failed:', e.message);
      }

      return res.send(`
        <html>
        <head><title>Leave Rejected</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1 style="color: #ef4444;">✕ Leave Request Rejected</h1>
          <p>Leave for ${entry.name} has been rejected.</p>
          <p><strong>Date:</strong> ${entry.date}</p>
          <p><strong>Type:</strong> ${entry.type}</p>
        </body>
        </html>
      `);
    }

    return res.status(400).send('Invalid action');
  } catch (error) {
    console.error(`Error processing ${newStatus}:`, error);
    res.status(500).send('Error processing request');
  }
}

// Old routes
app.get('/api/approve/:id/:token', (req, res) => processApprovalOrRejection(req, res, 'approved'));
app.get('/api/reject/:id/:token', (req, res) => processApprovalOrRejection(req, res, 'rejected'));

// ✅ Routes used by your emailService.js
app.get('/api/leave/approve', (req, res) => processApprovalOrRejection(req, res, 'approved'));
app.get('/api/leave/reject', (req, res) => processApprovalOrRejection(req, res, 'rejected'));

// ----------------------------
// Admin: Users/Roles
// ----------------------------
app.get('/api/admin/users', (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  const users = Object.keys(roles).map(employeeId => ({
    employeeId,
    displayName: roles[employeeId].displayName || employeeId,
    email: `${employeeId}@akersolutions.com`,
    role: roles[employeeId].role
  }));

  res.json(users);
});

app.post('/api/admin/users', (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  const { employeeId, displayName, role } = req.body;
  if (!employeeId || !role) return res.status(400).json({ error: 'Missing required fields' });

  roles[employeeId] = {
    role,
    displayName: displayName || employeeId
  };

  saveRoles();
  res.json({ success: true });
});

app.patch('/api/admin/users/:employeeId', (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  const { employeeId } = req.params;
  const { role } = req.body;

  if (!roles[employeeId]) return res.status(404).json({ error: 'User not found' });

  roles[employeeId].role = role;
  saveRoles();
  res.json({ success: true });
});

app.delete('/api/admin/users/:employeeId', (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  const { employeeId } = req.params;

  if (!roles[employeeId]) return res.status(404).json({ error: 'User not found' });

  delete roles[employeeId];
  saveRoles();
  res.json({ success: true });
});

// ----------------------------
// Server start
// ----------------------------
const PORT = 3001;
app.listen(PORT, () => {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   🎯 FINAL DEBUG VERSION - FEB 02 2026        ║');
  console.log('║   Holiday Calendar with Email Notifications   ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log(`Server: http://hcg-mapp105:${PORT}`);
  console.log(`Roles: ${Object.keys(roles).length} configured`);
  console.log(`Users: ${Object.keys(roles).filter(id => roles[id].role === 'admin').length} admins`);
  console.log('════════════════════════════════════════════════');
});
