# Holiday & Leave Management System

Internal team leave management system with calendar integration and email notifications.

## Features
- 🗓️ Team calendar with multi-day leave support
- 📧 Automated email notifications with Outlook/ICS integration
- 🔐 Windows SSO authentication (SSPI)
- 👥 Role-based access control (Admin, Manager, Developer)
- 📊 Color-coded leave types in Outlook calendar
- ✅ Approve/Reject leave requests via email buttons

## Leave Types
- Leave (Blue)
- Sick (Orange)
- Work From Home (Green)
- Remote Work - Location A (Purple)
- Remote Work - Location B (Teal)
- Work Travel (Purple)
- Public Holiday (Red)

## Tech Stack
- **Backend:** Node.js + Express
- **Authentication:** Windows SSPI (node-expose-sspi)
- **Email:** Nodemailer with ICS calendar attachments
- **Frontend:** Vanilla JavaScript + Flatpickr date picker
- **Deployment:** Windows Service (NSSM)

## Installation

### Prerequisites
- Node.js 18+
- Windows Server (for SSPI authentication)
- SMTP server access

### Setup

1. **Clone the repository:**
```bash
   git clone <your-repo-url>
   cd Holiday-Calendar
```

2. **Install dependencies:**
```bash
   npm install
```

3. **Create configuration files:**

   **email-config.json:**
```json
   {
     "enabled": true,
     "testMode": false,
     "smtp": {
       "host": "smtp.example.com",
       "port": 25,
       "secure": false,
       "auth": false
     },
     "from": "noreply@example.com",
     "serverUrl": "http://localhost:3001"
   }
```

   **employee-routing.json:**
```json
   {
     "mainApprover": "approver@example.com",
     "managers": {
       "manager1@example.com": [
         "employee1@example.com",
         "employee2@example.com"
       ]
     }
   }
```

4. **Initialize data files:**
```bash
   mkdir data
   echo [] > data/entries.json
   echo {"users":[],"defaultRole":"developer"} > data/roles.json
```

5. **Run the application:**
```bash
   set USE_SSPI=true
   node server.js
```

6. **Access the application:**
```
   http://localhost:3001
```

## Configuration

### Email Settings
Configure SMTP settings in `email-config.json`:
- `enabled`: Enable/disable email notifications
- `testMode`: Send all emails to test addresses
- `smtp`: SMTP server configuration
- `serverUrl`: Base URL for approve/reject links

### User Roles
Roles are managed in `data/roles.json`:
- **Admin**: Full access, user management
- **Manager**: Approve/reject team member requests
- **Developer**: Submit leave requests

### Authentication
The system uses Windows SSPI for seamless authentication:
- Automatically extracts user email from Active Directory
- No login form required
- Set `USE_SSPI=true` environment variable

## Features

### For Employees
- Apply for leave with calendar date picker
- Multi-day leave support (weekends auto-skipped)
- Receive confirmation email with ICS attachment
- Add leave to personal Outlook calendar
- Track leave status (Pending/Approved/Rejected)

### For Managers
- Receive email notifications with approve/reject buttons
- One-click approval/rejection
- View team calendar
- Automatic email confirmation to employee

### For Admins
- Manage user roles
- View all team members' leave
- Admin panel for user management

## Email Workflow

1. **Employee submits leave:**
   - Employee receives confirmation email with ICS file
   - Approver receives request email with approve/reject buttons
   - Direct manager receives FYI email (if different from approver)

2. **Manager approves/rejects:**
   - Click button in email
   - Employee receives approval/rejection email
   - Calendar automatically updated

## Development

### Project Structure
```
├── server.js              # Main Express server
├── emailService.js        # Email notification logic
├── package.json           # Dependencies
├── public/
│   ├── index.html        # Frontend UI
│   ├── app.js            # Frontend logic
│   └── styles.css        # Styling
└── data/
    ├── entries.json      # Leave entries
    └── roles.json        # User roles
```

### Running in Development
```bash
npm install
set USE_SSPI=true
node server.js
```

### Running as Windows Service
```bash
nssm install HolidayCalendar "C:\Program Files\nodejs\node.exe" "C:\path\to\server.js"
nssm set HolidayCalendar AppEnvironmentExtra USE_SSPI=true
nssm start HolidayCalendar
```

## API Endpoints

- `GET /api/user` - Get current user info
- `GET /api/entries` - Get all calendar entries
- `POST /api/entry/batch` - Create multiple leave entries
- `GET /api/leave/approve?token=...` - Approve leave request
- `GET /api/leave/reject?token=...` - Reject leave request
- `GET /api/admin/users` - Get all users (admin only)
- `POST /api/admin/users` - Add new user (admin only)

## Security

- Windows SSPI authentication
- Role-based access control
- Token-based approve/reject links
- SMTP envelope validation
- Input sanitization

## Troubleshooting

**Email not sending:**
- Check `email-config.json` settings
- Verify SMTP server connectivity
- Check logs in `C:\HolidayApp\logs\email.log`

**Authentication issues:**
- Ensure `USE_SSPI=true` is set
- Verify `node-expose-sspi` is installed
- Check Active Directory connectivity

**Calendar colors not showing:**
- Ensure Outlook category names are capitalized: "Blue Category" not "blue category"
- Open attached ICS file to add to calendar

## License
Internal use only

## Contributing
This is an internal tool. Contact the development team for modifications.