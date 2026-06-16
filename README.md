# WOLFHQ // FiveM Command Center v2.1

A local Electron desktop interface for inspecting and editing FiveM server projects.

## Features

- Recursive server folder indexing and searchable file tree
- FiveM framework detection for QBCore, Qbox, ESX, vRP, and ND
- `server.cfg` metadata extraction
- Built-in CodeMirror editor with save tracking
- Custom resource generator with `fxmanifest.lua`, config, client, and server scripts
- Live `/dynamic.json`, `/players.json`, and `/info.json` server telemetry
- Live FXServer CPU and RAM process telemetry
- Working Resources, Players, Console, and Settings workspaces
- Authenticated in-game announcements and txAdmin-managed restarts
- Remote VPS/dedicated-server profiles over SSH and SFTP
- SSH-tunneled FiveM telemetry and control traffic
- Password or OpenSSH private-key authentication with host-key verification
- OS-encrypted saved credentials through Electron safe storage
- Secure Electron preload bridge with root-folder path restrictions
- Resource start, stop, restart, inspect, and Git update controls
- Filterable live console with authenticated command execution
- Player identifiers, notes, connection history, kicks, and persistent bans
- Local and remote restore points with pre-edit and pre-deploy safety backups
- Historical CPU, RAM, player, uptime, and crash telemetry
- Multi-server fleet profiles and encrypted remote switching
- Git status, fast-forward deployment, and one-click rollback
- MySQL table browsing and parameterized cell editing through SSH tunnels
- Crash detection with restart commands and Discord webhook alerts
- Owner, admin, and developer accounts with permissions and audit logging
- Dedicated sidebar workspaces for performance, backups, fleet, Git, database,
  automation, accounts, player history, and AI
- Anthropic Claude and OpenAI-compatible AI providers with Windows-encrypted keys
- Full indexed path and file-content search across local or remote servers
- AI change proposals with per-file approval, secret redaction, automatic backup,
  and guarded writes to existing editable server files

## Remote servers

Choose **Remote VPS** and enter the SSH host, username, FiveM server root,
and port. WOLFHQ only requires SSH to be reachable; FiveM telemetry and the
WOLFHQ control bridge are accessed through an encrypted SSH tunnel.

## Run

```powershell
npm install
npm run build
npm start
```

## GitHub updater

WOLFHQ checks public GitHub Releases from `LairOfWolf/WOLFHQ` automatically on
startup. If a newer release exists, the top-bar **UPDATE** button downloads the
Windows installer, launches it, and closes WOLFHQ so the updated app can restart
from the installer flow.

To publish an update, bump `package.json` version, commit, then push a matching
tag:

```powershell
npm version 2.1.2 --no-git-tag-version
git add package.json package-lock.json
git commit -m "Release v2.1.2"
git tag v2.1.2
git push origin main --tags
```

GitHub Actions builds the Windows installer and zip, attaches them to the
release, and WOLFHQ downloads the newest installer asset from that release.
