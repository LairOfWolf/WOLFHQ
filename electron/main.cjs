const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const { RemoteServer, isAbsoluteRemotePath, normalizeRemotePath } = require("./remote.cjs");
const { OpsManager } = require("./ops.cjs");
const { AiManager } = require("./ai.cjs");
const { ResourceCatalogManager } = require("./catalog.cjs");
const { detectAntiCheats } = require("./anticheat.cjs");

const execFileAsync = promisify(execFile);

const TEXT_EXTENSIONS = new Set([
  ".lua", ".cfg", ".json", ".js", ".jsx", ".ts", ".tsx", ".html", ".css",
  ".scss", ".md", ".txt", ".xml", ".yml", ".yaml", ".toml", ".ini", ".sql",
  ".env", ".gitignore", ".fxap"
]);
const SKIP_DIRECTORIES = new Set([".git", "node_modules", "cache", ".cache", "dist", "build"]);
const MAX_TEXT_FILE_SIZE = 5 * 1024 * 1024;
const MAX_SCAN_ENTRIES = 60000;
const DEFAULT_UPDATER_SETTINGS = {
  repo: "LairOfWolf/WOLFHQ",
  checkOnStartup: true,
  includePrerelease: false,
  encryptedToken: ""
};

let mainWindow;
let splashWindow;
let splashStartedAt = 0;
let activeRoot = null;
let activeProject = null;
let activeMode = "local";
let remoteServer = null;
let remoteConnectPromise = null;
let recentProjectPromise = null;
let opsManager = null;
let aiManager = null;
let resourceCatalogManager = null;
let monitorTimer = null;
let lastScheduledBackupAt = 0;

function getOpsManager() {
  if (!opsManager) {
    opsManager = new OpsManager({
      userData: app.getPath("userData"),
      getContext: () => ({ mode: activeMode, project: activeProject, root: activeRoot, remote: remoteServer }),
      callControl,
      getStatus: getCurrentStatus
    });
  }
  return opsManager;
}

function getAiManager() {
  if (!aiManager) {
    aiManager = new AiManager({
      userData: app.getPath("userData"),
      encrypt: encryptSecret,
      decrypt: decryptSecret,
      getContext: () => ({ mode: activeMode, project: activeProject, root: activeRoot, remote: remoteServer }),
      readText: async (filePath) => {
        if (activeMode === "remote") return (await remoteServer.readFile(filePath)).content;
        return fs.readFile(requireSafePath(filePath), "utf8");
      },
      searchText: async (query, limit) => {
        if (activeMode === "remote") return remoteServer.searchText(query, limit);
        return null;
      },
      writeText: async (filePath, content) => {
        if (activeMode === "remote") return remoteServer.writeFile(filePath, content);
        const safePath = requireSafePath(filePath);
        await fs.writeFile(safePath, String(content), "utf8");
        return { ok: true, path: safePath };
      },
      createBackup: (label) => getOpsManager().createBackup(label),
      audit: (action, detail) => getOpsManager().audit(action, detail)
    });
  }
  return aiManager;
}

function getResourceCatalogManager() {
  if (!resourceCatalogManager) {
    resourceCatalogManager = new ResourceCatalogManager({
      userData: app.getPath("userData"),
      getContext: () => ({ mode: activeMode, project: activeProject, root: activeRoot, remote: remoteServer }),
      assertPermission: (permission) => getOpsManager().assertPermission(permission),
      audit: (action, detail) => getOpsManager().audit(action, detail)
    });
  }
  return resourceCatalogManager;
}

function profilesPath() {
  return path.join(app.getPath("userData"), "remote-profiles.json");
}

function sessionPath() {
  return path.join(app.getPath("userData"), "active-session.json");
}

function updaterSettingsPath() {
  return path.join(app.getPath("userData"), "wolfhq-updater.json");
}

function normalizeGitHubRepo(value) {
  const cleaned = String(value || "")
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
  const match = cleaned.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) return "";
  return `${match[1]}/${match[2]}`;
}

function normalizeUpdaterSettings(input = {}, current = {}) {
  const repo = normalizeGitHubRepo(input.repo) || DEFAULT_UPDATER_SETTINGS.repo;
  return {
    repo,
    checkOnStartup: input.checkOnStartup !== false,
    includePrerelease: Boolean(input.includePrerelease),
    encryptedToken: current.encryptedToken || ""
  };
}

async function readUpdaterSettings() {
  try {
    const saved = JSON.parse(await fs.readFile(updaterSettingsPath(), "utf8"));
    return normalizeUpdaterSettings(saved, saved);
  } catch {
    return { ...DEFAULT_UPDATER_SETTINGS };
  }
}

function publicUpdaterSettings(settings) {
  const { encryptedToken, ...safe } = settings;
  return { ...safe, hasToken: Boolean(encryptedToken) };
}

async function saveUpdaterSettings(input) {
  const current = await readUpdaterSettings();
  const settings = normalizeUpdaterSettings(input, current);
  if (input.token) settings.encryptedToken = encryptSecret(String(input.token).trim());
  await fs.writeFile(updaterSettingsPath(), JSON.stringify(settings, null, 2), "utf8");
  return publicUpdaterSettings(settings);
}

function parseVersion(value) {
  return String(value || "")
    .replace(/^[^\d]*/, "")
    .split(/[.-]/)
    .slice(0, 3)
    .map((part) => Number(part.replace(/\D/g, "")) || 0);
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] || 0) > (right[index] || 0)) return 1;
    if ((left[index] || 0) < (right[index] || 0)) return -1;
  }
  return 0;
}

function releaseSummary(release, repo) {
  const tag = release.tag_name || release.name || "";
  return {
    repo,
    currentVersion: app.getVersion(),
    latestVersion: tag,
    name: release.name || tag,
    body: release.body || "",
    publishedAt: release.published_at || "",
    releaseUrl: release.html_url || `https://github.com/${repo}/releases/latest`,
    available: compareVersions(tag, app.getVersion()) > 0,
    assets: (release.assets || []).map((asset) => ({
      name: asset.name,
      size: asset.size || 0,
      url: asset.browser_download_url,
      apiUrl: asset.url
    })).filter((asset) => asset.url)
  };
}

