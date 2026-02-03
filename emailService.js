// emailService.js
// Email Service - Dynamic config (smtp.enterdir.com internal relay)
// With iCalendar (.ics) attachment support for Outlook integration

const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

// ----------------------------
// Load email configuration
// ----------------------------
function loadEmailConfig() {
  try {
    const configPath = path.join(__dirname, "email-config.json");
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, "utf8");
      const cfg = JSON.parse(data);
      console.log("✓ Email config loaded:", configPath);
      return cfg;
    }
    console.log("⚠ email-config.json not found, using defaults");
  } catch (e) {
    console.error("✗ Error loading email-config.json:", e);
  }

  // Defaults
  return {
    enabled: true,  // must be true or emails won't send
    testMode: true, // safe while testing
    testEmail: "Mahadevan.Sivasubramanian.Karthic@akersolutions.com",

    serverUrl: "http://hcg-mapp105:3001",

    smtp: {
      host: "smtp.enterdir.com",
      port: 25,
      secure: false,
      user: "",
      pass: ""
    },

    // What users see
    from: "Holiday Calendar <noreply@akersolutions.com>",

    // What SMTP relay checks (MOST IMPORTANT)
    envelopeFrom: "noreply@akersolutions.com"
  };
}

// ----------------------------
// Load team structure (optional)
// ----------------------------
function loadTeamStructure() {
  try {
    const structurePath = path.join(__dirname, "reporting.json");
    if (fs.existsSync(structurePath)) {
      const data = fs.readFileSync(structurePath, "utf8");
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("✗ Error loading reporting.json:", e);
  }
  return null;
}

function getManagerEmail(employeeId) {
  const teamStructure = loadTeamStructure();
  if (!teamStructure) return null;

  const teamMember = teamStructure.teamMembers?.find((m) => m.id === employeeId);
  return teamMember?.managerEmail || null;
}

function getApproverEmail() {
  const teamStructure = loadTeamStructure();
  if (teamStructure?.reportingStructure?.approver?.email) {
    return teamStructure.reportingStructure.approver.email;
  }
  return "Arun.Joshi@akersolutions.com"; // fallback
}

// ----------------------------
// Create transporter
// ----------------------------
function createTransporter(emailConfig) {
  if (!emailConfig.enabled) {
    console.log("📧 Email notifications disabled (enabled=false)");
    return null;
  }

  const smtp = emailConfig.smtp || {};
  const host = smtp.host || "smtp.enterdir.com";
  const port = Number(smtp.port || 25);

  const transportOptions = {
    host,
    port,
    secure: Boolean(smtp.secure), // for 465 only
    tls: { rejectUnauthorized: false },

    // timeouts
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000
  };

  // ✅ Only attach auth if user is provided (service account case)
  if (smtp.user && smtp.user.trim()) {
    transportOptions.auth = { user: smtp.user, pass: smtp.pass || "" };
  }

  const transporter = nodemailer.createTransport(transportOptions);

  console.log(`✓ Email transporter created: ${host}:${port} (auth=${transportOptions.auth ? "YES" : "NO"})`);
  return transporter;
}

// ----------------------------
// Validate recipients helper
// ----------------------------
function ensureRecipients(list) {
  const clean = (list || [])
    .map((x) => (x || "").trim())
    .filter((x) => x.length > 0);

  if (clean.length === 0) {
    throw new Error("No recipients defined");
  }
  return clean;
}

// ----------------------------
// Generate iCalendar (.ics) file
// ----------------------------
function generateICalendar(leaveData) {
  const { id, employeeId, displayName, leaveType, startDate, endDate, reason } = leaveData;
  
  // Format dates for iCalendar (YYYYMMDD format)
  const formatDate = (dateStr) => dateStr.replace(/-/g, '');
  const startDateFormatted = formatDate(startDate);
  const endDateFormatted = formatDate(endDate);
  
  // Calculate end date + 1 day for all-day events (iCalendar spec)
  const endDateObj = new Date(endDate);
  endDateObj.setDate(endDateObj.getDate() + 1);
  const endDatePlusOne = endDateObj.toISOString().split('T')[0].replace(/-/g, '');
  
  // Current timestamp for DTSTAMP
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  
  // Build iCalendar content
  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Visioneering Holiday Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${id}@akersolutions.com`,
    `DTSTAMP:${timestamp}`,
    `DTSTART;VALUE=DATE:${startDateFormatted}`,
    `DTEND;VALUE=DATE:${endDatePlusOne}`,
    `SUMMARY:${leaveType} - ${displayName}`,
    `DESCRIPTION:${leaveType} request for ${displayName} (${employeeId})${reason ? '\\n\\nReason: ' + reason : ''}`,
    `LOCATION:Out of Office`,
    `STATUS:TENTATIVE`,
    `TRANSP:TRANSPARENT`,
    `ORGANIZER;CN=Holiday Calendar:MAILTO:noreply@akersolutions.com`,
    `ATTENDEE;CN=${displayName};ROLE=REQ-PARTICIPANT:MAILTO:${leaveData.email}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  
  return icsContent;
}

// ----------------------------
// Send leave request email
// ----------------------------
async function sendLeaveRequestEmail(leaveData) {
  const emailConfig = loadEmailConfig();
  const transporter = createTransporter(emailConfig);

  if (!transporter) return { success: false, error: "Transporter not available" };

  try {
    console.log("📧 Verifying SMTP connection...");
    await transporter.verify();
    console.log("✅ SMTP verify OK");

    const { employeeId, email, displayName, leaveType, startDate, endDate, reason, id, token } = leaveData;

    // Build recipients
    let recipients = [email];
    const approverEmail = getApproverEmail();
    if (approverEmail) recipients.push(approverEmail);

    const managerEmail = getManagerEmail(employeeId);
    if (managerEmail && managerEmail !== approverEmail) recipients.push(managerEmail);

    // Test mode override
    if (emailConfig.testMode) {
      console.log("🧪 TEST MODE enabled");
      console.log("Would notify:", recipients);

      if (emailConfig.testEmail && emailConfig.testEmail.trim()) {
        recipients = [emailConfig.testEmail.trim()];
        console.log("Actually sending only to testEmail:", recipients[0]);
      } else {
        console.log("⚠ testEmail is empty -> sending to real recipients");
      }
    }

    recipients = ensureRecipients(recipients);

    const approveUrl = `${emailConfig.serverUrl}/api/leave/approve?id=${id}&token=${token}`;
    const rejectUrl = `${emailConfig.serverUrl}/api/leave/reject?id=${id}&token=${token}`;

    const fromHeader = emailConfig.from || "Holiday Calendar <noreply@akersolutions.com>";
    const envelopeFrom = (emailConfig.envelopeFrom || "noreply@akersolutions.com").trim();

    console.log("📧 From header:", fromHeader);
    console.log("📧 Envelope MAIL FROM:", envelopeFrom);
    console.log("📧 To:", recipients.join(", "));
    console.log("📧 SMTP:", `${emailConfig.smtp.host}:${emailConfig.smtp.port}`);

    // ✅ Generate iCalendar attachment
    const icsContent = generateICalendar(leaveData);
    const icsFilename = `leave-${employeeId}-${startDate}.ics`;

    const mailOptions = {
      from: fromHeader,
      to: recipients.join(", "),
      subject: `Leave Request: ${displayName} - ${startDate} to ${endDate}`,

      // ✅ This controls the real SMTP MAIL FROM (where your 530 happens)
      envelope: {
        from: envelopeFrom,
        to: recipients
      },

      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #e0e0e0;border-radius:8px">
          <h2 style="color:#00A0DF;margin-bottom:20px">🏖️ Leave Request Notification</h2>
          
          <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
            <tr style="border-bottom:1px solid #f0f0f0">
              <td style="padding:10px 0;font-weight:bold;color:#333">Employee:</td>
              <td style="padding:10px 0;color:#666">${displayName}</td>
            </tr>
            <tr style="border-bottom:1px solid #f0f0f0">
              <td style="padding:10px 0;font-weight:bold;color:#333">Email:</td>
              <td style="padding:10px 0;color:#666">${email}</td>
            </tr>
            <tr style="border-bottom:1px solid #f0f0f0">
              <td style="padding:10px 0;font-weight:bold;color:#333">Type:</td>
              <td style="padding:10px 0;color:#666">${leaveType}</td>
            </tr>
            <tr style="border-bottom:1px solid #f0f0f0">
              <td style="padding:10px 0;font-weight:bold;color:#333">Start Date:</td>
              <td style="padding:10px 0;color:#666">${startDate}</td>
            </tr>
            <tr style="border-bottom:1px solid #f0f0f0">
              <td style="padding:10px 0;font-weight:bold;color:#333">End Date:</td>
              <td style="padding:10px 0;color:#666">${endDate}</td>
            </tr>
            ${reason ? `
            <tr style="border-bottom:1px solid #f0f0f0">
              <td style="padding:10px 0;font-weight:bold;color:#333">Reason:</td>
              <td style="padding:10px 0;color:#666">${reason}</td>
            </tr>
            ` : ""}
          </table>

          <div style="margin:30px 0;text-align:center">
            <a href="${approveUrl}" 
               style="display:inline-block;background:#28a745;color:white;padding:12px 30px;text-decoration:none;border-radius:5px;margin:0 10px;font-weight:bold">
              ✅ Approve
            </a>
            <a href="${rejectUrl}" 
               style="display:inline-block;background:#dc3545;color:white;padding:12px 30px;text-decoration:none;border-radius:5px;margin:0 10px;font-weight:bold">
              ❌ Reject
            </a>
          </div>

          <div style="margin-top:20px;padding:15px;background:#f8f9fa;border-radius:5px">
            <p style="margin:0;font-size:14px;color:#666">
              📅 <strong>Add to Calendar:</strong> Open the attached .ics file to add this leave to your Outlook calendar.
            </p>
          </div>

          <hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0"/>
          <p style="font-size:12px;color:#999;text-align:center">
            Visioneering Holiday & Leave Tracker | Server: ${emailConfig.serverUrl}
          </p>
        </div>
      `,

      // ✅ Attach iCalendar file
      attachments: [
        {
          filename: icsFilename,
          content: icsContent,
          contentType: 'text/calendar; charset=utf-8; method=REQUEST'
        }
      ]
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Email sent successfully:", info.messageId);
    console.log("📎 iCalendar attachment included:", icsFilename);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error("✗ Email send failed:", err);
    return { success: false, error: err.message };
  }
}

// ----------------------------
// Approval/Rejection emails
// ----------------------------
async function sendApprovalEmail(leaveData) {
  const emailConfig = loadEmailConfig();
  const transporter = createTransporter(emailConfig);
  if (!transporter) return { success: false, error: "Transporter not available" };

  try {
    await transporter.verify();

    const recipients = ensureRecipients([leaveData.email]);
    const fromHeader = emailConfig.from || "Holiday Calendar <noreply@akersolutions.com>";
    const envelopeFrom = (emailConfig.envelopeFrom || "noreply@akersolutions.com").trim();

    // ✅ Generate iCalendar for approved leave
    const icsContent = generateICalendar({
      ...leaveData,
      id: leaveData.id || 'approved-' + Date.now()
    });
    const icsFilename = `approved-leave-${leaveData.startDate}.ics`;

    const info = await transporter.sendMail({
      from: fromHeader,
      to: recipients[0],
      envelope: { from: envelopeFrom, to: recipients },
      subject: `✅ Leave Request Approved - ${leaveData.startDate} to ${leaveData.endDate}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #28a745;border-radius:8px;background:#f8fff9">
          <h2 style="color:#28a745;margin-bottom:20px">✅ Leave Request Approved</h2>
          <p style="font-size:16px;color:#333">Hi ${leaveData.displayName},</p>
          <p style="font-size:16px;color:#333">Your <strong>${leaveData.leaveType}</strong> request has been <strong style="color:#28a745">approved</strong>!</p>
          
          <table style="width:100%;border-collapse:collapse;margin:20px 0">
            <tr style="border-bottom:1px solid #e0e0e0">
              <td style="padding:10px 0;font-weight:bold">Start Date:</td>
              <td style="padding:10px 0">${leaveData.startDate}</td>
            </tr>
            <tr style="border-bottom:1px solid #e0e0e0">
              <td style="padding:10px 0;font-weight:bold">End Date:</td>
              <td style="padding:10px 0">${leaveData.endDate}</td>
            </tr>
          </table>

          <p style="font-size:14px;color:#666">
            📅 The attached calendar file has been updated to <strong>CONFIRMED</strong>. Open it to add this approved leave to your Outlook calendar.
          </p>

          <p style="font-size:14px;color:#666;margin-top:20px">Enjoy your time off! 🏖️</p>
        </div>
      `,
      attachments: [
        {
          filename: icsFilename,
          content: icsContent.replace('STATUS:TENTATIVE', 'STATUS:CONFIRMED'),
          contentType: 'text/calendar; charset=utf-8; method=REQUEST'
        }
      ]
    });

    console.log("✅ Approval email sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error("✗ Approval email failed:", err);
    return { success: false, error: err.message };
  }
}

async function sendRejectionEmail(leaveData, rejectionReason = "") {
  const emailConfig = loadEmailConfig();
  const transporter = createTransporter(emailConfig);
  if (!transporter) return { success: false, error: "Transporter not available" };

  try {
    await transporter.verify();

    const recipients = ensureRecipients([leaveData.email]);
    const fromHeader = emailConfig.from || "Holiday Calendar <noreply@akersolutions.com>";
    const envelopeFrom = (emailConfig.envelopeFrom || "noreply@akersolutions.com").trim();

    const info = await transporter.sendMail({
      from: fromHeader,
      to: recipients[0],
      envelope: { from: envelopeFrom, to: recipients },
      subject: `❌ Leave Request Rejected - ${leaveData.startDate} to ${leaveData.endDate}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #dc3545;border-radius:8px;background:#fff8f8">
          <h2 style="color:#dc3545;margin-bottom:20px">❌ Leave Request Rejected</h2>
          <p style="font-size:16px;color:#333">Hi ${leaveData.displayName},</p>
          <p style="font-size:16px;color:#333">Your <strong>${leaveData.leaveType}</strong> request has been <strong style="color:#dc3545">rejected</strong>.</p>
          
          <table style="width:100%;border-collapse:collapse;margin:20px 0">
            <tr style="border-bottom:1px solid #e0e0e0">
              <td style="padding:10px 0;font-weight:bold">Start Date:</td>
              <td style="padding:10px 0">${leaveData.startDate}</td>
            </tr>
            <tr style="border-bottom:1px solid #e0e0e0">
              <td style="padding:10px 0;font-weight:bold">End Date:</td>
              <td style="padding:10px 0">${leaveData.endDate}</td>
            </tr>
            ${rejectionReason ? `
            <tr style="border-bottom:1px solid #e0e0e0">
              <td style="padding:10px 0;font-weight:bold">Reason:</td>
              <td style="padding:10px 0">${rejectionReason}</td>
            </tr>
            ` : ""}
          </table>

          <p style="font-size:14px;color:#666">
            Please contact your manager if you have any questions.
          </p>
        </div>
      `
    });

    console.log("✅ Rejection email sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error("✗ Rejection email failed:", err);
    return { success: false, error: err.message };
  }
}

module.exports = { sendLeaveRequestEmail, sendApprovalEmail, sendRejectionEmail };