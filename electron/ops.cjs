const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const mysql = require("mysql2/promise");

const execFileAsync = promisify(execFile);
const MAX_METRICS = 720;
const MAX_AUDIT = 1000;
const MAX_PLAYER_HISTORY = 1000;
const ROLE_PERMISSIONS = {
  owner: new Set(["*"]),
  admin: new Set(["resource", "catalog", "backup", "console", "player", "git", "database", "settings", "ai"]),
  developer: new Set(["resource", "catalog", "backup", "console", "git", "ai"])
};

function sanitizeLabel(value, fallback = "snapshot") {
  return String(value || fallback).trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || fallback;
}

function publicAccount(account) {
  const { passwordHash, salt, ...safe } = account;
  return safe;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return {
    salt,
    passwordHash: crypto.scryptSync(String(password), salt, 64).toString("hex")
  };
}

class OpsManager {
  constructor(options) {
    this.userData = options.userData;
    this.getContext = options.getContext;
    this.callControl = options.callControl;
    this.getStatus = options.getStatus;
    this.currentAccountId = "owner";
    this.lastOnline = null;
    this.preEditBackups = new Set();
  }

  storePath(name) {
    return path.join(this.userData, `wolfhq-${name}.json`);
  }

  async readStore(name, fallback) {
    try {
      return JSON.parse(await fs.readFile(this.storePath(name), "utf8"));
    } catch {
      return fallback;
    }
  }

  async writeStore(name, value) {
    await fs.mkdir(this.userData, { recursive: true });
    await fs.writeFile(this.storePath(name), JSON.stringify(value, null, 2), "utf8");
    return value;
  }

  async accounts() {
    const accounts = await this.readStore("accounts", []);
    if (accounts.length) return accounts;
    const owner = {
      id: "owner",
      username: "Owner",
      role: "owner",
      createdAt: new Date().toISOString(),
      ...hashPassword("")
    };
    await this.writeStore("accounts", [owner]);
    return [owner];
  }

  async currentAccount() {
    const accounts = await this.accounts();
    return accounts.find((account) => account.id === this.currentAccountId) || accounts[0];
  }

  async assertPermission(permission) {
    const account = await this.currentAccount();
    const permissions = ROLE_PERMISSIONS[account.role] || new Set();
    if (!permissions.has("*") && !permissions.has(permission)) {
      throw new Error(`${account.role} accounts cannot perform this action.`);
    }
    return account;
  }

  async audit(action, detail = {}) {
    const account = await this.currentAccount();
    const records = await this.readStore("audit", []);
    records.unshift({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      account: account.username,
      role: account.role,
      action,
      detail
    });
    await this.writeStore("audit", records.slice(0, MAX_AUDIT));
  }

  async getAccounts() {
    const accounts = await this.accounts();
    const current = await this.currentAccount();
    return { current: publicAccount(current), accounts: accounts.map(publicAccount) };
  }

  async createAccount(input) {
    await this.assertPermission("accounts");
    const username = String(input.username || "").trim();
    const role = ["owner", "admin", "developer"].includes(input.role) ? input.role : "developer";
    const password = String(input.password || "");
    if (username.length < 2) throw new Error("Enter an account name.");
    if (password.length < 4) throw new Error("Use a password of at least four characters.");
    const accounts = await this.accounts();
    if (accounts.some((account) => account.username.toLowerCase() === username.toLowerCase())) {
      throw new Error("That account already exists.");
    }
    const account = {
      id: crypto.randomUUID(),
      username,
      role,
      createdAt: new Date().toISOString(),
      ...hashPassword(password)
    };
    accounts.push(account);
    await this.writeStore("accounts", accounts);
    await this.audit("account.created", { username, role });
    return publicAccount(account);
  }

  async login(input) {
    const accounts = await this.accounts();
    const account = accounts.find((candidate) => candidate.id === input.id);
    if (!account) throw new Error("Account not found.");
    const passwordHash = hashPassword(String(input.password || ""), account.salt).passwordHash;
    if (!crypto.timingSafeEqual(Buffer.from(passwordHash, "hex"), Buffer.from(account.passwordHash, "hex"))) {
      throw new Error("Incorrect account password.");
    }
    this.currentAccountId = account.id;
    await this.audit("account.login");
    return publicAccount(account);
  }

  async deleteAccount(id) {
    await this.assertPermission("accounts");
    if (id === "owner" || id === this.currentAccountId) throw new Error("The active owner account cannot be removed.");
    const accounts = await this.accounts();
    const removed = accounts.find((account) => account.id === id);
    await this.writeStore("accounts", accounts.filter((account) => account.id !== id));
    await this.audit("account.removed", { username: removed?.username || id });
    return { ok: true };
  }

  async getSettings() {
    return this.readStore("settings", {
      crashDetection: true,
      autoRestart: false,
      restartCommand: "",
      discordWebhook: "",
      backupSchedule: "manual"
    });
  }

