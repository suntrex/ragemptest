# Installation Guide – RageMP Admin Menu

This guide walks you through installing the Admin Menu script on a fresh RageMP server, step by step. Both Windows and Linux are covered.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Download RageMP Server](#2-download-ragemp-server)
3. [First Server Start](#3-first-server-start)
4. [Install the Admin Menu Script](#4-install-the-admin-menu-script)
5. [Configure the Server](#5-configure-the-server)
6. [Grant Yourself Admin](#6-grant-yourself-admin)
7. [Start the Server with Auto-Restart (Recommended)](#7-start-the-server-with-auto-restart-recommended)
8. [In-Game: Open the Admin Menu](#8-in-game-open-the-admin-menu)
9. [Command Reference](#9-command-reference)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prerequisites

| Requirement | Notes |
|-------------|-------|
| **GTA V** (PC) | Legitimately owned copy (Steam, Epic, Rockstar Launcher) |
| **RageMP Client** | Download from [rage.mp](https://rage.mp/) |
| **Node.js ≥ 14** | Only needed on the server host – download from [nodejs.org](https://nodejs.org/) |
| **RageMP Server** | See step 2 |

> **Windows users**: No additional software required.  
> **Linux users**: Make sure you have `wine` or a supported 64-bit environment (RageMP server binary is a Windows executable; use Wine on Linux).

---

## 2. Download RageMP Server

1. Go to **[rage.mp](https://rage.mp/)** and scroll to the *"Create your own server"* section, **or** navigate directly to:  
   `https://cdn.rage.mp/public/files/RAGEMultiplayer_Setup.exe`
2. Run the installer and choose **"Install Server"** when prompted.  
   The server files will be placed in (by default):  
   - **Windows**: `C:\RAGEMP\server-files\`  
   - **Linux (Wine)**: wherever you ran the installer

Your server folder should look like this after installation:

```
server-files/
├── ragemp-server.exe      (Windows) / ragemp-server (Linux)
├── conf.json
├── packages/
├── client_packages/
├── plugins/
└── maps/
```

---

## 3. First Server Start

Before installing scripts, verify the server starts cleanly:

**Windows:**
```bat
cd C:\RAGEMP\server-files
ragemp-server.exe
```

**Linux (Wine):**
```bash
cd ~/ragemp/server-files
wine ragemp-server.exe
```

You should see console output ending with something like:
```
[INFO] Server started on port 22005
```

Press `Ctrl+C` to stop the server again.

---

## 4. Install the Admin Menu Script

### Option A – Clone this repository (recommended)

```bash
# Navigate to your server directory
cd C:\RAGEMP\server-files       # Windows
# or
cd ~/ragemp/server-files        # Linux

# Clone the repo directly into a temp folder, then copy files
git clone https://github.com/suntrex/ragemptest.git /tmp/ragemptest

# Copy the packages
cp -r /tmp/ragemptest/packages/admin     ./packages/admin
cp -r /tmp/ragemptest/client_packages/admin  ./client_packages/admin
```

**Windows (PowerShell):**
```powershell
cd "C:\RAGEMP\server-files"
git clone https://github.com/suntrex/ragemptest.git "$env:TEMP\ragemptest"
Copy-Item -Recurse "$env:TEMP\ragemptest\packages\admin"          ".\packages\admin"
Copy-Item -Recurse "$env:TEMP\ragemptest\client_packages\admin"   ".\client_packages\admin"
```

### Option B – Manual download

1. Download the repository as a ZIP from GitHub:  
   `https://github.com/suntrex/ragemptest/archive/refs/heads/main.zip`
2. Extract the ZIP.
3. Copy the `packages/admin/` folder into your server's `packages/` directory.
4. Copy the `client_packages/admin/` folder into your server's `client_packages/` directory.

After this step your server directory should contain:

```
server-files/
├── packages/
│   └── admin/
│       └── index.js          ← server-side logic
└── client_packages/
    └── admin/
        ├── index.js          ← client-side event bridge
        └── html/
            ├── index.html    ← menu UI
            ├── style.css     ← dark theme
            └── script.js     ← menu logic
```

---

## 5. Configure the Server

Open `conf.json` in your server directory and make sure `"admin"` appears in **both** the `packages` and `client_packages` arrays:

```json
{
    "maxplayers": 100,
    "name": "My RageMP Server",
    "gamemode": "freeroam",
    "address": "0.0.0.0",
    "port": 22005,
    "announce": false,
    "csharp": "disable",
    "resources": [],
    "packages": ["admin"],
    "client_packages": ["admin"]
}
```

> If you already have other packages listed, just add `"admin"` to each array – do **not** replace existing entries.

---

## 6. Grant Yourself Admin

There are two ways to grant admin access:

### Method A – Hardcode your Social Club name (easiest)

Open `packages/admin/index.js` and add your Social Club name to the `HARDCODED_ADMINS` array at the very top:

```js
const HARDCODED_ADMINS = [
    'YourSocialClubName',   // ← replace with your actual Social Club name
];
```

Save the file. You will automatically have **Super Admin (level 3)** every time you join.

### Method B – Use the in-game `/setadmin` command

1. First, grant yourself admin using Method A (just once).
2. Once in-game, promote other players via chat:

```
/setadmin <playerID> <level>
```

**Admin levels:**

| Level | Role        | Permissions |
|-------|-------------|-------------|
| 0     | None        | No admin features |
| 1     | Moderator   | Basic admin menu |
| 2     | Admin       | + Set time/weather, kick players |
| 3     | Super Admin | + Promote others, restart server |

---

## 7. Start the Server with Auto-Restart (Recommended)

The `/restartserver` command works by calling `process.exit(0)`. For the server to automatically come back online, you need a **process manager** or a **restart loop**.

### Option A – pm2 (recommended, cross-platform)

```bash
# Install pm2 globally (requires Node.js)
npm install -g pm2

# Start the server with pm2
cd ~/ragemp/server-files
pm2 start ragemp-server.exe --name "ragemp"

# Make pm2 start on system boot
pm2 save
pm2 startup
```

Now `/restartserver` will exit the process and pm2 will restart it automatically within seconds.

### Option B – Batch script restart loop (Windows)

Create a file named `start.bat` in your server directory:

```bat
@echo off
:loop
ragemp-server.exe
echo Server stopped – restarting in 3 seconds...
timeout /t 3 /nobreak
goto loop
```

Run `start.bat` instead of `ragemp-server.exe` directly. When `/restartserver` is used, the server exits and the batch script restarts it automatically.

### Option C – Bash restart loop (Linux)

Create `start.sh`:

```bash
#!/bin/bash
while true; do
    wine ragemp-server.exe
    echo "Server stopped – restarting in 3 seconds..."
    sleep 3
done
```

```bash
chmod +x start.sh
./start.sh
```

---

## 8. In-Game: Open the Admin Menu

Once you are in-game and have admin access:

| Method | Description |
|--------|-------------|
| **F6** | Press F6 at any time to toggle the admin menu |
| **/admin** | Type `/admin` in chat to open the menu |

---

## 9. Command Reference

| Command | Required Level | Description |
|---------|---------------|-------------|
| `/admin` | Level 1+ | Open the admin menu |
| `/setadmin <id> <level>` | Level 3 | Set a player's admin level |
| `/restartserver` | Level 3 | Broadcast a 5-second countdown and restart the server |

---

## 10. Troubleshooting

**Menu doesn't open (F6 / /admin does nothing)**
- Check that `"admin"` is in both `packages` and `client_packages` in `conf.json`.
- Check the server console for JavaScript errors in `packages/admin/index.js`.

**"You do not have admin access" error**
- Make sure your Social Club name is exactly as it appears in-game (case-sensitive) in `HARDCODED_ADMINS`.

**Vehicle spawn fails**
- Use the exact RageMP model name (lowercase, no spaces). Example: `adder`, `zentorno`, `fbi2`.

**`/restartserver` closes the server but it doesn't come back**
- You need a process manager or restart loop (see [Step 7](#7-start-the-server-with-auto-restart-recommended)).

**Port 22005 is already in use**
- Change `"port"` in `conf.json` to another unused port (e.g. `22006`).

**Server not showing in the server list**
- Set `"announce": true` in `conf.json` and make sure port `22005` (UDP+TCP) is forwarded in your router/firewall.
