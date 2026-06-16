const test = require("node:test");
const assert = require("node:assert/strict");
const { detectAntiCheats } = require("../electron/anticheat.cjs");

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
