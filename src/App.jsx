import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import packageInfo from "../package.json";
import {
  Activity, AlertTriangle, Archive, Ban, BarChart3, Bell, Box, Braces, Check, ChevronDown, ChevronRight, Circle,
  Clock, Cloud, Code2, Cpu, Database, Download, ExternalLink, File, FileCode2, FileJson, Folder, FolderOpen, Gauge,
  Eye, Fingerprint, GitBranch, Globe2, HardDrive, History, KeyRound, Layers3, LockKeyhole, Maximize2, Minimize2, Network,
  PackageCheck, Play, Plus, RefreshCw, RotateCcw, Save, Search, Send, Server, Settings2, ShieldCheck, Sparkles,
  ShieldAlert, Square, Terminal, Trash2, UploadCloud, UserCog, UserX, Users, Wifi, X, Zap
} from "lucide-react";

const api = window.neonCore || {
  chooseServerFolder: async () => null,
  loadRecentProject: async () => null,
  listRemoteProfiles: async () => [],
  choosePrivateKey: async () => "",
  connectRemote: async () => null,
  deleteRemoteProfile: async () => null,
  disconnectRemote: async () => null,
  scanProject: async () => null,
  readFile: async () => null,
  saveFile: async () => null,
  createResource: async () => null,
  deleteResource: async () => null,
  deleteFolder: async () => null,
  uploadFolder: async () => null,
  createFile: async () => null,
  getServerStatus: async () => EMPTY_STATUS,
  getServerLogs: async () => ({ path: "", lines: [] }),
  installControlBridge: async () => null,
  getControlStatus: async () => ({ installed: false, running: false }),
  installNekoAntiCheat: async () => null,
  getNekoAntiCheatStatus: async () => ({ installed: false, running: false, incidents: [], players: [] }),
  setNekoAntiCheatProfile: async () => null,
  spectateNekoPlayer: async () => null,
  updateNekoResourceGuards: async () => null,
  sendAnnouncement: async () => null,
  restartServer: async () => null,
  getOpsDashboard: async () => ({ metrics: [], notes: {}, playerHistory: [], audit: [], accounts: [], current: null, settings: {} }),
  recordTelemetry: async () => null,
  getFleet: async () => [],
  getResourceStates: async () => [],
  resourceAction: async () => null,
  getResourceCatalog: async () => [],
  installOfficialResource: async () => null,
  runConsoleCommand: async () => null,
  getPlayerDetails: async () => [],
  playerAction: async () => null,
  savePlayerNote: async () => null,
  listBackups: async () => [],
  createBackup: async () => null,
  restoreBackup: async () => null,
  gitAction: async () => ({ output: "" }),
  databaseTables: async () => [],
  databaseRows: async () => ({ rows: [], columns: [] }),
  databaseUpdate: async () => null,
  listAccounts: async () => ({ accounts: [], current: null }),
  createAccount: async () => null,
  loginAccount: async () => null,
  deleteAccount: async () => null,
  getOpsSettings: async () => ({}),
  updateOpsSettings: async () => null,
  getAiSettings: async () => ({ provider: "anthropic", model: "claude-sonnet-4-6", endpoint: "https://api.anthropic.com/v1/messages", maxOutputTokens: 4096, hasApiKey: false }),
  saveAiSettings: async () => null,
  getAiModels: async () => ({ models: [], live: false }),
  getClaudeCodeStatus: async () => ({ available: false, loggedIn: false, message: "Claude Code status is unavailable in preview mode." }),
  loginClaudeCode: async () => ({ available: false, loggedIn: false, message: "Claude Code login is unavailable in preview mode." }),
  logoutClaudeCode: async () => ({ available: true, loggedIn: false, message: "Claude Code logged out in preview mode." }),
  searchAiFiles: async () => ({ indexedFiles: 0, results: [] }),
  proposeAiChanges: async () => ({ summary: "", indexedFiles: 0, contextFiles: 0, files: [] }),
  applyAiChanges: async () => null,
  getUpdaterSettings: async () => ({ repo: "LairOfWolf/WOLFHQ", checkOnStartup: true, includePrerelease: false }),
  checkForUpdate: async () => ({ available: false, currentVersion: "2.1.0", latestVersion: "2.1.0", assets: [] }),
  downloadUpdate: async () => null,
  getArtifactsStatus: async () => ({ platform: "windows", builds: [], latestBuild: null, currentBuild: null }),
  installArtifact: async () => null,
  openExternal: async () => null,
  minimize: () => {},
  maximize: () => {},
  close: () => {}
};
const EMPTY_STATUS = { online: false, players: [], playerCount: 0, maxPlayers: 0, process: null };
const APP_VERSION = packageInfo.version;
const OPERATIONS_VIEWS = new Set(["performance", "backups", "fleet", "git", "database", "automation", "accounts", "history", "ai"]);
const ANTI_CHEAT_MODULES = [
  { name: "PLAYER INTEGRITY", detail: "Godmode, health, armour, invisibility", icon: ShieldCheck },
  { name: "MOVEMENT ANALYSIS", detail: "Noclip, teleport, speed, impossible movement", icon: Activity },
  { name: "WEAPON CONTROL", detail: "Blacklisted weapons, damage and ammo anomalies", icon: CrosshairIcon },
  { name: "EVENT FIREWALL", detail: "Abusive events, triggers and injection patterns", icon: Zap },
  { name: "ENTITY DEFENCE", detail: "Vehicle, ped and object spawn protection", icon: Box },
  { name: "IDENTITY SIGNALS", detail: "Identifiers, session fingerprint and ban history", icon: Fingerprint }
];
const AI_MODEL_FALLBACKS = {
  anthropic: [
    { id: "claude-fable-5", name: "Claude Fable 5" },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" }
  ],
  "openai-compatible": [
    { id: "gpt-5.5", name: "GPT-5.5" },
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "gpt-5.4-mini", name: "GPT-5.4 mini" },
    { id: "gpt-5.4-nano", name: "GPT-5.4 nano" }
  ],
  "claude-code": [
    { id: "default", name: "Claude Code default" },
    { id: "opus", name: "Claude Code Opus" },
    { id: "sonnet", name: "Claude Code Sonnet" }
  ]
};

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function fileIcon(name) {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "json") return <FileJson size={15} />;
  if (["lua", "js", "jsx", "ts", "tsx", "css", "html"].includes(extension)) return <FileCode2 size={15} />;
  return <File size={15} />;
}

function languageExtensions(filePath) {
  if (/\.(js|jsx|ts|tsx)$/i.test(filePath)) return [javascript({ jsx: true, typescript: /\.tsx?$/i.test(filePath) })];
  if (/\.json$/i.test(filePath)) return [json()];
  return [];
}

function cleanErrorMessage(message) {
  return String(message || "")
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "")
    .replace(/^Error:\s*/i, "");
}

function TreeNode({ node, depth = 0, filter, onOpen, selectedPath }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const matches = !filter || node.name.toLowerCase().includes(filter.toLowerCase());
  const childMatches = node.type === "folder" && node.children?.some((child) =>
    child.name.toLowerCase().includes(filter.toLowerCase())
  );
  if (!matches && !childMatches) return null;

  if (node.type === "folder") {
    return (
      <div>
        <button className="tree-row" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {expanded ? <FolderOpen size={15} className="folder-icon" /> : <Folder size={15} className="folder-icon" />}
          <span>{node.name}</span>
          <span className="tree-count">{node.children?.length || 0}</span>
        </button>
        {expanded && node.children?.map((child) => (
          <TreeNode key={child.path} node={child} depth={depth + 1} filter={filter} onOpen={onOpen} selectedPath={selectedPath} />
        ))}
      </div>
    );
  }

  return (
    <button
      className={`tree-row file-row ${selectedPath === node.path ? "active" : ""} ${!node.editable ? "muted" : ""}`}
      style={{ paddingLeft: 25 + depth * 14 }}
      onClick={() => node.editable && onOpen(node)}
      title={node.relativePath}
    >
      {fileIcon(node.name)}
      <span>{node.name}</span>
      <span className="tree-size">{formatBytes(node.size)}</span>
    </button>
  );
}

function collectFolders(nodes = [], rootPath = "") {
  const folders = [];
  const walk = (node, depth) => {
    if (node.type !== "folder") return;
    const children = node.children || [];
    const relativePath = node.relativePath || node.path.replace(rootPath, "").replace(/^[\\/]/, "") || node.name;
    folders.push({
      ...node,
      depth,
      relativePath,
      fileCount: children.filter((child) => child.type === "file").length,
      folderCount: children.filter((child) => child.type === "folder").length
    });
    children.forEach((child) => walk(child, depth + 1));
  };
  nodes.forEach((node) => walk(node, 0));
  return folders;
}

function MetricCard({ icon: Icon, label, value, detail, color = "cyan" }) {
  return (
    <div className={`metric-card ${color}`}>
      <div className="metric-icon"><Icon size={19} /></div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      <div className="metric-scanline" />
    </div>
  );
}

