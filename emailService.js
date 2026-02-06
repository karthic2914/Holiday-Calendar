// emailService.js
// ✅ FINAL BEHAVIOR
// 1) Approver email -> Approver (buttons)
// 2) FYI email      -> Direct manager (NO buttons)
// 3) Employee email -> Employee (confirmation with ICS) ← NEW!
// ✅ TEST MODE
// - Approver email goes to email-config.json:testApprover
// - FYI email goes to email-config.json:testFyi
// ✅ Logs -> C:\HolidayApp\logs\email.log
//
// IMPORTANT FIX:
// If you set "envelope", you MUST set envelope.to, otherwise Nodemailer throws:
// "No recipients defined"

console.log("✅ LOADED emailService.js FROM:", __filename);

const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

// ----------------------------
// ✅ FILE LOGGING (Windows Service friendly)
// ----------------------------
const LOG_DIR = "C:\\HolidayApp\\logs";
const LOG_FILE = path.join(LOG_DIR, "email.log");

function logLine(...args) {
  const msg =
    `[${new Date().toISOString()}] ` +
    args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");

  console.log(msg);

  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, msg + "\r\n", "utf8");
  } catch (e) {
    console.log("⚠️ Could not write log file:", e.message);
  }
}

// ----------------------------
// ✅ OUTLOOK COLOR MAPPING - UPDATED WITH CORRECT CAPITALIZATION
// ----------------------------
const OUTLOOK_COLOR_CATEGORIES = {
  "Leave": "Blue Category",           // ✅ Capitalized "Category"
  "Sick": "Orange Category",          // ✅ Capitalized "Category"
  "WFH": "Green Category",            // ✅ Capitalized "Category"
  "Work Travel": "Purple Category",   // ✅ Capitalized "Category"
  "Work From Stavanger": "Purple Category",
  "Work From Oslo": "Teal Category",  // ✅ Changed to Teal to avoid conflict with WFH
  "Public Holiday": "Red Category"    // ✅ Capitalized "Category"
};