function updaterAuthHeaders(settings, accept = "application/vnd.github+json") {
  const headers = {
    "Accept": accept,
    "User-Agent": `WOLFHQ/${app.getVersion()}`
  };
  const token = settings.encryptedToken ? decryptSecret(settings.encryptedToken) : "";
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchJson(url, settings) {
  const response = await fetch(url, {
    headers: updaterAuthHeaders(settings)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `GitHub returned HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function checkForGithubUpdate(input = {}) {
  const current = await readUpdaterSettings();
  const settings = input.repo ? normalizeUpdaterSettings(input, current) : current;
  if (!settings.repo) throw new Error("Add your GitHub owner/repo in Settings before checking for WOLFHQ updates.");
  const apiUrl = settings.includePrerelease
    ? `https://api.github.com/repos/${settings.repo}/releases?per_page=10`
    : `https://api.github.com/repos/${settings.repo}/releases/latest`;
  let data;
  try {
    data = await fetchJson(apiUrl, settings);
  } catch (error) {
    if (error.status === 404 || /404|not found/i.test(error.message)) {
      try {
        await fetchJson(`https://api.github.com/repos/${settings.repo}`, settings);
      } catch {
        throw new Error(`GitHub could not see ${settings.repo}. Make sure the repo is public and the name is correct.`);
      }
      throw new Error(`No GitHub Release exists for ${settings.repo} yet. Create a release from the latest tag or wait for GitHub Actions to finish building it.`);
    }
    throw error;
  }
  const release = Array.isArray(data)
    ? data.find((item) => !item.draft && (settings.includePrerelease || !item.prerelease))
    : data;
  if (!release?.tag_name) throw new Error(`No GitHub releases were found for ${settings.repo}.`);
  return releaseSummary(release, settings.repo);
}

function pickReleaseAsset(release) {
  const assets = release.assets || [];
  const preferred = process.platform === "win32"
    ? [".exe", ".msi", ".appinstaller", ".zip"]
    : process.platform === "darwin"
      ? [".dmg", ".zip"]
      : [".AppImage", ".deb", ".rpm", ".tar.gz", ".zip"];
  return preferred.map((extension) => assets.find((asset) => asset.name?.toLowerCase().endsWith(extension.toLowerCase()))).find(Boolean)
    || assets[0];
}

function launchDownloadedUpdate(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension !== ".exe" && extension !== ".msi") return false;
  const child = extension === ".msi"
    ? spawn("msiexec.exe", ["/i", filePath], { detached: true, stdio: "ignore" })
    : spawn(filePath, [], { detached: true, stdio: "ignore" });
  child.unref();
  setTimeout(() => app.quit(), 1400);
  return true;
}

async function downloadGithubUpdate(input = {}) {
  const current = await readUpdaterSettings();
  const settings = input.repo ? normalizeUpdaterSettings(input, current) : current;
  const latest = await checkForGithubUpdate(settings);
  const asset = pickReleaseAsset(latest);
  if (!asset?.url) {
    await shell.openExternal(latest.releaseUrl);
    return { ...latest, downloaded: false, message: "No release asset was found, so WOLFHQ opened the GitHub release page." };
  }

  const response = await fetch(asset.apiUrl || asset.url, {
    headers: updaterAuthHeaders(settings, asset.apiUrl ? "application/octet-stream" : "application/vnd.github+json")
  });
  if (!response.ok) throw new Error(`Update download failed with HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const safeName = asset.name.replace(/[<>:"/\\|?*]/g, "_");
  const destination = path.join(app.getPath("downloads"), safeName);
  await fs.writeFile(destination, bytes);
  const installing = input.install !== false && launchDownloadedUpdate(destination);
  if (!installing) shell.showItemInFolder(destination);
  return {
    ...latest,
    downloaded: true,
    installing,
    filePath: destination,
    fileName: safeName,
    message: installing
      ? `Downloaded ${safeName}. The installer is launching and WOLFHQ will close so the update can finish.`
      : `Downloaded ${safeName} to your Downloads folder.`
  };
}

async function readProfiles() {
  try {
    const data = JSON.parse(await fs.readFile(profilesPath(), "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writeProfiles(profiles) {
  await fs.writeFile(profilesPath(), JSON.stringify(profiles, null, 2), "utf8");
}

function encryptSecret(value) {
  if (!value || !safeStorage.isEncryptionAvailable()) return "";
  return safeStorage.encryptString(String(value)).toString("base64");
}

function decryptSecret(value) {
  if (!value || !safeStorage.isEncryptionAvailable()) return "";
  return safeStorage.decryptString(Buffer.from(value, "base64"));
}

function publicProfile(profile) {
  const { encryptedSecret, ...safe } = profile;
  return { ...safe, hasSavedSecret: Boolean(encryptedSecret) };
}

function createSplashWindow() {
  splashStartedAt = Date.now();
  splashWindow = new BrowserWindow({
    width: 720,
    height: 455,
    frame: false,
    transparent: false,
    resizable: false,
    movable: true,
    show: true,
    backgroundColor: "#050711",
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    title: "WOLFHQ BOOTING",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  splashWindow.on("closed", () => {
    splashWindow = null;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 940,
    minWidth: 1120,
    minHeight: 700,
    frame: false,
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    backgroundColor: "#050711",
    show: false,
    title: "WOLFHQ // FiveM Command Center",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.once("ready-to-show", () => {
    const remaining = Math.max(0, 1900 - (Date.now() - splashStartedAt));
    setTimeout(() => {
      mainWindow?.show();
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    }, remaining);
  });
}

function isWithinRoot(targetPath) {
  if (!activeRoot) return false;
  const relative = path.relative(activeRoot, path.resolve(targetPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function requireSafePath(targetPath) {
  if (!targetPath || !isWithinRoot(targetPath)) {
    throw new Error("That path is outside the active server folder.");
  }
  return path.resolve(targetPath);
}

function requireKnownResourcePath(resourcePath) {
  if (!activeProject) throw new Error("Connect a server first.");
  const target = requireSafePath(resourcePath);
  const resource = activeProject.resources.find((candidate) => path.resolve(candidate.path) === target);
  if (!resource) throw new Error("WOLFHQ can only delete folders detected as FiveM resources.");
  if (target === path.resolve(activeProject.rootPath)) throw new Error("The server root cannot be deleted as a resource.");
  if ((activeProject.resourcesRoots || []).some((root) => path.resolve(root) === target)) {
    throw new Error("The top-level resources folder cannot be deleted.");
  }
  return { resource, target };
}

async function requireSafeFolderPath(folderPath, options = {}) {
  if (!activeProject) throw new Error("Connect a server first.");
  const target = requireSafePath(folderPath);
  const stats = await fs.stat(target);
  if (!stats.isDirectory()) throw new Error("That path is not a folder.");
  if (!options.allowRoot && target === path.resolve(activeProject.rootPath)) {
    throw new Error("The active server root cannot be deleted.");
  }
  return target;
}

async function copyFolderInto(sourceFolder, destinationFolder) {
  const sourceStats = await fs.stat(sourceFolder);
  if (!sourceStats.isDirectory()) throw new Error("Choose a folder to upload.");
  const destination = await requireSafeFolderPath(destinationFolder, { allowRoot: true });
  const target = path.join(destination, path.basename(sourceFolder));
  if (!isWithinRoot(target)) throw new Error("The upload target is outside the active server folder.");
  try {
    await fs.stat(target);
    throw new Error(`A folder named ${path.basename(sourceFolder)} already exists there.`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.cp(sourceFolder, target, { recursive: true, errorOnExist: true, force: false });
  return target;
}

function isTextFile(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  return TEXT_EXTENSIONS.has(extension) || !extension;
}

function detectFramework(signals) {
  const haystack = signals.join("\n").toLowerCase();
  const candidates = [
    { name: "Qbox", score: ["qbx_core", "qbox"].filter((token) => haystack.includes(token)).length },
    { name: "QBCore", score: ["qb-core", "qb_core", "getcoreobject"].filter((token) => haystack.includes(token)).length },
    { name: "ESX", score: ["es_extended", "esx:getsharedobject", "esx_"].filter((token) => haystack.includes(token)).length },
    { name: "vRP", score: ["vrp", "proxy.getinterface"].filter((token) => haystack.includes(token)).length },
    { name: "ND Framework", score: ["nd_core", "nd-framework"].filter((token) => haystack.includes(token)).length },
    { name: "Standalone", score: 0 }
  ].sort((a, b) => b.score - a.score);
  return candidates[0].score > 0 ? candidates[0].name : "Standalone / Custom";
}

async function scanDirectory(rootPath) {
  const stats = { files: 0, folders: 0, resources: 0, bytes: 0, truncated: false };
  const resources = [];
  const resourcesRoots = [];
  const signals = [];
  const antiCheatResources = [];
  const config = {};
  let serverConfigText = "";
  let entriesSeen = 0;

  async function walk(directory) {
    if (entriesSeen >= MAX_SCAN_ENTRIES) {
      stats.truncated = true;
      return [];
    }

    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }

    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    const nodes = [];

    for (const entry of entries) {
      if (entriesSeen++ >= MAX_SCAN_ENTRIES) {
        stats.truncated = true;
        break;
      }
      if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name.toLowerCase())) continue;

      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(rootPath, fullPath);

      if (entry.isDirectory()) {
        stats.folders += 1;
        if (entry.name.toLowerCase() === "resources") resourcesRoots.push(fullPath);
        const children = await walk(fullPath);
        nodes.push({ name: entry.name, path: fullPath, relativePath, type: "folder", children });
        continue;
      }

      let size = 0;
      try {
        size = (await fs.stat(fullPath)).size;
      } catch {}
      stats.files += 1;
      stats.bytes += size;
      const text = isTextFile(entry.name);
      const lowerName = entry.name.toLowerCase();

      if ((lowerName === "fxmanifest.lua" || lowerName === "__resource.lua") && size <= MAX_TEXT_FILE_SIZE) {
        stats.resources += 1;
        const resourceName = path.basename(directory);
        resources.push({ name: resourceName, path: directory, manifest: fullPath });
        signals.push(resourceName, relativePath);
        try {
          const manifestText = (await fs.readFile(fullPath, "utf8")).slice(0, 20000);
          signals.push(manifestText);
          antiCheatResources.push({ name: resourceName, path: directory, manifest: fullPath, manifestText });
        } catch {}
      }

      if (lowerName === "server.cfg" && size <= MAX_TEXT_FILE_SIZE) {
        try {
          const serverCfg = await fs.readFile(fullPath, "utf8");
          serverConfigText = serverCfg;
          signals.push(serverCfg);
          const getValue = (key) => {
            const match = serverCfg.match(new RegExp(`^\\s*(?:set|sets|setr)?\\s*${key}\\s+[\"']?([^\\r\\n\"']+)`, "im"));
            return match?.[1]?.trim() || "";
          };
          config.hostname = getValue("sv_hostname");
          config.maxClients = Number(getValue("sv_maxclients")) || 0;
          config.projectName = getValue("sv_projectName");
          config.locale = getValue("locale");
          config.endpoint = getValue("endpoint_add_tcp") || getValue("endpoint_add_udp");
          config.path = fullPath;
        } catch {}
      }

      nodes.push({
        name: entry.name,
        path: fullPath,
        relativePath,
        type: "file",
        size,
        editable: text && size <= MAX_TEXT_FILE_SIZE
      });
    }
    return nodes;
  }

  const tree = await walk(rootPath);
  return {
    rootPath,
    name: path.basename(rootPath),
    tree,
    resources,
    resourcesRoots,
    stats,
    config,
    framework: detectFramework(signals),
    antiCheats: detectAntiCheats(antiCheatResources, serverConfigText)
  };
}