  async updateSettings(input) {
    await this.assertPermission("settings");
    const current = await this.getSettings();
    const next = {
      ...current,
      crashDetection: Boolean(input.crashDetection),
      autoRestart: Boolean(input.autoRestart),
      restartCommand: String(input.restartCommand || "").trim(),
      discordWebhook: String(input.discordWebhook || "").trim(),
      backupSchedule: ["manual", "hourly", "daily"].includes(input.backupSchedule) ? input.backupSchedule : "manual"
    };
    await this.writeStore("settings", next);
    await this.audit("settings.updated", { crashDetection: next.crashDetection, autoRestart: next.autoRestart, backupSchedule: next.backupSchedule });
    return next;
  }

  async recordTelemetry(status) {
    const context = this.getContext();
    if (!context.project) return [];
    const metrics = await this.readStore("metrics", []);
    metrics.push({
      at: new Date().toISOString(),
      server: context.project.connectionName || context.project.name,
      online: Boolean(status.online),
      players: Number(status.playerCount) || 0,
      cpu: Number(status.process?.cpu) || 0,
      memoryBytes: Number(status.process?.memoryBytes) || 0
    });
    await this.writeStore("metrics", metrics.slice(-MAX_METRICS));
    await this.recordPlayerHistory(status.players || []);
    return metrics.slice(-120);
  }

  async recordPlayerHistory(players) {
    if (!players.length) return;
    const history = await this.readStore("player-history", []);
    const now = new Date().toISOString();
    for (const player of players) {
      const identifiers = Array.isArray(player.identifiers) ? player.identifiers : [];
      const key = identifiers[0] || `${player.name}:${player.id}`;
      const previous = history.find((entry) => entry.key === key);
      if (previous) {
        previous.lastSeen = now;
        previous.name = player.name;
        previous.ping = player.ping;
        previous.identifiers = identifiers;
      } else {
        history.unshift({ key, name: player.name, identifiers, firstSeen: now, lastSeen: now, ping: player.ping });
      }
    }
    await this.writeStore("player-history", history.slice(0, MAX_PLAYER_HISTORY));
  }

  async getDashboard() {
    const [metrics, notes, playerHistory, audit, settings, accountData] = await Promise.all([
      this.readStore("metrics", []),
      this.readStore("player-notes", {}),
      this.readStore("player-history", []),
      this.readStore("audit", []),
      this.getSettings(),
      this.getAccounts()
    ]);
    return {
      metrics: metrics.slice(-120),
      notes,
      playerHistory: playerHistory.slice(0, 100),
      audit: audit.slice(0, 100),
      settings,
      ...accountData
    };
  }

  async resourceAction(endpoint, name, action) {
    await this.assertPermission("resource");
    if (!["start", "stop", "restart", "ensure"].includes(action)) throw new Error("Unsupported resource action.");
    const result = await this.callControl(endpoint, "resource", { name, action });
    await this.audit(`resource.${action}`, { name });
    return result;
  }

  async consoleCommand(endpoint, command) {
    await this.assertPermission("console");
    const value = String(command || "").trim();
    if (!value || value.length > 300 || /[\r\n]/.test(value)) throw new Error("Enter one console command under 300 characters.");
    const result = await this.callControl(endpoint, "command", { command: value });
    await this.audit("console.command", { command: value });
    return result;
  }

  async playerAction(endpoint, options) {
    await this.assertPermission("player");
    const result = await this.callControl(endpoint, "player", {
      id: Number(options.id),
      action: options.action,
      reason: String(options.reason || "WOLFHQ administration").slice(0, 180)
    });
    await this.audit(`player.${options.action}`, { id: Number(options.id), name: options.name, reason: options.reason });
    return result;
  }

  async savePlayerNote(key, note) {
    await this.assertPermission("player");
    const notes = await this.readStore("player-notes", {});
    notes[String(key)] = String(note || "").slice(0, 2000);
    await this.writeStore("player-notes", notes);
    await this.audit("player.note", { key });
    return { ok: true };
  }

