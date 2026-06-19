const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { AiManager, redactSecrets } = require("../electron/ai.cjs");

test("redacts common server credentials", () => {
  const redacted = redactSecrets([
    'sv_licenseKey "private-license"',
    'set mysql_connection_string "mysql://root:secret@localhost/fivem"',
    'api_key = "private-api-key"'
  ].join("\n"));
  assert.doesNotMatch(redacted, /private-license|root:secret|private-api-key/);
  assert.match(redacted, /REDACTED/);
});

test("reports provider account rejection while keeping the configured token limit", async (context) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "wolfhq-ai-limit-"));
  context.after(() => fs.rm(temp, { recursive: true, force: true }));
  const provider = http.createServer((request, response) => {
    request.resume();
    response.writeHead(402, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Your credit balance is too low." } }));
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => provider.close(resolve)));

  const manager = new AiManager({
    userData: temp,
    encrypt: (value) => `encrypted:${value}`,
    decrypt: (value) => value.replace(/^encrypted:/, ""),
    getContext: () => ({ project: { rootPath: temp, tree: [] } }),
    readText: async () => "",
    writeText: async () => {},
    createBackup: async () => {},
    audit: async () => {}
  });
  await manager.saveSettings({
    provider: "openai-compatible",
    model: "wolfhq-test",
    endpoint: `http://127.0.0.1:${provider.address().port}/v1/chat/completions`,
    apiKey: "local-test-key",
    maxOutputTokens: 1024
  });

  await assert.rejects(
    () => manager.propose("Check this server."),
    /output token limit \(1024\).*Claude Desktop\/Pro limits are separate/
  );
});

test("uses Claude Code login mode through a local command without an API key", async (context) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "wolfhq-claude-code-"));
  context.after(() => fs.rm(temp, { recursive: true, force: true }));
  const fakeCli = path.join(temp, "fake-claude.js");
  await fs.writeFile(fakeCli, [
    "if (process.argv.includes('--version')) {",
    "  console.log('1.2.3-test');",
    "  process.exit(0);",
    "}",
    "if (process.argv.includes('auth') && process.argv.includes('status')) {",
    "  console.log(JSON.stringify({ email: 'neko@example.test' }));",
    "  process.exit(0);",
    "}",
    "if (process.argv.includes('auth') && process.argv.includes('logout')) {",
    "  console.log('Logged out');",
    "  process.exit(0);",
    "}",
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => { input += chunk; });",
    "process.stdin.on('end', () => {",
    "if (!input.includes('Output budget')) process.exit(7);",
    "const result = JSON.stringify({",
    "  response: 'Claude Code plan mode is connected.',",
    "  summary: 'No file changes needed.',",
    "  files: []",
    "});",
    "console.log(JSON.stringify({ result }));",
    "});"
  ].join("\n"), "utf8");

  const manager = new AiManager({
    userData: temp,
    encrypt: (value) => `encrypted:${value}`,
    decrypt: (value) => value.replace(/^encrypted:/, ""),
    getContext: () => ({ project: { rootPath: temp, tree: [] } }),
    readText: async () => "",
    writeText: async () => {},
    createBackup: async () => {},
    audit: async () => {}
  });
  await manager.saveSettings({
    provider: "claude-code",
    model: "default",
    endpoint: `"${process.execPath}" "${fakeCli}"`,
    maxOutputTokens: 1536
  });
  const settings = await manager.getSettings();
  assert.equal(settings.provider, "claude-code");
  assert.equal(settings.hasApiKey, true);
  assert.equal(settings.maxOutputTokens, 1536);
  const status = await manager.claudeCodeStatus();
  assert.equal(status.available, true);
  assert.equal(status.loggedIn, true);
  assert.equal(status.account, "neko@example.test");
  const logout = await manager.logoutClaudeCode();
  assert.equal(logout.loggedIn, false);
  const proposal = await manager.propose("Check the server.");
  assert.match(proposal.response, /plan mode is connected/);
  assert.equal(proposal.files.length, 0);
});