function normalizeEndpoint(rawEndpoint) {
  let endpoint = String(rawEndpoint || "http://127.0.0.1:30120").trim();
  endpoint = endpoint.replace(/^endpoint_add_(?:tcp|udp)\s+/i, "").replace(/["']/g, "");
  if (!/^https?:\/\//i.test(endpoint)) endpoint = `http://${endpoint}`;
  return endpoint.replace(/\/+$/, "");
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonResult(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 3500);
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      signal: controller.signal,
      cache: "no-store",
      headers: options.headers,
      body: options.body
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function endpointFromConfig() {
  const configured = activeProject?.config?.endpoint;
  if (!configured) return "";
  const port = String(configured).match(/:(\d{2,5})/)?.[1];
  return port ? `http://127.0.0.1:${port}` : "";
}

async function getProcessMetrics(baseUrl) {
  if (process.platform !== "win32") return null;
  const port = Number(new URL(baseUrl).port || 80);
  if (!port) return null;
  const script = [
    `$connection = Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1`,
    "if (-not $connection) { return }",
    "$pidValue = $connection.OwningProcess",
    "$perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -ErrorAction SilentlyContinue | Where-Object { $_.IDProcess -eq $pidValue } | Select-Object -First 1",
    "$proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue",
    "if ($proc) { [pscustomobject]@{ pid=$pidValue; cpu=if($perf){[math]::Min(100,[double]$perf.PercentProcessorTime)}else{0}; memoryBytes=[double]$proc.WorkingSet64; started=$proc.StartTime.ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress }"
  ].join("; ");
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], {
      windowsHide: true,
      timeout: 4500
    });
    return stdout.trim() ? JSON.parse(stdout.trim()) : null;
  } catch {
    return null;
  }
}

async function probeServer(rawEndpoint) {
  const baseUrl = normalizeEndpoint(rawEndpoint);
  const results = await Promise.allSettled([
    fetchJson(`${baseUrl}/dynamic.json`),
    fetchJson(`${baseUrl}/players.json`),
    fetchJson(`${baseUrl}/info.json`)
  ]);
  const dynamic = results[0].status === "fulfilled" ? results[0].value : {};
  const players = results[1].status === "fulfilled" && Array.isArray(results[1].value) ? results[1].value : [];
  const info = results[2].status === "fulfilled" ? results[2].value : {};
  const online = results.some((result) => result.status === "fulfilled");
  if (!online) throw new Error("FiveM telemetry endpoints did not respond.");
  return {
    online: true,
    endpoint: baseUrl,
    players,
    playerCount: players.length || Number(dynamic.clients) || 0,
    maxPlayers: Number(dynamic.sv_maxclients) || activeProject?.config?.maxClients || 0,
    hostname: dynamic.hostname || info.vars?.sv_projectName || "",
    map: dynamic.mapname || "",
    gameType: dynamic.gametype || "",
    resources: Array.isArray(info.resources) ? info.resources.length : 0,
    process: await getProcessMetrics(baseUrl)
  };
}

function getControlPaths() {
  if (!activeProject?.config?.path) throw new Error("No active server.cfg was detected.");
  const profileRoot = path.dirname(activeProject.config.path);
  const resourcesRoot = activeProject.resourcesRoots
    ?.find((candidate) => path.dirname(candidate) === profileRoot)
    || path.join(profileRoot, "resources");
  const resourceRoot = path.join(resourcesRoot, "[wolfhq]", "wolfhq-control");
  return {
    configPath: activeProject.config.path,
    resourcesRoot,
    resourceRoot,
    tokenPath: path.join(resourceRoot, ".wolfhq-token")
  };
}

async function readControlToken() {
  const { tokenPath } = getControlPaths();
  return (await fs.readFile(tokenPath, "utf8")).trim();
}

function controlBridgeFiles() {
  const manifest = [
    "fx_version 'cerulean'",
    "game 'gta5'",
    "",
    "author 'WOLFHQ'",
    "description 'Local authenticated bridge for the WOLFHQ desktop command center'",
    "version '2.1.1'",
    "",
    "server_script 'server.lua'",
    ""
  ].join("\n");
  const serverScript = `local RESOURCE = GetCurrentResourceName()
local TOKEN = (LoadResourceFile(RESOURCE, '.wolfhq-token') or ''):gsub('%s+$', '')
local BANS_FILE = 'bans.json'
local bans = json.decode(LoadResourceFile(RESOURCE, BANS_FILE) or '[]') or {}

local function sendJson(res, status, payload)
    res.writeHead(status, { ['Content-Type'] = 'application/json', ['Cache-Control'] = 'no-store' })
    res.send(json.encode(payload))
end

local function isAuthorized(req)
    local supplied = req.headers['x-wolfhq-token'] or req.headers['X-WOLFHQ-Token']
    return TOKEN ~= '' and supplied == TOKEN
end

local function announce(message)
    TriggerClientEvent('txcl:showAnnouncement', -1, message, 'WOLFHQ')
    TriggerClientEvent('chat:addMessage', -1, {
        color = { 80, 223, 249 },
        multiline = true,
        args = { 'WOLFHQ', message }
    })
    print(('[WOLFHQ] Announcement: %s'):format(message))
end

local function playerData(source)
    return {
        id = tonumber(source),
        name = GetPlayerName(source) or 'Unknown',
        ping = GetPlayerPing(source),
        endpoint = GetPlayerEndpoint(source) or 'Protected',
        identifiers = GetPlayerIdentifiers(source)
    }
end

local function resourceData()
    local result = {}
    for index = 0, GetNumResources() - 1 do
        local name = GetResourceByFindIndex(index)
        if name then
            result[#result + 1] = { name = name, state = GetResourceState(name) }
        end
    end
    return result
end

AddEventHandler('playerConnecting', function(_, setKickReason)
    local identifiers = GetPlayerIdentifiers(source)
    for _, ban in ipairs(bans) do
        for _, identifier in ipairs(identifiers) do
            for _, bannedIdentifier in ipairs(ban.identifiers or {}) do
                if identifier == bannedIdentifier then
                    setKickReason(('Banned by WOLFHQ: %s'):format(ban.reason or 'No reason supplied'))
                    CancelEvent()
                    return
                end
            end
        end
    end
end)

SetHttpHandler(function(req, res)
    if not isAuthorized(req) then
        return sendJson(res, 403, { ok = false, error = 'unauthorized' })
    end

    if req.method == 'GET' and req.path:match('/health$') then
        return sendJson(res, 200, { ok = true, version = 2, resource = RESOURCE, players = #GetPlayers() })
    end
    if req.method == 'GET' and req.path:match('/players$') then
        local result = {}
        for _, source in ipairs(GetPlayers()) do result[#result + 1] = playerData(source) end
        return sendJson(res, 200, result)
    end
    if req.method == 'GET' and req.path:match('/bans$') then
        return sendJson(res, 200, bans)
    end
    if req.method == 'GET' and req.path:match('/resources$') then
        return sendJson(res, 200, resourceData())
    end

    req.setDataHandler(function(body)
        local payload = json.decode(body or '{}') or {}
        if req.method == 'POST' and req.path:match('/announce$') then
            local message = tostring(payload.message or ''):sub(1, 500)
            if message == '' then return sendJson(res, 400, { ok = false, error = 'message required' }) end
            announce(message)
            return sendJson(res, 200, { ok = true })
        end

        if req.method == 'POST' and req.path:match('/restart$') then
            local delay = math.max(5, math.min(300, tonumber(payload.delay) or 15))
            local reason = tostring(payload.reason or 'WOLFHQ desktop restart'):sub(1, 180)
            announce(('Server restart in %d seconds. %s'):format(delay, reason))
            sendJson(res, 200, { ok = true, delay = delay })
            CreateThread(function()
                Wait(delay * 1000)
                ExecuteCommand('quit ' .. reason:gsub('[\\r\\n"]', ' '))
            end)
            return
        end

        if req.method == 'POST' and req.path:match('/resource$') then
            local name = tostring(payload.name or ''):gsub('[^%w_%-%.%[%]]', '')
            local action = tostring(payload.action or '')
            if name == '' then return sendJson(res, 400, { ok = false, error = 'resource required' }) end
            if action == 'restart' then
                ExecuteCommand('stop ' .. name)
                Wait(250)
                ExecuteCommand('ensure ' .. name)
            elseif action == 'start' or action == 'ensure' or action == 'stop' then
                ExecuteCommand(action .. ' ' .. name)
            else
                return sendJson(res, 400, { ok = false, error = 'invalid resource action' })
            end
            return sendJson(res, 200, { ok = true, name = name, action = action })
        end

        if req.method == 'POST' and req.path:match('/command$') then
            local command = tostring(payload.command or ''):gsub('[\\r\\n]', ''):sub(1, 300)
            if command == '' then return sendJson(res, 400, { ok = false, error = 'command required' }) end
            ExecuteCommand(command)
            return sendJson(res, 200, { ok = true, command = command })
        end

        if req.method == 'POST' and req.path:match('/player$') then
            local source = tonumber(payload.id)
            local action = tostring(payload.action or '')
            local reason = tostring(payload.reason or 'WOLFHQ administration'):gsub('[\\r\\n]', ' '):sub(1, 180)
            if not source then return sendJson(res, 400, { ok = false, error = 'player id required' }) end
            if GetPlayerName(source) == nil then return sendJson(res, 404, { ok = false, error = 'player not found' }) end
            if action == 'ban' then
                bans[#bans + 1] = {
                    name = GetPlayerName(source),
                    identifiers = GetPlayerIdentifiers(source),
                    reason = reason,
                    createdAt = os.date('!%Y-%m-%dT%H:%M:%SZ')
                }
                SaveResourceFile(RESOURCE, BANS_FILE, json.encode(bans), -1)
                DropPlayer(source, 'Banned by WOLFHQ: ' .. reason)
            elseif action == 'kick' then
                DropPlayer(source, reason)
            else
                return sendJson(res, 400, { ok = false, error = 'invalid player action' })
            end
            return sendJson(res, 200, { ok = true, action = action })
        end

        return sendJson(res, 404, { ok = false, error = 'route not found' })
    end)
end)

print('[WOLFHQ] Desktop control bridge ready.')
`;
  return { manifest, serverScript };
}

async function installControlBridge() {
  if (activeMode === "remote") {
    const files = controlBridgeFiles();
    const result = await remoteServer.installControlBridge(files.manifest, files.serverScript);
    activeProject = await remoteServer.scan();
    try {
      const health = await remoteServer.callControl("health", null, "GET");
      if (health?.ok) {
        await remoteServer.callControl("command", { command: "restart wolfhq-control" }).catch(() => {});
        return { ...result, requiresServerRestart: false, running: true, restarted: true };
      }
    } catch {}
    return result;
  }
  const paths = getControlPaths();
  await fs.mkdir(paths.resourceRoot, { recursive: true });
  try {
    await fs.readFile(paths.tokenPath, "utf8");
  } catch {
    const token = crypto.randomBytes(32).toString("hex");
    await fs.writeFile(paths.tokenPath, `${token}\n`, "utf8");
  }
  const { manifest, serverScript } = controlBridgeFiles();
  await fs.writeFile(path.join(paths.resourceRoot, "fxmanifest.lua"), manifest, "utf8");
  await fs.writeFile(path.join(paths.resourceRoot, "server.lua"), serverScript, "utf8");

  const serverCfg = await fs.readFile(paths.configPath, "utf8");
  const ensureLines = [];
  if (!/^\s*(?:ensure|start)\s+\[wolfhq\]\s*$/im.test(serverCfg)) ensureLines.push("ensure [wolfhq]");
  if (!/^\s*(?:ensure|start)\s+wolfhq-control\s*$/im.test(serverCfg)) ensureLines.push("ensure wolfhq-control");
  if (ensureLines.length) {
    const suffix = serverCfg.endsWith("\n") ? "" : "\n";
    await fs.writeFile(
      paths.configPath,
      `${serverCfg}${suffix}\n# WOLFHQ desktop command bridge\n${ensureLines.join("\n")}\n`,
      "utf8"
    );
  }
  activeProject = await scanDirectory(activeRoot);
  activeProject.mode = "local";
  try {
    const health = await callControl(endpointFromConfig(), "health", null, "GET");
    if (health?.ok) {
      await callControl(endpointFromConfig(), "command", { command: "restart wolfhq-control" }).catch(() => {});
      return { ok: true, resourcePath: paths.resourceRoot, requiresServerRestart: false, running: true, restarted: true };
    }
  } catch {}
  return { ok: true, resourcePath: paths.resourceRoot, requiresServerRestart: true, running: false };
}

async function callControl(endpoint, route, payload, method = "POST") {
  if (activeMode === "remote") {
    return remoteServer.callControl(route, payload, method);
  }
  const token = await readControlToken();
  const baseUrl = normalizeEndpoint(endpoint || endpointFromConfig());
  return fetchJsonResult(`${baseUrl}/wolfhq-control/${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-wolfhq-token": token
    },
    body: method === "GET" ? undefined : JSON.stringify(payload || {}),
    timeout: 5000
  });
}

async function getCurrentStatus(endpoint) {
  if (activeMode === "remote") return remoteServer.getStatus();
  const requested = normalizeEndpoint(endpoint);
  const configured = endpointFromConfig();
  const candidates = [...new Set([requested, configured].filter(Boolean))];
  let lastError;
  for (const candidate of candidates) {
    try {
      return await probeServer(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  return {
    online: false,
    endpoint: requested,
    error: lastError?.message || "Server unavailable",
    players: [],
    playerCount: 0,
    maxPlayers: activeProject?.config?.maxClients || 0,
    process: null
  };
}

async function runCrashMonitor() {
  if (!activeProject) return;
  const ops = getOpsManager();
  const settings = await ops.getSettings();
  const status = await getCurrentStatus(activeProject.config?.port ? `http://127.0.0.1:${activeProject.config.port}` : "");
  await ops.recordTelemetry(status);

  if (settings.crashDetection && ops.lastOnline === true && !status.online) {
    await ops.audit("crash.detected", { server: activeProject.name });
    if (/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//i.test(settings.discordWebhook)) {
      fetch(settings.discordWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `WOLFHQ detected that **${activeProject.name}** went offline at ${new Date().toLocaleString()}.` })
      }).catch(() => {});
    }
    if (settings.autoRestart && settings.restartCommand) {
      try {
        if (activeMode === "remote") {
          await remoteServer.exec(settings.restartCommand, 30000);
        } else {
          await execFileAsync("powershell.exe", ["-NoProfile", "-Command", settings.restartCommand], { windowsHide: true, timeout: 30000 });
        }
        await ops.audit("crash.restart-command", { command: settings.restartCommand });
      } catch (error) {
        await ops.audit("crash.restart-failed", { error: error.message });
      }
    }
  }
  ops.lastOnline = Boolean(status.online);

  const scheduleMs = settings.backupSchedule === "hourly" ? 60 * 60 * 1000
    : settings.backupSchedule === "daily" ? 24 * 60 * 60 * 1000
      : 0;
  if (scheduleMs && Date.now() - lastScheduledBackupAt >= scheduleMs) {
    lastScheduledBackupAt = Date.now();
    ops.createBackup("scheduled").catch((error) => ops.audit("backup.scheduled-failed", { error: error.message }));
  }
}

