const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { ResourceCatalogManager, buildCatalogFromRepositories, inferCategory } = require("../electron/catalog.cjs");

test("builds a categorized catalog only from approved active resource names", () => {
  const catalog = buildCatalogFromRepositories({
    "qbcore-framework": [
      { name: "qb-shops", description: "Shops", archived: false, disabled: false },
      { name: "qb-docs", description: "Docs", archived: false, disabled: false },
      { name: "qb-old", description: "Old", archived: true, disabled: false }
    ],
    "Qbox-project": [
      { name: "qbx_garages", description: "Garages", archived: false, disabled: false },
      { name: "qbox-docs", description: "Docs", archived: false, disabled: false }
    ],
    "esx-framework": [
      { name: "esx_core", description: "Core", archived: false, disabled: false }
    ],
    citizenfx: [
      { name: "screenshot-basic", description: "Screenshots", archived: false, disabled: false },
      { name: "fivem", description: "Platform source", archived: false, disabled: false }
    ]
  });

  assert.deepEqual(catalog.map((resource) => resource.repo).sort(), [
    "esx_core",
    "qb-shops",
    "qbx_garages",
    "screenshot-basic"
  ]);
  assert.equal(inferCategory("qbx_garages"), "Vehicles");
  assert.equal(inferCategory("qb-policejob"), "Jobs");
});

test("refreshes and caches official organization data", async (context) => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "wolfhq-catalog-"));
  context.after(() => fs.rm(userData, { recursive: true, force: true }));
  let requests = 0;
  const repositories = {
    "qbcore-framework": [{ name: "qb-core", description: "Core", archived: false, disabled: false }],
    "Qbox-project": [{ name: "qbx_core", description: "Core", archived: false, disabled: false }],
    "esx-framework": [{ name: "esx_core", description: "Core", archived: false, disabled: false }],
    citizenfx: [{ name: "screenshot-basic", description: "Screenshots", archived: false, disabled: false }]
  };
  const manager = new ResourceCatalogManager({
    userData,
    getContext: () => ({}),
    assertPermission: async () => {},
    audit: async () => {},
    fetch: async (url) => {
      requests += 1;
      const owner = url.match(/orgs\/([^/]+)/)?.[1];
      return { ok: true, json: async () => repositories[owner] || [] };
    }
  });

  const first = await manager.list(true);
  const second = await manager.list();
  assert.equal(first.length, 4);
  assert.equal(second.length, 4);
  assert.equal(requests, 4);
  const cached = JSON.parse(await fs.readFile(path.join(userData, "wolfhq-resource-catalog.json"), "utf8"));
  assert.equal(cached.resources.length, 4);
});
