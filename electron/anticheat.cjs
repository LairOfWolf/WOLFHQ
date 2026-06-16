const path = require("node:path");

const KNOWN_ANTI_CHEATS = Object.freeze([
  { provider: "Neko Anti-Cheat", patterns: [/neko[-_ ]?(?:anti[-_ ]?cheat|ac)\b/i] },
  { provider: "FiveGuard", patterns: [/\bfiveguard\b/i, /\bfg[-_]?anticheat\b/i] },
  { provider: "WaveShield", patterns: [/\bwave[-_ ]?shield\b/i] },
  { provider: "SecureServe", patterns: [/\bsecure[-_ ]?serve\b/i] },
  { provider: "Phoenix AC", patterns: [/\bphoenix[-_ ]?(?:anti[-_ ]?cheat|ac)\b/i] },
  { provider: "Pegasus AC", patterns: [/\bpegasus[-_ ]?(?:anti[-_ ]?cheat|ac)\b/i, /\bpegasusac\b/i] },
  { provider: "ChocoHax", patterns: [/\bchoco[-_ ]?hax\b/i] },
  { provider: "Reaper AC", patterns: [/\breaper[-_ ]?(?:anti[-_ ]?cheat|ac)\b/i] },
  { provider: "Badger Anti-Cheat", patterns: [/\bbadger[-_ ]?(?:anti[-_ ]?cheat|ac)\b/i] },
  { provider: "CFXGuard", patterns: [/\bcfx[-_ ]?guard\b/i] }
]);

const GENERIC_PATTERNS = [
  /\banti[-_ ]?cheat\b/i,
  /\banticheat\b/i,
  /\bcheat[-_ ]?detection\b/i,
  /\bexploit[-_ ]?protection\b/i
];

function normalizedResourceName(value) {
  return String(value || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isStarted(configText, resource) {
  const escapedName = normalizedResourceName(resource.name);
  if (escapedName && new RegExp(`^\\s*(?:ensure|start)\\s+["']?${escapedName}["']?\\s*(?:#.*)?$`, "im").test(configText)) {
    return true;
  }
  const groups = String(resource.path || "").split(/[\\/]/).filter((segment) => /^\[.*\]$/.test(segment));
  return groups.some((group) => {
    const escapedGroup = normalizedResourceName(group);
    return new RegExp(`^\\s*(?:ensure|start)\\s+["']?${escapedGroup}["']?\\s*(?:#.*)?$`, "im").test(configText);
  });
}

function detectAntiCheats(resources, configText = "") {
  const detected = [];
  for (const resource of resources || []) {
    const manifestText = String(resource.manifestText || "");
    const haystack = [resource.name, resource.path, manifestText].filter(Boolean).join("\n");
    const known = KNOWN_ANTI_CHEATS.find((candidate) => candidate.patterns.some((pattern) => pattern.test(haystack)));
    const generic = GENERIC_PATTERNS.some((pattern) => pattern.test(haystack));
    if (!known && !generic) continue;

    const evidence = [];
    if (known) evidence.push(`Recognized ${known.provider} signature`);
    if (GENERIC_PATTERNS.some((pattern) => pattern.test(resource.name || ""))) evidence.push("Anti-cheat naming signal");
    if (GENERIC_PATTERNS.some((pattern) => pattern.test(manifestText))) evidence.push("Manifest protection signal");
    if (/[\[](?:anti[-_ ]?cheat|security|protection)[\]]/i.test(resource.path || "")) evidence.push("Security resource group");
    const enabled = isStarted(configText, resource);
    if (enabled) evidence.push("Started by server.cfg");

    detected.push({
      id: `${String(resource.name || "resource").toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}-${detected.length}`,
      name: known?.provider || resource.name || "Custom Anti-Cheat",
      provider: known?.provider || "Custom / Unrecognized",
      resourceName: resource.name,
      path: resource.path,
      manifest: resource.manifest,
      type: known ? "recognized" : "custom",
      confidence: known ? 96 : evidence.length > 1 ? 82 : 68,
      status: enabled ? "enabled" : "installed",
      evidence
    });
  }
  return detected;
}

module.exports = { detectAntiCheats, KNOWN_ANTI_CHEATS };