// ----------------------------
// Helpers
// ----------------------------
function lower(s) {
  return String(s || "").trim().toLowerCase();
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getOutlookCategory(leaveType) {
  return OUTLOOK_COLOR_CATEGORIES[leaveType] || "Blue Category";
}

// ----------------------------
// Alias → Real Email Mapping (IMPORTANT)
// Your UI shows: 408275a@akersolutions.com
// But routing file contains: Mahadevan.Sivasubramanian.Karthic@akersolutions.com
// ----------------------------
const EMAIL_ALIAS_MAP = {
  "408275a@akersolutions.com": "Mahadevan.Sivasubramanian.Karthic@akersolutions.com",
  "408275@akersolutions.com": "Mahadevan.Sivasubramanian.Karthic@akersolutions.com",
};

function normalizeEmployeeEmail(email) {
  const e = lower(email);
  return EMAIL_ALIAS_MAP[e] || email;
}

// ----------------------------
// Normalize email config
// Supports serverUrl OR serviceUrl (your config uses serverUrl)
// ----------------------------
function normalizeEmailConfig(cfg) {
  const safe = cfg || {};

  safe.smtp = safe.smtp || {};
  safe.smtp.host = safe.smtp.host || "smtp.enterdir.com";
  safe.smtp.port = Number(safe.smtp.port || 25);
  safe.smtp.secure = Boolean(safe.smtp.secure || false);
  safe.smtp.auth = Boolean(safe.smtp.auth || false);

  safe.enabled = safe.enabled !== false;
  safe.from = safe.from || "noreply@akersolutions.com";
  safe.envelopeFrom = safe.envelopeFrom || safe.from;

  safe.testMode = safe.testMode !== undefined ? Boolean(safe.testMode) : false;

  // ✅ test keys
  safe.testApprover = safe.testApprover || "Arun.Joshi@akersolutions.com";
  safe.testFyi = safe.testFyi || "Mahadevan.Sivasubramanian.Karthic@akersolutions.com";

  safe.serverUrl = safe.serverUrl || safe.serviceUrl || "http://hcg-mapp105:3001";

  return safe;
}

function loadEmailConfig() {
  const configPath = path.join(__dirname, "email-config.json");

  if (!fs.existsSync(configPath)) {
    logLine("⚠️ email-config.json not found - using defaults");
    return normalizeEmailConfig({});
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const normalized = normalizeEmailConfig(config);

    logLine("✓ Email config loaded:", configPath);
    logLine("📌 Email config (effective):", {
      enabled: normalized.enabled,
      testMode: normalized.testMode,
      testApprover: normalized.testApprover,
      testFyi: normalized.testFyi,
      serverUrl: normalized.serverUrl,
      smtp: {
        host: normalized.smtp.host,
        port: normalized.smtp.port,
        secure: normalized.smtp.secure,
        auth: normalized.smtp.auth,
      },
      from: normalized.from,
      envelopeFrom: normalized.envelopeFrom,
    });

    return normalized;
  } catch (err) {
    logLine("✗ Error loading email-config.json:", err.message);
    return normalizeEmailConfig({});
  }
}

const emailConfig = loadEmailConfig();

// ----------------------------
// ✅ Load routing config
// Your file name is: employee-routing.json
// But older code used: approval-routing.json
// We support BOTH.
// ----------------------------
function loadApprovalRouting() {
  const routingCandidates = [
    path.join(__dirname, "employee-routing.json"),
    path.join(__dirname, "approval-routing.json"),
  ];

  const routingPath = routingCandidates.find((p) => fs.existsSync(p));

  if (!routingPath) {
    logLine("⚠️ routing json not found (employee-routing.json/approval-routing.json) - using defaults (Arun only)");
    return { mainApprover: "Arun.Joshi@akersolutions.com", managers: {}, approverOnlyButtons: true };
  }

  try {
    const cfg = JSON.parse(fs.readFileSync(routingPath, "utf8"));
    const finalCfg = {
      mainApprover: cfg.mainApprover || "Arun.Joshi@akersolutions.com",
      managers: cfg.managers || {},
      approverOnlyButtons: cfg.approverOnlyButtons !== false,
    };
    logLine("✓ Routing loaded:", routingPath);
    return finalCfg;
  } catch (e) {
    logLine("✗ Error loading routing json:", e.message);
    return { mainApprover: "Arun.Joshi@akersolutions.com", managers: {}, approverOnlyButtons: true };
  }
}

const routingConfig = loadApprovalRouting();

// ----------------------------
// Find direct manager
// ----------------------------
function getDirectManagerEmail(employeeEmail) {
  const target = lower(employeeEmail);
  const managers = routingConfig.managers || {};

  for (const [managerEmail, teamEmails] of Object.entries(managers)) {
    const list = Array.isArray(teamEmails) ? teamEmails : [];
    const found = list.some((e) => lower(e) === target);
    if (found) return managerEmail;
  }
  return null;
}

function getRouting(employeeEmail) {
  const approver = routingConfig.mainApprover || "Arun.Joshi@akersolutions.com";
  const directManager = getDirectManagerEmail(employeeEmail);
  return { approver, directManager };
}

// ----------------------------
// SMTP transporter
// ----------------------------
function createTransporter() {
  if (!emailConfig.enabled) {
    logLine("📧 Email disabled (enabled=false)");
    return null;
  }

  const transportConfig = {
    host: emailConfig.smtp.host,
    port: emailConfig.smtp.port,
    secure: emailConfig.smtp.secure,
    tls: { rejectUnauthorized: false },
  };

  if (emailConfig.smtp.auth && emailConfig.smtp.user && emailConfig.smtp.pass) {
    transportConfig.auth = { user: emailConfig.smtp.user, pass: emailConfig.smtp.pass };
  }

  const transporter = nodemailer.createTransport(transportConfig);

  logLine(`✓ Email transporter created: ${emailConfig.smtp.host}:${emailConfig.smtp.port}`);
  if (emailConfig.testMode) {
    logLine("🧪 TEST MODE enabled");
    logLine("   testApprover:", emailConfig.testApprover);
    logLine("   testFyi     :", emailConfig.testFyi);
  }

  return transporter;
}

// ----------------------------
// ✅ ENVELOPE FIX (IMPORTANT)
// If you set envelope, you MUST set to.
// ----------------------------
function buildEnvelope(toList) {
  const arr = Array.isArray(toList) ? toList : [toList];
  const cleaned = arr.map((x) => String(x || "").trim()).filter(Boolean);
  return {
    from: emailConfig.envelopeFrom,
    to: cleaned, // <-- required
  };
}

// ----------------------------
// HTML blocks
// ----------------------------
function buildButtonsHtml({ approveUrl, rejectUrl, daysText }) {
  return `
    <div style="display:flex; gap:14px; justify-content:center; margin:22px 0 10px; flex-wrap:wrap;">
      <a href="${approveUrl}" style="background:#10B981; color:#fff; text-decoration:none; padding:14px 22px; border-radius:12px; font-weight:800; display:inline-block; min-width:200px; text-align:center;">
        ✓ Approve (${escapeHtml(daysText)})
      </a>
      <a href="${rejectUrl}" style="background:#EF4444; color:#fff; text-decoration:none; padding:14px 22px; border-radius:12px; font-weight:800; display:inline-block; min-width:200px; text-align:center;">
        ✕ Reject (${escapeHtml(daysText)})
      </a>
    </div>
  `;
}

function buildFYIBoxHtml(mainApproverEmail) {
  return `
    <div style="background:#F1F5F9; border-left:6px solid #94A3B8; padding:14px 16px; border-radius:12px; margin:18px 0; color:#334155;">
      ℹ️ <b>FYI:</b> Your team member submitted a leave request.<br/>
      Approval will be handled by <b>${escapeHtml(mainApproverEmail)}</b>.<br/><br/>
      <b>No action is required from you.</b>
    </div>
  `;
}

function buildHtml({
  subject,
  id,
  employeeId,
  email,
  displayName,
  leaveType,
  dateRange,
  daysText,
  reason,
  datesListHtml,
  totalDays,
  outlookCategory,
  extraSectionHtml,
}) {
  return `
<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0; padding:0; background:#f4f7fb; font-family:Segoe UI, Arial, sans-serif;">
  <div style="max-width:760px; margin:0 auto; padding:28px 16px;">
    <div style="background:#ffffff; border-radius:18px; box-shadow:0 10px 30px rgba(0,0,0,0.08); overflow:hidden;">
      <div style="background:#0B2B3C; padding:22px 24px;">
        <div style="color:#fff; font-size:18px; font-weight:700;">VISIONEERING</div>
        <div style="color:#b9d7e5; font-size:13px; margin-top:4px;">Leave Request</div>
      </div>

      <div style="padding:26px 24px;">
        <div style="font-size:20px; font-weight:800; color:#0f172a; margin-bottom:8px;">Leave Request</div>
        <div style="font-size:13px; color:#64748b; margin-bottom:16px;">
          Request ID: <b>${escapeHtml(String(id).substring(0, 8))}</b>
        </div>

        <div style="background:#F1F5FF; border-left:6px solid #4F7BFF; padding:18px; border-radius:14px;">
          <table style="width:100%; border-collapse:collapse; font-size:14px; color:#0f172a;">
            <tr><td style="padding:6px 0; font-weight:700; color:#334155;">Employee:</td><td>${escapeHtml(displayName)} (${escapeHtml(employeeId)})</td></tr>
            <tr><td style="padding:6px 0; font-weight:700; color:#334155;">Email:</td><td>${escapeHtml(email)}</td></tr>
            <tr><td style="padding:6px 0; font-weight:700; color:#334155;">Leave Type:</td><td>${escapeHtml(leaveType)}</td></tr>
            <tr><td style="padding:6px 0; font-weight:700; color:#334155;">Date Range:</td><td>${escapeHtml(dateRange)}</td></tr>
            <tr><td style="padding:6px 0; font-weight:700; color:#334155;">Total Days:</td><td style="font-weight:800;">${escapeHtml(daysText)}</td></tr>
          </table>
        </div>

        ${reason ? `<div style="margin-top:14px; color:#334155;"><b>Note:</b> ${escapeHtml(reason)}</div>` : ""}
        ${datesListHtml || ""}

        <div style="background:#FFFBEB; border-left:6px solid #F59E0B; padding:14px 16px; border-radius:12px; margin:18px 0; color:#92400E;">
          ⚠️ <b>Important:</b> Approval applies to <b>ALL ${escapeHtml(String(totalDays))}</b> day(s).
        </div>

        ${extraSectionHtml || ""}

        <div style="background:#EEF6FF; border-left:6px solid #3B82F6; padding:14px 16px; border-radius:12px; margin-top:18px; color:#1e3a8a;">
          📎 <b>Add to Calendar:</b> Open the attached <b>.ics</b> file.<br/>
          🏷️ <b>Calendar category:</b> ${escapeHtml(outlookCategory)}
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ----------------------------
// ICS
// ----------------------------
function createICSFile(eventData) {
  const { summary, startDate, endDate, description, category } = eventData;

  const formatDate = (dateStr) => dateStr.replace(/-/g, "");
  const start = formatDate(startDate);

  const endDateObj = new Date(endDate);
  endDateObj.setDate(endDateObj.getDate() + 1);
  const endPlusOne = formatDate(endDateObj.toISOString().split("T")[0]);

  const now = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const uid = `${start}-${Math.random().toString(36).substring(2)}@akersolutions.com`;

  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Aker Solutions//Holiday Calendar//EN
CALSCALE:GREGORIAN
METHOD:REQUEST
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${now}
DTSTART;VALUE=DATE:${start}
DTEND;VALUE=DATE:${endPlusOne}
SUMMARY:${summary}
DESCRIPTION:${description}
CATEGORIES:${category}
STATUS:TENTATIVE
TRANSP:TRANSPARENT
END:VEVENT
END:VCALENDAR`;
}

// ----------------------------
// ✅ SEND LEAVE REQUEST EMAIL (3 emails now!)
// ----------------------------
async function sendLeaveRequestEmail(leaveData) {
  const {
    id,
    token,
    employeeId,
    email,
    displayName,
    leaveType,
    reason,
    startDate,
    endDate,
    dates = [],
    totalDays = 1,
    isMultiDay = false,
  } = leaveData;

  logLine("📨 sendLeaveRequestEmail CALLED", { email, leaveType, employeeId });

  const transporter = createTransporter();
  if (!transporter) return { success: false, error: "Email disabled" };

  const normalizedEmail = normalizeEmployeeEmail(email);
  const { approver, directManager } = getRouting(normalizedEmail);

  logLine("📧 Email normalization", { original: email, normalized: normalizedEmail });

  const baseUrl = process.env.BASE_URL || emailConfig.serverUrl || "http://hcg-mapp105:3001";
  const approveUrl = `${baseUrl}/api/leave/approve?token=${token}`;
  const rejectUrl = `${baseUrl}/api/leave/reject?token=${token}`;

  const dateRange = isMultiDay ? `${startDate} to ${endDate}` : startDate;
  const daysText = totalDays === 1 ? "1 day" : `${totalDays} days`;
  const outlookCategory = getOutlookCategory(leaveType);

  const subject = `Leave Request: ${String(id).substring(0, 8)} - ${leaveType} (${daysText})`;

  const datesListHtml =
    dates.length > 0
      ? `
      <div style="background:#FFF7ED; border-left:6px solid #F59E0B; padding:16px 18px; border-radius:12px; margin:18px 0;">
        <div style="font-weight:700; color:#9A3412; margin-bottom:8px;">🗓️ All Requested Dates:</div>
        <ul style="margin:0; padding-left:18px; color:#9A3412;">
          ${dates.map((d) => `<li style="margin:6px 0;">${escapeHtml(d)}</li>`).join("")}
        </ul>
      </div>`
      : "";

  // ✅ UPDATED: ICS with "Type - Name" format
  const icsContent = createICSFile({
    summary: `${leaveType} - ${displayName}`,
    startDate,
    endDate,
    description: reason || `Leave request by ${displayName}`,
    category: outlookCategory,
  });

  // ✅ Recipients (your rules)
  const approverRecipient = emailConfig.testMode ? emailConfig.testApprover : approver;
  const fyiRecipient = emailConfig.testMode ? emailConfig.testFyi : directManager;

  // Prod: avoid FYI if it becomes same as approver
  // Test: always send if testFyi exists
  const shouldSendFyi =
    Boolean(fyiRecipient) &&
    (emailConfig.testMode || lower(fyiRecipient) !== lower(approverRecipient));

  logLine("📌 ROUTING", {
    approver_real: approver,
    manager_real: directManager,
    approver_send: approverRecipient,
    fyi_send: fyiRecipient || null,
    employee_send: normalizedEmail,
    shouldSendFyi,
  });

  // --- 1) Approver email
  const approverMail = {
    from: emailConfig.from,
    to: approverRecipient,
    envelope: buildEnvelope([approverRecipient]),
    subject,
    html: buildHtml({
      subject,
      id,
      employeeId,
      email,
      displayName,
      leaveType,
      dateRange,
      daysText,
      reason,
      datesListHtml,
      totalDays,
      outlookCategory,
      extraSectionHtml: buildButtonsHtml({ approveUrl, rejectUrl, daysText }),
    }),
    attachments: [
      {
        filename: `leave-${employeeId}-${startDate}.ics`,
        content: icsContent,
        contentType: "text/calendar; charset=utf-8; method=REQUEST",
      },
    ],
  };

  // --- 2) FYI email
  const managerMail = shouldSendFyi
    ? {
        from: emailConfig.from,
        to: fyiRecipient,
        envelope: buildEnvelope([fyiRecipient]),
        subject: `FYI (No Action) - ${subject}`,
        html: buildHtml({
          subject,
          id,
          employeeId,
          email,
          displayName,
          leaveType,
          dateRange,
          daysText,
          reason,
          datesListHtml,
          totalDays,
          outlookCategory,
          extraSectionHtml: buildFYIBoxHtml(approver),
        }),
        attachments: [
          {
            filename: `leave-${employeeId}-${startDate}.ics`,
            content: icsContent,
            contentType: "text/calendar; charset=utf-8; method=REQUEST",
          },
        ],
      }
    : null;

  // --- 3) ✅ NEW: Employee confirmation email with ICS
  const employeeMail = {
    from: emailConfig.from,
    to: normalizedEmail,
    envelope: buildEnvelope([normalizedEmail]),
    subject: `✅ Leave Request Submitted: ${leaveType} (${daysText})`,
    html: `
<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
</head>
<body style="margin:0; padding:0; background:#f4f7fb; font-family:Segoe UI, Arial, sans-serif;">
  <div style="max-width:760px; margin:0 auto; padding:28px 16px;">
    <div style="background:#ffffff; border-radius:18px; box-shadow:0 10px 30px rgba(0,0,0,0.08); overflow:hidden;">
      <div style="background:#0B2B3C; padding:22px 24px;">
        <div style="color:#fff; font-size:18px; font-weight:700;">VISIONEERING</div>
        <div style="color:#b9d7e5; font-size:13px; margin-top:4px;">Leave Request Confirmation</div>
      </div>

      <div style="padding:26px 24px;">
        <div style="font-size:20px; font-weight:800; color:#0f172a; margin-bottom:8px;">✅ Request Submitted</div>
        <div style="font-size:15px; color:#64748b; margin-bottom:16px;">
          Hi <b>${escapeHtml(displayName)}</b>, your leave request has been submitted for approval.
        </div>

        <div style="background:#F1F5FF; border-left:6px solid #10B981; padding:18px; border-radius:14px;">
          <table style="width:100%; border-collapse:collapse; font-size:14px; color:#0f172a;">
            <tr><td style="padding:6px 0; font-weight:700; color:#334155;">Leave Type:</td><td>${escapeHtml(leaveType)}</td></tr>
            <tr><td style="padding:6px 0; font-weight:700; color:#334155;">Date Range:</td><td>${escapeHtml(dateRange)}</td></tr>
            <tr><td style="padding:6px 0; font-weight:700; color:#334155;">Total Days:</td><td style="font-weight:800;">${escapeHtml(daysText)}</td></tr>
            <tr><td style="padding:6px 0; font-weight:700; color:#334155;">Status:</td><td><b style="color:#F59E0B;">Pending Approval</b></td></tr>
          </table>
        </div>

        ${reason ? `<div style="margin-top:14px; color:#334155;"><b>Note:</b> ${escapeHtml(reason)}</div>` : ""}
        ${datesListHtml || ""}

        <div style="background:#EEF6FF; border-left:6px solid #3B82F6; padding:14px 16px; border-radius:12px; margin-top:18px; color:#1e3a8a;">
          📎 <b>Add to Your Calendar:</b> Open the attached <b>.ics</b> file to add this leave to your Outlook calendar.<br/>
          🏷️ <b>Calendar category:</b> ${escapeHtml(outlookCategory)}
        </div>

        <div style="background:#F1F5F9; border-left:6px solid #94A3B8; padding:14px 16px; border-radius:12px; margin:18px 0; color:#334155;">
          ℹ️ You will receive another email once your leave is approved or rejected.
        </div>
      </div>
    </div>
  </div>
</body>
</html>`,
    attachments: [
      {
        filename: `leave-${employeeId}-${startDate}.ics`,
        content: icsContent,
        contentType: "text/calendar; charset=utf-8; method=REQUEST",
      },
    ],
  };

  try {
    try {
      await transporter.verify();
      logLine("✓ SMTP verify OK");
    } catch (vErr) {
      logLine("⚠️ SMTP verify failed (continuing):", vErr.message);
    }

    logLine("➡️ Sending APPROVER email now...", { to: approverMail.to });
    const info1 = await transporter.sendMail(approverMail);
    logLine("✅ Approver email SENT", {
      messageId: info1.messageId,
      accepted: info1.accepted,
      rejected: info1.rejected,
      response: info1.response,
    });

    if (managerMail) {
      logLine("➡️ Sending FYI email now...", { to: managerMail.to });
      const info2 = await transporter.sendMail(managerMail);
      logLine("✅ FYI email SENT", {
        messageId: info2.messageId,
        accepted: info2.accepted,
        rejected: info2.rejected,
        response: info2.response,
      });
    } else {
      logLine("ℹ️ FYI NOT SENT (managerMail=null)");
    }

    // ✅ NEW: Send confirmation email to EMPLOYEE with ICS
    logLine("➡️ Sending EMPLOYEE confirmation email now...", { to: employeeMail.to });
    const info3 = await transporter.sendMail(employeeMail);
    logLine("✅ Employee confirmation email SENT", {
      messageId: info3.messageId,
      accepted: info3.accepted,
      rejected: info3.rejected,
      response: info3.response,
    });

    return { success: true };
  } catch (error) {
    logLine("✗ Email error:", error.message);
    return { success: false, error: error.message };
  }
}

// ✅ APPROVED email (to employee)
async function sendApprovalEmail(approvalData) {
  const { email, leaveType, startDate, endDate, dates = [], totalDays = 1, approvedBy = "Manager" } = approvalData;

  const transporter = createTransporter();
  if (!transporter) return { success: false, error: "Email disabled" };

  const isMultiDay = dates.length > 1;
  const dateRange = isMultiDay ? `${startDate} to ${endDate}` : startDate;
  const daysText = totalDays === 1 ? "1 day" : `${totalDays} days`;

  const subject = `✅ Leave Approved: ${leaveType} (${daysText})`;
  const htmlBody = `
    <div style="font-family:Segoe UI,Arial,sans-serif;">
      <h2 style="color:#059669;">Approved</h2>
      <p>Your leave request has been approved by <b>${escapeHtml(approvedBy)}</b>.</p>
      <p><b>${escapeHtml(dateRange)}</b></p>
    </div>`;

  try {
    const info = await transporter.sendMail({
      from: emailConfig.from,
      to: email,
      envelope: buildEnvelope([email]),
      subject,
      html: htmlBody,
    });
    logLine("✓ Approval email sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logLine("✗ Approval email error:", error.message);
    return { success: false, error: error.message };
  }
}

// ✅ REJECTED email (to employee)
async function sendRejectionEmail(rejectionData, reason = "") {
  const { email, leaveType, startDate, endDate, dates = [], totalDays = 1, rejectedBy = "Manager" } = rejectionData;

  const transporter = createTransporter();
  if (!transporter) return { success: false, error: "Email disabled" };

  const isMultiDay = dates.length > 1;
  const dateRange = isMultiDay ? `${startDate} to ${endDate}` : startDate;
  const daysText = totalDays === 1 ? "1 day" : `${totalDays} days`;

  const subject = `❌ Leave Rejected: ${leaveType} (${daysText})`;
  const htmlBody = `
    <div style="font-family:Segoe UI,Arial,sans-serif;">
      <h2 style="color:#dc2626;">Rejected</h2>
      <p>Your leave request has been rejected by <b>${escapeHtml(rejectedBy)}</b>.</p>
      <p><b>${escapeHtml(dateRange)}</b></p>
      ${reason ? `<p><b>Reason:</b> ${escapeHtml(reason)}</p>` : ""}
    </div>`;

  try {
    const info = await transporter.sendMail({
      from: emailConfig.from,
      to: email,
      envelope: buildEnvelope([email]),
      subject,
      html: htmlBody,
    });
    logLine("✓ Rejection email sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logLine("✗ Rejection email error:", error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendLeaveRequestEmail,
  sendApprovalEmail,
  sendRejectionEmail,
};