test("searches contents, validates a provider proposal, backs up, and applies selected files", async (context) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "wolfhq-ai-"));
  context.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "server");
  const configPath = path.join(root, "resources", "vehicle-shop", "config.lua");
  const serverCfgPath = path.join(root, "server.cfg");
  const content = new Map([
    [configPath, "Config = {}\nConfig.PremiumPrice = 25000\n"],
    [serverCfgPath, 'sv_licenseKey "private-license"\nsv_maxclients 48\n']
  ]);
  const writes = [];
  const backups = [];
  const audits = [];
  let providerRequest = "";
  const provider = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [
        { id: "wolfhq-test", name: "WOLFHQ Test" },
        { id: "text-embedding-test", name: "Embedding model" }
      ] }));
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      providerRequest = body;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              response: "I found the premium vehicle price and prepared the requested ten percent increase.",
              summary: "Raised the premium vehicle price.",
              files: [{
                path: configPath,
                explanation: "Updates the requested premium price.",
                content: "Config = {}\nConfig.PremiumPrice = 27500\n"
              }, {
                path: path.join(root, "invented.lua"),
                explanation: "Must be rejected.",
                content: "print('unsafe')"
              }]
            })
          }
        }]
      }));
    });
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => provider.close(resolve)));
  const endpoint = `http://127.0.0.1:${provider.address().port}/v1/chat/completions`;

  const project = {
    rootPath: root,
    tree: [{
      name: "server.cfg",
      path: serverCfgPath,
      relativePath: "server.cfg",
      type: "file",
      editable: true
    }, {
      name: "resources",
      path: path.join(root, "resources"),
      relativePath: "resources",
      type: "folder",
      children: [{
        name: "vehicle-shop",
        path: path.dirname(configPath),
        relativePath: path.join("resources", "vehicle-shop"),
        type: "folder",
        children: [{
          name: "config.lua",
          path: configPath,
          relativePath: path.join("resources", "vehicle-shop", "config.lua"),
          type: "file",
          editable: true
        }]
      }]
    }]
  };
  const manager = new AiManager({
    userData: temp,
    encrypt: (value) => `encrypted:${value}`,
    decrypt: (value) => value.replace(/^encrypted:/, ""),
    getContext: () => ({ project }),
    readText: async (filePath) => content.get(filePath),
    writeText: async (filePath, value) => {
      writes.push(filePath);
      content.set(filePath, value);
    },
    createBackup: async (label) => backups.push(label),
    audit: async (action, detail) => audits.push({ action, detail })
  });

  await manager.saveSettings({
    provider: "openai-compatible",
    model: "wolfhq-test",
    endpoint,
    apiKey: "local-test-key",
    maxOutputTokens: 2048
  });
  const settings = await manager.getSettings();
  assert.equal(settings.hasApiKey, true);
  assert.equal(settings.provider, "openai-compatible");
  assert.equal(settings.maxOutputTokens, 2048);
  const models = await manager.listModels();
  assert.equal(models.live, true);
  assert.deepEqual(models.models, [{ id: "wolfhq-test", name: "WOLFHQ Test" }]);

  const search = await manager.search("PremiumPrice");
  assert.equal(search.indexedFiles, 2);
  assert.equal(search.results[0].path, configPath);
  assert.match(search.results[0].snippet, /PremiumPrice/);

  const proposal = await manager.propose("Raise the premium vehicle price by ten percent.");
  assert.equal(proposal.files.length, 1);
  assert.equal(proposal.files[0].path, configPath);
  assert.match(proposal.response, /prepared the requested/);
  assert.doesNotMatch(providerRequest, /private-license/);
  assert.equal(JSON.parse(providerRequest).max_tokens, 2048);

  await manager.apply(proposal.files);
  assert.deepEqual(backups, ["pre-ai-edit"]);
  assert.deepEqual(writes, [configPath]);
  assert.match(content.get(configPath), /27500/);
  assert.ok(audits.some((entry) => entry.action === "ai.proposed"));
  assert.ok(audits.some((entry) => entry.action === "ai.applied"));
});