async function findLatestLog(rootPath) {
  const candidates = [];
  async function walk(directory, depth = 0) {
    if (depth > 5) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name.toLowerCase())) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else if (entry.name.toLowerCase().endsWith(".log")) {
        try {
          const stat = await fs.stat(fullPath);
          candidates.push({ path: fullPath, mtime: stat.mtimeMs, size: stat.size });
        } catch {}
      }
    }
  }
  await walk(rootPath);
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0] || null;
}

async function connectRemoteProfile(input, options = {}) {
  const profiles = await readProfiles();
  const stored = input.id ? profiles.find((profile) => profile.id === input.id) : null;
  const profile = {
    ...stored,
    ...input,
    id: input.id || crypto.randomUUID(),
    name: String(input.name || input.host || "Remote FiveM").trim(),
    host: String(input.host || "").trim(),
    port: Number(input.port) || 22,
    username: String(input.username || "").trim(),
    rootPath: normalizeRemotePath(input.rootPath),
    authType: input.authType === "key" ? "key" : "password",
    privateKeyPath: String(input.privateKeyPath || stored?.privateKeyPath || "").trim(),
    fiveMPort: Number(input.fiveMPort) || Number(stored?.fiveMPort) || 30120,
    fingerprint: options.acceptFingerprint || input.fingerprint || stored?.fingerprint || ""
  };
  delete profile.hasSavedSecret;
  if (!profile.host || !profile.username || !isAbsoluteRemotePath(profile.rootPath)) {
    throw new Error("Remote host, username, and an absolute Linux or Windows server root path are required.");
  }

  let secret = String(options.secret || "");
  if (!secret && stored?.encryptedSecret) secret = decryptSecret(stored.encryptedSecret);
  const credentials = {};
  if (profile.authType === "key") {
    if (!profile.privateKeyPath) throw new Error("Select an SSH private key.");
    credentials.privateKey = await fs.readFile(profile.privateKeyPath);
    credentials.passphrase = secret;
  } else {
    if (!secret) throw new Error("Enter the SSH password.");
    credentials.password = secret;
  }

  const nextRemote = new RemoteServer(profile, credentials);
  const connection = await nextRemote.connect({ acceptedFingerprint: options.acceptFingerprint });
  if (!connection.connected) {
    nextRemote.disconnect();
    return connection;
  }

  let project;
  try {
    project = await nextRemote.scan();
  } catch (error) {
    nextRemote.disconnect();
    throw new Error(`SSH connected, but the server root could not be scanned: ${error.message}`);
  }

  remoteServer?.disconnect();
  remoteServer = nextRemote;
  activeMode = "remote";
  activeRoot = project.rootPath;
  activeProject = project;
  profile.fingerprint = connection.fingerprint;
  if (options.rememberSecret && secret) profile.encryptedSecret = encryptSecret(secret);
  else if (stored?.encryptedSecret && options.rememberSecret !== false) profile.encryptedSecret = stored.encryptedSecret;
  else delete profile.encryptedSecret;

  const nextProfiles = profiles.filter((candidate) => candidate.id !== profile.id);
  nextProfiles.push(profile);
  await writeProfiles(nextProfiles);
  await fs.writeFile(sessionPath(), JSON.stringify({ mode: "remote", profileId: profile.id }), "utf8");
  return { connected: true, project, profile: publicProfile(profile) };
}

