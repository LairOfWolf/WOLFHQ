const { Client } = require("ssh2");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const localPath = require("node:path");
const path = require("node:path").posix;
const { detectAntiCheats } = require("./anticheat.cjs");
const { patchNekoAntiCheatConfig, patchNekoResourceGuard, removeNekoResourceGuard } = require("./neko-ac.cjs");

const TEXT_EXTENSIONS = new Set([
  ".lua", ".cfg", ".json", ".js", ".jsx", ".ts", ".tsx", ".html", ".css",
  ".scss", ".md", ".txt", ".xml", ".yml", ".yaml", ".toml", ".ini", ".sql",
  ".env", ".gitignore", ".fxap"
]);
const SKIP_DIRECTORIES = new Set([".git", "node_modules", "cache", ".cache", "dist", "build"]);
const MAX_TEXT_FILE_SIZE = 5 * 1024 * 1024;
const MAX_SCAN_ENTRIES = 60000;
const CONTROL_BRIDGE_ACES = [
  "add_ace resource.wolfhq-control command.quit allow",
  "add_ace resource.wolfhq-control command.restart allow",
  "add_ace resource.wolfhq-control command.start allow",
  "add_ace resource.wolfhq-control command.stop allow",
  "add_ace resource.wolfhq-control command.ensure allow"
];
const ARTIFACT_RUNTIME_ENTRIES = [
  "FXServer.exe", "FXServer", "run.sh", "citizen", "alpine", "components.json", "server-monitor.json"
];

