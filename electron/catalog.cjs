const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const CATALOG_CACHE_TTL = 30 * 60 * 1000;

const CATALOG_SOURCES = Object.freeze([
  {
    owner: "qbcore-framework",
    framework: "QBCore",
    matches: (name) => /^qb-/i.test(name) || ["progressbar", "safecracker", "tutorial-script"].includes(name.toLowerCase()),
    excludes: new Set(["qb-docs"])
  },
  {
    owner: "Qbox-project",
    framework: "Qbox",
    matches: (name) => /^qbx_/i.test(name) || /^npwd_qbx_/i.test(name) || ["mm_radio", "safecracker", "mhacking"].includes(name.toLowerCase()),
    excludes: new Set(["qbx_grafana_map", "qbx_grafana_dashboard_examples", "qbx_invimages"])
  },
  {
    owner: "esx-framework",
    framework: "ESX",
    matches: (name) => /^(esx_|ox_)/i.test(name)
      || ["esx_core", "esx-legacy-addons", "esx-legacy-seasonal", "oxmysql"].includes(name.toLowerCase()),
    excludes: new Set()
  },
  {
    owner: "citizenfx",
    framework: "Standalone",
    matches: (name) => ["screenshot-basic", "example-resources"].includes(name.toLowerCase()),
    excludes: new Set()
  }
]);

const FALLBACK_RESOURCES = Object.freeze([
  { owner: "citizenfx", repo: "screenshot-basic", framework: "Standalone", category: "Utility", description: "Official Cfx.re screenshot capture resource." },
  { owner: "citizenfx", repo: "example-resources", framework: "Standalone", category: "Developer", description: "Official Cfx.re example resource collection." },
  { owner: "qbcore-framework", repo: "qb-core", framework: "QBCore", category: "Core", description: "The official core framework for QBCore servers." },
  { owner: "qbcore-framework", repo: "qb-inventory", framework: "QBCore", category: "Inventory", description: "Official slot-based QBCore inventory system." },
  { owner: "qbcore-framework", repo: "qb-target", framework: "QBCore", category: "Interaction", description: "Official eye-target interaction resource for QBCore." },
  { owner: "qbcore-framework", repo: "qb-menu", framework: "QBCore", category: "UI", description: "Official menu interface used by QBCore resources." },
  { owner: "qbcore-framework", repo: "qb-hud", framework: "QBCore", category: "UI", description: "Official QBCore player and vehicle HUD." },
  { owner: "qbcore-framework", repo: "qb-vehicleshop", framework: "QBCore", category: "Vehicles", description: "Official QBCore vehicle dealership resource." },
  { owner: "qbcore-framework", repo: "qb-policejob", framework: "QBCore", category: "Jobs", description: "Official QBCore police job." },
  { owner: "qbcore-framework", repo: "qb-ambulancejob", framework: "QBCore", category: "Jobs", description: "Official QBCore ambulance job." },
  { owner: "Qbox-project", repo: "qbx_core", framework: "Qbox", category: "Core", description: "Official Qbox core framework resource." },
  { owner: "Qbox-project", repo: "qbx_vehicles", framework: "Qbox", category: "Vehicles", description: "Official Qbox vehicle management resource." },
  { owner: "Qbox-project", repo: "qbx_properties", framework: "Qbox", category: "Housing", description: "Official Qbox property and housing system." },
  { owner: "Qbox-project", repo: "qbx_police", framework: "Qbox", category: "Jobs", description: "Official Qbox police resource." },
  { owner: "Qbox-project", repo: "qbx_ambulancejob", framework: "Qbox", category: "Jobs", description: "Official Qbox ambulance resource." },
  { owner: "Qbox-project", repo: "qbx_garages", framework: "Qbox", category: "Vehicles", description: "Official Qbox garage system." },
  { owner: "esx-framework", repo: "esx_core", framework: "ESX", category: "Core", description: "Official ESX Legacy core resource pack." },
  { owner: "esx-framework", repo: "ESX-Legacy-Addons", framework: "ESX", category: "Resource Pack", description: "Official ESX Legacy addon resource collection." },
  { owner: "esx-framework", repo: "ox_inventory", framework: "ESX", category: "Inventory", description: "Official ox inventory repository maintained by the ESX organization." },
  { owner: "esx-framework", repo: "oxmysql", framework: "ESX", category: "Database", description: "Official MySQL resource maintained by the ESX organization." }
]);