ipcMain.handle("remote:profiles", async () => (await readProfiles()).map(publicProfile));

ipcMain.handle("remote:choose-key", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select SSH private key",
    properties: ["openFile"]
  });
  return result.canceled ? "" : result.filePaths[0] || "";
});

ipcMain.handle("remote:connect", async (_event, request) => {
  if (remoteConnectPromise) {
    throw new Error("A remote connection is already in progress.");
  }
  remoteConnectPromise = connectRemoteProfile(request.profile || {}, {
    secret: request.secret,
    rememberSecret: request.rememberSecret,
    acceptFingerprint: request.acceptFingerprint
  });
  try {
    return await remoteConnectPromise;
  } finally {
    remoteConnectPromise = null;
  }
});

ipcMain.handle("remote:delete-profile", async (_event, profileId) => {
  const profiles = await readProfiles();
  await writeProfiles(profiles.filter((profile) => profile.id !== profileId));
  return { ok: true };
});

ipcMain.handle("remote:disconnect", async () => {
  remoteServer?.disconnect();
  remoteServer = null;
  activeMode = "local";
  activeProject = null;
  activeRoot = null;
  return { ok: true };
});

ipcMain.handle("project:choose", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select your FiveM server folder",
    properties: ["openDirectory"]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  remoteServer?.disconnect();
  remoteServer = null;
  activeMode = "local";
  activeRoot = path.resolve(result.filePaths[0]);
  await fs.writeFile(path.join(app.getPath("userData"), "recent-project.txt"), activeRoot, "utf8");
  await fs.writeFile(sessionPath(), JSON.stringify({ mode: "local", rootPath: activeRoot }), "utf8");
  activeProject = await scanDirectory(activeRoot);
  activeProject.mode = "local";
  return activeProject;
});