function SparkChart({ values, color = "#50dff9", label }) {
  const numbers = values.map((value) => Number(value) || 0);
  const max = Math.max(1, ...numbers);
  const points = numbers.length > 1
    ? numbers.map((value, index) => `${(index / (numbers.length - 1)) * 100},${38 - (value / max) * 34}`).join(" ")
    : "0,38 100,38";
  return (
    <div className="spark-chart">
      <span>{label}</span>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none">
        <polyline points={points} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      </svg>
      <strong>{numbers.at(-1) || 0}</strong>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal panel-corners" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div><Sparkles size={17} /><strong>{title}</strong></div>
          <button onClick={onClose}><X size={17} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CatalogDropdown({ label, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`hub-dropdown ${open ? "open" : ""}`} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <span>{label}</span>
      <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <strong>{value}</strong><ChevronDown size={15} />
      </button>
      {open && (
        <div className="hub-dropdown-menu">
          {options.map((option) => (
            <button
              type="button"
              className={option === value ? "active" : ""}
              key={option}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              <span>{option}</span>{option === value && <Check size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CrosshairIcon(props) {
  return <Gauge {...props} />;
}

export default function App() {
  const [project, setProject] = useState(null);
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:30120");
  const [activeView, setActiveView] = useState("project");
  const [filter, setFilter] = useState("");
  const [tabs, setTabs] = useState([]);
  const [activePath, setActivePath] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(null);
  const [logs, setLogs] = useState({ path: "", lines: [] });
  const [controlStatus, setControlStatus] = useState({ installed: false, running: false });
  const [remoteProfiles, setRemoteProfiles] = useState([]);
  const [remoteTrust, setRemoteTrust] = useState(null);
  const [remoteConnectMessage, setRemoteConnectMessage] = useState("");
  const [remoteConnectError, setRemoteConnectError] = useState("");
  const [remoteDraft, setRemoteDraft] = useState({
    id: "", name: "My Remote FiveM", host: "", port: 22, username: "root",
    rootPath: "/home/fivem/txData/default", fiveMPort: 30120, authType: "password",
    privateKeyPath: "", secret: "", rememberSecret: true, fingerprint: ""
  });
  const [announcement, setAnnouncement] = useState("");
  const [restartDraft, setRestartDraft] = useState({ delay: 15, reason: "Scheduled maintenance" });
  const [resourceStates, setResourceStates] = useState([]);
  const [resourceSearch, setResourceSearch] = useState("");
  const [folderSearch, setFolderSearch] = useState("");
  const [resourceCatalog, setResourceCatalog] = useState([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogFramework, setCatalogFramework] = useState("Detected");
  const [catalogCategory, setCatalogCategory] = useState("All");
  const [catalogInstalling, setCatalogInstalling] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [antiCheatDisplay, setAntiCheatDisplay] = useState("Overview");
  const [antiCheatProfile, setAntiCheatProfile] = useState("Balanced");
  const [nekoStatus, setNekoStatus] = useState({ installed: false, running: false, incidents: [], players: [], incidentCount: 0, banCount: 0, profile: "Balanced", modules: {} });
  const [nekoInstalling, setNekoInstalling] = useState(false);
  const [inspectedNekoPlayerId, setInspectedNekoPlayerId] = useState(null);
  const [spectatorServerId, setSpectatorServerId] = useState("");
  const [nekoGuardBusy, setNekoGuardBusy] = useState(false);
  const [nekoGuardAction, setNekoGuardAction] = useState(null);
  const [nekoUpdateStagedVersion, setNekoUpdateStagedVersion] = useState("");
  const [playerDetails, setPlayerDetails] = useState([]);
  const [playerModal, setPlayerModal] = useState(null);
  const [consoleCommand, setConsoleCommand] = useState("");
  const [consoleFilter, setConsoleFilter] = useState("");
  const [opsData, setOpsData] = useState({ metrics: [], notes: {}, playerHistory: [], audit: [], accounts: [], current: null, settings: {} });
  const [backups, setBackups] = useState([]);
  const [fleet, setFleet] = useState([]);
  const [gitTarget, setGitTarget] = useState("");
  const [gitOutput, setGitOutput] = useState("Select a resource or use the server root, then inspect its Git state.");
  const [dbConfig, setDbConfig] = useState({ host: "127.0.0.1", port: 3306, user: "root", password: "", database: "" });
  const [dbTables, setDbTables] = useState([]);
  const [dbTable, setDbTable] = useState("");
  const [dbRows, setDbRows] = useState({ rows: [], columns: [] });
  const [dbEditor, setDbEditor] = useState(null);
  const [accountDraft, setAccountDraft] = useState({ username: "", role: "developer", password: "" });
  const [accountLogin, setAccountLogin] = useState({ id: "", password: "" });
  const [opsSettings, setOpsSettings] = useState({ crashDetection: true, autoRestart: false, restartCommand: "", discordWebhook: "", backupSchedule: "manual" });
  const [aiSettings, setAiSettings] = useState({ provider: "anthropic", model: "claude-sonnet-4-6", endpoint: "https://api.anthropic.com/v1/messages", maxOutputTokens: 4096, apiKey: "", hasApiKey: false });
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiSearchQuery, setAiSearchQuery] = useState("");
  const [aiSearch, setAiSearch] = useState({ indexedFiles: 0, results: [] });
  const [aiProposal, setAiProposal] = useState(null);
  const [aiApplyReport, setAiApplyReport] = useState(null);
  const [aiSelected, setAiSelected] = useState({});
  const [aiModels, setAiModels] = useState(AI_MODEL_FALLBACKS.anthropic);
  const [aiModelsLive, setAiModelsLive] = useState(false);
  const [aiMessages, setAiMessages] = useState([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [claudeCodeStatus, setClaudeCodeStatus] = useState({ available: false, loggedIn: false, message: "Select Claude Code Login to check this PC." });
  const [claudeCodeBusy, setClaudeCodeBusy] = useState(false);
  const [updater, setUpdater] = useState({
    settings: { repo: "LairOfWolf/WOLFHQ", checkOnStartup: true, includePrerelease: false },
    latest: null,
    checking: false,
    downloading: false,
    status: "Linked to LairOfWolf/WOLFHQ."
  });
  const [artifactStatus, setArtifactStatus] = useState(null);
  const [artifactBuild, setArtifactBuild] = useState("");
  const [artifactBusy, setArtifactBusy] = useState(false);
  const [resourceDraft, setResourceDraft] = useState({
    name: "wolfhq-custom", description: "Custom gameplay resource", author: "WOLFHQ",
    framework: "Standalone", includeClient: true, includeServer: true
  });
  const [fileDraft, setFileDraft] = useState({ name: "custom.lua", parentPath: "", content: "-- Custom FiveM script\n\n" });
  const searchRef = useRef(null);
  const aiChatRef = useRef(null);
  const recentLoadedRef = useRef(false);

  const activeTab = tabs.find((tab) => tab.path === activePath);
  const isRemote = project?.mode === "remote";
  const notify = useCallback((message) => {
    setToast(cleanErrorMessage(message));
    window.setTimeout(() => setToast(""), 2600);
  }, []);

  const refreshStatus = useCallback(async (value = endpoint) => {
    const next = await api.getServerStatus(value);
    setStatus(next);
    api.recordTelemetry(next).catch(() => {});
    if (next.online && next.endpoint && next.endpoint !== value) setEndpoint(next.endpoint);
  }, [endpoint]);

  const refreshControlStatus = useCallback(async (value = endpoint) => {
    if (!project) return;
    setControlStatus(await api.getControlStatus(value));
  }, [endpoint, project]);

  useEffect(() => {
    let cancelled = false;
    api.getUpdaterSettings().then(async (settings) => {
      if (cancelled) return;
      const nextSettings = { ...settings, repo: "LairOfWolf/WOLFHQ", checkOnStartup: true, includePrerelease: false };
      setUpdater((current) => ({ ...current, settings: nextSettings }));
      setUpdater((current) => ({ ...current, checking: true, status: "Checking GitHub releases..." }));
      try {
        const latest = await api.checkForUpdate(nextSettings);
        if (cancelled) return;
        setUpdater((current) => ({
          ...current,
          latest,
          checking: false,
          status: latest.available ? `Update ${latest.latestVersion} is ready to download.` : `WOLFHQ ${latest.currentVersion} is up to date.`
        }));
        if (latest.available) notify(`WOLFHQ update ${latest.latestVersion} is ready`);
      } catch (error) {
        if (!cancelled) setUpdater((current) => ({ ...current, checking: false, status: cleanErrorMessage(error.message) }));
      }
    }).catch((error) => {
      if (!cancelled) setUpdater((current) => ({ ...current, status: cleanErrorMessage(error.message) }));
    });
    return () => {
      cancelled = true;
    };
  }, [notify]);

  const loadOperations = useCallback(async () => {
    if (!project) return;
    const [dashboard, backupList, fleetList] = await Promise.all([
      api.getOpsDashboard(),
      api.listBackups(),
      api.getFleet()
    ]);
    setOpsData(dashboard);
    setOpsSettings(dashboard.settings || {});
    setBackups(backupList);
    setFleet(fleetList);
    setGitTarget((current) => current || project.rootPath);
  }, [project]);

  useEffect(() => {
    if (recentLoadedRef.current) return;
    recentLoadedRef.current = true;
    api.loadRecentProject().then((result) => {
      if (!result) return;
      setProject(result);
      const configuredPort = result.config?.endpoint?.split(":").pop()?.replace(/\D/g, "");
      setEndpoint(result.mode === "remote"
        ? `SSH tunnel -> 127.0.0.1:${result.config.port || configuredPort || 30120}`
        : configuredPort ? `http://127.0.0.1:${configuredPort}` : "http://127.0.0.1:30120");
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!project) return;
    refreshStatus(endpoint);
    refreshControlStatus(endpoint);
    const timer = window.setInterval(() => refreshStatus(endpoint), 4000);
    return () => window.clearInterval(timer);
  }, [project, endpoint, refreshStatus, refreshControlStatus]);

  useEffect(() => {
    if (!project || activeView !== "console") return;
    const loadLogs = async () => setLogs(await api.getServerLogs());
    loadLogs();
    const timer = window.setInterval(loadLogs, 4000);
    return () => window.clearInterval(timer);
  }, [project, activeView]);

  useEffect(() => {
    if (!project || activeView !== "resources") return;
    const loadStates = async () => setResourceStates(await api.getResourceStates(endpoint));
    loadStates().catch(() => {});
    const timer = window.setInterval(() => loadStates().catch(() => {}), 5000);
    return () => window.clearInterval(timer);
  }, [project, activeView, endpoint]);

  const loadResourceCatalog = useCallback(async (force = false) => {
    setCatalogLoading(true);
    try {
      const resources = await api.getResourceCatalog(force);
      setResourceCatalog(resources);
      if (force) notify(`Official catalog refreshed: ${resources.length} repositories`);
    } catch (error) {
      notify(error.message);
    } finally {
      setCatalogLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    if (!project || activeView !== "resourceHub") return;
    loadResourceCatalog();
  }, [project, activeView, loadResourceCatalog]);

  const loadArtifactStatus = useCallback(async () => {
    const result = await api.getArtifactsStatus();
    setArtifactStatus(result);
    setArtifactBuild((current) => result.builds?.some((build) => String(build.build) === String(current)) ? current : String(result.latestBuild || ""));
    return result;
  }, []);

  useEffect(() => {
    if (!project || (activeView !== "artifacts" && activeView !== "settings")) return;
    loadArtifactStatus().catch((error) => notify(error.message));
  }, [project, activeView, loadArtifactStatus, notify]);

  useEffect(() => {
    if (!project || activeView !== "players") return;
    const loadPlayers = async () => {
      const [players, dashboard] = await Promise.all([api.getPlayerDetails(endpoint), api.getOpsDashboard()]);
      setPlayerDetails(players);
      setOpsData(dashboard);
    };
    loadPlayers().catch(() => setPlayerDetails(status.players || []));
    const timer = window.setInterval(() => loadPlayers().catch(() => {}), 4000);
    return () => window.clearInterval(timer);
  }, [project, activeView, endpoint, status.players]);

  const loadNekoStatus = useCallback(async () => {
    if (!project) return null;
    const result = await api.getNekoAntiCheatStatus(endpoint);
    const normalized = result || { installed: false, running: false, incidents: [], players: [] };
    const staged = nekoUpdateStagedVersion && normalized.latestVersion === nekoUpdateStagedVersion && normalized.updateAvailable
      ? { ...normalized, updateAvailable: false, pendingRestart: true, stagedVersion: nekoUpdateStagedVersion }
      : normalized;
    setNekoStatus(staged);
    if (result?.profile) setAntiCheatProfile(result.profile);
    return staged;
  }, [endpoint, project, nekoUpdateStagedVersion]);

  useEffect(() => {
    if (!project || activeView !== "antiCheat") return;
    loadNekoStatus().catch(() => {});
    const timer = window.setInterval(() => loadNekoStatus().catch(() => {}), 5000);
    return () => window.clearInterval(timer);
  }, [project, activeView, loadNekoStatus]);

  useEffect(() => {
    if (!project || activeView !== "antiCheat" || !inspectedNekoPlayerId) return;
    loadNekoStatus().catch(() => {});
    const timer = window.setInterval(() => loadNekoStatus().catch(() => {}), 900);
    return () => window.clearInterval(timer);
  }, [project, activeView, inspectedNekoPlayerId, loadNekoStatus]);

  useEffect(() => {
    if (!project || !OPERATIONS_VIEWS.has(activeView)) return;
    loadOperations().catch((error) => notify(error.message));
  }, [project, activeView, loadOperations, notify]);

  useEffect(() => {
    if (!project || activeView !== "ai") return;
    Promise.all([api.getAiSettings(), api.getAiModels(), api.searchAiFiles("")]).then(([settings, modelResult, search]) => {
      setAiSettings((current) => ({ ...current, ...settings, apiKey: "" }));
      setAiModels(modelResult.models?.length ? modelResult.models : AI_MODEL_FALLBACKS[settings.provider]);
      setAiModelsLive(Boolean(modelResult.live));
      setAiSearch(search);
      if (settings.provider === "claude-code") refreshClaudeCodeLogin(settings.endpoint, false);
    }).catch((error) => notify(error.message));
  }, [project, activeView, notify]);

  useEffect(() => {
    if (!aiChatRef.current) return;
    aiChatRef.current.scrollTo({ top: aiChatRef.current.scrollHeight, behavior: "smooth" });
  }, [aiMessages, aiBusy, aiProposal]);

  useEffect(() => {
    function handleShortcut(event) {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveActive();
      }
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  async function chooseFolder() {
    setBusy(true);
    try {
      const result = await api.chooseServerFolder();
      if (!result) return;
      setProject(result);
      setTabs([]);
      setActivePath("");
      setActiveView("project");
      const configuredPort = result.config?.endpoint?.split(":").pop()?.replace(/\D/g, "");
      const nextEndpoint = configuredPort ? `http://127.0.0.1:${configuredPort}` : "http://127.0.0.1:30120";
      setEndpoint(nextEndpoint);
      notify(`Indexed ${result.stats.files.toLocaleString()} files`);
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function openRemoteConnections() {
    try {
      setRemoteProfiles(await api.listRemoteProfiles());
      setRemoteTrust(null);
      setModal("remote");
    } catch (error) {
      notify(error.message);
    }
  }

  function loadRemoteProfile(profileId) {
    const profile = remoteProfiles.find((candidate) => candidate.id === profileId);
    if (!profile) {
      setRemoteDraft({
        id: "", name: "My Remote FiveM", host: "", port: 22, username: "root",
        rootPath: "/home/fivem/txData/default", fiveMPort: 30120, authType: "password",
        privateKeyPath: "", secret: "", rememberSecret: true, fingerprint: ""
      });
      return;
    }
    setRemoteDraft((current) => ({
      ...current,
      ...profile,
      secret: "",
      rememberSecret: profile.hasSavedSecret
    }));
  }

  async function connectRemote(event, acceptFingerprint = "") {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setRemoteConnectError("");
    setRemoteConnectMessage(acceptFingerprint
      ? "Authenticating securely with the VPS..."
      : "Contacting the VPS and checking its identity...");
    const progressTimer = window.setTimeout(() => {
      setRemoteConnectMessage(acceptFingerprint
        ? "Authenticating and indexing the remote FiveM server files..."
        : "Waiting for the VPS to complete the SSH handshake...");
    }, 2400);
    try {
      const { secret, rememberSecret, ...profile } = remoteDraft;
      const result = await api.connectRemote({ profile, secret, rememberSecret, acceptFingerprint });
      if (result.requiresTrust) {
        setRemoteTrust(result);
        setRemoteConnectMessage("");
        setModal("trust");
        return;
      }
      setProject(result.project);
      setTabs([]);
      setActivePath("");
      setActiveView("project");
      setEndpoint(`SSH tunnel -> 127.0.0.1:${result.project.config.port || remoteDraft.fiveMPort}`);
      setModal(null);
      setRemoteTrust(null);
      notify(`Securely connected to ${result.profile.name}`);
    } catch (error) {
      const message = cleanErrorMessage(error.message);
      if (acceptFingerprint) {
        setRemoteConnectError(message);
        setRemoteConnectMessage("");
      } else {
        notify(message);
      }
    } finally {
      window.clearTimeout(progressTimer);
      setBusy(false);
    }
  }

  async function chooseRemoteKey() {
    const privateKeyPath = await api.choosePrivateKey();
    if (privateKeyPath) setRemoteDraft((current) => ({ ...current, privateKeyPath }));
  }

  async function deleteRemoteProfile() {
    if (!remoteDraft.id) return;
    await api.deleteRemoteProfile(remoteDraft.id);
    const profiles = await api.listRemoteProfiles();
    setRemoteProfiles(profiles);
    loadRemoteProfile("");
    notify("Remote profile removed");
  }

  async function rescan() {
    if (!project) return;
    setBusy(true);
    try {
      const result = await api.scanProject(project.rootPath);
      setProject(result);
      notify("Project intelligence refreshed");
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function openFile(node) {
    const existing = tabs.find((tab) => tab.path === node.path);
    if (existing) {
      setActivePath(node.path);
      return;
    }
    try {
      const result = await api.readFile(node.path);
      setTabs((current) => [...current, {
        name: node.name, path: node.path, content: result.content, original: result.content, dirty: false
      }]);
      setActivePath(node.path);
    } catch (error) {
      notify(error.message);
    }
  }

  function updateContent(content) {
    setTabs((current) => current.map((tab) =>
      tab.path === activePath ? { ...tab, content, dirty: content !== tab.original } : tab
    ));
  }

  async function saveActive() {
    if (!activeTab) return;
    try {
      await api.saveFile(activeTab.path, activeTab.content);
      setTabs((current) => current.map((tab) =>
        tab.path === activePath ? { ...tab, original: tab.content, dirty: false } : tab
      ));
      notify(`Saved ${activeTab.name}`);
    } catch (error) {
      notify(error.message);
    }
  }

  function closeTab(pathToClose) {
    const index = tabs.findIndex((tab) => tab.path === pathToClose);
    const nextTabs = tabs.filter((tab) => tab.path !== pathToClose);
    setTabs(nextTabs);
    if (activePath === pathToClose) {
      setActivePath(nextTabs[Math.max(0, index - 1)]?.path || "");
    }
  }

  async function createResource(event) {
    event.preventDefault();
    try {
      const resourcesFolder = project.resourcesRoots?.[0] || project.tree.find((node) => node.type === "folder" && node.name.toLowerCase() === "resources")?.path;
      const separator = isRemote ? "/" : "\\";
      const parentPath = resourcesFolder || (project.resources[0]?.path
        ? project.resources[0].path.split(/[\\/]/).slice(0, -1).join(separator)
        : project.rootPath);
      await api.createResource({ ...resourceDraft, parentPath });
      setModal(null);
      await rescan();
      notify(`Resource ${resourceDraft.name} created`);
    } catch (error) {
      notify(error.message);
    }
  }

  function openFileForge() {
    const separator = isRemote ? "/" : "\\";
    setFileDraft((current) => ({
      ...current,
      parentPath: activeTab
        ? activeTab.path.split(/[\\/]/).slice(0, -1).join(separator)
        : project.resources[0]?.path || project.rootPath
    }));
    setModal("file");
  }

  async function createScriptFile(event) {
    event.preventDefault();
    try {
      const result = await api.createFile(fileDraft);
      setModal(null);
      await rescan();
      await openFile({ path: result.path, name: fileDraft.name, editable: true });
      notify(`Created ${fileDraft.name}`);
    } catch (error) {
      notify(error.message);
    }
  }

  async function installBridge() {
    setBusy(true);
    try {
      const result = await api.installControlBridge();
      await rescan();
      let latestStatus = await api.getControlStatus(endpoint);
      for (let attempt = 0; !latestStatus.running && attempt < 3; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        latestStatus = await api.getControlStatus(endpoint);
      }
      setControlStatus(latestStatus);
      if (result.requiresServerRestart) notify("Control bridge permissions were updated. Restart FXServer once from txAdmin or the VPS terminal so quit/restart commands are allowed.");
      else if (latestStatus.running) notify("Control bridge is online and ready");
      else notify("Control bridge installed, but WOLFHQ could not reach it yet. Check the FiveM console for wolfhq-control.");
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function installNekoEngine() {
    setAntiCheatDisplay("Neko Anti-Cheat");
    setModal("nekoInstall");
  }

  async function performNekoEngineInstall() {
    setModal(null);
    setNekoInstalling(true);
    try {
      const result = await api.installNekoAntiCheat({ profile: antiCheatProfile });
      if (result?.project) setProject(result.project);
      await rescan();
      const latest = await loadNekoStatus().catch(() => result?.status || null);
      const stagedVersion = latest?.latestVersion || nekoStatus.latestVersion;
      if (stagedVersion) {
        setNekoUpdateStagedVersion(stagedVersion);
        setNekoStatus((current) => ({ ...current, updateAvailable: false, pendingRestart: true, stagedVersion }));
      }
      setAntiCheatDisplay("Neko Anti-Cheat");
      if (latest?.running || result?.running) notify("Neko Anti-Cheat update staged. Restart neko-anticheat or FXServer to load the new runtime.");
      else notify("Neko Anti-Cheat installed. Restart FXServer or run `ensure neko-anticheat` to activate it.");
    } catch (error) {
      notify(error.message);
    } finally {
      setNekoInstalling(false);
    }
  }

  async function syncNekoProfile(profile) {
    setAntiCheatProfile(profile);
    if (!nekoStatus.running) return;
    try {
      const result = await api.setNekoAntiCheatProfile(endpoint, profile);
      setNekoStatus(result);
      notify(`Neko Anti-Cheat profile set to ${profile}`);
    } catch (error) {
      notify(error.message);
    }
  }

  async function controlNekoSpectate(action, targetId) {
    const watcher = Number(spectatorServerId) || undefined;
    try {
      await api.spectateNekoPlayer(endpoint, { watcher, target: Number(targetId), action });
      notify(action === "stop" ? "Spectate stopped in-game" : `Spectate request sent for server ID ${targetId}`);
    } catch (error) {
      notify(error.message);
    }
  }

  async function updateNekoGuards(action) {
    setNekoGuardAction(action);
    setModal("nekoGuard");
  }

  async function performNekoGuardUpdate() {
    const action = nekoGuardAction || "install";
    const removing = action === "remove";
    setModal(null);
    setNekoGuardBusy(true);
    try {
      const result = await api.updateNekoResourceGuards(action);
      if (result?.project) setProject(result.project);
      await rescan();
      notify(`${removing ? "Removed" : "Injected"} Neko resource guard in ${result?.changed ?? 0} resource manifest${result?.changed === 1 ? "" : "s"}`);
    } catch (error) {
      notify(error.message);
    } finally {
      setNekoGuardBusy(false);
      setNekoGuardAction(null);
    }
  }

  async function submitAnnouncement(event) {
    event.preventDefault();
    try {
      await api.sendAnnouncement(endpoint, announcement);
      setAnnouncement("");
      setModal(null);
      notify("Announcement sent to connected players");
    } catch (error) {
      notify(controlStatus.running ? error.message : "Install and activate the WOLFHQ control bridge first");
    }
  }

  async function submitRestart(event) {
    event.preventDefault();
    try {
      await api.restartServer(endpoint, restartDraft);
      setModal(null);
      notify(`Server restart scheduled in ${restartDraft.delay} seconds`);
    } catch (error) {
      notify(controlStatus.running ? error.message : "Install and activate the WOLFHQ control bridge first");
    }
  }

  async function manageResource(resource, action) {
    try {
      if (action === "update") {
        await api.createBackup("pre-resource-update");
        const result = await api.gitAction({ path: resource.path, action: "pull" });
        notify(result.output || `${resource.name} updated`);
      } else {
        await api.resourceAction(endpoint, resource.name, action);
        notify(`${resource.name}: ${action} command sent`);
      }
      setResourceStates(await api.getResourceStates(endpoint));
    } catch (error) {
      notify(controlStatus.running ? error.message : "Install or repair the WOLFHQ control bridge, then restart the FiveM server once.");
    }
  }

  async function deleteResourceFolder(resource) {
    const typed = window.prompt(`This deletes the entire "${resource.name}" resource folder and all files inside it after creating a restore point.\n\nType ${resource.name} to confirm:`);
    if (typed === null) return;
    if (typed.trim() !== resource.name) {
      notify("Resource delete canceled");
      return;
    }
    setBusy(true);
    try {
      const result = await api.deleteResource(resource.path);
      const separator = isRemote ? "/" : "\\";
      setTabs((current) => current.filter((tab) => tab.path !== resource.path && !tab.path.startsWith(`${resource.path}${separator}`)));
      if (activePath === resource.path || activePath.startsWith(`${resource.path}${separator}`)) setActivePath("");
      setProject(result.project || await api.scanProject(project.rootPath));
      setResourceStates(await api.getResourceStates(endpoint));
      notify(`${resource.name} deleted after backup`);
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadServerFolder(destinationPath = project.rootPath) {
    setBusy(true);
    try {
      const result = await api.uploadFolder(destinationPath);
      if (!result) return;
      setProject(result.project || await api.scanProject(project.rootPath));
      notify(`${result.name} uploaded`);
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteServerFolder(folder) {
    const typed = window.prompt(`This deletes the entire "${folder.name}" folder and all files inside it after creating a restore point.\n\nType ${folder.name} to confirm:`);
    if (typed === null) return;
    if (typed.trim() !== folder.name) {
      notify("Folder delete canceled");
      return;
    }
    setBusy(true);
    try {
      const result = await api.deleteFolder(folder.path);
      const separator = isRemote ? "/" : "\\";
      setTabs((current) => current.filter((tab) => tab.path !== folder.path && !tab.path.startsWith(`${folder.path}${separator}`)));
      if (activePath === folder.path || activePath.startsWith(`${folder.path}${separator}`)) setActivePath("");
      setProject(result.project || await api.scanProject(project.rootPath));
      notify(`${folder.name} deleted after backup`);
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function installCatalogResource(resource) {
    if (!window.confirm(`Download the official ${resource.repo} repository into this server's resources folder?`)) return;
    setCatalogInstalling(resource.id);
    try {
      const result = await api.installOfficialResource(resource.id);
      await rescan();
      notify(`${result.resource.repo} installed. Review its documentation and dependencies before ensuring it.`);
    } catch (error) {
      notify(error.message);
    } finally {
      setCatalogInstalling("");
    }
  }

  async function submitConsoleCommand(event) {
    event.preventDefault();
    if (!consoleCommand.trim()) return;
    try {
      await api.runConsoleCommand(endpoint, consoleCommand);
      setConsoleCommand("");
      setLogs(await api.getServerLogs());
      notify("Console command executed");
    } catch (error) {
      notify(error.message);
    }
  }

  function openPlayerAction(player, action) {
    setPlayerModal({
      type: action,
      player,
      reason: action === "ban" ? "Banned by WOLFHQ administration" : "Kicked by WOLFHQ administration",
      confirmed: action !== "ban"
    });
  }

  function openPlayerNote(player) {
    const key = player.identifiers?.[0] || `${player.name}:${player.id}`;
    setPlayerModal({
      type: "note",
      player,
      key,
      note: opsData.notes?.[key] || player.note || ""
    });
  }

  async function submitPlayerAction(event) {
    event.preventDefault();
    if (!playerModal?.player || !["kick", "ban"].includes(playerModal.type)) return;
    if (playerModal.type === "ban" && !playerModal.confirmed) {
      notify("Tick the ban confirmation before sending it");
      return;
    }
    try {
      const control = await api.getControlStatus(endpoint);
      if (!control.running) throw new Error("Install or repair the WOLFHQ control bridge first, then restart or repair wolfhq-control.");
      const player = playerModal.player;
      await api.playerAction(endpoint, {
        id: player.id,
        name: player.name,
        identifiers: player.identifiers || [],
        action: playerModal.type,
        reason: playerModal.reason
      });
      notify(`${player.name} ${playerModal.type === "ban" ? "banned" : "kicked"}`);
      setPlayerModal(null);
      setPlayerDetails(await api.getPlayerDetails(endpoint));
      setOpsData(await api.getOpsDashboard());
    } catch (error) {
      notify(error.message);
    }
  }

  async function submitPlayerNote(event) {
    event.preventDefault();
    if (!playerModal?.player || playerModal.type !== "note") return;
    try {
      await api.savePlayerNote(playerModal.key, playerModal.note);
      const [players, dashboard] = await Promise.all([api.getPlayerDetails(endpoint), api.getOpsDashboard()]);
      setPlayerDetails(players);
      setOpsData(dashboard);
      setPlayerModal(null);
      notify("Player note saved");
    } catch (error) {
      notify(error.message);
    }
  }

  async function createBackupNow() {
    setBusy(true);
    try {
      await api.createBackup("manual");
      setBackups(await api.listBackups());
      notify("Restore point created");
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function restoreBackupNow(backup) {
    if (!window.confirm(`Restore ${backup.name}? Current files will be replaced by this restore point.`)) return;
    setBusy(true);
    try {
      await api.restoreBackup(backup.path);
      await rescan();
      notify("Backup restored");
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function runGit(action) {
    if (action === "rollback" && !window.confirm("Roll back this Git working tree to the state before the last pull?")) return;
    try {
      if (action === "pull") await api.createBackup("pre-deploy");
      const result = await api.gitAction({ path: gitTarget || project.rootPath, action });
      setGitOutput(result.output);
      notify(`Git ${action} completed`);
    } catch (error) {
      setGitOutput(cleanErrorMessage(error.message));
      notify(error.message);
    }
  }

  async function connectDatabase() {
    try {
      const tables = await api.databaseTables(dbConfig);
      setDbTables(tables);
      setDbTable(tables[0] || "");
      setDbRows(tables[0] ? await api.databaseRows(dbConfig, tables[0]) : { rows: [], columns: [] });
      notify(`Database linked: ${tables.length} tables`);
    } catch (error) {
      notify(error.message);
    }
  }

  async function loadDatabaseTable(table) {
    setDbTable(table);
    try {
      setDbRows(await api.databaseRows(dbConfig, table));
    } catch (error) {
      notify(error.message);
    }
  }

  function openDatabaseEditor(row, column) {
    const primaryKey = dbRows.columns.find((item) => item.Key === "PRI")?.Field;
    const where = primaryKey
      ? [{ column: primaryKey, value: row[primaryKey] }]
      : dbRows.columns.map((item) => ({ column: item.Field, value: row[item.Field] }));
    if (!where.length) return;
    setDbEditor({
      table: dbTable,
      column,
      where,
      original: row[column],
      value: row[column] == null ? "" : String(row[column]),
      valueIsNull: row[column] == null,
      keyLabel: primaryKey ? `${primaryKey}=${row[primaryKey]}` : "full-row match"
    });
  }

  async function saveDatabaseEditor(event) {
    event.preventDefault();
    if (!dbEditor) return;
    try {
      const result = await api.databaseUpdate(dbConfig, {
        table: dbEditor.table,
        column: dbEditor.column,
        value: dbEditor.valueIsNull ? null : dbEditor.value,
        valueIsNull: dbEditor.valueIsNull,
        where: dbEditor.where
      });
      setDbRows(await api.databaseRows(dbConfig, dbEditor.table));
      notify(result?.affectedRows ? `${dbEditor.table}.${dbEditor.column} saved` : `${dbEditor.table}.${dbEditor.column} was already up to date`);
      setDbEditor(null);
    } catch (error) {
      notify(error.message);
    }
  }

  async function saveOpsSettings() {
    try {
      const settings = await api.updateOpsSettings(opsSettings);
      setOpsSettings(settings);
      notify("Operations settings saved");
    } catch (error) {
      notify(error.message);
    }
  }

  async function checkAppUpdate() {
    setUpdater((current) => ({ ...current, checking: true, status: "Checking GitHub releases..." }));
    try {
      const latest = await api.checkForUpdate(updater.settings);
      setUpdater((current) => ({
        ...current,
        latest,
        checking: false,
        status: latest.available ? `Update ${latest.latestVersion} is ready to download.` : `WOLFHQ ${latest.currentVersion} is up to date.`
      }));
      notify(latest.available ? `Update ${latest.latestVersion} found` : "WOLFHQ is up to date");
      return latest;
    } catch (error) {
      setUpdater((current) => ({ ...current, checking: false, status: cleanErrorMessage(error.message) }));
      notify(error.message);
      return null;
    }
  }

  async function downloadAppUpdate() {
    setUpdater((current) => ({ ...current, downloading: true, status: "Downloading latest GitHub release..." }));
    try {
      const result = await api.downloadUpdate(updater.settings);
      setUpdater((current) => ({
        ...current,
        latest: result,
        downloading: false,
        status: result?.message || "Update downloaded."
      }));
      notify(result?.message || "Update downloaded");
    } catch (error) {
      setUpdater((current) => ({ ...current, downloading: false, status: cleanErrorMessage(error.message) }));
      notify(error.message);
    }
  }

  async function installServerArtifact(build = artifactBuild || artifactStatus?.latestBuild) {
    const targetBuild = Number(build);
    if (!targetBuild) {
      notify("Pick an artifact build first");
      return;
    }
    if (!window.confirm(`Update FXServer artifacts to build ${targetBuild}?\n\nWOLFHQ will back up old runtime files first and preserve resources, txData, server.cfg, and databases.`)) return;
    setArtifactBusy(true);
    try {
      const result = await api.installArtifact({ build: targetBuild });
      if (result?.project) setProject(result.project);
      await loadArtifactStatus();
      notify(`Server artifacts updated to build ${targetBuild}`);
    } catch (error) {
      notify(error.message);
    } finally {
      setArtifactBusy(false);
    }
  }

  async function runTitlebarUpdate() {
    if (updater.checking || updater.downloading) return;
    const latest = updater.latest?.available ? updater.latest : await checkAppUpdate();
    if (latest?.available) await downloadAppUpdate();
  }

  async function createOpsAccount(event) {
    event.preventDefault();
    try {
      await api.createAccount(accountDraft);
      setAccountDraft({ username: "", role: "developer", password: "" });
      setOpsData(await api.getOpsDashboard());
      notify("WOLFHQ account created");
    } catch (error) {
      notify(error.message);
    }
  }

  async function loginOpsAccount(event) {
    event.preventDefault();
    try {
      await api.loginAccount(accountLogin);
      setAccountLogin({ id: "", password: "" });
      setOpsData(await api.getOpsDashboard());
      notify("Active WOLFHQ account changed");
    } catch (error) {
      notify(error.message);
    }
  }

  async function deleteOpsAccount(account) {
    if (!window.confirm(`Remove the ${account.role} account ${account.username}?`)) return;
    try {
      await api.deleteAccount(account.id);
      setOpsData(await api.getOpsDashboard());
      notify("WOLFHQ account removed");
    } catch (error) {
      notify(error.message);
    }
  }

  async function saveAiProvider() {
    try {
      const settings = await api.saveAiSettings(aiSettings);
      const modelResult = await api.getAiModels();
      setAiSettings((current) => ({ ...current, ...settings, apiKey: "" }));
      setAiModels(modelResult.models?.length ? modelResult.models : AI_MODEL_FALLBACKS[settings.provider]);
      setAiModelsLive(Boolean(modelResult.live));
      if (settings.provider === "claude-code") refreshClaudeCodeLogin(settings.endpoint, false);
      notify("AI provider saved securely");
    } catch (error) {
      notify(error.message);
    }
  }

  async function refreshClaudeCodeLogin(endpointValue = aiSettings.endpoint, shouldNotify = true) {
    if (claudeCodeBusy) return;
    setClaudeCodeBusy(true);
    try {
      const result = await api.getClaudeCodeStatus({ endpoint: endpointValue || "claude" });
      setClaudeCodeStatus(result);
      if (shouldNotify) notify(result.message || (result.loggedIn ? "Claude Code login is ready" : "Claude Code login still needs attention"));
      return result;
    } catch (error) {
      const result = { available: false, loggedIn: false, message: cleanErrorMessage(error.message) };
      setClaudeCodeStatus(result);
      if (shouldNotify) notify(result.message);
      return result;
    } finally {
      setClaudeCodeBusy(false);
    }
  }

  async function startClaudeCodeLogin() {
    if (claudeCodeBusy) return;
    setClaudeCodeBusy(true);
    try {
      const settings = await api.saveAiSettings({ ...aiSettings, provider: "claude-code" });
      setAiSettings((current) => ({ ...current, ...settings, apiKey: "" }));
      setAiModels(AI_MODEL_FALLBACKS["claude-code"]);
      setAiModelsLive(true);
      const result = await api.loginClaudeCode({ endpoint: settings.endpoint || aiSettings.endpoint || "claude" });
      setClaudeCodeStatus(result);
      notify(result.message);
      window.setTimeout(() => refreshClaudeCodeLogin(settings.endpoint || aiSettings.endpoint || "claude", false), 7000);
    } catch (error) {
      const result = { available: false, loggedIn: false, message: cleanErrorMessage(error.message) };
      setClaudeCodeStatus(result);
      notify(result.message);
    } finally {
      setClaudeCodeBusy(false);
    }
  }

  async function logoutClaudeCode() {
    if (claudeCodeBusy) return;
    setClaudeCodeBusy(true);
    try {
      const result = await api.logoutClaudeCode({ endpoint: aiSettings.endpoint || "claude" });
      setClaudeCodeStatus(result);
      notify(result.message);
    } catch (error) {
      const result = { available: true, loggedIn: true, message: cleanErrorMessage(error.message) };
      setClaudeCodeStatus(result);
      notify(result.message);
    } finally {
      setClaudeCodeBusy(false);
    }
  }

  async function changeAiModel(model) {
    const next = { ...aiSettings, model };
    setAiSettings(next);
    try {
      const settings = await api.saveAiSettings(next);
      setAiSettings((current) => ({ ...current, ...settings, model: settings?.model || model, apiKey: "" }));
      notify(`AI model switched to ${model}`);
    } catch (error) {
      notify(error.message);
    }
  }

  function startNewAiChat() {
    if (aiBusy) return;
    setAiMessages([]);
    setAiProposal(null);
    setAiApplyReport(null);
    setAiSelected({});
    setAiPrompt("");
    notify("New AI chat started");
  }

  async function searchServerWithAi() {
    setAiBusy(true);
    try {
      setAiSearch(await api.searchAiFiles(aiSearchQuery));
    } catch (error) {
      notify(error.message);
    } finally {
      setAiBusy(false);
    }
  }

  async function generateAiProposal() {
    const question = aiPrompt.trim();
    if (question.length < 2 || aiBusy) return;
    setAiBusy(true);
    setAiProposal(null);
    setAiApplyReport(null);
    setAiPrompt("");
    setAiMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text: question }]);
    try {
      const proposal = await api.proposeAiChanges(question);
      setAiProposal(proposal);
      setAiSelected(Object.fromEntries(proposal.files.map((file) => [file.path, true])));
      setAiMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        text: proposal.response || proposal.summary,
        model: aiSettings.model
      }]);
      notify(proposal.files.length ? `${proposal.files.length} AI changes ready for review` : "AI analysis completed with no file changes");
    } catch (error) {
      setAiMessages((current) => [...current, { id: crypto.randomUUID(), role: "error", text: cleanErrorMessage(error.message) }]);
      notify(error.message);
    } finally {
      setAiBusy(false);
    }
  }

  async function applySelectedAiChanges() {
    const selected = (aiProposal?.files || []).filter((file) => aiSelected[file.path]);
    if (!selected.length) return;
    if (!window.confirm(`Apply ${selected.length} reviewed AI file change${selected.length === 1 ? "" : "s"}? WOLFHQ will create a restore point first.`)) return;
    setAiBusy(true);
    try {
      const report = await api.applyAiChanges(selected);
      setAiProposal(null);
      setAiApplyReport(report);
      setAiSelected({});
      setTabs([]);
      setActivePath("");
      await rescan();
      const changedCount = report.changedFiles?.length || 0;
      const unchangedCount = report.unchangedFiles?.length || 0;
      setAiMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        text: `Applied and verified ${changedCount} changed file${changedCount === 1 ? "" : "s"}.${unchangedCount ? ` ${unchangedCount} selected file${unchangedCount === 1 ? " was" : "s were"} already unchanged.` : ""}`,
        model: aiSettings.model
      }]);
      notify(`${changedCount} AI file changes verified`);
    } catch (error) {
      notify(error.message);
    } finally {
      setAiBusy(false);
    }
  }

  function changeAiProvider(provider) {
    const models = AI_MODEL_FALLBACKS[provider];
    const defaults = {
      anthropic: { model: "claude-sonnet-4-6", endpoint: "https://api.anthropic.com/v1/messages" },
      "openai-compatible": { model: "gpt-5.4", endpoint: "https://api.openai.com/v1/responses" },
      "claude-code": { model: "default", endpoint: "claude" }
    };
    const next = defaults[provider] || defaults.anthropic;
    setAiSettings((current) => ({
      ...current,
      provider,
      model: next.model,
      endpoint: next.endpoint
    }));
    setAiModels(models);
    setAiModelsLive(provider === "claude-code");
    if (provider === "claude-code") window.setTimeout(() => refreshClaudeCodeLogin(next.endpoint, false), 0);
  }

  const resourceNames = useMemo(() => project?.resources?.slice(0, 8) || [], [project]);
  const resourceStateMap = useMemo(() => Object.fromEntries(resourceStates.map((resource) => [resource.name, resource.state])), [resourceStates]);
  const visibleResources = useMemo(() => {
    const query = resourceSearch.trim().toLowerCase();
    if (!query) return project?.resources || [];
    return (project?.resources || []).filter((resource) => {
      const state = resourceStateMap[resource.name] || "unknown";
      return `${resource.name} ${resource.path} ${state}`.toLowerCase().includes(query);
    });
  }, [project?.resources, resourceSearch, resourceStateMap]);
  const visibleFolders = useMemo(() => {
    const folders = collectFolders(project?.tree || [], project?.rootPath || "");
    const query = folderSearch.trim().toLowerCase();
    if (!query) return folders;
    return folders.filter((folder) => `${folder.name} ${folder.relativePath} ${folder.path}`.toLowerCase().includes(query));
  }, [project?.tree, project?.rootPath, folderSearch]);
  const visibleLogs = useMemo(() => logs.lines.filter((line) => !consoleFilter || line.toLowerCase().includes(consoleFilter.toLowerCase())), [logs.lines, consoleFilter]);
  const focusedView = Boolean(project && activeView !== "project");
  const detectedCatalogFramework = useMemo(() => {
    if (project?.framework === "QBCore") return "QBCore";
    if (project?.framework === "Qbox") return "Qbox";
    if (project?.framework === "ESX") return "ESX";
    return "Standalone";
  }, [project?.framework]);
  const catalogCategories = useMemo(() => ["All", ...new Set(resourceCatalog.map((resource) => resource.category))], [resourceCatalog]);
  const visibleCatalog = useMemo(() => {
    const framework = catalogFramework === "Detected" ? detectedCatalogFramework : catalogFramework;
    const query = catalogSearch.trim().toLowerCase();
    return resourceCatalog.filter((resource) => {
      const frameworkMatch = framework === "All" || resource.framework === framework;
      const categoryMatch = catalogCategory === "All" || resource.category === catalogCategory;
      const queryMatch = !query || `${resource.repo} ${resource.description} ${resource.owner} ${resource.category}`.toLowerCase().includes(query);
      return frameworkMatch && categoryMatch && queryMatch;
    });
  }, [resourceCatalog, catalogFramework, catalogCategory, catalogSearch, detectedCatalogFramework]);
  const detectedAntiCheats = project?.antiCheats || [];
  const antiCheatChoices = useMemo(() => [
    "Overview",
    "Neko Anti-Cheat",
    ...detectedAntiCheats.map((antiCheat) => `${antiCheat.provider} // ${antiCheat.resourceName}`)
  ], [detectedAntiCheats]);
  const selectedAntiCheat = useMemo(() => detectedAntiCheats.find((antiCheat) =>
    `${antiCheat.provider} // ${antiCheat.resourceName}` === antiCheatDisplay
  ), [detectedAntiCheats, antiCheatDisplay]);
  const nekoSelected = antiCheatDisplay === "Neko Anti-Cheat";
  const nekoDetected = detectedAntiCheats.find((antiCheat) => antiCheat.provider === "Neko Anti-Cheat");
  const nekoEngineSelected = nekoSelected || selectedAntiCheat?.provider === "Neko Anti-Cheat";
  const nekoIncidents = nekoStatus.incidents || [];
  const nekoPlayers = nekoStatus.players || [];
  const observedNekoPlayers = nekoPlayers.length ? nekoPlayers : status.players || [];
  const inspectedNekoPlayer = observedNekoPlayers.find((player) => String(player.id) === String(inspectedNekoPlayerId)) || null;
  const nekoModulesOnline = Boolean(nekoStatus.running);
  const nekoActionText = nekoStatus.updateAvailable ? "UPDATE NEKO AC" : nekoStatus.installed ? "REPAIR NEKO AC" : "INSTALL NEKO AC";
  const nekoDeployText = nekoStatus.updateAvailable ? "UPDATE ENGINE" : nekoStatus.installed ? "REPAIR / REINSTALL ENGINE" : "INSTALL NEKO ANTI-CHEAT";
  const recentPlayerBans = useMemo(() => {
    const seen = new Set();
    return playerDetails
      .flatMap((player) => (player.recentBans || []).map((ban) => ({ ...ban, playerName: player.name })))
      .filter((ban) => {
        const key = `${ban.name || ban.playerName}-${ban.createdAt}-${ban.reason}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);
  }, [playerDetails]);
  const selectableAiModels = useMemo(() => {
    if (aiModels.some((model) => model.id === aiSettings.model)) return aiModels;
    return [{ id: aiSettings.model, name: aiSettings.model }, ...aiModels].filter((model) => model.id);
  }, [aiModels, aiSettings.model]);

  return (
    <div className="app-shell">
      <div className="ambient-grid" />
      <header className="titlebar">
        <div className="brand-lockup">
          <img className="brand-logo" src="./assets/wolfhq-icon.png" alt="WOLFHQ" />
          <div><strong>WOLFHQ</strong><span>FIVEM COMMAND CENTER // v{APP_VERSION}</span></div>
        </div>
        <div className="system-strip">
          <span><Circle size={7} fill={status.online ? "#58ffd1" : "#ff577f"} /> {status.online ? "SERVER LINKED" : isRemote ? "SSH CONNECTED" : "LOCAL MODE"}</span>
          <span>{isRemote ? "ENCRYPTED SSH + SFTP" : "SECURE FILE BRIDGE"}</span>
          <span>{new Date().toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" }).toUpperCase()}</span>
        </div>
        <div className="update-control">
          <button className={updater.checking || updater.downloading ? "spinning" : ""} onClick={runTitlebarUpdate} title={updater.status}>
            <Download size={13} />
            <span>{updater.downloading ? "DOWNLOADING" : updater.latest?.available ? `UPDATE ${updater.latest.latestVersion}` : "UPDATE"}</span>
          </button>
        </div>
        <div className="window-controls">
          <button onClick={api.minimize}><Minimize2 size={14} /></button>
          <button onClick={api.maximize}><Maximize2 size={13} /></button>
          <button className="close-window" onClick={api.close}><X size={15} /></button>
        </div>
      </header>

      <div className={`workspace ${focusedView ? "focused-workspace" : ""}`}>
        <aside className="rail">
          <button className={`rail-button project-rail ${activeView === "project" ? "active" : ""}`} title="Project" onClick={() => setActiveView("project")}><Layers3 size={19} /><span>Project</span></button>
          <button className={`rail-button resources-rail ${activeView === "resources" ? "active" : ""}`} title="Resources" onClick={() => setActiveView("resources")}><Box size={19} /><span>Resources</span></button>
          <button className={`rail-button folders-rail ${activeView === "folders" ? "active" : ""}`} title="Server Folders" onClick={() => setActiveView("folders")}><FolderOpen size={19} /><span>Folders</span></button>
          <button className={`rail-button hub-rail ${activeView === "resourceHub" ? "active" : ""}`} title="Official Resource Hub" onClick={() => setActiveView("resourceHub")}><Download size={19} /><span>Hub</span></button>
          <button className={`rail-button artifacts-rail ${activeView === "artifacts" ? "active" : ""}`} title="FXServer Artifacts" onClick={() => setActiveView("artifacts")}><PackageCheck size={19} /><span>Builds</span></button>
          <button className={`rail-button anticheat-rail ${activeView === "antiCheat" ? "active" : ""}`} title="Neko Anti-Cheat" onClick={() => setActiveView("antiCheat")}><ShieldAlert size={19} /><span>Neko AC</span></button>
          <button className={`rail-button players-rail ${activeView === "players" ? "active" : ""}`} title="Players" onClick={() => setActiveView("players")}><Users size={19} /><span>Players</span></button>
          <button className={`rail-button console-rail ${activeView === "console" ? "active" : ""}`} title="Console" onClick={() => setActiveView("console")}><Terminal size={19} /><span>Console</span></button>
          <button className={`rail-button performance-rail ${activeView === "performance" ? "active" : ""}`} title="Performance" onClick={() => setActiveView("performance")}><BarChart3 size={19} /><span>Perf</span></button>
          <button className={`rail-button backups-rail ${activeView === "backups" ? "active" : ""}`} title="Backups" onClick={() => setActiveView("backups")}><Archive size={19} /><span>Backups</span></button>
          <button className={`rail-button fleet-rail ${activeView === "fleet" ? "active" : ""}`} title="Server Fleet" onClick={() => setActiveView("fleet")}><Globe2 size={19} /><span>Fleet</span></button>
          <button className={`rail-button git-rail ${activeView === "git" ? "active" : ""}`} title="Git Deployment" onClick={() => setActiveView("git")}><GitBranch size={19} /><span>Git</span></button>
          <button className={`rail-button database-rail ${activeView === "database" ? "active" : ""}`} title="Database" onClick={() => setActiveView("database")}><Database size={19} /><span>Database</span></button>
          <button className={`rail-button automation-rail ${activeView === "automation" ? "active" : ""}`} title="Automation" onClick={() => setActiveView("automation")}><Bell size={19} /><span>Auto</span></button>
          <button className={`rail-button accounts-rail ${activeView === "accounts" ? "active" : ""}`} title="Accounts and Audit" onClick={() => setActiveView("accounts")}><UserCog size={19} /><span>Accounts</span></button>
          <button className={`rail-button history-rail ${activeView === "history" ? "active" : ""}`} title="Player History" onClick={() => setActiveView("history")}><History size={19} /><span>History</span></button>
          <button className={`rail-button ai-rail ${activeView === "ai" ? "active" : ""}`} title="WOLFHQ AI" onClick={() => setActiveView("ai")}><Sparkles size={19} /><span>AI</span></button>
          <button className={`rail-button settings-rail ${activeView === "settings" ? "active" : ""}`} title="Settings" onClick={() => setActiveView("settings")}><Settings2 size={19} /><span>Settings</span></button>
        </aside>

        {(!project || activeView === "project") && <aside className="explorer">
          <div className="section-heading">
            <div><span>{isRemote ? "REMOTE SERVER MATRIX" : "SERVER MATRIX"}</span><strong>{project?.name || "NO PROJECT LINKED"}</strong></div>
            <button className={busy ? "spinning" : ""} onClick={rescan} disabled={!project}><RefreshCw size={15} /></button>
          </div>
          <div className="connect-options">
            <button className="connect-button" onClick={chooseFolder}>
              <FolderOpen size={17} />
              <span>{project && !isRemote ? "SWITCH LOCAL FOLDER" : "LOCAL SERVER"}</span>
            </button>
            <button className={`connect-button remote ${isRemote ? "linked" : ""}`} onClick={openRemoteConnections}>
              <Globe2 size={17} />
              <span>{isRemote ? "REMOTE CONNECTED" : "REMOTE VPS"}</span>
            </button>
          </div>
          <div className="search-box">
            <Search size={14} />
            <input ref={searchRef} value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter project files..." />
            <kbd>CTRL K</kbd>
          </div>
          <div className="tree">
            {project ? project.tree.map((node) => (
              <TreeNode key={node.path} node={node} filter={filter} onOpen={openFile} selectedPath={activePath} />
            )) : (
              <div className="empty-tree">
                <div className="radar"><span /><span /><span /></div>
                <strong>Awaiting directory uplink</strong>
                <p>Select the folder containing your `server.cfg` and resources.</p>
              </div>
            )}
          </div>
          <div className="explorer-footer">
            <span><HardDrive size={13} /> {project ? formatBytes(project.stats.bytes) : "--"}</span>
            <span>{project?.stats.files || 0} FILES</span>
          </div>
        </aside>}

        <main className={`main-stage ${focusedView ? "focused-stage" : ""}`}>
          {!project ? (
            <section className="landing">
              <div className="hero-art" />
              <div className="hero-scan" />
              <div className="landing-content">
                <img className="landing-logo" src="./assets/wolfhq-logo.png" alt="WOLFHQ logo" />
                <div className="eyebrow"><span /> GLOBAL COMMAND SYSTEM READY</div>
                <h1>YOUR SERVER.<br /><em>FULLY VISIBLE.</em></h1>
                <p>Connect to a local server or securely manage a VPS in another country through encrypted SSH and SFTP.</p>
                <div className="landing-actions">
                  <button className="primary-action" onClick={chooseFolder}>
                    <FolderOpen size={18} /> LOCAL SERVER <ChevronRight size={17} />
                  </button>
                  <button className="primary-action remote-action" onClick={openRemoteConnections}>
                    <Cloud size={18} /> REMOTE VPS <ChevronRight size={17} />
                  </button>
                </div>
                <div className="feature-chips">
                  <span><Check size={13} /> SSH ENCRYPTED</span>
                  <span><Check size={13} /> LIVE EDITOR</span>
                  <span><Check size={13} /> WORLDWIDE ACCESS</span>
                </div>
              </div>
              <div className="boot-log">
                <span>01 // Electron secure bridge</span>
                <span>02 // SSH + SFTP remote transport</span>
                <span>03 // Tunneled FiveM telemetry</span>
                <strong>READY FOR UPLINK_</strong>
              </div>
            </section>
          ) : (
            <>
              {activeView === "project" && <>
                <section className="dashboard-head">
                  <div>
                    <div className="eyebrow"><span /> ACTIVE SERVER PROFILE</div>
                    <h2>{project.config.projectName || project.config.hostname || project.name}</h2>
                    <p>{isRemote ? `ssh://${project.remoteHost} // ${project.rootPath}` : project.rootPath}</p>
                  </div>
                  <div className="head-actions">
                    <button className="secondary-action cyan-action" onClick={() => setModal("announcement")}><Send size={15} /> ANNOUNCEMENT</button>
                    <button className="secondary-action danger-action" onClick={() => setModal("restart")}><RotateCcw size={15} /> RESTART</button>
                    <button className="secondary-action" onClick={openFileForge}><FileCode2 size={16} /> NEW SCRIPT</button>
                    <button className="secondary-action" onClick={() => setModal("resource")}><Plus size={16} /> NEW RESOURCE</button>
                    <button className="primary-action compact" onClick={rescan}><RefreshCw size={15} /> RESCAN</button>
                  </div>
                </section>

                <section className="metrics">
                  <MetricCard icon={Users} label="CONNECTED PLAYERS" value={`${status.playerCount}/${status.maxPlayers || project.config.maxClients || "--"}`} detail={status.online ? "LIVE TELEMETRY" : "SERVER OFFLINE"} />
                  <MetricCard icon={Cpu} label="FRAMEWORK" value={project.framework} detail="AUTO-DETECTED" color="violet" />
                  <MetricCard icon={Box} label="RESOURCES" value={project.stats.resources} detail={`${project.stats.files.toLocaleString()} FILES INDEXED`} color="pink" />
                  <MetricCard icon={Activity} label="SERVER STATE" value={status.online ? "ONLINE" : "STANDBY"} detail={status.endpoint || endpoint} color={status.online ? "green" : "amber"} />
                </section>
              </>}

              {activeView === "project" && <section className="content-grid">
                <div className="editor-panel panel-corners">
                  <div className="tabs-bar">
                    <div className="tabs">
                      {tabs.length ? tabs.map((tab) => (
                        <button key={tab.path} className={`tab ${tab.path === activePath ? "active" : ""}`} onClick={() => setActivePath(tab.path)}>
                          <Code2 size={13} /><span>{tab.name}</span>{tab.dirty && <i />}
                          <X size={12} onClick={(event) => { event.stopPropagation(); closeTab(tab.path); }} />
                        </button>
                      )) : <span className="no-tabs">SELECT A FILE FROM THE MATRIX</span>}
                    </div>
                    <button className="save-button" disabled={!activeTab?.dirty} onClick={saveActive}><Save size={15} /> SAVE</button>
                  </div>
                  <div className="editor-breadcrumb">
                    <Braces size={14} />
                    <span>{activeTab ? activeTab.path.replace(project.rootPath, project.name) : "Editor standing by"}</span>
                    {activeTab?.dirty && <strong>MODIFIED</strong>}
                  </div>
                  <div className="editor-space">
                    {activeTab ? (
                      <CodeMirror
                        value={activeTab.content}
                        height="100%"
                        theme="dark"
                        extensions={languageExtensions(activeTab.path)}
                        onChange={updateContent}
                        basicSetup={{ foldGutter: true, highlightActiveLine: true, autocompletion: true }}
                      />
                    ) : (
                      <div className="editor-empty">
                        <Code2 size={42} />
                        <strong>CODE MATRIX IDLE</strong>
                        <p>Open any editable file to inspect and modify it here.</p>
                        <div className="shortcut"><kbd>CTRL</kbd><span>+</span><kbd>S</kbd><small>TO SAVE</small></div>
                      </div>
                    )}
                  </div>
                  <div className="status-bar">
                    <span><Circle size={7} fill="#58ffd1" /> {isRemote ? "SFTP WRITE ACCESS" : "LOCAL WRITE ACCESS"}</span>
                    <span>{activeTab ? activeTab.content.split("\n").length : 0} LINES</span>
                    <span>UTF-8</span><span>LF</span>
                  </div>
                </div>

                <aside className="intel-panel">
                  <div className="intel-block panel-corners">
                    <div className="intel-title"><Network size={16} /><span>LIVE ENDPOINT</span><i className={status.online ? "online" : ""} /></div>
                    <div className="endpoint-row">
                      <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
                      <button onClick={() => refreshStatus(endpoint)}><RefreshCw size={14} /></button>
                    </div>
                    <div className="server-orbit">
                      <div className="orbit orbit-one" /><div className="orbit orbit-two" />
                      <Server size={31} />
                      <span className={status.online ? "online" : ""}>{status.online ? "ONLINE" : "OFFLINE"}</span>
                    </div>
                    <div className="mini-stats">
                      <div><span>CPU</span><strong>{status.process ? `${Math.round(status.process.cpu)}%` : "--"}</strong></div>
                      <div><span>RAM</span><strong>{status.process ? formatBytes(status.process.memoryBytes) : "--"}</strong></div>
                      <div><span>MAP</span><strong>{status.map || "--"}</strong></div>
                      <div><span>GAMETYPE</span><strong>{status.gameType || "--"}</strong></div>
                    </div>
                  </div>
                  <div className="intel-block resources-block panel-corners">
                    <div className="intel-title"><Box size={16} /><span>RESOURCE SIGNALS</span><small>{project.stats.resources}</small></div>
                    <div className="resource-list">
                      {resourceNames.map((resource, index) => (
                        <div key={resource.path}><span>{String(index + 1).padStart(2, "0")}</span><strong>{resource.name}</strong><i /></div>
                      ))}
                      {!resourceNames.length && <p>No manifests detected.</p>}
                    </div>
                  </div>
                  <div className="intel-block framework-block panel-corners">
                    <div><Gauge size={18} /><span>DETECTION CONFIDENCE</span></div>
                    <strong>{project.framework}</strong>
                    <div className="confidence"><span style={{ width: project.framework.includes("Standalone") ? "62%" : "94%" }} /></div>
                    <small>Based on manifests, resource names, and server.cfg signals.</small>
                  </div>
                </aside>
              </section>}

              {activeView === "resources" && (
                <section className="command-page panel-corners">
                  <div className="command-page-head">
                    <div><Box size={20} /><span><strong>RESOURCE REGISTRY</strong><small>All detected FiveM manifests and resource paths</small></span></div>
                    <div className="resource-page-tools">
                      <label><Search size={13} /><input placeholder="Search resources..." value={resourceSearch} onChange={(event) => setResourceSearch(event.target.value)} /></label>
                      <strong>{visibleResources.length}/{project.resources.length} ACTIVE SIGNALS</strong>
                    </div>
                  </div>
                  <div className="resource-grid">
                    {visibleResources.map((resource, index) => (
                      <div key={resource.path} className="resource-card managed">
                        <span>{String(index + 1).padStart(3, "0")}</span>
                        <Box size={18} />
                        <div className="resource-card-info">
                          <strong>{resource.name}</strong>
                          <small>{resource.path.replace(project.rootPath, project.name)}</small>
                          <i className={`resource-state ${resourceStateMap[resource.name] === "started" ? "online" : ""}`}>{resourceStateMap[resource.name] || "unknown"}</i>
                        </div>
                        <div className="resource-actions">
                          <button title="Inspect manifest" onClick={() => { openFile({ path: resource.manifest, name: "fxmanifest.lua", editable: true }); setActiveView("project"); }}><Code2 size={13} /></button>
                          <button title="Start" onClick={() => manageResource(resource, "ensure")}><Play size={13} /></button>
                          <button title="Stop" onClick={() => manageResource(resource, "stop")}><Square size={12} /></button>
                          <button title="Restart" onClick={() => manageResource(resource, "restart")}><RotateCcw size={13} /></button>
                          <button title="Git update" onClick={() => manageResource(resource, "update")}><GitBranch size={13} /></button>
                          <button className="danger" title="Delete resource folder" onClick={() => deleteResourceFolder(resource)}><Trash2 size={13} /></button>
                        </div>
                      </div>
                    ))}
                    {!visibleResources.length && <div className="resource-empty"><Search size={34} /><strong>NO MATCHING RESOURCES</strong><p>Try another resource name, path, or state.</p></div>}
                  </div>
                </section>
              )}

              {activeView === "folders" && (
                <section className="command-page folder-page panel-corners">
                  <div className="command-page-head">
                    <div><FolderOpen size={20} /><span><strong>SERVER FOLDER MATRIX</strong><small>Every indexed folder inside the active server root, with upload and guarded delete controls</small></span></div>
                    <div className="resource-page-tools">
                      <label><Search size={13} /><input placeholder="Search folders..." value={folderSearch} onChange={(event) => setFolderSearch(event.target.value)} /></label>
                      <button onClick={() => uploadServerFolder(project.rootPath)} disabled={busy}><UploadCloud size={13} /> UPLOAD TO ROOT</button>
                      <strong>{visibleFolders.length}/{project.stats.folders} FOLDERS</strong>
                    </div>
                  </div>
                  <div className="folder-grid">
                    {visibleFolders.map((folder, index) => (
                      <article key={folder.path} className="folder-card">
                        <span>{String(index + 1).padStart(3, "0")}</span>
                        <FolderOpen size={20} />
                        <div>
                          <strong>{folder.name}</strong>
                          <small>{folder.relativePath}</small>
                          <i>{folder.folderCount} folders // {folder.fileCount} files</i>
                        </div>
                        <div className="folder-card-actions">
                          <button title="Upload a folder here" onClick={() => uploadServerFolder(folder.path)} disabled={busy}><UploadCloud size={13} /> UPLOAD</button>
                          <button className="danger" title="Delete this folder" onClick={() => deleteServerFolder(folder)} disabled={busy}><Trash2 size={13} /> DELETE</button>
                        </div>
                      </article>
                    ))}
                    {!visibleFolders.length && <div className="resource-empty"><FolderOpen size={34} /><strong>NO MATCHING FOLDERS</strong><p>Try another folder name or path.</p></div>}
                  </div>
                </section>
              )}

              {activeView === "resourceHub" && (
                <section className="resource-hub panel-corners">
                  <div className="hub-header">
                    <img src="./assets/wolfhq-icon.png" alt="" />
                    <span>
                      <strong>OFFICIAL RESOURCE HUB</strong>
                      <small>Live verified repositories from Cfx.re, QBCore, Qbox, and ESX framework organizations</small>
                    </span>
                    <div className="hub-header-actions">
                      <i><ShieldCheck size={14} /> {resourceCatalog.length || "--"} VERIFIED</i>
                      <button className={catalogLoading ? "spinning" : ""} onClick={() => loadResourceCatalog(true)} disabled={catalogLoading}><RefreshCw size={14} /> REFRESH CATALOG</button>
                    </div>
                  </div>
                  <div className="hub-toolbar">
                    <label className="hub-search"><Search size={15} /><input value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder="Search official resources..." /></label>
                    <CatalogDropdown label="Framework" value={catalogFramework} options={["Detected", "All", "Standalone", "QBCore", "Qbox", "ESX"]} onChange={setCatalogFramework} />
                    <CatalogDropdown label="Category" value={catalogCategory} options={catalogCategories} onChange={setCatalogCategory} />
                    <button className="detected-framework" onClick={() => setCatalogFramework(detectedCatalogFramework)} title={`Show ${detectedCatalogFramework} resources`}>
                      <Cpu size={15} /><span>DETECTED SERVER</span><strong>{detectedCatalogFramework}</strong><em>USE FILTER</em>
                    </button>
                  </div>
                  <div className="hub-notice">
                    <PackageCheck size={17} />
                    <span>WOLFHQ downloads the official Git repository into a framework-specific resource folder. Review each repository's setup, SQL, dependencies, and license before starting it.</span>
                  </div>
                  <div className="hub-grid">
                    {visibleCatalog.map((resource) => (
                      <article className="hub-card" key={resource.id}>
                        <div className="hub-card-top">
                          <span className={`framework-tag ${resource.framework.toLowerCase()}`}>{resource.framework}</span>
                          <span className="official-tag"><ShieldCheck size={12} /> OFFICIAL</span>
                        </div>
                        <div className="hub-card-title"><Box size={22} /><span><strong>{resource.repo}</strong><small>{resource.owner}</small></span></div>
                        <p>{resource.description}</p>
                        <div className="hub-card-meta"><span>{resource.category}</span><code>git clone</code></div>
                        <div className="hub-card-actions">
                          <button onClick={() => api.openExternal(resource.sourceUrl)}><ExternalLink size={14} /> SOURCE</button>
                          <button className="install" disabled={Boolean(catalogInstalling)} onClick={() => installCatalogResource(resource)}>
                            {catalogInstalling === resource.id ? <RefreshCw className="spinning-icon" size={14} /> : <Download size={14} />}
                            {catalogInstalling === resource.id ? "INSTALLING" : "INSTALL"}
                          </button>
                        </div>
                      </article>
                    ))}
                    {!visibleCatalog.length && <div className="hub-empty"><Search size={34} /><strong>NO MATCHING OFFICIAL RESOURCES</strong><p>Change the framework, category, or search filter.</p></div>}
                  </div>
                </section>
              )}

              {activeView === "artifacts" && (
                <section className="artifact-page panel-corners">
                  <div className="artifact-hero">
                    <div className="artifact-core"><PackageCheck size={38} /><span /></div>
                    <span>
                      <strong>FXSERVER ARTIFACT CONTROL</strong>
                      <small>Official Cfx.re runtime feed, current build tracking, guarded replacement, and automatic restore-point storage.</small>
                    </span>
                    <div className={`artifact-state ${artifactStatus?.updateAvailable ? "needs-update" : "ready"}`}>
                      <Circle size={8} fill="currentColor" />
                      {artifactStatus?.managed ? artifactStatus.updateAvailable ? "UPDATE AVAILABLE" : "TRACKED CURRENTLY" : "UNMANAGED INSTALL"}
                    </div>
                  </div>

                  <div className="artifact-grid">
                    <div className="artifact-card primary">
                      <span>CURRENT SERVER ARTIFACT</span>
                      <strong>{artifactStatus?.currentBuild || "UNKNOWN"}</strong>
                      <small>{artifactStatus?.installedAt ? `Installed ${new Date(artifactStatus.installedAt).toLocaleString()}` : "WOLFHQ will know the exact build after the first managed artifact update."}</small>
                    </div>
                    <div className="artifact-card">
                      <span>LATEST OFFICIAL BUILD</span>
                      <strong>{artifactStatus?.latestBuild || "--"}</strong>
                      <small>{artifactStatus?.latestDate || "Waiting for Cfx feed"}</small>
                    </div>
                    <div className="artifact-card">
                      <span>RECOMMENDED BUILD</span>
                      <strong>{artifactStatus?.recommendedBuild || "--"}</strong>
                      <small>Official latest recommended label from the artifact feed.</small>
                    </div>
                    <div className="artifact-card">
                      <span>TARGET PLATFORM</span>
                      <strong>{artifactStatus?.platform === "linux" ? "LINUX VPS" : "WINDOWS SERVER"}</strong>
                      <small>{artifactStatus?.mode === "remote" ? "Using SSH updater" : "Using local runtime updater"}</small>
                    </div>
                  </div>

                  <div className="artifact-console">
                    <div className="artifact-feed">
                      <div className="artifact-section-title"><Download size={17} /><span><strong>OFFICIAL BUILDS</strong><small>{artifactStatus?.feedUrl || "https://runtime.fivem.net"}</small></span></div>
                      <div className="artifact-build-picker">
                        <label>Install target
                          <select value={artifactBuild} onChange={(event) => setArtifactBuild(event.target.value)}>
                            {(artifactStatus?.builds || []).slice(0, 30).map((build) => (
                              <option key={build.build} value={build.build}>{build.build} // {build.date}</option>
                            ))}
                          </select>
                        </label>
                        <button className={artifactBusy ? "spinning" : ""} onClick={() => loadArtifactStatus().catch((error) => notify(error.message))} disabled={artifactBusy}><RefreshCw size={14} /> REFRESH FEED</button>
                        <button className="primary-action compact" onClick={() => installServerArtifact()} disabled={artifactBusy || !artifactStatus?.builds?.length}><Download size={14} /> {artifactBusy ? "UPDATING..." : "INSTALL SELECTED"}</button>
                      </div>
                      <div className="artifact-build-list">
                        {(artifactStatus?.builds || []).slice(0, 12).map((build) => (
                          <button key={build.build} className={Number(artifactBuild) === build.build ? "active" : ""} onClick={() => setArtifactBuild(String(build.build))}>
                            <span>{build.build}</span><small>{build.date}</small>
                            {build.build === artifactStatus?.latestBuild && <i>LATEST</i>}
                            {build.build === artifactStatus?.recommendedBuild && <i>RECOMMENDED</i>}
                          </button>
                        ))}
                      </div>
                    </div>

                    <aside className="artifact-safety">
                      <div className="artifact-section-title"><ShieldCheck size={17} /><span><strong>UPDATE SAFETY</strong><small>What WOLFHQ protects during replacement</small></span></div>
                      <ul>
                        <li><Check size={13} /> Old FXServer runtime files move into `.wolfhq-artifacts/backups` first.</li>
                        <li><Check size={13} /> `resources`, `txData`, `server.cfg`, SQL files, and databases are preserved.</li>
                        <li><Check size={13} /> Remote VPS updates run inside your existing encrypted SSH session.</li>
                        <li><AlertTriangle size={13} /> Stop your FiveM server before replacing artifacts for the cleanest update.</li>
                      </ul>
                      <button onClick={() => api.openExternal(artifactStatus?.feedUrl || "https://runtime.fivem.net/artifacts/fivem/")}><ExternalLink size={14} /> OPEN OFFICIAL FEED</button>
                      <button onClick={() => setActiveView("backups")}><Archive size={14} /> VIEW RESTORE POINTS</button>
                    </aside>
                  </div>
                </section>
              )}

              {activeView === "antiCheat" && (
                <section className="anti-cheat-page panel-corners">
                  <div className="anti-cheat-header">
                    <div className="anti-cheat-mark"><ShieldAlert size={29} /></div>
                    <span>
                      <strong>NEKO ANTI-CHEAT COMMAND MATRIX</strong>
                      <small>Installable WOLFHQ runtime protection, provider visibility, live player observation, and incident scoring.</small>
                    </span>
                    <div className={`anti-cheat-readiness ${nekoStatus.running || detectedAntiCheats.some((item) => item.status === "enabled") ? "protected" : ""}`}>
                      <Circle size={8} fill="currentColor" />
                      <span>{nekoStatus.running ? "NEKO ENGINE ONLINE" : detectedAntiCheats.some((item) => item.status === "enabled") ? "PROTECTION DETECTED" : "NO ACTIVE ENGINE DETECTED"}</span>
                    </div>
                  </div>

                  <div className="anti-cheat-toolbar">
                    <CatalogDropdown label="Displayed protection system" value={antiCheatDisplay} options={antiCheatChoices} onChange={setAntiCheatDisplay} />
                    <div className="anti-cheat-toolbar-stat"><span>DETECTED</span><strong>{detectedAntiCheats.length}</strong></div>
                    <div className="anti-cheat-toolbar-stat"><span>ENABLED</span><strong>{detectedAntiCheats.filter((item) => item.status === "enabled").length}</strong></div>
                    <button className={`${nekoInstalling ? "spinning" : ""} ${nekoStatus.installed ? "installed" : ""} ${nekoStatus.updateAvailable ? "outdated" : ""}`} onClick={installNekoEngine} disabled={nekoInstalling}><ShieldAlert size={14} /> {nekoActionText}</button>
                    <button className={busy ? "spinning" : ""} onClick={rescan}><RefreshCw size={14} /> RESCAN SERVER</button>
                  </div>

                  <div className="anti-cheat-body">
                    <div className="anti-cheat-metrics">
                      <div><ShieldCheck size={20} /><span>ACTIVE PROVIDER<strong>{nekoStatus.running ? "Neko Anti-Cheat" : selectedAntiCheat?.provider || detectedAntiCheats.find((item) => item.status === "enabled")?.provider || "None"}</strong></span></div>
                      <div><Eye size={20} /><span>OBSERVED PLAYERS<strong>{nekoPlayers.length || status.playerCount || 0}</strong></span></div>
                      <div><AlertTriangle size={20} /><span>LIVE INCIDENTS<strong>{nekoStatus.incidentCount ?? nekoIncidents.length}</strong></span></div>
                      <div><Activity size={20} /><span>TELEMETRY LINK<strong>{nekoStatus.running ? "ONLINE" : nekoStatus.installed || nekoDetected ? "INSTALLED / START REQUIRED" : "NOT INSTALLED"}</strong></span></div>
                    </div>

                    <div className="anti-cheat-grid">
                      <div className="anti-cheat-panel detected-panel">
                        <div className="anti-panel-title"><ShieldAlert size={17} /><span><strong>DETECTED PROTECTION</strong><small>Manifest, path, and startup signals found during the server scan</small></span></div>
                        <div className="detected-ac-list">
                          {detectedAntiCheats.map((antiCheat) => {
                            const label = `${antiCheat.provider} // ${antiCheat.resourceName}`;
                            return (
                              <button className={antiCheatDisplay === label ? "active" : ""} key={antiCheat.id} onClick={() => setAntiCheatDisplay(label)}>
                                <div className="ac-provider-icon"><ShieldCheck size={18} /></div>
                                <span><strong>{antiCheat.provider}</strong><small>{antiCheat.resourceName} // {antiCheat.type}</small></span>
                                <i className={antiCheat.status}>{antiCheat.status}</i>
                                <em>{antiCheat.confidence}% MATCH</em>
                              </button>
                            );
                          })}
                          {!detectedAntiCheats.length && (
                            <div className="no-ac-detected"><ShieldAlert size={31} /><strong>NO ANTI-CHEAT RESOURCE FOUND</strong><p>WOLFHQ checked resource names, manifests, security folders, and server.cfg startup entries.</p></div>
                          )}
                        </div>
                      </div>

                      <div className="anti-cheat-panel provider-panel">
                        <div className="anti-panel-title"><Fingerprint size={17} /><span><strong>PROVIDER INSPECTOR</strong><small>The selected system is displayed here; no server files are changed.</small></span></div>
                        {nekoEngineSelected ? (
                          <div className="neko-provider">
                            <div className="neko-core-orbit"><span /><span /><ShieldAlert size={42} /></div>
                            <strong>NEKO ANTI-CHEAT</strong>
                            <small>{nekoStatus.updateAvailable ? `OUT OF DATE // ${nekoStatus.version || "unknown"} -> ${nekoStatus.latestVersion}` : nekoStatus.running ? `ONLINE // ${nekoStatus.version || "1.0.0"}` : nekoStatus.installed || nekoDetected ? "INSTALLED // WAITING FOR RESOURCE START" : "READY TO INSTALL"}</small>
                            <p>Neko Anti-Cheat deploys a FiveM client/server resource with movement, integrity, weapon, event, entity, and identity protection. It reports live incidents back into WOLFHQ.</p>
                            <div className="anti-profile-selector">
                              {["Monitor", "Balanced", "Strict"].map((profile) => <button className={antiCheatProfile === profile ? "active" : ""} key={profile} onClick={() => syncNekoProfile(profile)}>{profile}</button>)}
                            </div>
                            <div className="neko-runtime-grid">
                              <div><span>PROFILE</span><strong>{nekoStatus.profile || antiCheatProfile}</strong></div>
                              <div><span>BANS</span><strong>{nekoStatus.banCount || 0}</strong></div>
                              <div><span>RESOURCE</span><strong>{nekoStatus.resource || "neko-anticheat"}</strong></div>
                              <div><span>STATUS</span><strong>{nekoStatus.running ? "ONLINE" : nekoStatus.installed ? "INSTALLED" : "NOT INSTALLED"}</strong></div>
                            </div>
                            <button className={`neko-deploy ${nekoStatus.installed ? "installed" : ""} ${nekoStatus.updateAvailable ? "outdated" : ""}`} onClick={installNekoEngine} disabled={nekoInstalling}>{nekoInstalling ? <RefreshCw size={15} /> : <Download size={15} />} {nekoDeployText}</button>
                            {nekoStatus.error && <p className="neko-status-warning">{nekoStatus.error}</p>}
                          </div>
                        ) : selectedAntiCheat ? (
                          <div className="existing-provider">
                            <div className="existing-provider-head"><ShieldCheck size={32} /><span><strong>{selectedAntiCheat.provider}</strong><small>{selectedAntiCheat.resourceName}</small></span><i className={selectedAntiCheat.status}>{selectedAntiCheat.status}</i></div>
                            <dl>
                              <div><dt>TYPE</dt><dd>{selectedAntiCheat.type.toUpperCase()}</dd></div>
                              <div><dt>CONFIDENCE</dt><dd>{selectedAntiCheat.confidence}%</dd></div>
                              <div><dt>RESOURCE PATH</dt><dd>{selectedAntiCheat.path.replace(project.rootPath, project.name)}</dd></div>
                            </dl>
                            <div className="ac-evidence">{selectedAntiCheat.evidence.map((evidence) => <span key={evidence}><Check size={12} /> {evidence}</span>)}</div>
                            <button onClick={() => { openFile({ path: selectedAntiCheat.manifest, name: "fxmanifest.lua", editable: true }); setActiveView("project"); }}><Code2 size={14} /> INSPECT MANIFEST</button>
                          </div>
                        ) : (
                          <div className="provider-overview">
                            <img src="./assets/wolfhq-icon.png" alt="" />
                            <strong>PROTECTION OVERVIEW</strong>
                            <p>Select a detected provider to inspect it, or choose Neko Anti-Cheat to preview the future protection console.</p>
                            <button onClick={() => setAntiCheatDisplay("Neko Anti-Cheat")}><ShieldAlert size={14} /> PREVIEW NEKO ANTI-CHEAT</button>
                          </div>
                        )}
                      </div>

                      <div className="anti-cheat-panel modules-panel">
                        <div className="anti-panel-title"><Activity size={17} /><span><strong>DEFENCE MODULES</strong><small>{nekoModulesOnline ? "Runtime modules active inside neko-anticheat" : "Install Neko Anti-Cheat to activate these modules"}</small></span></div>
                        <div className="anti-module-grid">
                          {ANTI_CHEAT_MODULES.map(({ name, detail, icon: Icon }) => <div key={name} className={nekoModulesOnline ? "active" : ""}><Icon size={17} /><span><strong>{name}</strong><small>{detail}</small></span><i>{nekoModulesOnline ? "ACTIVE" : "READY"}</i></div>)}
                        </div>
                      </div>

                      <div className="anti-cheat-panel activity-panel">
                        <div className="anti-panel-title"><Eye size={17} /><span><strong>PLAYER OBSERVATION</strong><small>{nekoStatus.running ? "Live Neko telemetry, scores, and recent flags" : "Connected players now; install Neko Anti-Cheat for behavioural telemetry"}</small></span></div>
                        <div className="anti-player-list">
                          {observedNekoPlayers.slice(0, 8).map((player) => (
                            <button className={String(inspectedNekoPlayerId) === String(player.id) ? "active" : ""} key={`${player.id}-${player.name}`} onClick={() => { setInspectedNekoPlayerId(player.id); loadNekoStatus().catch(() => {}); }} title="Open Neko Player Intel and spectate controls">
                              <span><i />#{player.id}</span><strong>{player.name}</strong><small>{player.ping ?? "--"} ms // score {player.score ?? 0}</small><em>{player.flags?.length ? `${player.flags.length} FLAGS` : nekoStatus.running ? "OPEN INTEL / SPECTATE" : "NO EVENT STREAM"}</em>
                            </button>
                          ))}
                          {!observedNekoPlayers.length && <div className="anti-empty-feed"><Eye size={28} /><strong>NO PLAYERS TO OBSERVE</strong><p>Connected players will appear here. Neko telemetry starts after the resource is installed and running.</p></div>}
                        </div>
                        {!!observedNekoPlayers.length && <div className="neko-click-hint"><Eye size={13} /> Click a player name to open the full live player intel popup.</div>}
                      </div>

                      <div className="anti-cheat-panel neko-version-panel">
                        <div className="anti-panel-title"><ShieldCheck size={17} /><span><strong>ENGINE VERSION</strong><small>Installed runtime and entity defence state</small></span></div>
                        <div className={`neko-version-card ${nekoStatus.updateAvailable ? "outdated" : ""}`}>
                          <strong>{nekoStatus.version || (nekoStatus.installed ? "Installed" : "Not installed")}</strong>
                          <span>{nekoStatus.pendingRestart ? `Update staged to ${nekoStatus.stagedVersion}. Restart neko-anticheat or FXServer to load it.` : nekoStatus.updateAvailable ? `Out of date. Latest bundled engine is ${nekoStatus.latestVersion}. Click Update Engine.` : nekoStatus.running ? "Neko telemetry endpoint online" : nekoStatus.installed ? "Installed, waiting for resource start" : "Install Neko Anti-Cheat to activate version tracking"}</span>
                          <i>{nekoStatus.resource || "neko-anticheat"} // latest {nekoStatus.latestVersion || "--"}</i>
                        </div>
                        <div className="neko-guard-actions">
                          <button onClick={() => updateNekoGuards("install")} disabled={nekoGuardBusy || !nekoStatus.installed}><ShieldCheck size={14} /> INJECT RESOURCE GUARD</button>
                          <button className="remove" onClick={() => updateNekoGuards("remove")} disabled={nekoGuardBusy}><Trash2 size={14} /> REMOVE RESOURCE GUARD</button>
                          <span>{nekoStatus.protectedResources ? `${Object.keys(nekoStatus.protectedResources).length} resources reporting guard signals` : "Resource guard markers patch manifests and can be removed anytime."}</span>
                        </div>
                      </div>

                      <div className="anti-cheat-panel neko-warning-panel">
                        <div className="anti-panel-title"><AlertTriangle size={17} /><span><strong>WARNING STREAM</strong><small>Recent Neko AC incidents moved out of Player Observation</small></span></div>
                        <div className="neko-incident-feed">
                          {nekoIncidents.slice(-5).reverse().map((incident) => (
                            <div key={incident.id || `${incident.createdAt}-${incident.message}`}>
                              <AlertTriangle size={14} />
                              <span><strong>{incident.moduleLabel || incident.module}</strong><small>{incident.name} // severity {incident.severity}</small></span>
                              <em>{incident.message}</em>
                            </div>
                          ))}
                          {!nekoIncidents.length && <div className="neko-empty-warning"><Check size={16} /> No warnings recorded by Neko Anti-Cheat.</div>}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {activeView === "players" && (
                <section className="command-page player-page panel-corners">
                  <div className="command-page-head">
                    <div><Users size={20} /><span><strong>LIVE PLAYER MATRIX</strong><small>Live endpoint data, WOLFHQ notes, identifiers, and recent admin history</small></span></div>
                    <div className="player-head-actions">
                      <button onClick={async () => setPlayerDetails(await api.getPlayerDetails(endpoint))}><RefreshCw size={14} /> REFRESH</button>
                      <strong>{status.playerCount}/{status.maxPlayers || project.config.maxClients || "--"} CONNECTED</strong>
                    </div>
                  </div>
                  <div className="player-command-layout">
                    <div className="player-card-list">
                      {playerDetails.map((player) => (
                        <article className="player-admin-card" key={`${player.id}-${player.name}`}>
                          <div className="player-card-top">
                            <span className="player-live-dot" />
                            <div>
                              <strong>{player.name || "Unknown player"}</strong>
                              <small>SERVER ID #{player.id} // {player.ping ?? "--"} MS</small>
                            </div>
                            <i>{player.recentBans?.length ? "BAN HISTORY" : "CLEAR"}</i>
                          </div>
                          <div className="player-identifiers">
                            {(player.identifiers || []).slice(0, 4).map((identifier) => <code key={identifier}>{identifier}</code>)}
                            {!player.identifiers?.length && <code>{player.endpoint || "Protected endpoint"}</code>}
                          </div>
                          <div className="player-card-stats">
                            <div><span>FIRST SEEN</span><strong>{player.history?.firstSeen ? new Date(player.history.firstSeen).toLocaleString() : "This session"}</strong></div>
                            <div><span>LAST SEEN</span><strong>{player.history?.lastSeen ? new Date(player.history.lastSeen).toLocaleString() : "Live now"}</strong></div>
                            <div><span>WOLFHQ NOTE</span><strong>{player.note ? "SAVED" : "NONE"}</strong></div>
                          </div>
                          {player.recentBans?.length ? (
                            <div className="player-ban-warning"><Ban size={14} /><span>Recent WOLFHQ ban: {player.recentBans[0].reason || "No reason"} // {player.recentBans[0].createdAt ? new Date(player.recentBans[0].createdAt).toLocaleString() : "unknown time"}</span></div>
                          ) : (
                            <div className="player-ban-clear"><ShieldCheck size={14} /><span>No matching WOLFHQ ban record for this identifier.</span></div>
                          )}
                          <div className="player-actions">
                            <button onClick={() => openPlayerNote(player)}><FileCode2 size={13} /> NOTE</button>
                            <button onClick={() => openPlayerAction(player, "kick")}><UserX size={13} /> KICK</button>
                            <button className="danger" onClick={() => openPlayerAction(player, "ban")}><Ban size={13} /> BAN</button>
                          </div>
                        </article>
                      ))}
                      {!playerDetails.length && (
                        <div className="page-empty"><Wifi size={38} /><strong>NO PLAYERS CONNECTED</strong><p>The list refreshes from `{status.endpoint || endpoint}/players.json` every four seconds.</p></div>
                      )}
                    </div>
                    <aside className="player-side-panel">
                      <div className="player-side-card">
                        <span><Users size={16} /> SESSION INTEL</span>
                        <div><strong>{playerDetails.length}</strong><small>live players indexed</small></div>
                        <div><strong>{opsData.playerHistory?.length || 0}</strong><small>historical players stored on this PC</small></div>
                        <div><strong>{recentPlayerBans.length}</strong><small>recent matching ban records</small></div>
                      </div>
                      <div className="player-side-card ban-feed">
                        <span><Ban size={16} /> RECENT SERVER BANS</span>
                        {recentPlayerBans.map((ban, index) => (
                          <div key={`${ban.createdAt}-${index}`}><strong>{ban.name || ban.playerName || "Unknown"}</strong><small>{ban.reason || "No reason supplied"}</small><em>{ban.createdAt ? new Date(ban.createdAt).toLocaleString() : "unknown time"}</em></div>
                        ))}
                        {!recentPlayerBans.length && <p>No matching WOLFHQ bans for the currently connected identifiers.</p>}
                      </div>
                      <div className="player-side-card global-intel">
                        <span><Globe2 size={16} /> GLOBAL BAN INTEL</span>
                        <div><strong>PROVIDER READY</strong><small>FiveM has no public universal ban database. WOLFHQ can only detect external bans when an anti-cheat or reputation provider exposes an API/key.</small></div>
                        <div><strong>ANTI-CHEAT SOURCE</strong><small>Future adapters can label bans by provider, for example Neko Anti-Cheat, txAdmin exports, or a paid anti-cheat API.</small></div>
                      </div>
                    </aside>
                        </div>
                </section>
              )}

              {activeView === "console" && (
                <section className="command-page console-page panel-corners">
                  <div className="command-page-head">
                    <div><Terminal size={20} /><span><strong>SERVER CONSOLE FEED</strong><small>{logs.path || "Searching for the latest FXServer log"}</small></span></div>
                    <div className="console-tools">
                      <label><Search size={13} /><input placeholder="Filter logs..." value={consoleFilter} onChange={(event) => setConsoleFilter(event.target.value)} /></label>
                      <button onClick={async () => setLogs(await api.getServerLogs())}><RefreshCw size={15} /> REFRESH</button>
                    </div>
                  </div>
                  <div className="console-output">
                    {visibleLogs.length ? visibleLogs.map((line, index) => (
                      <div key={`${index}-${line.slice(0, 20)}`} className={/error|exception|failed|fatal/i.test(line) ? "error" : /warn/i.test(line) ? "warn" : ""}>{line}</div>
                    )) : "Awaiting log data..."}
                  </div>
                  <form className="console-command" onSubmit={submitConsoleCommand}>
                    <Terminal size={15} />
                    <input placeholder="Execute a FiveM console command..." value={consoleCommand} onChange={(event) => setConsoleCommand(event.target.value)} />
                    <button type="submit" disabled={!consoleCommand.trim()}><Send size={14} /> EXECUTE</button>
                  </form>
                </section>
              )}

              {OPERATIONS_VIEWS.has(activeView) && (
                <section className="ops-page module-page">
                  <div className={`ops-card performance-card panel-corners ${activeView !== "performance" ? "module-hidden" : ""}`}>
                    <div className="ops-title"><BarChart3 size={18} /><span><strong>PERFORMANCE HISTORY</strong><small>CPU, memory, players, uptime, and crash signals retained locally</small></span></div>
                    <div className="spark-grid">
                      <SparkChart label="CPU %" values={opsData.metrics.map((item) => item.cpu)} />
                      <SparkChart label="RAM MB" color="#9d73ff" values={opsData.metrics.map((item) => Math.round(item.memoryBytes / 1024 / 1024))} />
                      <SparkChart label="PLAYERS" color="#58ffd1" values={opsData.metrics.map((item) => item.players)} />
                    </div>
                    <div className="ops-stats">
                      <span>UPTIME <strong>{status.process?.started ? `${Math.max(0, Math.floor((Date.now() - new Date(status.process.started).getTime()) / 3600000))}h` : "--"}</strong></span>
                      <span>CRASH SAMPLES <strong>{opsData.metrics.filter((item, index, all) => index > 0 && all[index - 1].online && !item.online).length}</strong></span>
                      <span>HISTORY <strong>{opsData.metrics.length}</strong></span>
                    </div>
                  </div>

                  <div className={`ops-card backup-card panel-corners ${activeView !== "backups" ? "module-hidden" : ""}`}>
                    <div className="ops-title"><Archive size={18} /><span><strong>AUTOMATIC BACKUPS</strong><small>Restore points are also created before the first file edit and Git deployment</small></span></div>
                    <div className="ops-actions">
                      <button onClick={createBackupNow} disabled={busy}><Archive size={14} /> CREATE RESTORE POINT</button>
                      <select value={opsSettings.backupSchedule || "manual"} onChange={(event) => setOpsSettings({ ...opsSettings, backupSchedule: event.target.value })}>
                        <option value="manual">Manual only</option><option value="hourly">Every hour</option><option value="daily">Every day</option>
                      </select>
                    </div>
                    <div className="backup-list">
                      {backups.slice(0, 6).map((backup) => (
                        <div key={backup.path}><Archive size={13} /><span><strong>{backup.name}</strong><small>{new Date(backup.createdAt).toLocaleString()} // {formatBytes(backup.size)}</small></span><button onClick={() => restoreBackupNow(backup)}>RESTORE</button></div>
                      ))}
                      {!backups.length && <p>No restore points created yet.</p>}
                    </div>
                  </div>

                  <div className={`ops-card fleet-card panel-corners ${activeView !== "fleet" ? "module-hidden" : ""}`}>
                    <div className="ops-title"><Globe2 size={18} /><span><strong>MULTI-SERVER FLEET</strong><small>Saved VPS profiles and the active encrypted connection</small></span></div>
                    <div className="fleet-list">
                      {fleet.map((server) => (
                        <button key={server.id} className={server.active ? "active" : ""} onClick={openRemoteConnections}>
                          <Server size={15} /><span><strong>{server.name}</strong><small>{server.host}:{server.port}</small></span><i>{server.active ? "CONNECTED" : "SAVED"}</i>
                        </button>
                      ))}
                      {!fleet.length && <div className="compact-empty">No saved VPS profiles.</div>}
                    </div>
                  </div>

                  <div className={`ops-card git-card panel-corners ${activeView !== "git" ? "module-hidden" : ""}`}>
                    <div className="ops-title"><GitBranch size={18} /><span><strong>GIT DEPLOYMENT</strong><small>Status, fast-forward deployment, and rollback with a pre-deploy backup</small></span></div>
                    <select value={gitTarget} onChange={(event) => setGitTarget(event.target.value)}>
                      <option value={project.rootPath}>Server root</option>
                      {project.resources.map((resource) => <option key={resource.path} value={resource.path}>{resource.name}</option>)}
                    </select>
                    <div className="ops-actions">
                      <button onClick={() => runGit("status")}><Search size={13} /> STATUS</button>
                      <button onClick={() => runGit("pull")}><GitBranch size={13} /> DEPLOY PULL</button>
                      <button className="danger" onClick={() => runGit("rollback")}><History size={13} /> ROLLBACK</button>
                    </div>
                    <pre className="git-output">{gitOutput}</pre>
                  </div>

                  <div className={`ops-card database-card panel-corners ${activeView !== "database" ? "module-hidden" : ""}`}>
                    <div className="ops-title"><Database size={18} /><span><strong>DATABASE MANAGER</strong><small>Click any visible cell to edit and save it back to MySQL with parameterized writes</small></span></div>
                    <div className="db-connect">
                      <input placeholder="Host" value={dbConfig.host} onChange={(event) => setDbConfig({ ...dbConfig, host: event.target.value })} />
                      <input type="number" placeholder="Port" value={dbConfig.port} onChange={(event) => setDbConfig({ ...dbConfig, port: Number(event.target.value) })} />
                      <input placeholder="User" value={dbConfig.user} onChange={(event) => setDbConfig({ ...dbConfig, user: event.target.value })} />
                      <input type="password" placeholder="Password" value={dbConfig.password} onChange={(event) => setDbConfig({ ...dbConfig, password: event.target.value })} />
                      <input placeholder="Database" value={dbConfig.database} onChange={(event) => setDbConfig({ ...dbConfig, database: event.target.value })} />
                      <button onClick={connectDatabase}><Database size={13} /> CONNECT</button>
                    </div>
                    <div className="db-browser">
                      <aside>{dbTables.map((table) => <button key={table} className={dbTable === table ? "active" : ""} onClick={() => loadDatabaseTable(table)}>{table}</button>)}</aside>
                      <div className="db-table-wrap">
                        {dbRows.rows.length ? (
                          <table><thead><tr>{dbRows.columns.map((column) => <th key={column.Field}>{column.Field}</th>)}</tr></thead>
                            <tbody>{dbRows.rows.slice(0, 100).map((row, rowIndex) => <tr key={rowIndex}>{dbRows.columns.map((column) => <td key={column.Field} onClick={() => openDatabaseEditor(row, column.Field)} title="Click to edit this value">{row[column.Field] == null ? "NULL" : String(row[column.Field])}</td>)}</tr>)}</tbody>
                          </table>
                        ) : <div className="compact-empty">Connect and select a table. Click any cell to edit it safely.</div>}
                      </div>
                    </div>
                  </div>

                  <div className={`ops-card crash-card panel-corners ${activeView !== "automation" ? "module-hidden" : ""}`}>
                    <div className="ops-title"><Bell size={18} /><span><strong>CRASH DETECTION</strong><small>Offline detection, optional restart command, and Discord webhook alerts</small></span></div>
                    <label className="ops-check"><input type="checkbox" checked={Boolean(opsSettings.crashDetection)} onChange={(event) => setOpsSettings({ ...opsSettings, crashDetection: event.target.checked })} /> Monitor FXServer state</label>
                    <label className="ops-check"><input type="checkbox" checked={Boolean(opsSettings.autoRestart)} onChange={(event) => setOpsSettings({ ...opsSettings, autoRestart: event.target.checked })} /> Execute restart command after a crash</label>
                    <input placeholder="Restart command, e.g. powershell Start-Service FiveM" value={opsSettings.restartCommand || ""} onChange={(event) => setOpsSettings({ ...opsSettings, restartCommand: event.target.value })} />
                    <input type="password" placeholder="Discord webhook URL (kept on this PC)" value={opsSettings.discordWebhook || ""} onChange={(event) => setOpsSettings({ ...opsSettings, discordWebhook: event.target.value })} />
                    <button onClick={saveOpsSettings}><Save size={13} /> SAVE AUTOMATION</button>
                  </div>

                  <div className={`ops-card accounts-card panel-corners ${activeView !== "accounts" ? "module-hidden" : ""}`}>
                    <div className="ops-title"><UserCog size={18} /><span><strong>WOLFHQ ACCOUNTS</strong><small>Owner, admin, and developer permissions with local audit identity</small></span></div>
                    <div className="current-account"><ShieldCheck size={15} /><span>ACTIVE ACCOUNT</span><strong>{opsData.current?.username || "Owner"} // {opsData.current?.role || "owner"}</strong></div>
                    <form className="account-form" onSubmit={createOpsAccount}>
                      <input placeholder="New username" value={accountDraft.username} onChange={(event) => setAccountDraft({ ...accountDraft, username: event.target.value })} />
                      <select value={accountDraft.role} onChange={(event) => setAccountDraft({ ...accountDraft, role: event.target.value })}><option value="developer">Developer</option><option value="admin">Admin</option><option value="owner">Owner</option></select>
                      <input type="password" placeholder="Password" value={accountDraft.password} onChange={(event) => setAccountDraft({ ...accountDraft, password: event.target.value })} />
                      <button type="submit"><Plus size={13} /> ADD</button>
                    </form>
                    <form className="account-form login" onSubmit={loginOpsAccount}>
                      <select value={accountLogin.id} onChange={(event) => setAccountLogin({ ...accountLogin, id: event.target.value })}><option value="">Switch account...</option>{opsData.accounts.map((account) => <option key={account.id} value={account.id}>{account.username} // {account.role}</option>)}</select>
                      <input type="password" placeholder="Account password" value={accountLogin.password} onChange={(event) => setAccountLogin({ ...accountLogin, password: event.target.value })} />
                      <button type="submit"><KeyRound size={13} /> LOGIN</button>
                    </form>
                    <div className="account-list">
                      {opsData.accounts.map((account) => (
                        <div key={account.id}><UserCog size={13} /><span><strong>{account.username}</strong><small>{account.role}</small></span>{account.id !== "owner" && account.id !== opsData.current?.id && <button onClick={() => deleteOpsAccount(account)}><Trash2 size={12} /></button>}</div>
                      ))}
                    </div>
                  </div>

                  <div className={`ops-card history-card panel-corners ${activeView !== "history" ? "module-hidden" : ""}`}>
                    <div className="ops-title"><Users size={18} /><span><strong>PLAYER CONNECTION HISTORY</strong><small>Last seen names and identifiers retained on this PC</small></span></div>
                    <div className="history-list">
                      {opsData.playerHistory.slice(0, 20).map((entry) => <div key={entry.key}><span><strong>{entry.name}</strong><small>{entry.identifiers?.[0] || entry.key}</small></span><i>{new Date(entry.lastSeen).toLocaleString()}</i></div>)}
                      {!opsData.playerHistory.length && <p>No player connections have been recorded yet.</p>}
                    </div>
                  </div>

                  <div className={`ops-card audit-card panel-corners ${activeView !== "accounts" ? "module-hidden" : ""}`}>
                    <div className="ops-title"><History size={18} /><span><strong>AUDIT LOG</strong><small>Who performed each sensitive server action and when</small></span></div>
                    <div className="audit-list">{opsData.audit.slice(0, 20).map((entry) => <div key={entry.id}><span>{new Date(entry.at).toLocaleString()}</span><strong>{entry.account}</strong><code>{entry.action}</code></div>)}{!opsData.audit.length && <p>No administrative actions recorded yet.</p>}</div>
                  </div>

                  <div className={`ops-card ai-card panel-corners ${activeView !== "ai" ? "module-hidden" : ""}`}>
                    <div className="ai-header">
                      <div className="ai-orb"><img src="./assets/wolfhq-icon.png" alt="" /></div>
                      <span><strong>WOLFHQ AI CODE MATRIX</strong><small>Search the full indexed server, reason over relevant files, review complete edits, then apply with an automatic restore point.</small></span>
                      <div className="ai-header-actions">
                        <button type="button" onClick={startNewAiChat} disabled={aiBusy}><Plus size={13} /> NEW CHAT</button>
                        <i className={aiSettings.provider === "claude-code" ? claudeCodeStatus.loggedIn ? "ready" : claudeCodeStatus.available ? "warn" : "danger" : ""}>
                          {aiSettings.provider === "claude-code" ? claudeCodeStatus.loggedIn ? "CLAUDE LOGIN READY" : claudeCodeStatus.available ? "LOGIN NEEDED" : "CLAUDE NOT FOUND" : aiSettings.hasApiKey ? "PROVIDER ARMED" : "SETUP REQUIRED"}
                        </i>
                      </div>
                    </div>

                    <div className="ai-layout">
                      <aside className="ai-config">
                        <div className="ai-section-title"><KeyRound size={14} /> PROVIDER VAULT</div>
                        <label>Provider<select value={aiSettings.provider} onChange={(event) => changeAiProvider(event.target.value)}>
                          <option value="claude-code">Claude Code Login</option>
                          <option value="anthropic">Anthropic API (Claude models)</option>
                          <option value="openai-compatible">OpenAI-compatible</option>
                        </select></label>
                        <label>Model<select value={aiSettings.model} onChange={(event) => changeAiModel(event.target.value)}>
                          {selectableAiModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                        </select></label>
                        <div className="ai-model-source"><Circle size={7} fill="currentColor" /> {aiSettings.provider === "claude-code" ? "USES YOUR LOCAL CLAUDE CODE LOGIN" : aiModelsLive ? "LIVE MODELS FROM YOUR PROVIDER" : "CURRENT MODEL CATALOG"}</div>
                        <label>{aiSettings.provider === "claude-code" ? "Claude command" : "API endpoint"}<input value={aiSettings.endpoint} onChange={(event) => setAiSettings({ ...aiSettings, endpoint: event.target.value })} /></label>
                        <label>Limit tokens<input type="number" min="512" max="16000" step="256" value={aiSettings.maxOutputTokens || 4096} onChange={(event) => setAiSettings({ ...aiSettings, maxOutputTokens: Number(event.target.value) || 4096 })} /></label>
                        {aiSettings.provider !== "claude-code" && <label>API key<input type="password" placeholder={aiSettings.hasApiKey ? "Encrypted key saved - leave blank to keep it" : "Enter provider API key"} value={aiSettings.apiKey} onChange={(event) => setAiSettings({ ...aiSettings, apiKey: event.target.value })} /></label>}
                        <button onClick={saveAiProvider}><ShieldCheck size={13} /> {aiSettings.provider === "claude-code" ? "SAVE CLAUDE CODE LOGIN MODE" : "ENCRYPT AND SAVE"}</button>
                        {aiSettings.provider === "claude-code" && (
                          <div className={`ai-login-panel ${claudeCodeStatus.loggedIn ? "ready" : claudeCodeStatus.available ? "warn" : "danger"}`}>
                            <div><Terminal size={15} /><span><strong>{claudeCodeStatus.loggedIn ? "CLAUDE CODE CONNECTED" : claudeCodeStatus.available ? "CLAUDE CODE NEEDS LOGIN" : "CLAUDE CODE NOT FOUND"}</strong><small>{claudeCodeStatus.message}</small></span></div>
                            <div className="ai-login-actions">
                              <button type="button" onClick={() => refreshClaudeCodeLogin(aiSettings.endpoint)} disabled={claudeCodeBusy}><RefreshCw size={13} /> CHECK LOGIN</button>
                              <button type="button" className={claudeCodeStatus.loggedIn ? "logout" : ""} onClick={claudeCodeStatus.loggedIn ? logoutClaudeCode : startClaudeCodeLogin} disabled={claudeCodeBusy}>
                                {claudeCodeStatus.loggedIn ? <X size={13} /> : <ExternalLink size={13} />} {claudeCodeStatus.loggedIn ? "LOGOUT" : "LOGIN"}
                              </button>
                            </div>
                          </div>
                        )}
                        <div className="ai-security"><LockKeyhole size={14} /><span>{aiSettings.provider === "claude-code" ? "WOLFHQ launches Claude Code login for you, then calls the local Claude Code CLI in print mode so it uses your signed-in plan limits." : "Keys are encrypted by Windows. WOLFHQ sends your configured output token limit for every API provider."}</span></div>

                        <div className="ai-section-title search-title"><Search size={14} /> FILE INTELLIGENCE</div>
                        <div className="ai-search">
                          <input placeholder="Search paths and file contents..." value={aiSearchQuery} onChange={(event) => setAiSearchQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && searchServerWithAi()} />
                          <button onClick={searchServerWithAi} disabled={aiBusy}><Search size={13} /></button>
                        </div>
                        <div className="ai-index-count">{aiSearch.indexedFiles.toLocaleString()} EDITABLE FILES INDEXED</div>
                        <div className="ai-search-results">
                          {aiSearch.results.slice(0, 12).map((result) => <button key={result.path} onClick={() => { openFile({ path: result.path, name: result.relativePath.split(/[\\/]/).pop(), editable: true }); setActiveView("project"); }}><FileCode2 size={12} /><span><strong>{result.relativePath}</strong><small>{result.snippet || "Indexed path match"}</small></span></button>)}
                        </div>
                      </aside>

                      <main className="ai-workbench">
                        <div className="ai-section-title"><Sparkles size={14} /> LIVE SERVER ASSISTANT</div>
                        <div className="ai-chat-feed" ref={aiChatRef}>
                          {!aiMessages.length && (
                            <div className="ai-chat-welcome">
                              <Sparkles size={38} />
                              <strong>ASK WOLFHQ ANYTHING ABOUT THIS SERVER</strong>
                              <p>I can inspect the indexed files, explain how the server works, find problems, and prepare reviewed edits. Nothing is saved until you approve it.</p>
                            </div>
                          )}
                          {aiMessages.map((message) => (
                            <div key={message.id} className={`ai-message ${message.role}`}>
                              <div className="ai-message-role">{message.role === "user" ? "YOU" : message.role === "error" ? "SYSTEM ERROR" : `WOLFHQ AI // ${message.model}`}</div>
                              <div className="ai-message-text">{message.text}</div>
                            </div>
                          ))}
                          {aiBusy && <div className="ai-message assistant thinking"><div className="ai-message-role">WOLFHQ AI</div><div className="ai-message-text"><RefreshCw size={16} /> Reading relevant server files and preparing an answer...</div></div>}

                          {aiApplyReport && (
                            <div className="ai-apply-report">
                              <div className="ai-apply-report-head">
                                <Check size={17} />
                                <span><strong>AI EDITS SAVED AND VERIFIED</strong><small>{aiApplyReport.changedFiles?.length || 0} changed // {aiApplyReport.unchangedFiles?.length || 0} unchanged // backup {aiApplyReport.backup || "created"}</small></span>
                              </div>
                              <div className="ai-apply-report-files">
                                {(aiApplyReport.files || []).map((file) => (
                                  <div key={file.path} className={file.changed ? "changed" : "unchanged"}>
                                    <span>{file.changed ? <Check size={13} /> : <Circle size={9} fill="currentColor" />}<strong>{file.relativePath || file.path}</strong></span>
                                    <small>{file.changed ? `changed and verified // ${file.beforeHash} -> ${file.afterHash}` : "selected but already matched the proposed content"}</small>
                                  </div>
                                ))}
                              </div>
                              <div className="ai-next-steps">
                                <strong>WHAT TO DO NEXT</strong>
                                {(aiApplyReport.nextSteps || []).map((step) => <p key={step}>{step}</p>)}
                              </div>
                            </div>
                          )}

                          {aiProposal?.files.length > 0 && (
                            <div className="ai-review-panel">
                              <div className="ai-summary"><Check size={17} /><span><strong>{aiProposal.summary}</strong><small>{aiProposal.indexedFiles} paths searched // {aiProposal.contextFiles} relevant files analyzed</small></span></div>
                              <div className="ai-change-list">
                                {aiProposal.files.map((file) => (
                                  <div key={file.path} className={aiSelected[file.path] ? "selected" : ""}>
                                    <label><input type="checkbox" checked={Boolean(aiSelected[file.path])} onChange={(event) => setAiSelected({ ...aiSelected, [file.path]: event.target.checked })} /><span /></label>
                                    <div className="ai-change-info"><strong>{file.path.replace(project.rootPath, project.name)}</strong><small>{file.explanation}</small></div>
                                    <pre>{file.content.split("\n").slice(0, 18).join("\n")}{file.content.split("\n").length > 18 ? "\n..." : ""}</pre>
                                  </div>
                                ))}
                              </div>
                              <div className="ai-apply-bar">
                                <span>{Object.values(aiSelected).filter(Boolean).length} FILES SELECTED</span>
                                <button onClick={() => setAiProposal(null)}><X size={13} /> DISCARD EDITS</button>
                                <button className="apply" onClick={applySelectedAiChanges} disabled={aiBusy || !Object.values(aiSelected).some(Boolean)}><Save size={13} /> BACKUP AND APPLY</button>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="ai-composer">
                          <textarea
                            autoFocus
                            placeholder="Ask about the server or describe an edit. Press Enter to send, Shift+Enter for a new line."
                            value={aiPrompt}
                            onChange={(event) => setAiPrompt(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault();
                                generateAiProposal();
                              }
                            }}
                          />
                          <button onClick={generateAiProposal} disabled={aiBusy || aiPrompt.trim().length < 2}><Send size={17} /> SEND</button>
                        </div>
                        <div className="ai-composer-meta"><span>ENTER TO SEND // SHIFT+ENTER FOR NEW LINE</span><span>{project.stats.files.toLocaleString()} FILES // {project.stats.resources} RESOURCES</span></div>
                      </main>
                    </div>
                  </div>
                </section>
              )}

              {activeView === "settings" && (
                <section className="settings-grid">
                  <div className="settings-card panel-corners">
                    <div className="settings-title"><Network size={18} /><span><strong>TELEMETRY ENDPOINT</strong><small>WOLFHQ automatically falls back to the port detected in server.cfg.</small></span></div>
                    <label>{isRemote ? "Encrypted tunnel route" : "FiveM HTTP endpoint"}<input readOnly={isRemote} value={endpoint} onChange={(event) => setEndpoint(event.target.value)} /></label>
                    <button className="primary-action compact" onClick={() => refreshStatus(endpoint)}><RefreshCw size={15} /> TEST CONNECTION</button>
                    <div className={`connection-result ${status.online ? "online" : ""}`}><Circle size={8} fill="currentColor" /> {status.online ? `Linked to ${status.endpoint}` : status.error || "Not connected"}</div>
                  </div>
                  <div className="settings-card panel-corners">
                    <div className="settings-title"><Globe2 size={18} /><span><strong>SERVER TRANSPORT</strong><small>Remote mode keeps files, telemetry, and controls inside one SSH session.</small></span></div>
                    <div className="runtime-grid">
                      <div><span>MODE</span><strong>{isRemote ? "REMOTE SSH" : "LOCAL PC"}</strong></div>
                      <div><span>HOST</span><strong>{project.remoteHost || "THIS DEVICE"}</strong></div>
                      <div><span>FILES</span><strong>{isRemote ? "SFTP" : "DIRECT"}</strong></div>
                      <div><span>CONTROL</span><strong>{isRemote ? "SSH TUNNEL" : "LOOPBACK"}</strong></div>
                    </div>
                    <button className="secondary-action" onClick={isRemote ? openRemoteConnections : openRemoteConnections}><KeyRound size={15} /> MANAGE REMOTE PROFILES</button>
                  </div>
                  <div className="settings-card panel-corners">
                    <div className="settings-title"><ShieldCheck size={18} /><span><strong>WOLFHQ CONTROL BRIDGE</strong><small>Required for announcements and managed server restarts.</small></span></div>
                    <div className="bridge-state">
                      <span className={controlStatus.running ? "online" : ""}><Circle size={8} fill="currentColor" /> {controlStatus.running ? "RUNNING" : controlStatus.installed ? "INSTALLED / RESTART REQUIRED" : "NOT INSTALLED"}</span>
                    </div>
                    <button className="secondary-action" onClick={installBridge}><ShieldCheck size={15} /> INSTALL / REPAIR BRIDGE</button>
                  </div>
                  <div className="settings-card panel-corners">
                    <div className="settings-title"><Cpu size={18} /><span><strong>RUNTIME PROCESS</strong><small>Metrics are linked to the process owning the live FiveM port.</small></span></div>
                    <div className="runtime-grid">
                      <div><span>PID</span><strong>{status.process?.pid || "--"}</strong></div>
                      <div><span>CPU</span><strong>{status.process ? `${Math.round(status.process.cpu)}%` : "--"}</strong></div>
                      <div><span>RAM</span><strong>{status.process ? formatBytes(status.process.memoryBytes) : "--"}</strong></div>
                      <div><span>STARTED</span><strong>{status.process?.started ? new Date(status.process.started).toLocaleTimeString() : "--"}</strong></div>
                    </div>
                  </div>
                  <div className="settings-card panel-corners">
                    <div className="settings-title"><PackageCheck size={18} /><span><strong>SERVER ARTIFACTS</strong><small>Track and update the official FXServer runtime without touching server data.</small></span></div>
                    <div className="runtime-grid">
                      <div><span>CURRENT</span><strong>{artifactStatus?.currentBuild || "UNKNOWN"}</strong></div>
                      <div><span>LATEST</span><strong>{artifactStatus?.latestBuild || "--"}</strong></div>
                      <div><span>PLATFORM</span><strong>{artifactStatus?.platform || (isRemote ? "REMOTE" : "LOCAL")}</strong></div>
                      <div><span>MODE</span><strong>{artifactStatus?.managed ? "TRACKED" : "UNMANAGED"}</strong></div>
                    </div>
                    <button className="secondary-action" onClick={() => { setActiveView("artifacts"); loadArtifactStatus().catch((error) => notify(error.message)); }}><PackageCheck size={15} /> OPEN ARTIFACT CONTROL</button>
                  </div>
                  <div className="settings-card panel-corners">
                    <div className="settings-title"><Archive size={18} /><span><strong>MAINTENANCE SAFETY</strong><small>Fast restore points before risky edits, deployments, or artifact replacement.</small></span></div>
                    <div className="runtime-grid">
                      <div><span>BACKUPS</span><strong>{backups.length}</strong></div>
                      <div><span>SCHEDULE</span><strong>{opsSettings.backupSchedule || "manual"}</strong></div>
                      <div><span>ROOT</span><strong>{project.name}</strong></div>
                      <div><span>FILES</span><strong>{project.stats.files}</strong></div>
                    </div>
                    <button className="secondary-action" onClick={createBackupNow}><Archive size={15} /> CREATE RESTORE POINT</button>
                  </div>
                  <div className="settings-card panel-corners">
                    <div className="settings-title"><LockKeyhole size={18} /><span><strong>SECURITY POSTURE</strong><small>Useful reminders for remote control, bridge access, and public updater hygiene.</small></span></div>
                    <div className="settings-notes">
                      <span><ShieldCheck size={13} /> Remote files stay behind SSH/SFTP.</span>
                      <span><ShieldCheck size={13} /> Control bridge uses a local token and does not need a public port.</span>
                      <span><ShieldCheck size={13} /> GitHub updater uses public releases and no saved personal tokens.</span>
                    </div>
                    <button className="secondary-action" onClick={() => setActiveView("history")}><History size={15} /> OPEN AUDIT HISTORY</button>
                  </div>
                </section>
              )}
            </>
          )}
        </main>
      </div>

      <footer className="copyright-footer">
        <img src="./assets/wolfhq-icon.png" alt="" />
        <span>© {new Date().getFullYear()} WOLF STUDIOS INC. ALL RIGHTS RESERVED.</span>
        <i>WOLFHQ // SECURE COMMAND SYSTEM</i>
      </footer>

      {modal === "remote" && (
        <Modal title="REMOTE VPS CONNECTION" onClose={() => { setModal(null); setRemoteTrust(null); }}>
          <form className="resource-form remote-form" onSubmit={connectRemote}>
            <div className="control-notice"><LockKeyhole size={17} /><span>WOLFHQ uses SSH/SFTP and tunnels FiveM traffic through SSH. You do not need to expose your server files or control bridge publicly.</span></div>
            <div className="profile-picker">
              <label>Saved profile<select value={remoteDraft.id} onChange={(event) => loadRemoteProfile(event.target.value)}>
                <option value="">New remote server</option>
                {remoteProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} // {profile.host}</option>)}
              </select></label>
              {remoteDraft.id && <button type="button" className="icon-danger" title="Delete profile" onClick={deleteRemoteProfile}><Trash2 size={16} /></button>}
            </div>
            <div className="form-row">
              <label>Profile name<input value={remoteDraft.name} onChange={(event) => setRemoteDraft({ ...remoteDraft, name: event.target.value })} /></label>
              <label>SSH host or IP<input placeholder="203.0.113.20" value={remoteDraft.host} onChange={(event) => setRemoteDraft({ ...remoteDraft, host: event.target.value })} /></label>
            </div>
            <div className="form-row three">
              <label>SSH port<input type="number" min="1" max="65535" value={remoteDraft.port} onChange={(event) => setRemoteDraft({ ...remoteDraft, port: Number(event.target.value) })} /></label>
              <label>Username<input value={remoteDraft.username} onChange={(event) => setRemoteDraft({ ...remoteDraft, username: event.target.value })} /></label>
              <label>FiveM port<input type="number" min="1" max="65535" value={remoteDraft.fiveMPort} onChange={(event) => setRemoteDraft({ ...remoteDraft, fiveMPort: Number(event.target.value) })} /></label>
            </div>
            <label>Server root path<input placeholder="/home/fivem/server or C:\FiveM\server" value={remoteDraft.rootPath} onChange={(event) => setRemoteDraft({ ...remoteDraft, rootPath: event.target.value })} /></label>
            <div className="auth-selector">
              <button type="button" className={remoteDraft.authType === "password" ? "active" : ""} onClick={() => setRemoteDraft({ ...remoteDraft, authType: "password" })}><LockKeyhole size={15} /> PASSWORD</button>
              <button type="button" className={remoteDraft.authType === "key" ? "active" : ""} onClick={() => setRemoteDraft({ ...remoteDraft, authType: "key" })}><KeyRound size={15} /> PRIVATE KEY</button>
            </div>
            {remoteDraft.authType === "key" && (
              <div className="key-picker">
                <label>Private key file<input readOnly placeholder="Select an OpenSSH private key..." value={remoteDraft.privateKeyPath} /></label>
                <button type="button" onClick={chooseRemoteKey}>BROWSE</button>
              </div>
            )}
            <label>{remoteDraft.authType === "key" ? "Key passphrase (leave blank if none)" : "SSH password"}
              <input type="password" placeholder={remoteDraft.hasSavedSecret && !remoteDraft.secret ? "Saved securely by Windows" : ""} value={remoteDraft.secret} onChange={(event) => setRemoteDraft({ ...remoteDraft, secret: event.target.value })} />
            </label>
            <label className="remember-secret"><input type="checkbox" checked={remoteDraft.rememberSecret} onChange={(event) => setRemoteDraft({ ...remoteDraft, rememberSecret: event.target.checked })} /><span /> Encrypt and remember credentials on this PC</label>
            <button className="primary-action form-submit" type="submit" disabled={busy}><Globe2 size={16} /> {busy ? "CONNECTING..." : "CONNECT REMOTE SERVER"}</button>
          </form>
        </Modal>
      )}
      {modal === "trust" && remoteTrust && (
        <Modal title={remoteTrust.changed ? "SSH HOST KEY CHANGED" : "TRUST SSH HOST"} onClose={() => {
          if (busy) return;
          setModal("remote");
          setRemoteTrust(null);
          setRemoteConnectError("");
          setRemoteConnectMessage("");
        }}>
          <div className="trust-panel">
            <ShieldCheck size={34} className={busy ? "trust-pulse" : ""} />
            <strong>{remoteTrust.changed ? "THE SERVER IDENTITY HAS CHANGED" : "VERIFY THIS SERVER IDENTITY"}</strong>
            <p>{remoteTrust.changed ? "Only continue if your VPS provider confirms the SSH host key was changed. An unexpected change can indicate an attack." : "Compare this fingerprint with the SSH fingerprint shown by your VPS provider before trusting it."}</p>
            <code>{remoteTrust.fingerprint}</code>
            {remoteConnectMessage && <div className="trust-status"><RefreshCw size={14} /> {remoteConnectMessage}</div>}
            {remoteConnectError && <div className="trust-error"><X size={14} /> {remoteConnectError}</div>}
            <div className="trust-actions">
              <button className="secondary-action" disabled={busy} onClick={() => {
                setModal("remote");
                setRemoteTrust(null);
                setRemoteConnectError("");
                setRemoteConnectMessage("");
              }}>CANCEL</button>
              <button className={`primary-action compact ${busy ? "spinning" : ""}`} disabled={busy} onClick={() => connectRemote(null, remoteTrust.fingerprint)}>
                {busy ? <RefreshCw size={15} /> : <ShieldCheck size={15} />} {busy ? "CONNECTING..." : "TRUST AND CONNECT"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {modal === "resource" && (
        <Modal title="FORGE NEW RESOURCE" onClose={() => setModal(null)}>
          <form className="resource-form" onSubmit={createResource}>
            <label>Resource ID<input value={resourceDraft.name} onChange={(e) => setResourceDraft({ ...resourceDraft, name: e.target.value })} /></label>
            <label>Description<input value={resourceDraft.description} onChange={(e) => setResourceDraft({ ...resourceDraft, description: e.target.value })} /></label>
            <div className="form-row">
              <label>Author<input value={resourceDraft.author} onChange={(e) => setResourceDraft({ ...resourceDraft, author: e.target.value })} /></label>
              <label>Framework<select value={resourceDraft.framework} onChange={(e) => setResourceDraft({ ...resourceDraft, framework: e.target.value })}>
                <option>Standalone</option><option>QBCore</option><option>Qbox</option><option>ESX</option>
              </select></label>
            </div>
            <div className="switches">
              <label><input type="checkbox" checked={resourceDraft.includeClient} onChange={(e) => setResourceDraft({ ...resourceDraft, includeClient: e.target.checked })} /><span /> Client script</label>
              <label><input type="checkbox" checked={resourceDraft.includeServer} onChange={(e) => setResourceDraft({ ...resourceDraft, includeServer: e.target.checked })} /><span /> Server script</label>
            </div>
            <div className="manifest-preview">
              <Terminal size={14} /><code>fxmanifest.lua + config.lua {resourceDraft.includeClient && "+ client.lua"} {resourceDraft.includeServer && "+ server.lua"}</code>
            </div>
            <button className="primary-action form-submit" type="submit"><Zap size={16} /> CREATE RESOURCE</button>
          </form>
        </Modal>
      )}
      {modal === "file" && (
        <Modal title="FORGE SCRIPT FILE" onClose={() => setModal(null)}>
          <form className="resource-form" onSubmit={createScriptFile}>
            <label>File name<input value={fileDraft.name} onChange={(e) => setFileDraft({ ...fileDraft, name: e.target.value })} /></label>
            <label>Target resource<select value={fileDraft.parentPath} onChange={(e) => setFileDraft({ ...fileDraft, parentPath: e.target.value })}>
              <option value={project.rootPath}>Server root</option>
              {project.resources.map((resource) => <option key={resource.path} value={resource.path}>{resource.name}</option>)}
            </select></label>
            <label>Starter code<textarea value={fileDraft.content} onChange={(e) => setFileDraft({ ...fileDraft, content: e.target.value })} /></label>
            <button className="primary-action form-submit" type="submit"><FileCode2 size={16} /> CREATE AND OPEN</button>
          </form>
        </Modal>
      )}
      {modal === "announcement" && (
        <Modal title="SERVER ANNOUNCEMENT" onClose={() => setModal(null)}>
          <form className="resource-form" onSubmit={submitAnnouncement}>
            <div className="control-notice"><Send size={17} /><span>This message will be broadcast to every player currently connected to WOLFHQ.</span></div>
            <label>Announcement<textarea autoFocus maxLength={500} placeholder="Server announcement..." value={announcement} onChange={(event) => setAnnouncement(event.target.value)} /></label>
            <div className="character-count">{announcement.length}/500</div>
            <button className="primary-action form-submit" type="submit" disabled={!announcement.trim()}><Send size={16} /> BROADCAST NOW</button>
          </form>
        </Modal>
      )}
      {modal === "restart" && (
        <Modal title="MANAGED SERVER RESTART" onClose={() => setModal(null)}>
          <form className="resource-form" onSubmit={submitRestart}>
            <div className="control-notice danger"><RotateCcw size={17} /><span>Players will receive a warning, then FXServer will exit and txAdmin will start it again.</span></div>
            <div className="form-row">
              <label>Countdown<select value={restartDraft.delay} onChange={(event) => setRestartDraft({ ...restartDraft, delay: Number(event.target.value) })}>
                <option value={10}>10 seconds</option>
                <option value={15}>15 seconds</option>
                <option value={30}>30 seconds</option>
                <option value={60}>1 minute</option>
                <option value={300}>5 minutes</option>
              </select></label>
              <label>Reason<input value={restartDraft.reason} onChange={(event) => setRestartDraft({ ...restartDraft, reason: event.target.value })} /></label>
            </div>
            <div className="restart-confirm"><Clock size={15} /> Restart scheduled after confirmation. This cannot be canceled from WOLFHQ.</div>
            <button className="primary-action form-submit danger-submit" type="submit"><RotateCcw size={16} /> CONFIRM SERVER RESTART</button>
          </form>
        </Modal>
      )}
      {modal === "nekoInstall" && (
        <Modal title={nekoStatus.updateAvailable ? "UPDATE NEKO ANTI-CHEAT" : nekoStatus.installed ? "REPAIR NEKO ANTI-CHEAT" : "INSTALL NEKO ANTI-CHEAT"} onClose={() => setModal(null)}>
          <div className="neko-install-confirm">
            <div className="neko-install-core"><ShieldAlert size={34} /><span><strong>{nekoStatus.updateAvailable ? "ENGINE UPDATE READY" : "NEKO DEFENCE DEPLOYMENT"}</strong><small>{nekoStatus.version || "Not installed"} {"->"} {nekoStatus.latestVersion || "bundled latest"}</small></span></div>
            <p>WOLFHQ will write the latest Neko Anti-Cheat resource, patch `server.cfg`, preserve your token, and try to start the engine through the control bridge.</p>
            <div className="neko-install-facts">
              <div><span>PROFILE</span><strong>{antiCheatProfile}</strong></div>
              <div><span>RESOURCE</span><strong>neko-anticheat</strong></div>
              <div><span>STATUS</span><strong>{nekoStatus.updateAvailable ? "UPDATE REQUIRED" : nekoStatus.installed ? "REPAIR MODE" : "NEW INSTALL"}</strong></div>
            </div>
            <div className="neko-install-actions">
              <button type="button" onClick={() => setModal(null)}>CANCEL</button>
              <button type="button" className="primary" onClick={performNekoEngineInstall}><Download size={16} /> {nekoStatus.updateAvailable ? "UPDATE ENGINE" : nekoStatus.installed ? "REPAIR ENGINE" : "INSTALL ENGINE"}</button>
            </div>
          </div>
        </Modal>
      )}
      {modal === "nekoGuard" && (
        <Modal title={nekoGuardAction === "remove" ? "REMOVE RESOURCE GUARD" : "INJECT RESOURCE GUARD"} onClose={() => { setModal(null); setNekoGuardAction(null); }}>
          <div className="neko-install-confirm">
            <div className="neko-install-core"><ShieldCheck size={34} /><span><strong>{nekoGuardAction === "remove" ? "GUARD REMOVAL" : "RESOURCE GUARD INJECTION"}</strong><small>{project?.resources?.length || 0} detected resource manifests</small></span></div>
            <p>{nekoGuardAction === "remove" ? "WOLFHQ will remove the Neko guard line from every detected resource manifest. Restart affected resources afterwards." : "WOLFHQ will add a reversible Neko guard line to every detected resource manifest so Neko AC can report guarded resources."}</p>
            <div className="neko-install-facts">
              <div><span>ACTION</span><strong>{nekoGuardAction === "remove" ? "REMOVE" : "INJECT"}</strong></div>
              <div><span>RESOURCE</span><strong>neko-anticheat</strong></div>
              <div><span>SAFE UNDO</span><strong>YES</strong></div>
            </div>
            <div className="neko-install-actions">
              <button type="button" onClick={() => { setModal(null); setNekoGuardAction(null); }}>CANCEL</button>
              <button type="button" className="primary" onClick={performNekoGuardUpdate}>{nekoGuardAction === "remove" ? <Trash2 size={16} /> : <ShieldCheck size={16} />} {nekoGuardAction === "remove" ? "REMOVE GUARD" : "INJECT GUARD"}</button>
            </div>
          </div>
        </Modal>
      )}
      {inspectedNekoPlayer && (
        <Modal title="NEKO PLAYER INTEL" onClose={() => setInspectedNekoPlayerId(null)}>
          <div className="neko-player-modal">
            <div className="neko-player-hero">
              <div><Eye size={24} /><span><strong>{inspectedNekoPlayer.name}</strong><small>Server ID #{inspectedNekoPlayer.id} // {inspectedNekoPlayer.ping ?? "--"} ms ping // score {inspectedNekoPlayer.score ?? 0}</small></span></div>
              <i>{inspectedNekoPlayer.flags?.length ? `${inspectedNekoPlayer.flags.length} RECENT FLAGS` : "CLEAR"}</i>
            </div>
            <div className="neko-spectate-controls">
              <label>Optional watcher server ID<input value={spectatorServerId} onChange={(event) => setSpectatorServerId(event.target.value.replace(/\D/g, ""))} placeholder={nekoStatus.watcher ? `Registered: ${nekoStatus.watcher}` : "Auto if blank"} /></label>
              <button type="button" onClick={() => controlNekoSpectate("start", inspectedNekoPlayer.id)}><Eye size={16} /> START SPECTATE</button>
              <button type="button" className="stop" onClick={() => controlNekoSpectate("stop", inspectedNekoPlayer.id)}><X size={16} /> STOP SPECTATE</button>
              <span>Desktop live observe is already active in this popup. GTA camera spectate needs a connected FiveM watcher client; run /nekoacwatcher in-game once for best results.</span>
            </div>
            <div className="neko-live-grid modal-grid">
              <div><span>HEALTH</span><strong>{inspectedNekoPlayer.telemetry?.health ?? "--"}</strong></div>
              <div><span>ARMOUR</span><strong>{inspectedNekoPlayer.telemetry?.armour ?? "--"}</strong></div>
              <div><span>SPEED</span><strong>{inspectedNekoPlayer.telemetry?.speed?.toFixed ? inspectedNekoPlayer.telemetry.speed.toFixed(2) : inspectedNekoPlayer.telemetry?.speed ?? "--"}</strong></div>
              <div><span>VEHICLE</span><strong>{inspectedNekoPlayer.telemetry?.inVehicle ? "YES" : "NO"}</strong></div>
              <div><span>VISIBLE</span><strong>{inspectedNekoPlayer.telemetry?.visible === false ? "NO" : inspectedNekoPlayer.telemetry ? "YES" : "--"}</strong></div>
              <div><span>INVINCIBLE</span><strong>{inspectedNekoPlayer.telemetry?.invincible ? "YES" : "NO"}</strong></div>
              <div><span>DEAD</span><strong>{inspectedNekoPlayer.telemetry?.dead ? "YES" : "NO"}</strong></div>
              <div><span>WEAPON HASH</span><strong>{inspectedNekoPlayer.telemetry?.weapon ?? "--"}</strong></div>
              <div><span>HEADING</span><strong>{inspectedNekoPlayer.telemetry?.heading?.toFixed ? inspectedNekoPlayer.telemetry.heading.toFixed(1) : inspectedNekoPlayer.telemetry?.heading ?? "--"}</strong></div>
              <div><span>FIRST SEEN</span><strong>{inspectedNekoPlayer.firstSeen ? new Date(inspectedNekoPlayer.firstSeen).toLocaleTimeString() : "--"}</strong></div>
              <div><span>LAST SEEN</span><strong>{inspectedNekoPlayer.lastSeen ? new Date(inspectedNekoPlayer.lastSeen).toLocaleTimeString() : "--"}</strong></div>
              <div><span>LAST HEARTBEAT</span><strong>{inspectedNekoPlayer.lastHeartbeat ? new Date(inspectedNekoPlayer.lastHeartbeat).toLocaleTimeString() : "--"}</strong></div>
            </div>
            <div className="neko-location-row modal-location">
              <Fingerprint size={13} />
              <span>{inspectedNekoPlayer.telemetry?.coords ? `X ${inspectedNekoPlayer.telemetry.coords.x?.toFixed?.(2) ?? inspectedNekoPlayer.telemetry.coords.x} // Y ${inspectedNekoPlayer.telemetry.coords.y?.toFixed?.(2) ?? inspectedNekoPlayer.telemetry.coords.y} // Z ${inspectedNekoPlayer.telemetry.coords.z?.toFixed?.(2) ?? inspectedNekoPlayer.telemetry.coords.z}` : "Waiting for live position heartbeat"}</span>
            </div>
            <div className="neko-modal-columns">
              <div className="neko-inventory-panel">
                <span><Box size={13} /> INVENTORY SNAPSHOT <em>{inspectedNekoPlayer.inventoryCount || inspectedNekoPlayer.inventory?.length || 0} ITEMS</em></span>
                <div>
                  {(inspectedNekoPlayer.inventory || []).slice(0, 24).map((item, index) => <b key={`${item.name}-${item.slot || index}`}>{item.label || item.name}<small>x{item.count || 1}</small></b>)}
                  {!inspectedNekoPlayer.inventory?.length && <p>No framework inventory data exposed yet. QBCore, Qbox/Ox Inventory, and ESX are checked automatically.</p>}
                </div>
              </div>
              <div className="neko-ident-panel">
                <span><Fingerprint size={13} /> IDENTIFIERS</span>
                {(inspectedNekoPlayer.identifiers || []).map((identifier) => <code key={identifier}>{identifier}</code>)}
                {!inspectedNekoPlayer.identifiers?.length && <p>No identifiers available from the telemetry endpoint yet.</p>}
              </div>
            </div>
            <div className="neko-modal-flags">
              <span><AlertTriangle size={13} /> RECENT PLAYER WARNINGS</span>
              {(inspectedNekoPlayer.flags || []).slice(-8).reverse().map((flag) => <div key={flag.id || `${flag.createdAt}-${flag.message}`}><strong>{flag.moduleLabel || flag.module}</strong><small>severity {flag.severity} // {flag.createdAt ? new Date(flag.createdAt).toLocaleTimeString() : "--"}</small><em>{flag.message}</em></div>)}
              {!inspectedNekoPlayer.flags?.length && <p>No recent warnings for this player.</p>}
            </div>
          </div>
        </Modal>
      )}
      {playerModal?.type === "note" && (
        <Modal title="PLAYER NOTE" onClose={() => setPlayerModal(null)}>
          <form className="resource-form player-action-form" onSubmit={submitPlayerNote}>
            <div className="control-notice"><FileCode2 size={17} /><span>Save a private WOLFHQ note for {playerModal.player?.name}. This stays on this PC and does not require the control bridge.</span></div>
            <label>Player<input readOnly value={`${playerModal.player?.name || "Unknown"} // #${playerModal.player?.id ?? "--"}`} /></label>
            <label>Note<textarea autoFocus value={playerModal.note} onChange={(event) => setPlayerModal({ ...playerModal, note: event.target.value })} /></label>
            <button className="primary-action form-submit" type="submit"><Save size={16} /> SAVE PLAYER NOTE</button>
          </form>
        </Modal>
      )}
      {["kick", "ban"].includes(playerModal?.type) && (
        <Modal title={playerModal.type === "ban" ? "BAN PLAYER" : "KICK PLAYER"} onClose={() => setPlayerModal(null)}>
          <form className="resource-form player-action-form" onSubmit={submitPlayerAction}>
            <div className={`control-notice ${playerModal.type === "ban" ? "danger" : ""}`}>
              {playerModal.type === "ban" ? <Ban size={17} /> : <UserX size={17} />}
              <span>{playerModal.type === "ban" ? "This drops the player and stores their current identifiers in the WOLFHQ bridge ban file." : "This drops the player from the live server through the WOLFHQ control bridge."}</span>
            </div>
            <label>Player<input readOnly value={`${playerModal.player?.name || "Unknown"} // #${playerModal.player?.id ?? "--"}`} /></label>
            <label>Reason<textarea autoFocus value={playerModal.reason} onChange={(event) => setPlayerModal({ ...playerModal, reason: event.target.value })} /></label>
            {playerModal.type === "ban" && <label className="remember-secret action-confirm"><input type="checkbox" checked={Boolean(playerModal.confirmed)} onChange={(event) => setPlayerModal({ ...playerModal, confirmed: event.target.checked })} /><span /> Confirm ban using this player's current identifiers</label>}
            <button className={`primary-action form-submit ${playerModal.type === "ban" ? "danger-submit" : ""}`} type="submit" disabled={playerModal.type === "ban" && !playerModal.confirmed}>
              {playerModal.type === "ban" ? <Ban size={16} /> : <UserX size={16} />} {playerModal.type === "ban" ? "CONFIRM BAN" : "KICK PLAYER"}
            </button>
          </form>
        </Modal>
      )}
      {dbEditor && (
        <Modal title="DATABASE CELL EDITOR" onClose={() => setDbEditor(null)}>
          <form className="resource-form database-edit-form" onSubmit={saveDatabaseEditor}>
            <div className="control-notice"><Database size={17} /><span>Editing `{dbEditor.table}.{dbEditor.column}` using {dbEditor.keyLabel}. This writes directly to MySQL when you save.</span></div>
            <div className="form-row">
              <label>Table<input readOnly value={dbEditor.table} /></label>
              <label>Column<input readOnly value={dbEditor.column} /></label>
            </div>
            <label>Value<textarea autoFocus spellCheck="false" value={dbEditor.value} disabled={dbEditor.valueIsNull} onChange={(event) => setDbEditor({ ...dbEditor, value: event.target.value })} /></label>
            <label className="remember-secret db-null-toggle"><input type="checkbox" checked={dbEditor.valueIsNull} onChange={(event) => setDbEditor({ ...dbEditor, valueIsNull: event.target.checked })} /><span /> Save this cell as SQL NULL</label>
            <button className="primary-action form-submit" type="submit"><Save size={16} /> SAVE DATABASE VALUE</button>
          </form>
        </Modal>
      )}
      {toast && <div className="toast"><Check size={15} /> {toast}</div>}
    </div>
  );
}