function patchControlBridgeConfig(serverCfg) {
  const missingAces = CONTROL_BRIDGE_ACES.filter((line) => {
    const [, principal, object] = line.split(/\s+/);
    return !new RegExp(`^\\s*add_ace\\s+${principal.replace(".", "\\.")}\\s+${object.replace(".", "\\.")}\\s+allow\\s*$`, "im").test(serverCfg);
  });
  const ensureLines = [];
  if (!/^\s*(?:ensure|start)\s+\[wolfhq\]\s*$/im.test(serverCfg)) ensureLines.push("ensure [wolfhq]");
  if (!/^\s*(?:ensure|start)\s+wolfhq-control\s*$/im.test(serverCfg)) ensureLines.push("ensure wolfhq-control");
  if (!missingAces.length && !ensureLines.length) return { content: serverCfg, changed: false };
  const prefix = missingAces.length
    ? `# WOLFHQ desktop command bridge permissions\n${missingAces.join("\n")}\n\n`
    : "";
  const suffix = ensureLines.length
    ? `${serverCfg.endsWith("\n") ? "" : "\n"}\n# WOLFHQ desktop command bridge\n${ensureLines.join("\n")}\n`
    : "";
  return { content: `${prefix}${serverCfg}${suffix}`, changed: true };
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

function isTextFile(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  return TEXT_EXTENSIONS.has(extension) || !extension;
}

function parseServerConfig(serverCfg) {
  const getValue = (key) => {
    const match = serverCfg.match(new RegExp(`^\\s*(?:set|sets|setr)?\\s*${key}\\s+[\"']?([^\\r\\n\"']+)`, "im"));
    return match?.[1]?.trim() || "";
  };
  return {
    hostname: getValue("sv_hostname"),
    maxClients: Number(getValue("sv_maxclients")) || 0,
    projectName: getValue("sv_projectName"),
    locale: getValue("locale"),
    endpoint: getValue("endpoint_add_tcp") || getValue("endpoint_add_udp")
  };
}

function fingerprintKey(key) {
  return `SHA256:${crypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function describeSshError(error) {
  const message = String(error?.message || error || "Unknown SSH error");
  if (error?.code === "ECONNRESET" || /read ECONNRESET/i.test(message)) {
    return "The VPS reset the SSH connection. Check that SSH is running, the port is correct, and your firewall allows this PC.";
  }
  if (error?.code === "ETIMEDOUT" || /timed out/i.test(message)) {
    return "The SSH connection timed out. Check the VPS address, SSH port, and firewall rules.";
  }
  if (error?.code === "ECONNREFUSED") {
    return "The VPS refused the SSH connection. Check that the SSH service is running on the selected port.";
  }
  if (/connection lost before handshake/i.test(message)) {
    return "The VPS closed the connection before the SSH handshake completed. Check the SSH service, port, and firewall.";
  }
  if (/all configured authentication methods failed/i.test(message)) {
    return "SSH authentication failed. Check the username, password, or private key.";
  }
  return message;
}

function isTransientSshError(error) {
  const message = String(error?.message || error || "");
  return error?.code === "ECONNRESET"
    || error?.code === "ETIMEDOUT"
    || /ECONNRESET|reset the SSH connection|connection lost before handshake|closed the connection before the SSH handshake|timed out/i.test(message);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createTaskLimiter(limit) {
  let active = 0;
  const pending = [];
  const runNext = () => {
    if (active >= limit || pending.length === 0) return;
    const { task, resolve, reject } = pending.shift();
    active += 1;
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        runNext();
      });
  };
  return (task) => new Promise((resolve, reject) => {
    pending.push({ task, resolve, reject });
    runNext();
  });
}

async function closeSshClient(client) {
  if (!client) return;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, 1200);
    client.once("close", finish);
    try {
      client.end();
    } catch {
      finish();
    }
  });
}

function normalizeRemotePath(value) {
  const normalized = path.normalize(String(value || "").trim().replace(/\\/g, "/"));
  return normalized.replace(/^\/?([a-z]):\//i, (match, drive) => `${match.startsWith("/") ? "/" : ""}${drive.toUpperCase()}:/`);
}

function isWindowsRemotePath(value) {
  return /^\/?[a-z]:\//i.test(normalizeRemotePath(value));
}

function isAbsoluteRemotePath(value) {
  const normalized = normalizeRemotePath(value);
  return normalized.startsWith("/") || /^[a-z]:\//i.test(normalized);
}

function relativeRemotePath(rootPath, targetPath) {
  const root = normalizeRemotePath(rootPath);
  const target = normalizeRemotePath(targetPath);
  if (!isAbsoluteRemotePath(root) || !isAbsoluteRemotePath(target)) return null;

  const caseInsensitive = isWindowsRemotePath(root);
  const comparableRoot = caseInsensitive ? root.toLowerCase() : root;
  const comparableTarget = caseInsensitive ? target.toLowerCase() : target;
  if (comparableTarget === comparableRoot) return "";
  const prefix = comparableRoot.endsWith("/") ? comparableRoot : `${comparableRoot}/`;
  if (!comparableTarget.startsWith(prefix)) return null;
  return target.slice(prefix.length);
}

class RemoteServer {
  constructor(profile, credentials = {}) {
    this.profile = { ...profile };
    this.credentials = credentials;
    this.client = null;
    this.sftp = null;
    this.project = null;
    this.latestLogPath = "";
    this.connectionError = null;
  }

  async connect(options = {}) {
    const attempts = options.acceptedFingerprint ? 3 : 1;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.connectOnce(options);
      } catch (error) {
        lastError = error;
        if (attempt === attempts || !isTransientSshError(error)) throw error;
        await wait(600 * attempt);
      }
    }
    throw lastError;
  }

  async connectOnce({ acceptedFingerprint } = {}) {
    const client = new Client();
    let observedFingerprint = "";
    let connecting = true;
    let rejectConnection = null;
    const expectedFingerprint = acceptedFingerprint || this.profile.fingerprint || "";
    const recordClientError = (error) => {
      this.connectionError = error;
      if (connecting && rejectConnection) {
        connecting = false;
        rejectConnection(error);
      }
    };
    client.on("error", recordClientError);
    client.on("close", () => {
      if (this.client === client) {
        this.sftp = null;
        this.client = null;
      }
    });
    const config = {
      host: this.profile.host,
      port: Number(this.profile.port) || 22,
      username: this.profile.username,
      readyTimeout: 15000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
      hostVerifier: (key) => {
        observedFingerprint = fingerprintKey(key);
        return Boolean(expectedFingerprint && observedFingerprint === expectedFingerprint);
      }
    };

    if (this.profile.authType === "key") {
      config.privateKey = this.credentials.privateKey;
      if (this.credentials.passphrase) config.passphrase = this.credentials.passphrase;
    } else {
      config.password = this.credentials.password;
    }

    try {
      await new Promise((resolve, reject) => {
        rejectConnection = reject;
        client.once("ready", () => {
          connecting = false;
          resolve();
        });
        client.connect(config);
      });
    } catch (error) {
      await closeSshClient(client);
      if (observedFingerprint && (!expectedFingerprint || observedFingerprint !== expectedFingerprint)) {
        return {
          connected: false,
          requiresTrust: true,
          fingerprint: observedFingerprint,
          changed: Boolean(expectedFingerprint)
        };
      }
      throw new Error(describeSshError(error));
    }

    this.client = client;
    try {
      this.sftp = await new Promise((resolve, reject) => {
        client.sftp((error, sftp) => error ? reject(error) : resolve(sftp));
      });
    } catch (error) {
      this.disconnect();
      throw new Error(`SSH connected, but SFTP could not start: ${describeSshError(error)}`);
    }
    const sftp = this.sftp;
    sftp.on("error", (error) => {
      this.connectionError = error;
      if (this.sftp === sftp) this.sftp = null;
    });
    sftp.on("close", () => {
      if (this.sftp === sftp) this.sftp = null;
    });
    this.connectionError = null;
    this.profile.fingerprint = observedFingerprint || expectedFingerprint;
    return { connected: true, fingerprint: this.profile.fingerprint };
  }

  disconnect() {
    const client = this.client;
    this.sftp = null;
    this.client = null;
    try {
      client?.end();
    } catch {}
  }

  requireConnected() {
    if (!this.client || !this.sftp) {
      const detail = this.connectionError ? ` ${describeSshError(this.connectionError)}` : "";
      throw new Error(`The remote SSH session is not connected.${detail}`);
    }
  }

  safePath(targetPath) {
    const root = normalizeRemotePath(this.profile.rootPath);
    const target = normalizeRemotePath(targetPath);
    if (!targetPath || relativeRemotePath(root, target) === null) {
      throw new Error("That path is outside the remote server root.");
    }
    return target;
  }

  async resolveRootPath() {
    const root = normalizeRemotePath(this.profile.rootPath);
    const candidates = isWindowsRemotePath(root) && !root.startsWith("/")
      ? [root, `/${root}`]
      : [root];
    let lastError;
    for (const candidate of candidates) {
      try {
        const stats = await this.stat(candidate);
        if (!stats.isDirectory()) throw new Error("The remote server root is not a directory.");
        this.profile.rootPath = candidate;
        return candidate;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("The remote server root could not be found.");
  }

  readdir(directory) {
    this.requireConnected();
    return new Promise((resolve, reject) => {
      this.sftp.readdir(directory, (error, list) => error ? reject(error) : resolve(list));
    });
  }

  stat(filePath) {
    this.requireConnected();
    return new Promise((resolve, reject) => {
      this.sftp.stat(filePath, (error, stats) => error ? reject(error) : resolve(stats));
    });
  }

  readFileRaw(filePath) {
    this.requireConnected();
    return new Promise((resolve, reject) => {
      this.sftp.readFile(filePath, (error, data) => error ? reject(error) : resolve(data));
    });
  }

  async readFile(filePath) {
    const safePath = this.safePath(filePath);
    const stats = await this.stat(safePath);
    if (stats.size > MAX_TEXT_FILE_SIZE) throw new Error("This remote file is too large to edit.");
    if (!isTextFile(safePath)) throw new Error("This remote file type is preview-only.");
    const data = await this.readFileRaw(safePath);
    return { path: safePath, content: data.toString("utf8"), size: stats.size };
  }

  writeFile(filePath, content, options = {}) {
    this.requireConnected();
    const safePath = this.safePath(filePath);
    return new Promise((resolve, reject) => {
      const flags = options.exclusive ? "wx" : "w";
      this.sftp.writeFile(safePath, String(content), { encoding: "utf8", flag: flags }, (error) => {
        if (error) reject(error);
        else resolve({ ok: true, path: safePath, savedAt: new Date().toISOString() });
      });
    });
  }

  uploadFile(localFile, remoteFile) {
    this.requireConnected();
    const safePath = this.safePath(remoteFile);
    return new Promise((resolve, reject) => {
      this.sftp.fastPut(localFile, safePath, (error) => {
        if (error) reject(error);
        else resolve({ ok: true, path: safePath });
      });
    });
  }

  mkdir(directory) {
    this.requireConnected();
    const safePath = this.safePath(directory);
    return new Promise((resolve, reject) => {
      this.sftp.mkdir(safePath, (error) => error ? reject(error) : resolve());
    });
  }

  async mkdirRecursive(directory) {
    const root = normalizeRemotePath(this.profile.rootPath);
    const target = this.safePath(directory);
    const relative = relativeRemotePath(root, target);
    if (relative === null) throw new Error("That path is outside the remote server root.");
    let current = root;
    for (const segment of relative.split("/").filter(Boolean)) {
      current = path.join(current, segment);
      try {
        await this.mkdir(current);
      } catch (error) {
        try {
          const stats = await this.stat(current);
          if (!stats.isDirectory()) throw error;
        } catch {
          throw error;
        }
      }
    }
  }

  async uploadFolder(sourceFolder, destinationFolder) {
    const sourceStats = await fs.stat(sourceFolder);
    if (!sourceStats.isDirectory()) throw new Error("Choose a folder to upload.");
    const destination = this.safePath(destinationFolder);
    const name = localPath.basename(sourceFolder);
    const target = this.safePath(path.join(destination, name));
    try {
      await this.stat(target);
      throw new Error(`A folder named ${name} already exists there.`);
    } catch (error) {
      if (error.code !== 2 && error.code !== "ENOENT" && !/no such file/i.test(error.message || "")) throw error;
    }
    await this.mkdirRecursive(target);
    const uploadTree = async (localDirectory, remoteDirectory) => {
      const entries = await fs.readdir(localDirectory, { withFileTypes: true });
      for (const entry of entries) {
        const localChild = localPath.join(localDirectory, entry.name);
        const remoteChild = path.join(remoteDirectory, entry.name);
        if (entry.isDirectory()) {
          await this.mkdirRecursive(remoteChild);
          await uploadTree(localChild, remoteChild);
        } else if (entry.isFile()) {
          await this.uploadFile(localChild, remoteChild);
        }
      }
    };
    await uploadTree(sourceFolder, target);
    return { ok: true, name, path: target };
  }

  async scan() {
    this.requireConnected();
    const rootPath = await this.resolveRootPath();
    const stats = { files: 0, folders: 0, resources: 0, bytes: 0, truncated: false };
    const resources = [];
    const resourcesRoots = [];
    const signals = [];
    const antiCheatResources = [];
    let config = {};
    let serverConfigText = "";
    let entriesSeen = 0;
    const limitedReaddir = createTaskLimiter(8);

    const walk = async (directory) => {
      if (entriesSeen >= MAX_SCAN_ENTRIES) {
        stats.truncated = true;
        return [];
      }
      let entries;
      try {
        entries = await limitedReaddir(() => this.readdir(directory));
      } catch {
        return [];
      }
      entries.sort((a, b) => Number(b.attrs.isDirectory()) - Number(a.attrs.isDirectory()) || a.filename.localeCompare(b.filename));
      const nodeTasks = [];
      for (const entry of entries) {
        if (entriesSeen++ >= MAX_SCAN_ENTRIES) {
          stats.truncated = true;
          break;
        }
        const name = entry.filename;
        if (name === "." || name === "..") continue;
        if (entry.attrs.isDirectory() && SKIP_DIRECTORIES.has(name.toLowerCase())) continue;
        const fullPath = path.join(directory, name);
        const relativePath = relativeRemotePath(rootPath, fullPath);
        if (relativePath === null) continue;
        nodeTasks.push((async () => {
          if (entry.attrs.isDirectory()) {
            stats.folders += 1;
            if (name.toLowerCase() === "resources") resourcesRoots.push(fullPath);
            const children = await walk(fullPath);
            return { name, path: fullPath, relativePath, type: "folder", children };
          }
          const size = Number(entry.attrs.size) || 0;
          stats.files += 1;
          stats.bytes += size;
          const lowerName = name.toLowerCase();
          if ((lowerName === "fxmanifest.lua" || lowerName === "__resource.lua") && size <= MAX_TEXT_FILE_SIZE) {
            stats.resources += 1;
            const resourceName = path.basename(directory);
            resources.push({ name: resourceName, path: directory, manifest: fullPath });
            signals.push(resourceName, relativePath);
            try {
              const manifestText = (await this.readFileRaw(fullPath)).toString("utf8").slice(0, 20000);
              signals.push(manifestText);
              antiCheatResources.push({ name: resourceName, path: directory, manifest: fullPath, manifestText });
            } catch {}
          }
          if (lowerName === "server.cfg" && size <= MAX_TEXT_FILE_SIZE) {
            try {
              const serverCfg = (await this.readFileRaw(fullPath)).toString("utf8");
              serverConfigText = serverCfg;
              signals.push(serverCfg);
              config = { ...parseServerConfig(serverCfg), path: fullPath };
            } catch {}
          }
          return { name, path: fullPath, relativePath, type: "file", size, editable: isTextFile(name) && size <= MAX_TEXT_FILE_SIZE };
        })());
      }
      return Promise.all(nodeTasks);
    };

    const tree = await walk(rootPath);
    const configuredPort = String(config.endpoint || "").match(/:(\d{2,5})/)?.[1] || this.profile.fiveMPort || 30120;
    this.project = {
      mode: "remote",
      connectionName: this.profile.name,
      remoteHost: this.profile.host,
      rootPath,
      name: this.profile.name || path.basename(rootPath),
      tree,
      resources,
      resourcesRoots,
      stats,
      config: { ...config, publicHost: this.profile.publicHost || this.profile.host, port: Number(configuredPort) },
      framework: detectFramework(signals),
      antiCheats: detectAntiCheats(antiCheatResources, serverConfigText)
    };
    return this.project;
  }

  async exec(command, timeout = 12000) {
    this.requireConnected();
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) reject(new Error("Remote command timed out."));
      }, timeout);
      this.client.exec(command, (error, stream) => {
        if (error) {
          clearTimeout(timer);
          reject(error);
          return;
        }
        let stdout = "";
        let stderr = "";
        stream.on("data", (data) => { stdout += data.toString(); });
        stream.stderr.on("data", (data) => { stderr += data.toString(); });
        stream.on("close", (code) => {
          settled = true;
          clearTimeout(timer);
          resolve({ code, stdout, stderr });
        });
      });
    });
  }

  async searchText(query, limit = 80) {
    this.requireConnected();
    const needle = String(query || "").trim();
    if (!needle) return [];
    const safeLimit = Math.max(1, Math.min(Number(limit) || 80, 200));
    if (this.isWindowsServer()) {
      const root = this.windowsShellPath(this.profile.rootPath);
      const extensions = [...TEXT_EXTENSIONS].map((extension) => powershellQuote(extension)).join(",");
      const command = `powershell -NoProfile -Command "$root=${powershellQuote(root)}; $pattern=${powershellQuote(needle)}; $extensions=@(${extensions}); $skip='\\\\(?:\\.git|node_modules|cache|\\.cache|dist|build)\\\\'; $matches=Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue | Where-Object {$_.Length -le ${MAX_TEXT_FILE_SIZE} -and $_.FullName -notmatch $skip -and ($extensions -contains $_.Extension.ToLower() -or -not $_.Extension)} | Select-String -SimpleMatch -Pattern $pattern -List | Select-Object -First ${safeLimit} | ForEach-Object {[pscustomobject]@{path=$_.Path;line=$_.LineNumber;snippet=$_.Line.Trim()}}; @($matches) | ConvertTo-Json -Compress"`;
      const result = await this.exec(command, 120000);
      if (result.code !== 0) throw new Error(result.stderr || "Remote file search failed.");
      if (!result.stdout.trim()) return [];
      const parsed = JSON.parse(result.stdout.trim());
      return (Array.isArray(parsed) ? parsed : [parsed]).map((match) => ({
        path: normalizeRemotePath(match.path),
        line: Number(match.line) || 0,
        snippet: String(match.snippet || "").slice(0, 500)
      }));
    }

    const root = normalizeRemotePath(this.profile.rootPath);
    const includes = [...TEXT_EXTENSIONS]
      .filter(Boolean)
      .map((extension) => `--include=${shellQuote(`*${extension}`)}`)
      .join(" ");
    const excludes = [...SKIP_DIRECTORIES].map((directory) => `--exclude-dir=${shellQuote(directory)}`).join(" ");
    const command = `grep -RInIF -m 1 ${includes} ${excludes} -- ${shellQuote(needle)} ${shellQuote(root)} 2>/dev/null | head -n ${safeLimit}`;
    const result = await this.exec(command, 120000);
    if (result.code > 1) throw new Error(result.stderr || "Remote file search failed.");
    return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const match = line.match(/^(.*?):(\d+):(.*)$/);
      return match ? { path: normalizeRemotePath(match[1]), line: Number(match[2]), snippet: match[3].trim().slice(0, 500) } : null;
    }).filter(Boolean);
  }

  isWindowsServer() {
    return isWindowsRemotePath(this.profile.rootPath);
  }

  windowsShellPath(value) {
    return normalizeRemotePath(value).replace(/^\/(?=[A-Z]:\/)/i, "").replace(/\//g, "\\");
  }

  forward(host, port) {
    this.requireConnected();
    return new Promise((resolve, reject) => {
      this.client.forwardOut("127.0.0.1", 0, host, Number(port), (error, stream) => error ? reject(error) : resolve(stream));
    });
  }

  async createBackup(label = "manual") {
    this.requireConnected();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (this.isWindowsServer()) {
      const root = this.windowsShellPath(this.profile.rootPath);
      const command = `powershell -NoProfile -Command "$root=${powershellQuote(root)}; $dir=Join-Path (Split-Path $root -Parent) '.wolfhq-backups'; New-Item -ItemType Directory -Path $dir -Force | Out-Null; $file=Join-Path $dir ${powershellQuote(`${stamp}-${label}.zip`)}; Compress-Archive -Path (Join-Path $root '*') -DestinationPath $file -Force; $item=Get-Item $file; [pscustomobject]@{name=$item.Name;path=$item.FullName;createdAt=$item.LastWriteTimeUtc.ToString('o');size=$item.Length;mode='remote'} | ConvertTo-Json -Compress"`;
      const result = await this.exec(command, 30 * 60 * 1000);
      if (result.code !== 0) throw new Error(result.stderr || "Remote backup failed.");
      return JSON.parse(result.stdout.trim());
    }
    const root = normalizeRemotePath(this.profile.rootPath);
    const backupDir = path.join(path.dirname(root), ".wolfhq-backups");
    const filePath = path.join(backupDir, `${stamp}-${label}.tar.gz`);
    const result = await this.exec(`mkdir -p ${shellQuote(backupDir)} && tar -czf ${shellQuote(filePath)} -C ${shellQuote(root)} . && stat -c '%n|%s|%Y' ${shellQuote(filePath)}`, 30 * 60 * 1000);
    if (result.code !== 0) throw new Error(result.stderr || "Remote backup failed.");
    const [name, size, seconds] = result.stdout.trim().split("|");
    return { name: path.basename(name), path: name, size: Number(size), createdAt: new Date(Number(seconds) * 1000).toISOString(), mode: "remote" };
  }

  async listBackups() {
    this.requireConnected();
    if (this.isWindowsServer()) {
      const root = this.windowsShellPath(this.profile.rootPath);
      const command = `powershell -NoProfile -Command "$dir=Join-Path (Split-Path ${powershellQuote(root)} -Parent) '.wolfhq-backups'; if(Test-Path $dir){@(Get-ChildItem $dir -File | Sort-Object LastWriteTimeUtc -Descending | ForEach-Object {[pscustomobject]@{name=$_.Name;path=$_.FullName;createdAt=$_.LastWriteTimeUtc.ToString('o');size=$_.Length;mode='remote'}}) | ConvertTo-Json -Compress}"`;
      const result = await this.exec(command, 20000);
      if (result.code !== 0) throw new Error(result.stderr || "Remote backups could not be listed.");
      if (!result.stdout.trim()) return [];
      const parsed = JSON.parse(result.stdout.trim());
      return Array.isArray(parsed) ? parsed : [parsed];
    }
    const root = normalizeRemotePath(this.profile.rootPath);
    const backupDir = path.join(path.dirname(root), ".wolfhq-backups");
    const result = await this.exec(`if [ -d ${shellQuote(backupDir)} ]; then find ${shellQuote(backupDir)} -maxdepth 1 -type f -name '*.tar.gz' -printf '%f|%p|%s|%T@\\n' | sort -t'|' -k4 -nr; fi`, 20000);
    if (result.code !== 0) throw new Error(result.stderr || "Remote backups could not be listed.");
    return result.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => {
      const [name, filePath, size, seconds] = line.split("|");
      return { name, path: filePath, size: Number(size), createdAt: new Date(Number(seconds) * 1000).toISOString(), mode: "remote" };
    });
  }

  async readArtifactMetadata() {
    const filePath = this.safePath(path.join(this.profile.rootPath, ".wolfhq-artifact.json"));
    try {
      return JSON.parse((await this.readFileRaw(filePath)).toString("utf8"));
    } catch {
      return null;
    }
  }

  async installArtifact(artifact) {
    this.requireConnected();
    const root = this.safePath(this.profile.rootPath);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const metadata = {
      platform: artifact.platform,
      build: artifact.build,
      installedAt: new Date().toISOString(),
      sourceUrl: artifact.url,
      installedBy: "WOLFHQ"
    };
    if (this.isWindowsServer()) {
      const runtimeList = ARTIFACT_RUNTIME_ENTRIES.map((entry) => powershellQuote(entry)).join(",");
      const command = `powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $root=${powershellQuote(this.windowsShellPath(root))}; $url=${powershellQuote(artifact.url)}; $stamp=${powershellQuote(stamp)}; $work=Join-Path $env:TEMP ('wolfhq-artifact-' + $stamp); $extract=Join-Path $work 'extract'; New-Item -ItemType Directory -Force -Path $extract | Out-Null; $archive=Join-Path $work 'server.7z'; Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $archive; & tar.exe -xf $archive -C $extract; if($LASTEXITCODE -ne 0){ throw 'Windows could not extract server.7z. Install 7-Zip or update Windows tar support on the VPS.' }; $backup=Join-Path (Join-Path $root '.wolfhq-artifacts\\backups') $stamp; New-Item -ItemType Directory -Force -Path $backup | Out-Null; $items=@(${runtimeList}); foreach($item in $items){ $source=Join-Path $root $item; if(Test-Path -LiteralPath $source){ Move-Item -LiteralPath $source -Destination (Join-Path $backup $item) -Force } }; Copy-Item -Path (Join-Path $extract '*') -Destination $root -Recurse -Force; ${powershellQuote(JSON.stringify(metadata))} | Set-Content -LiteralPath (Join-Path $root '.wolfhq-artifact.json') -Encoding UTF8; Remove-Item -LiteralPath $work -Recurse -Force; [pscustomobject]@{ok=$true;build=${Number(artifact.build)};backupPath=$backup;platform='windows'} | ConvertTo-Json -Compress"`;
      const result = await this.exec(command, 20 * 60 * 1000);
      if (result.code !== 0) throw new Error(result.stderr || result.stdout || "Remote artifact update failed.");
      return JSON.parse(result.stdout.trim());
    }

    const backupRoot = path.join(root, ".wolfhq-artifacts", "backups", stamp);
    const runtimeScript = ARTIFACT_RUNTIME_ENTRIES
      .map((entry) => `if [ -e ${shellQuote(path.join(root, entry))} ]; then mv ${shellQuote(path.join(root, entry))} ${shellQuote(path.join(backupRoot, entry))}; fi`)
      .join(" ");
    const command = `set -e; root=${shellQuote(root)}; stamp=${shellQuote(stamp)}; work=$(mktemp -d); extract="$work/extract"; mkdir -p "$extract" ${shellQuote(backupRoot)}; archive="$work/fx.tar.xz"; if command -v curl >/dev/null 2>&1; then curl -fL ${shellQuote(artifact.url)} -o "$archive"; else wget -O "$archive" ${shellQuote(artifact.url)}; fi; tar -xJf "$archive" -C "$extract"; ${runtimeScript}; cp -a "$extract"/. "$root"/; cat > "$root/.wolfhq-artifact.json" <<'WOLFHQ_ARTIFACT_META'\n${JSON.stringify(metadata, null, 2)}\nWOLFHQ_ARTIFACT_META\nrm -rf "$work"; printf '{"ok":true,"build":%s,"backupPath":%s,"platform":"linux"}' ${shellQuote(String(artifact.build))} ${shellQuote(JSON.stringify(backupRoot))}`;
    const result = await this.exec(command, 20 * 60 * 1000);
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || "Remote artifact update failed.");
    return JSON.parse(result.stdout.trim());
  }

  async restoreBackup(backupPath) {
    this.requireConnected();
    const backups = await this.listBackups();
    const backup = backups.find((candidate) => candidate.path === backupPath);
    if (!backup) throw new Error("That remote backup is no longer available.");
    if (this.isWindowsServer()) {
      const root = this.windowsShellPath(this.profile.rootPath);
      const command = `powershell -NoProfile -Command "Expand-Archive -Path ${powershellQuote(backup.path)} -DestinationPath ${powershellQuote(root)} -Force"`;
      const result = await this.exec(command, 30 * 60 * 1000);
      if (result.code !== 0) throw new Error(result.stderr || "Remote restore failed.");
      return { ok: true };
    }
    const result = await this.exec(`tar -xzf ${shellQuote(backup.path)} -C ${shellQuote(this.profile.rootPath)}`, 30 * 60 * 1000);
    if (result.code !== 0) throw new Error(result.stderr || "Remote restore failed.");
    return { ok: true };
  }

  async gitAction(targetPath, action) {
    const target = this.safePath(targetPath);
    const args = {
      status: "status --short --branch",
      pull: "pull --ff-only",
      rollback: "reset --hard HEAD@{1}"
    }[action];
    if (!args) throw new Error("Unsupported Git action.");
    let command;
    if (this.isWindowsServer()) {
      command = `powershell -NoProfile -Command "& git -C ${powershellQuote(this.windowsShellPath(target))} ${args}; if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"`;
    } else {
      command = `git -C ${shellQuote(target)} ${args}`;
    }
    const result = await this.exec(command, 120000);
    if (result.code !== 0) throw new Error(result.stderr || "Git command failed.");
    return { ok: true, output: `${result.stdout}${result.stderr}`.trim() || "Git command completed." };
  }

  async cloneOfficialResource(resource, resourcesRoot, categoryName) {
    const root = this.safePath(resourcesRoot);
    const category = this.safePath(path.join(root, categoryName));
    const destination = this.safePath(path.join(category, resource.repo));
    const sourceUrl = `https://github.com/${resource.owner}/${resource.repo}.git`;
    let command;
    if (this.isWindowsServer()) {
      const windowsCategory = this.windowsShellPath(category);
      const windowsDestination = this.windowsShellPath(destination);
      command = `powershell -NoProfile -Command "$destination=${powershellQuote(windowsDestination)}; if(Test-Path -LiteralPath $destination){Write-Error ${powershellQuote(`${resource.repo} is already installed. Use Git Deployment to update it.`)}; exit 2}; New-Item -ItemType Directory -Path ${powershellQuote(windowsCategory)} -Force | Out-Null; & git clone --depth 1 ${powershellQuote(sourceUrl)} $destination; if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}"`;
    } else {
      command = `if [ -e ${shellQuote(destination)} ]; then echo ${shellQuote(`${resource.repo} is already installed. Use Git Deployment to update it.`)} >&2; exit 2; fi; mkdir -p ${shellQuote(category)} && git clone --depth 1 ${shellQuote(sourceUrl)} ${shellQuote(destination)}`;
    }
    const result = await this.exec(command, 10 * 60 * 1000);
    if (result.code !== 0) throw new Error(result.stderr || "Git could not download this resource on the remote server.");
    return { ok: true, path: destination, output: `${result.stdout}${result.stderr}`.trim() };
  }

  remoteHttpJson(route, options = {}) {
    this.requireConnected();
    const port = Number(this.project?.config?.port || this.profile.fiveMPort || 30120);
    return new Promise((resolve, reject) => {
      this.client.forwardOut("127.0.0.1", 0, "127.0.0.1", port, (forwardError, stream) => {
        if (forwardError) {
          reject(forwardError);
          return;
        }
        const body = options.body ? JSON.stringify(options.body) : "";
        const request = http.request({
          method: options.method || "GET",
          host: "127.0.0.1",
          port,
          path: route,
          headers: {
            Accept: "application/json",
            ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
            ...(options.headers || {})
          },
          createConnection: () => stream,
          timeout: options.timeout || 5000
        }, (response) => {
          let responseBody = "";
          response.on("data", (chunk) => { responseBody += chunk.toString(); });
          response.on("end", () => {
            let data;
            try {
              data = responseBody ? JSON.parse(responseBody) : {};
            } catch {
              data = { message: responseBody };
            }
            if (response.statusCode < 200 || response.statusCode >= 300) {
              reject(new Error(data.error || `HTTP ${response.statusCode}`));
            } else {
              resolve(data);
            }
          });
        });
        request.on("timeout", () => request.destroy(new Error("Remote FiveM request timed out.")));
        request.on("error", reject);
        if (body) request.write(body);
        request.end();
      });
    });
  }

  async getProcessMetrics() {
    const linux = await this.exec(
      "sh -lc 'pid=$(pgrep -f \"[F]XServer\" | tail -n 1); if [ -n \"$pid\" ]; then ps -p \"$pid\" -o pid=,%cpu=,rss=,lstart=; fi'",
      7000
    ).catch(() => ({ stdout: "" }));
    const line = linux.stdout.trim();
    if (line) {
      const match = line.match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
      if (match) {
        return {
          pid: Number(match[1]),
          cpu: Number(match[2]),
          memoryBytes: Number(match[3]) * 1024,
          started: new Date(match[4]).toISOString()
        };
      }
    }
    const windowsCommand = "powershell -NoProfile -Command \"$p=Get-Process FXServer -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending | Select-Object -First 1; if($p){$cpu=(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object {$_.IDProcess -eq $p.Id} | Select-Object -First 1).PercentProcessorTime; [pscustomobject]@{pid=$p.Id;cpu=[double]$cpu;memoryBytes=[double]$p.WorkingSet64;started=$p.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress}\"";
    const windows = await this.exec(windowsCommand, 9000).catch(() => ({ stdout: "" }));
    try {
      return windows.stdout.trim() ? JSON.parse(windows.stdout.trim()) : null;
    } catch {
      return null;
    }
  }

  async getStatus() {
    const results = await Promise.allSettled([
      this.remoteHttpJson("/dynamic.json"),
      this.remoteHttpJson("/players.json"),
      this.remoteHttpJson("/info.json")
    ]);
    const dynamic = results[0].status === "fulfilled" ? results[0].value : {};
    const players = results[1].status === "fulfilled" && Array.isArray(results[1].value) ? results[1].value : [];
    const info = results[2].status === "fulfilled" ? results[2].value : {};
    if (!results.some((result) => result.status === "fulfilled")) {
      return {
        online: false,
        endpoint: `SSH tunnel -> 127.0.0.1:${this.project?.config?.port || this.profile.fiveMPort || 30120}`,
        error: "FiveM did not respond through the SSH tunnel.",
        players: [],
        playerCount: 0,
        maxPlayers: this.project?.config?.maxClients || 0,
        process: await this.getProcessMetrics()
      };
    }
    return {
      online: true,
      endpoint: `SSH tunnel -> 127.0.0.1:${this.project?.config?.port || this.profile.fiveMPort || 30120}`,
      players,
      playerCount: players.length || Number(dynamic.clients) || 0,
      maxPlayers: Number(dynamic.sv_maxclients) || this.project?.config?.maxClients || 0,
      hostname: dynamic.hostname || info.vars?.sv_projectName || "",
      map: dynamic.mapname || "",
      gameType: dynamic.gametype || "",
      resources: Array.isArray(info.resources) ? info.resources.length : 0,
      process: await this.getProcessMetrics()
    };
  }

  async findLatestLog() {
    const candidates = [];
    const walk = async (directory, depth = 0) => {
      if (depth > 5) return;
      let entries;
      try {
        entries = await this.readdir(directory);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.attrs.isDirectory() && SKIP_DIRECTORIES.has(entry.filename.toLowerCase())) continue;
        const fullPath = path.join(directory, entry.filename);
        if (entry.attrs.isDirectory()) {
          await walk(fullPath, depth + 1);
        } else if (entry.filename.toLowerCase().endsWith(".log")) {
          candidates.push({ path: fullPath, mtime: Number(entry.attrs.mtime) || 0, size: Number(entry.attrs.size) || 0 });
        }
      }
    };
    await walk(this.profile.rootPath);
    candidates.sort((a, b) => b.mtime - a.mtime);
    return candidates[0] || null;
  }

  async getLogs() {
    let log;
    if (this.latestLogPath) {
      try {
        const stats = await this.stat(this.latestLogPath);
        log = { path: this.latestLogPath, size: Number(stats.size) || 0 };
      } catch {
        this.latestLogPath = "";
      }
    }
    if (!log) {
      log = await this.findLatestLog();
      this.latestLogPath = log?.path || "";
    }
    if (!log) return { path: "", lines: ["No remote server log was found."] };
    if (!log.size) return { path: log.path, lines: ["Remote log is currently empty."] };
    const readSize = Math.min(log.size, 220 * 1024);
    const data = await new Promise((resolve, reject) => {
      this.sftp.open(log.path, "r", (openError, handle) => {
        if (openError) return reject(openError);
        const buffer = Buffer.alloc(readSize);
        this.sftp.read(handle, buffer, 0, readSize, Math.max(0, log.size - readSize), (readError, bytesRead) => {
          this.sftp.close(handle, () => {});
          if (readError) reject(readError);
          else resolve(buffer.subarray(0, bytesRead));
        });
      });
    });
    const tail = data.toString("utf8");
    return { path: log.path, lines: tail.split(/\r?\n/).slice(-500) };
  }

  async createFile(options) {
    const parentPath = this.safePath(options.parentPath);
    const cleanName = path.basename(String(options.name || "").trim());
    if (!cleanName) throw new Error("Enter a file name.");
    const filePath = this.safePath(path.join(parentPath, cleanName));
    return this.writeFile(filePath, options.content || "", { exclusive: true });
  }

  async createResource(options) {
    const parentPath = this.safePath(options.parentPath);
    const resourceName = String(options.name || "").trim().replace(/[^a-zA-Z0-9_-]/g, "-");
    if (!resourceName) throw new Error("Enter a valid resource name.");
    const resourcePath = this.safePath(path.join(parentPath, resourceName));
    await this.mkdir(resourcePath);
    const framework = String(options.framework || "Standalone");
    const dependencies = [];
    if (framework === "QBCore") dependencies.push("qb-core");
    if (framework === "Qbox") dependencies.push("qbx_core");
    if (framework === "ESX") dependencies.push("es_extended");
    const includeClient = options.includeClient !== false;
    const includeServer = options.includeServer !== false;
    const manifest = [
      "fx_version 'cerulean'", "game 'gta5'", "",
      `author '${String(options.author || "WOLFHQ").replace(/'/g, "\\'")}'`,
      `description '${String(options.description || "Custom FiveM resource").replace(/'/g, "\\'")}'`,
      "version '1.0.0'", "", "shared_script 'config.lua'",
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
    await this.writeFile(path.join(resourcePath, "fxmanifest.lua"), manifest);
    await this.writeFile(path.join(resourcePath, "config.lua"), "Config = {}\n\nConfig.Debug = false\n");
    if (includeClient) await this.writeFile(path.join(resourcePath, "client.lua"), `${frameworkHeader}\nCreateThread(function()\n    print('[${resourceName}] client initialized')\nend)\n`);
    if (includeServer) await this.writeFile(path.join(resourcePath, "server.lua"), `${frameworkHeader}\nCreateThread(function()\n    print('[${resourceName}] server initialized')\nend)\n`);
    return { ok: true, path: resourcePath };
  }

  async deleteResource(resourcePath) {
    const target = this.safePath(resourcePath);
    const resource = this.project?.resources?.find((candidate) => normalizeRemotePath(candidate.path) === target);
    if (!resource) throw new Error("WOLFHQ can only delete folders detected as FiveM resources.");
    if (target === normalizeRemotePath(this.profile.rootPath)) throw new Error("The remote server root cannot be deleted as a resource.");
    if ((this.project.resourcesRoots || []).some((root) => normalizeRemotePath(root) === target)) {
      throw new Error("The top-level remote resources folder cannot be deleted.");
    }
    const command = this.isWindowsServer()
      ? `powershell -NoProfile -Command "Remove-Item -LiteralPath ${powershellQuote(this.windowsShellPath(target))} -Recurse -Force"`
      : `rm -rf -- ${shellQuote(target)}`;
    const result = await this.exec(command, 10 * 60 * 1000);
    if (result.code !== 0) throw new Error(result.stderr || "Remote resource deletion failed.");
    return { ok: true, name: resource.name, path: target };
  }

  async deleteFolder(folderPath) {
    const target = this.safePath(folderPath);
    if (target === normalizeRemotePath(this.profile.rootPath)) throw new Error("The remote server root cannot be deleted.");
    const stats = await this.stat(target);
    if (!stats.isDirectory()) throw new Error("That remote path is not a folder.");
    const command = this.isWindowsServer()
      ? `powershell -NoProfile -Command "Remove-Item -LiteralPath ${powershellQuote(this.windowsShellPath(target))} -Recurse -Force"`
      : `rm -rf -- ${shellQuote(target)}`;
    const result = await this.exec(command, 10 * 60 * 1000);
    if (result.code !== 0) throw new Error(result.stderr || "Remote folder deletion failed.");
    return { ok: true, name: path.basename(target), path: target };
  }

  getControlPaths() {
    if (!this.project?.config?.path) throw new Error("No remote server.cfg was detected.");
    const profileRoot = path.dirname(this.project.config.path);
    const resourcesRoot = this.project.resourcesRoots?.find((candidate) => path.dirname(candidate) === profileRoot)
      || path.join(profileRoot, "resources");
    const resourceRoot = path.join(resourcesRoot, "[wolfhq]", "wolfhq-control");
    return {
      configPath: this.project.config.path,
      resourceRoot,
      tokenPath: path.join(resourceRoot, ".wolfhq-token")
    };
  }

  getNekoAntiCheatPaths() {
    if (!this.project?.config?.path) throw new Error("No remote server.cfg was detected.");
    const profileRoot = path.dirname(this.project.config.path);
    const resourcesRoot = this.project.resourcesRoots?.find((candidate) => path.dirname(candidate) === profileRoot)
      || path.join(profileRoot, "resources");
    const resourceRoot = path.join(resourcesRoot, "[wolfhq]", "neko-anticheat");
    return {
      configPath: this.project.config.path,
      resourceRoot,
      tokenPath: path.join(resourceRoot, ".neko-token")
    };
  }

  async readControlToken() {
    return (await this.readFileRaw(this.getControlPaths().tokenPath)).toString("utf8").trim();
  }

  async readNekoAntiCheatToken() {
    return (await this.readFileRaw(this.getNekoAntiCheatPaths().tokenPath)).toString("utf8").trim();
  }

  async installControlBridge(manifest, serverScript) {
    const paths = this.getControlPaths();
    await this.mkdirRecursive(paths.resourceRoot);
    let token;
    try {
      token = await this.readControlToken();
    } catch {
      token = crypto.randomBytes(32).toString("hex");
      await this.writeFile(paths.tokenPath, `${token}\n`);
    }
    await this.writeFile(path.join(paths.resourceRoot, "fxmanifest.lua"), manifest);
    await this.writeFile(path.join(paths.resourceRoot, "server.lua"), serverScript);
    const serverCfg = (await this.readFileRaw(paths.configPath)).toString("utf8");
    const patchedConfig = patchControlBridgeConfig(serverCfg);
    if (patchedConfig.changed) await this.writeFile(paths.configPath, patchedConfig.content);
    return { ok: true, resourcePath: paths.resourceRoot, requiresServerRestart: true, running: false };
  }

  async installNekoAntiCheat(files) {
    const paths = this.getNekoAntiCheatPaths();
    await this.mkdirRecursive(paths.resourceRoot);
    try {
      await this.readNekoAntiCheatToken();
    } catch {
      await this.writeFile(paths.tokenPath, `${crypto.randomBytes(32).toString("hex")}\n`);
    }
    await this.writeFile(path.join(paths.resourceRoot, "fxmanifest.lua"), files.manifest);
    await this.writeFile(path.join(paths.resourceRoot, "config.lua"), files.config);
    await this.writeFile(path.join(paths.resourceRoot, "client.lua"), files.client);
    await this.writeFile(path.join(paths.resourceRoot, "server.lua"), files.server);
    await this.writeFile(path.join(paths.resourceRoot, "resource_guard.lua"), files.guard);
    await this.writeFile(path.join(paths.resourceRoot, "README.md"), files.readme);
    await this.writeFile(path.join(paths.resourceRoot, "incidents.json"), "[]\n", { exclusive: true }).catch(() => {});
    await this.writeFile(path.join(paths.resourceRoot, "bans.json"), "[]\n", { exclusive: true }).catch(() => {});
    const serverCfg = (await this.readFileRaw(paths.configPath)).toString("utf8");
    const patchedConfig = patchNekoAntiCheatConfig(serverCfg);
    if (patchedConfig.changed) await this.writeFile(paths.configPath, patchedConfig.content);
    return { ok: true, resourcePath: paths.resourceRoot, requiresServerRestart: true, running: false };
  }

  async updateNekoResourceGuards(action = "install") {
    const resources = Array.isArray(this.project?.resources) ? this.project.resources : [];
    let changed = 0;
    let scanned = 0;
    const changedResources = [];
    for (const resource of resources) {
      if (!resource?.manifest || resource.name === "neko-anticheat") continue;
      scanned += 1;
      const text = (await this.readFileRaw(resource.manifest)).toString("utf8");
      const result = action === "remove" ? removeNekoResourceGuard(text) : patchNekoResourceGuard(text);
      if (result.changed) {
        await this.writeFile(resource.manifest, result.content);
        changed += 1;
        changedResources.push(resource.name);
      }
    }
    this.project = await this.scan();
    return { ok: true, action, scanned, changed, resources: changedResources, project: this.project };
  }

  async callControl(route, payload, method = "POST") {
    const token = await this.readControlToken();
    return this.remoteHttpJson(`/wolfhq-control/${route}`, {
      method,
      headers: { "x-wolfhq-token": token },
      body: method === "GET" ? undefined : payload
    });
  }

  async callNekoAntiCheat(route, payload, method = "POST") {
    const token = await this.readNekoAntiCheatToken();
    return this.remoteHttpJson(`/neko-anticheat/${route}`, {
      method,
      headers: { "x-neko-token": token },
      body: method === "GET" ? undefined : payload
    });
  }
}

module.exports = { RemoteServer, isAbsoluteRemotePath, normalizeRemotePath };