ipcMain.handle("project:recent", async () => {
  if (recentProjectPromise) return recentProjectPromise;
  recentProjectPromise = (async () => {
    try {
      const session = JSON.parse(await fs.readFile(sessionPath(), "utf8"));
      if (session.mode === "remote" && session.profileId) {
        const profile = (await readProfiles()).find((candidate) => candidate.id === session.profileId);
        if (!profile?.encryptedSecret && profile?.authType !== "key") return null;
        const result = await connectRemoteProfile(profile, { rememberSecret: true });
        return result.connected ? result.project : null;
      }
      const recentPath = session.rootPath || (await fs.readFile(path.join(app.getPath("userData"), "recent-project.txt"), "utf8")).trim();
      if (!recentPath) return null;
      const stat = await fs.stat(recentPath);
      if (!stat.isDirectory()) return null;
      activeRoot = path.resolve(recentPath);
      activeMode = "local";
      activeProject = await scanDirectory(activeRoot);
      activeProject.mode = "local";
      return activeProject;
    } catch {
      try {
        const recentPath = (await fs.readFile(path.join(app.getPath("userData"), "recent-project.txt"), "utf8")).trim();
        if (!recentPath) return null;
        activeRoot = path.resolve(recentPath);
        activeMode = "local";
        activeProject = await scanDirectory(activeRoot);
        activeProject.mode = "local";
        return activeProject;
      } catch {
        return null;
      }
    }
  })();
  try {
    return await recentProjectPromise;
  } finally {
    recentProjectPromise = null;
  }
});

ipcMain.handle("project:scan", async (_event, rootPath) => {
  if (activeMode === "remote") {
    activeProject = await remoteServer.scan();
    return activeProject;
  }
  if (!activeRoot || path.resolve(rootPath) !== activeRoot) {
    throw new Error("Select the server folder through the folder picker first.");
  }
  activeProject = await scanDirectory(activeRoot);
  activeProject.mode = "local";
  return activeProject;
});

ipcMain.handle("file:read", async (_event, filePath) => {
  if (activeMode === "remote") return remoteServer.readFile(filePath);
  const safePath = requireSafePath(filePath);
  const stat = await fs.stat(safePath);
  if (stat.size > MAX_TEXT_FILE_SIZE) throw new Error("This file is too large to edit in the command center.");
  if (!isTextFile(safePath)) throw new Error("This file type is preview-only.");
  return { path: safePath, content: await fs.readFile(safePath, "utf8"), size: stat.size };
});

