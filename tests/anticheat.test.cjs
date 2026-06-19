const test = require("node:test");
const assert = require("node:assert/strict");
const { detectAntiCheats } = require("../electron/anticheat.cjs");
const { nekoAntiCheatFiles, patchNekoAntiCheatConfig } = require("../electron/neko-ac.cjs");

test("detects recognized and custom anti-cheat resources with startup state", () => {
  const detected = detectAntiCheats([
    {
      name: "fiveguard",
      path: "C:\\server\\resources\\[security]\\fiveguard",
      manifest: "C:\\server\\resources\\[security]\\fiveguard\\fxmanifest.lua",
      manifestText: "description 'FiveGuard protection'"
    },
    {
      name: "city-security",
      path: "C:\\server\\resources\\[anticheat]\\city-security",
      manifest: "C:\\server\\resources\\[anticheat]\\city-security\\fxmanifest.lua",
      manifestText: "description 'Custom anti-cheat and exploit protection'"
    },
    {
      name: "normal-resource",
      path: "C:\\server\\resources\\normal-resource",
      manifestText: "description 'Vehicle shop'"
    }
  ], "ensure fiveguard\nensure [anticheat]\n");

  assert.equal(detected.length, 2);
  assert.equal(detected[0].provider, "FiveGuard");
  assert.equal(detected[0].status, "enabled");
  assert.equal(detected[1].provider, "Custom / Unrecognized");
  assert.equal(detected[1].status, "enabled");
});

test("generates the installable Neko Anti-Cheat resource files", () => {
  const files = nekoAntiCheatFiles("Strict");

  assert.match(files.manifest, /fx_version 'cerulean'/);
  assert.match(files.config, /NekoAC\.profile = 'Strict'/);
  assert.match(files.client, /nekoac:heartbeat/);
  assert.match(files.client, /nekoac:spectate/);
  assert.match(files.server, /SetHttpHandler/);
  assert.match(files.server, /req\.path:match\('\/status\$'\)/);
  assert.match(files.server, /req\.path:match\('\/spectate\$'\)/);
  assert.match(files.readme, /WOLFHQ/);
});

test("patches server.cfg to ensure Neko Anti-Cheat once", () => {
  const cfg = "ensure mapmanager\nensure chat\n";
  const patched = patchNekoAntiCheatConfig(cfg).content;
  const repatched = patchNekoAntiCheatConfig(patched).content;

  assert.match(patched, /ensure neko-anticheat/);
  assert.equal((repatched.match(/ensure neko-anticheat/g) || []).length, 1);
});