  async localBackup(label) {
    const context = this.getContext();
    const root = context.project.rootPath;
    const backupDir = path.join(path.dirname(root), ".wolfhq-backups");
    await fs.mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${stamp}-${sanitizeLabel(label)}.tar.gz`;
    const archive = path.join(backupDir, fileName);
    await execFileAsync("tar.exe", ["-czf", archive, "-C", root, "."], { windowsHide: true, timeout: 30 * 60 * 1000 });
    return { name: fileName, path: archive, createdAt: new Date().toISOString(), mode: "local" };
  }

  async createBackup(label = "manual") {
    await this.assertPermission("backup");
    const context = this.getContext();
    if (!context.project) throw new Error("Connect a server first.");
    const backup = context.mode === "remote"
      ? await context.remote.createBackup(sanitizeLabel(label))
      : await this.localBackup(label);
    await this.audit("backup.created", { name: backup.name });
    return backup;
  }

  async listBackups() {
    const context = this.getContext();
    if (!context.project) return [];
    if (context.mode === "remote") return context.remote.listBackups();
    const backupDir = path.join(path.dirname(context.project.rootPath), ".wolfhq-backups");
    try {
      const entries = await fs.readdir(backupDir, { withFileTypes: true });
      return Promise.all(entries.filter((entry) => entry.isFile() && /\.tar\.gz$/i.test(entry.name)).map(async (entry) => {
        const filePath = path.join(backupDir, entry.name);
        const stats = await fs.stat(filePath);
        return { name: entry.name, path: filePath, createdAt: stats.mtime.toISOString(), size: stats.size, mode: "local" };
      })).then((items) => items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } catch {
      return [];
    }
  }

  async restoreBackup(backupPath) {
    await this.assertPermission("backup");
    const context = this.getContext();
    if (!context.project) throw new Error("Connect a server first.");
    if (context.mode === "remote") {
      await context.remote.restoreBackup(backupPath);
    } else {
      const backupDir = path.resolve(path.dirname(context.project.rootPath), ".wolfhq-backups");
      const archive = path.resolve(backupPath);
      if (path.relative(backupDir, archive).startsWith("..")) throw new Error("Invalid backup path.");
      await execFileAsync("tar.exe", ["-xzf", archive, "-C", context.project.rootPath], { windowsHide: true, timeout: 30 * 60 * 1000 });
    }
    await this.audit("backup.restored", { path: backupPath });
    return { ok: true };
  }

  async ensurePreEditBackup(filePath) {
    const context = this.getContext();
    if (!context.project || this.preEditBackups.has(context.project.rootPath)) return;
    this.preEditBackups.add(context.project.rootPath);
    try {
      await this.createBackup("pre-edit");
    } catch (error) {
      this.preEditBackups.delete(context.project.rootPath);
      throw new Error(`A safety backup could not be created before editing: ${error.message}`);
    }
    await this.audit("backup.pre-edit", { filePath });
  }

  async gitAction(options) {
    await this.assertPermission("git");
    const context = this.getContext();
    const targetPath = options.path || context.project?.rootPath;
    if (!targetPath) throw new Error("Select a project or resource.");
    const action = options.action || "status";
    const result = context.mode === "remote"
      ? await context.remote.gitAction(targetPath, action)
      : await this.localGit(targetPath, action);
    if (action !== "status") await this.audit(`git.${action}`, { path: targetPath });
    return result;
  }

  async localGit(targetPath, action) {
    const safe = path.resolve(targetPath);
    const argsByAction = {
      status: ["-C", safe, "status", "--short", "--branch"],
      pull: ["-C", safe, "pull", "--ff-only"],
      rollback: ["-C", safe, "reset", "--hard", "HEAD@{1}"]
    };
    if (!argsByAction[action]) throw new Error("Unsupported Git action.");
    const { stdout, stderr } = await execFileAsync("git.exe", argsByAction[action], { windowsHide: true, timeout: 120000 });
    return { ok: true, output: `${stdout}${stderr}`.trim() || "Git command completed." };
  }

  async databaseConnect(config) {
    await this.assertPermission("database");
    const context = this.getContext();
    const connectionOptions = {
      host: String(config.host || "127.0.0.1"),
      port: Number(config.port) || 3306,
      user: String(config.user || ""),
      password: String(config.password || ""),
      database: String(config.database || ""),
      connectTimeout: 10000,
      multipleStatements: false
    };
    let tunnel;
    if (context.mode === "remote" && ["127.0.0.1", "localhost"].includes(connectionOptions.host)) {
      tunnel = await context.remote.forward(connectionOptions.host, connectionOptions.port);
      connectionOptions.stream = tunnel;
    }
    const connection = await mysql.createConnection(connectionOptions);
    return { connection, tunnel };
  }

  async databaseTables(config) {
    const { connection } = await this.databaseConnect(config);
    try {
      const [rows] = await connection.query("SHOW TABLES");
      return rows.map((row) => Object.values(row)[0]);
    } finally {
      await connection.end();
    }
  }

  async databaseRows(config, table) {
    if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error("Invalid table name.");
    const { connection } = await this.databaseConnect(config);
    try {
      const [rows] = await connection.query(`SELECT * FROM \`${table}\` LIMIT 100`);
      const [columns] = await connection.query(`SHOW COLUMNS FROM \`${table}\``);
      return { rows, columns };
    } finally {
      await connection.end();
    }
  }

  async databaseUpdate(config, input) {
    await this.assertPermission("database");
    const where = Array.isArray(input.where) && input.where.length
      ? input.where
      : [{ column: input.keyColumn, value: input.keyValue }];
    for (const value of [input.table, input.column, ...where.map((item) => item.column)]) {
      if (!/^[a-zA-Z0-9_]+$/.test(value)) throw new Error("Invalid database identifier.");
    }
    if (!where.length) throw new Error("No database row identifier was provided.");
    const setValue = input.valueIsNull ? null : input.value;
    const whereSql = where.map((item) => `\`${item.column}\` <=> ?`).join(" AND ");
    const { connection } = await this.databaseConnect(config);
    try {
      const [result] = await connection.execute(
        `UPDATE \`${input.table}\` SET \`${input.column}\` = ? WHERE ${whereSql} LIMIT 1`,
        [setValue, ...where.map((item) => item.value)]
      );
      await this.audit("database.update", { table: input.table, column: input.column });
      return { ok: true, affectedRows: result.affectedRows };
    } finally {
      await connection.end();
    }
  }
}

module.exports = { OpsManager };