ipcMain.handle("file:save", async (_event, filePath, content) => {
  await getOpsManager().ensurePreEditBackup(filePath);
  if (activeMode === "remote") return remoteServer.writeFile(filePath, content);
  const safePath = requireSafePath(filePath);
  await fs.writeFile(safePath, String(content), "utf8");
  return { ok: true, path: safePath, savedAt: new Date().toISOString() };
});

ipcMain.handle("file:create", async (_event, options) => {
  if (activeMode === "remote") return remoteServer.createFile(options);
  const parentPath = requireSafePath(options.parentPath);
  const cleanName = path.basename(String(options.name || "").trim());
  if (!cleanName) throw new Error("Enter a file name.");
  const filePath = requireSafePath(path.join(parentPath, cleanName));
  await fs.writeFile(filePath, String(options.content || ""), { encoding: "utf8", flag: "wx" });
  return { ok: true, path: filePath };
});

ipcMain.handle("resource:create", async (_event, options) => {
  if (activeMode === "remote") return remoteServer.createResource(options);
  const parentPath = requireSafePath(options.parentPath);
  const resourceName = String(options.name || "").trim().replace(/[^a-zA-Z0-9_-]/g, "-");
  if (!resourceName) throw new Error("Enter a valid resource name.");
  const resourcePath = requireSafePath(path.join(parentPath, resourceName));
  await fs.mkdir(resourcePath, { recursive: false });

  const author = String(options.author || "WOLFHQ").replace(/'/g, "\\'");
  const description = String(options.description || "Custom FiveM resource").replace(/'/g, "\\'");
  const includeClient = options.includeClient !== false;
  const includeServer = options.includeServer !== false;
  const framework = String(options.framework || "Standalone");
  const dependencies = [];
  if (framework === "QBCore") dependencies.push("qb-core");
  if (framework === "Qbox") dependencies.push("qbx_core");
  if (framework === "ESX") dependencies.push("es_extended");

  const manifest = [
    "fx_version 'cerulean'",
    "game 'gta5'",
    "",
    `author '${author}'`,
    `description '${description}'`,
    "version '1.0.0'",
    "",
    "shared_script 'config.lua'",
    includeClient ? "client_script 'client.lua'" : null,
    includeServer ? "server_script 'server.lua'" : null,
    dependencies.length ? "" : null,
    ...dependencies.map((dependency) => `dependency '${dependency}'`)
  ].filter((line) => line !== null).join("\n") + "\n";

  const frameworkHeader = {
    QBCore: "local QBCore = exports['qb-core']:GetCoreObject()\n",
    Qbox: "-- Qbox APIs are available through exports and ox_lib modules.\n",
    ESX: "local ESX = exports['es_extended']:getSharedObject()\n",
    Standalone: ""
  }[framework] || "";

  await fs.writeFile(path.join(resourcePath, "fxmanifest.lua"), manifest, "utf8");
  await fs.writeFile(path.join(resourcePath, "config.lua"), "Config = {}\n\nConfig.Debug = false\n", "utf8");
  if (includeClient) {
    await fs.writeFile(path.join(resourcePath, "client.lua"), `${frameworkHeader}\nCreateThread(function()\n    print('[${resourceName}] client initialized')\nend)\n`, "utf8");
  }
  if (includeServer) {
    await fs.writeFile(path.join(resourcePath, "server.lua"), `${frameworkHeader}\nCreateThread(function()\n    print('[${resourceName}] server initialized')\nend)\n`, "utf8");
  }
  return { ok: true, path: resourcePath };
});

ipcMain.handle("resource:delete", async (_event, resourcePath) => {
  await getOpsManager().assertPermission("resource");
  await getOpsManager().createBackup("pre-resource-delete");
  if (activeMode === "remote") {
    const result = await remoteServer.deleteResource(resourcePath);
    activeProject = await remoteServer.scan();
    await getOpsManager().audit("resource.deleted", { name: result.name, path: result.path, mode: "remote" });
    return { ...result, project: activeProject };
  }
  const { resource, target } = requireKnownResourcePath(resourcePath);
  await fs.rm(target, { recursive: true, force: false });
  activeProject = await scanDirectory(activeRoot);
  activeProject.mode = "local";
  await getOpsManager().audit("resource.deleted", { name: resource.name, path: target, mode: "local" });
  return { ok: true, name: resource.name, path: target, project: activeProject };
});

ipcMain.handle("folder:delete", async (_event, folderPath) => {
  await getOpsManager().assertPermission("resource");
  await getOpsManager().createBackup("pre-folder-delete");
  if (activeMode === "remote") {
    const result = await remoteServer.deleteFolder(folderPath);
    activeProject = await remoteServer.scan();
    await getOpsManager().audit("folder.deleted", { name: result.name, path: result.path, mode: "remote" });
    return { ...result, project: activeProject };
  }
  const target = await requireSafeFolderPath(folderPath);
  await fs.rm(target, { recursive: true, force: false });
  activeProject = await scanDirectory(activeRoot);
  activeProject.mode = "local";
  await getOpsManager().audit("folder.deleted", { name: path.basename(target), path: target, mode: "local" });
  return { ok: true, name: path.basename(target), path: target, project: activeProject };
});

ipcMain.handle("folder:upload", async (_event, destinationPath) => {
  await getOpsManager().assertPermission("resource");
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose folder to upload into this server",
    properties: ["openDirectory"]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const sourceFolder = result.filePaths[0];
  if (activeMode === "remote") {
    const upload = await remoteServer.uploadFolder(sourceFolder, destinationPath);
    activeProject = await remoteServer.scan();
    await getOpsManager().audit("folder.uploaded", { name: upload.name, path: upload.path, mode: "remote" });
    return { ...upload, project: activeProject };
  }
  const target = await copyFolderInto(sourceFolder, destinationPath);
  activeProject = await scanDirectory(activeRoot);
  activeProject.mode = "local";
  await getOpsManager().audit("folder.uploaded", { name: path.basename(target), path: target, mode: "local" });
  return { ok: true, name: path.basename(target), path: target, project: activeProject };
});

ipcMain.handle("server:status", async (_event, endpoint) => {
  return getCurrentStatus(endpoint);
});

ipcMain.handle("server:logs", async () => {
  if (activeMode === "remote") return remoteServer.getLogs();
  if (!activeRoot) throw new Error("Select a server folder first.");
  const log = await findLatestLog(activeRoot);
  if (!log) return { path: "", lines: ["No server log was found in the selected folder."] };
  try {
    const handle = await fs.open(log.path, "r");
    const readSize = Math.min(log.size, 220 * 1024);
    const buffer = Buffer.alloc(readSize);
    await handle.read(buffer, 0, readSize, Math.max(0, log.size - readSize));
    await handle.close();
    return { path: log.path, lines: buffer.toString("utf8").split(/\r?\n/).slice(-500) };
  } catch {
    return { path: log.path, lines: ["The latest log could not be read."] };
  }
});

ipcMain.handle("control:install", () => installControlBridge());
ipcMain.handle("control:status", async (_event, endpoint) => {
  try {
    const data = await callControl(endpoint, "health", null, "GET");
    return { installed: true, running: Boolean(data.ok), ...data };
  } catch (error) {
    let installed = false;
    try {
      if (activeMode === "remote") await remoteServer.readControlToken();
      else await readControlToken();
      installed = true;
    } catch {}
    return { installed, running: false, error: error.message };
  }
});
ipcMain.handle("control:announce", (_event, endpoint, message) =>
  callControl(endpoint, "announce", { message: String(message || "").trim() })
);
ipcMain.handle("control:restart", (_event, endpoint, options) =>
  callControl(endpoint, "restart", {
    delay: Number(options?.delay) || 15,
    reason: String(options?.reason || "Restart requested from WOLFHQ desktop")
  })
);

ipcMain.handle("ops:dashboard", () => getOpsManager().getDashboard());
ipcMain.handle("ops:telemetry", (_event, status) => getOpsManager().recordTelemetry(status || {}));
ipcMain.handle("ops:fleet", async () => {
  const profiles = (await readProfiles()).map(publicProfile);
  return profiles.map((profile) => ({
    ...profile,
    active: activeMode === "remote" && activeProject?.connectionName === profile.name,
    status: activeMode === "remote" && activeProject?.connectionName === profile.name ? "connected" : "saved"
  }));
});
ipcMain.handle("resource:states", async (_event, endpoint) => {
  try {
    return await callControl(endpoint, "resources", null, "GET");
  } catch {
    return (activeProject?.resources || []).map((resource) => ({ name: resource.name, state: "unknown" }));
  }
});
ipcMain.handle("resource:action", (_event, endpoint, name, action) =>
  getOpsManager().resourceAction(endpoint, name, action)
);
ipcMain.handle("catalog:list", (_event, force) => getResourceCatalogManager().list(Boolean(force)));
ipcMain.handle("catalog:install", (_event, resourceId) => getResourceCatalogManager().install(resourceId));
ipcMain.handle("console:command", (_event, endpoint, command) =>
  getOpsManager().consoleCommand(endpoint, command)
);
ipcMain.handle("players:details", async (_event, endpoint) => {
  let players = [];
  let bans = [];
  try {
    players = await callControl(endpoint, "players", null, "GET");
    bans = await callControl(endpoint, "bans", null, "GET").catch(() => []);
  } catch {
    players = (await getCurrentStatus(endpoint)).players || [];
  }
  return getOpsManager().enrichPlayers(Array.isArray(players) ? players : [], Array.isArray(bans) ? bans : []);
});
ipcMain.handle("player:action", (_event, endpoint, options) =>
  getOpsManager().playerAction(endpoint, options || {})
);
ipcMain.handle("player:note", (_event, key, note) => getOpsManager().savePlayerNote(key, note));
ipcMain.handle("backup:list", () => getOpsManager().listBackups());
ipcMain.handle("backup:create", (_event, label) => getOpsManager().createBackup(label));
ipcMain.handle("backup:restore", (_event, backupPath) => getOpsManager().restoreBackup(backupPath));
ipcMain.handle("git:action", (_event, options) => getOpsManager().gitAction(options || {}));
ipcMain.handle("database:tables", (_event, config) => getOpsManager().databaseTables(config || {}));
ipcMain.handle("database:rows", (_event, config, table) => getOpsManager().databaseRows(config || {}, table));
ipcMain.handle("database:update", (_event, config, input) => getOpsManager().databaseUpdate(config || {}, input || {}));
ipcMain.handle("accounts:list", () => getOpsManager().getAccounts());
ipcMain.handle("accounts:create", (_event, input) => getOpsManager().createAccount(input || {}));
ipcMain.handle("accounts:login", (_event, input) => getOpsManager().login(input || {}));
ipcMain.handle("accounts:delete", (_event, id) => getOpsManager().deleteAccount(id));
ipcMain.handle("ops:settings", () => getOpsManager().getSettings());
ipcMain.handle("ops:update-settings", (_event, input) => getOpsManager().updateSettings(input || {}));
ipcMain.handle("ai:settings", () => getAiManager().getSettings());
ipcMain.handle("ai:save-settings", async (_event, input) => {
  await getOpsManager().assertPermission("ai");
  return getAiManager().saveSettings(input || {});
});
ipcMain.handle("ai:models", async () => {
  await getOpsManager().assertPermission("ai");
  return getAiManager().listModels();
});
ipcMain.handle("ai:search", async (_event, query) => {
  await getOpsManager().assertPermission("ai");
  return getAiManager().search(query);
});
ipcMain.handle("ai:propose", async (_event, prompt) => {
  await getOpsManager().assertPermission("ai");
  return getAiManager().propose(prompt);
});
ipcMain.handle("ai:apply", async (_event, changes) => {
  await getOpsManager().assertPermission("ai");
  return getAiManager().apply(changes);
});

ipcMain.handle("updater:settings", async () => publicUpdaterSettings(await readUpdaterSettings()));
ipcMain.handle("updater:save-settings", (_event, input) => saveUpdaterSettings(input || {}));
ipcMain.handle("updater:check", (_event, input) => checkForGithubUpdate(input || {}));
ipcMain.handle("updater:download", (_event, input) => downloadGithubUpdate(input || {}));

ipcMain.handle("external:open", async (_event, url) => {
  if (!/^https?:\/\//i.test(url)) throw new Error("Unsupported URL.");
  await shell.openExternal(url);
});

ipcMain.on("window:minimize", () => mainWindow?.minimize());
ipcMain.on("window:maximize", () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
ipcMain.on("window:close", () => mainWindow?.close());

app.whenReady().then(async () => {
  app.setAppUserModelId("com.wolfstudios.wolfhq");
  const installArgIndex = process.argv.indexOf("--install-bridge");
  if (installArgIndex !== -1 && process.argv[installArgIndex + 1]) {
    try {
      activeRoot = path.resolve(process.argv[installArgIndex + 1]);
      activeMode = "local";
      await fs.writeFile(path.join(app.getPath("userData"), "recent-project.txt"), activeRoot, "utf8");
      activeProject = await scanDirectory(activeRoot);
      activeProject.mode = "local";
      const result = await installControlBridge();
      console.log(JSON.stringify(result));
      app.exit(0);
    } catch (error) {
      console.error(error.message);
      app.exit(1);
    }
    return;
  }
  createSplashWindow();
  createWindow();
  monitorTimer = setInterval(() => runCrashMonitor().catch(() => {}), 15000);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createSplashWindow();
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (monitorTimer) clearInterval(monitorTimer);
  remoteServer?.disconnect();
  if (process.platform !== "darwin") app.quit();
});