function resourceId(owner, repo) {
  return `${owner}-${repo}`.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

function inferCategory(name) {
  const value = String(name || "").toLowerCase();
  if (/core/.test(value)) return "Core";
  if (/inventory/.test(value)) return "Inventory";
  if (/mysql|database/.test(value)) return "Database";
  if (/police|ambulance|mechanic|taxi|tow|truck|garbage|bus|news|job/.test(value)) return "Jobs";
  if (/vehicle|garage|fuel|nitro|seatbelt|scrapyard/.test(value)) return "Vehicles";
  if (/house|housing|apartment|propert/.test(value)) return "Housing";
  if (/phone|npwd|radio/.test(value)) return "Communication";
  if (/menu|hud|scoreboard|loading|progress|input|spawn|clothing/.test(value)) return "UI";
  if (/target|doorlock|interior|binocular|helicam|dive/.test(value)) return "Interaction";
  if (/bank|robbery|weed|drug|pawn|shop|craft|crypto|jewel|vineyard|recycle/.test(value)) return "Gameplay";
  if (/admin|anticheat|management|playerstate|duty/.test(value)) return "Administration";
  if (/weather|smallresource|firework|density/.test(value)) return "Utility";
  if (/example|tutorial/.test(value)) return "Developer";
  return "Gameplay";
}

function publicResource(resource) {
  return {
    id: resource.id || resourceId(resource.owner, resource.repo),
    owner: resource.owner,
    repo: resource.repo,
    framework: resource.framework,
    category: resource.category || inferCategory(resource.repo),
    description: resource.description || `Official ${resource.framework} FiveM resource.`,
    sourceUrl: `https://github.com/${resource.owner}/${resource.repo}`,
    updatedAt: resource.updatedAt || "",
    stars: Number(resource.stars) || 0,
    official: true
  };
}

function buildCatalogFromRepositories(repositoriesByOwner) {
  const resources = [];
  for (const source of CATALOG_SOURCES) {
    const repositories = repositoriesByOwner[source.owner] || [];
    for (const repository of repositories) {
      if (repository.archived || repository.disabled) continue;
      if (!source.matches(repository.name) || source.excludes.has(repository.name.toLowerCase())) continue;
      resources.push(publicResource({
        owner: source.owner,
        repo: repository.name,
        framework: source.framework,
        category: inferCategory(repository.name),
        description: repository.description || `Official ${source.framework} FiveM resource.`,
        updatedAt: repository.pushed_at || repository.updated_at || "",
        stars: repository.stargazers_count
      }));
    }
  }
  return resources.sort((left, right) =>
    left.framework.localeCompare(right.framework)
    || left.category.localeCompare(right.category)
    || left.repo.localeCompare(right.repo)
  );
}

function chooseResourcesRoot(project) {
  const roots = project?.resourcesRoots || [];
  if (!roots.length) throw new Error("No FiveM resources folder was detected in this server.");
  const configDirectory = project.config?.path ? path.dirname(project.config.path) : "";
  return roots.find((candidate) => path.dirname(candidate) === configDirectory)
    || roots.find((candidate) => /txdata/i.test(candidate))
    || roots[0];
}

function categoryFolder(framework) {
  return {
    QBCore: "[wolfhq-qb]",
    Qbox: "[wolfhq-qbox]",
    ESX: "[wolfhq-esx]",
    Standalone: "[wolfhq-official]"
  }[framework] || "[wolfhq-official]";
}

class ResourceCatalogManager {
  constructor(options) {
    this.getContext = options.getContext;
    this.assertPermission = options.assertPermission;
    this.audit = options.audit;
    this.userData = options.userData || "";
    this.fetch = options.fetch || global.fetch;
    this.catalog = [];
    this.catalogLoadedAt = 0;
  }

  cachePath() {
    return this.userData ? path.join(this.userData, "wolfhq-resource-catalog.json") : "";
  }

  async fetchOrganization(owner) {
    const response = await this.fetch(`https://api.github.com/orgs/${owner}/repos?per_page=100&type=public&sort=updated`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "WOLFHQ-FiveM-Command-Center"
      }
    });
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status} for ${owner}.`);
    const repositories = await response.json();
    if (!Array.isArray(repositories)) throw new Error(`GitHub returned invalid repository data for ${owner}.`);
    return repositories;
  }

  async readCache() {
    const cachePath = this.cachePath();
    if (!cachePath) return [];
    try {
      const cached = JSON.parse(await fs.readFile(cachePath, "utf8"));
      return Array.isArray(cached.resources) ? cached.resources.map(publicResource) : [];
    } catch {
      return [];
    }
  }

  async writeCache(resources) {
    const cachePath = this.cachePath();
    if (!cachePath) return;
    await fs.mkdir(this.userData, { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify({
      refreshedAt: new Date().toISOString(),
      resources
    }, null, 2), "utf8");
  }

  async list(force = false) {
    if (!force && this.catalog.length && Date.now() - this.catalogLoadedAt < CATALOG_CACHE_TTL) {
      return this.catalog;
    }
    try {
      const entries = await Promise.all(CATALOG_SOURCES.map(async (source) => [
        source.owner,
        await this.fetchOrganization(source.owner)
      ]));
      const resources = buildCatalogFromRepositories(Object.fromEntries(entries));
      if (!resources.length) throw new Error("The official organizations returned no resource repositories.");
      this.catalog = resources;
      this.catalogLoadedAt = Date.now();
      await this.writeCache(resources).catch(() => {});
      return resources;
    } catch {
      const cached = await this.readCache();
      this.catalog = cached.length ? cached : FALLBACK_RESOURCES.map(publicResource);
      this.catalogLoadedAt = Date.now();
      return this.catalog;
    }
  }

  async install(resourceIdValue) {
    await this.assertPermission("catalog");
    const resources = await this.list();
    const resource = resources.find((candidate) => candidate.id === resourceIdValue);
    if (!resource) throw new Error("That resource is not in the verified official catalog.");
    const approvedSource = CATALOG_SOURCES.find((source) =>
      source.owner.toLowerCase() === resource.owner.toLowerCase()
      && source.matches(resource.repo)
      && !source.excludes.has(resource.repo.toLowerCase())
    );
    if (!approvedSource) throw new Error("That repository is not from an approved official resource source.");

    const context = this.getContext();
    if (!context.project) throw new Error("Connect a FiveM server before installing a resource.");
    const resourcesRoot = chooseResourcesRoot(context.project);
    const folder = categoryFolder(resource.framework);
    let result;
    if (context.mode === "remote") {
      result = await context.remote.cloneOfficialResource(resource, resourcesRoot, folder);
    } else {
      const categoryPath = path.resolve(resourcesRoot, folder);
      const destination = path.resolve(categoryPath, resource.repo);
      const relative = path.relative(path.resolve(context.root), destination);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("The selected resource destination is outside the active server.");
      }
      try {
        await fs.access(destination);
        throw new Error(`${resource.repo} is already installed. Use Git Deployment to update it.`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await fs.mkdir(categoryPath, { recursive: true });
      const sourceUrl = `https://github.com/${resource.owner}/${resource.repo}.git`;
      try {
        const { stdout, stderr } = await execFileAsync("git", ["clone", "--depth", "1", sourceUrl, destination], {
          windowsHide: true,
          timeout: 10 * 60 * 1000,
          maxBuffer: 8 * 1024 * 1024
        });
        result = { ok: true, path: destination, output: `${stdout}${stderr}`.trim() };
      } catch (error) {
        await fs.rm(destination, { recursive: true, force: true }).catch(() => {});
        throw new Error(error.stderr || error.message || "Git could not download this resource.");
      }
    }

    await this.audit("catalog.resource-installed", {
      resource: resource.repo,
      framework: resource.framework,
      source: `${resource.owner}/${resource.repo}`,
      path: result.path
    });
    return { ...result, resource };
  }
}

module.exports = {
  ResourceCatalogManager,
  CATALOG_SOURCES,
  FALLBACK_RESOURCES,
  buildCatalogFromRepositories,
  chooseResourcesRoot,
  inferCategory
};
