const NEKO_ANTI_CHEAT_RESOURCE = "neko-anticheat";
const NEKO_ANTI_CHEAT_VERSION = "1.0.0";

function nekoAntiCheatFiles(profile = "Balanced") {
  const safeProfile = ["Monitor", "Balanced", "Strict"].includes(profile) ? profile : "Balanced";
  const manifest = [
    "fx_version 'cerulean'",
    "game 'gta5'",
    "",
    "author 'Wolf Studios Inc. / Neko Wolf Dev'",
    "description 'Neko Anti-Cheat runtime protection for WOLFHQ'",
    `version '${NEKO_ANTI_CHEAT_VERSION}'`,
    "",
    "shared_script 'config.lua'",
    "client_script 'client.lua'",
    "server_script 'server.lua'",
    ""
  ].join("\n");
  const config = [
    "NekoAC = NekoAC or {}",
    `NekoAC.profile = '${safeProfile}' -- Monitor, Balanced, Strict`,
    "NekoAC.version = '1.0.0'",
    "NekoAC.heartbeatSeconds = 15",
    "NekoAC.maxRunSpeed = 13.5",
    "NekoAC.teleportDistance = 85.0",
    "NekoAC.maxHealth = 205",
    "NekoAC.maxArmour = 100",
    "NekoAC.entityBurstLimit = 34",
    "NekoAC.explosionBurstLimit = 5",
    "NekoAC.blacklistedWeapons = {",
    "  'WEAPON_RAILGUN',",
    "  'WEAPON_RAILGUNXM3',",
    "  'WEAPON_MINIGUN',",
    "  'WEAPON_RPG',",
    "  'WEAPON_HOMINGLAUNCHER',",
    "  'WEAPON_GRENADELAUNCHER',",
    "  'WEAPON_COMPACTLAUNCHER'",
    "}",
    "NekoAC.blacklistedExplosions = {",
    "  [0] = true,  -- grenade",
    "  [1] = true,  -- grenade launcher",
    "  [2] = true,  -- sticky bomb",
    "  [4] = true,  -- rocket",
    "  [5] = true,  -- tank shell",
    "  [29] = true, -- pipe bomb",
    "  [32] = true, -- vehicle mine",
    "  [33] = true, -- explosive ammo",
    "  [35] = true, -- programmable ar",
    "  [36] = true  -- railgun",
    "}",
    ""
  ].join("\n");
  const client = `local lastPosition = nil
local lastReport = {}

local function now()
    return GetGameTimer()
end

local function shouldReport(key, cooldown)
    local current = now()
    if lastReport[key] and current - lastReport[key] < cooldown then
        return false
    end
    lastReport[key] = current
    return true
end

local function report(module, severity, message, data)
    if not shouldReport(module .. ':' .. message, 8000) then return end
    TriggerServerEvent('nekoac:flag', module, severity, message, data or {})
end

local function weaponHashList()
    local result = {}
    for _, name in ipairs(NekoAC.blacklistedWeapons or {}) do
        result[GetHashKey(name)] = name
    end
    return result
end

local blacklistedWeapons = weaponHashList()

CreateThread(function()
    while true do
        Wait(1750)
        local ped = PlayerPedId()
        if ped and ped ~= 0 and NetworkIsPlayerActive(PlayerId()) then
            local health = GetEntityHealth(ped)
            local armour = GetPedArmour(ped)
            if health > (NekoAC.maxHealth or 205) then
                report('PLAYER_INTEGRITY', 82, 'Health above configured maximum', { health = health })
            end
            if armour > (NekoAC.maxArmour or 100) then
                report('PLAYER_INTEGRITY', 72, 'Armour above configured maximum', { armour = armour })
            end
            if GetPlayerInvincible(PlayerId()) then
                report('PLAYER_INTEGRITY', 95, 'Player invincibility native returned true', {})
            end
            if not IsEntityVisible(ped) and not IsPedDeadOrDying(ped, true) then
                report('PLAYER_INTEGRITY', 80, 'Player ped is invisible', {})
            end

            local weapon = GetSelectedPedWeapon(ped)
            if weapon and blacklistedWeapons[weapon] then
                report('WEAPON_CONTROL', 92, 'Blacklisted weapon equipped', { weapon = blacklistedWeapons[weapon], hash = weapon })
            end

            local coords = GetEntityCoords(ped)
            local inVehicle = IsPedInAnyVehicle(ped, false)
            local falling = IsPedFalling(ped) or IsPedRagdoll(ped) or IsPedClimbing(ped) or IsPedDeadOrDying(ped, true)
            if not inVehicle and not falling then
                local speed = GetEntitySpeed(ped)
                if speed > (NekoAC.maxRunSpeed or 13.5) then
                    report('MOVEMENT_ANALYSIS', 72, 'Suspicious on-foot speed', { speed = speed })
                end
                if lastPosition then
                    local distance = #(coords - lastPosition)
                    if distance > (NekoAC.teleportDistance or 85.0) then
                        report('MOVEMENT_ANALYSIS', 86, 'Large on-foot position delta', { distance = distance })
                    end
                end
            end
            lastPosition = coords
        end
    end
end)

CreateThread(function()
    while true do
        Wait((NekoAC.heartbeatSeconds or 15) * 1000)
        local ped = PlayerPedId()
        if ped and ped ~= 0 then
            local coords = GetEntityCoords(ped)
            TriggerServerEvent('nekoac:heartbeat', {
                health = GetEntityHealth(ped),
                armour = GetPedArmour(ped),
                speed = GetEntitySpeed(ped),
                weapon = GetSelectedPedWeapon(ped),
                coords = { x = coords.x, y = coords.y, z = coords.z }
            })
        end
    end
end)
`;
  const server = `local RESOURCE = GetCurrentResourceName()
local TOKEN = (LoadResourceFile(RESOURCE, '.neko-token') or ''):gsub('%s+$', '')
local INCIDENTS_FILE = 'incidents.json'
local BANS_FILE = 'bans.json'
local SETTINGS_FILE = 'runtime-settings.json'
local incidents = json.decode(LoadResourceFile(RESOURCE, INCIDENTS_FILE) or '[]') or {}
local bans = json.decode(LoadResourceFile(RESOURCE, BANS_FILE) or '[]') or {}
local runtimeSettings = json.decode(LoadResourceFile(RESOURCE, SETTINGS_FILE) or '{}') or {}
local players = {}
local entityWindows = {}
local explosionWindows = {}

local moduleNames = {
    PLAYER_INTEGRITY = 'Player integrity',
    MOVEMENT_ANALYSIS = 'Movement analysis',
    WEAPON_CONTROL = 'Weapon control',
    EVENT_FIREWALL = 'Event firewall',
    ENTITY_DEFENCE = 'Entity defence',
    IDENTITY_SIGNALS = 'Identity signals'
}

local profiles = {
    Monitor = { dropSeverity = 999, maxScore = 999, decay = 10 },
    Balanced = { dropSeverity = 96, maxScore = 170, decay = 12 },
    Strict = { dropSeverity = 84, maxScore = 115, decay = 8 }
}

local function activeProfile()
    local profile = runtimeSettings.profile or NekoAC.profile or 'Balanced'
    if profiles[profile] then return profile end
    return 'Balanced'
end

local function saveJson(fileName, value)
    SaveResourceFile(RESOURCE, fileName, json.encode(value), -1)
end

local function sendJson(res, status, payload)
    res.writeHead(status, { ['Content-Type'] = 'application/json', ['Cache-Control'] = 'no-store' })
    res.send(json.encode(payload))
end

local function isAuthorized(req)
    local supplied = req.headers['x-neko-token'] or req.headers['X-Neko-Token']
    return TOKEN ~= '' and supplied == TOKEN
end

local function identifiers(source)
    return GetPlayerIdentifiers(source) or {}
end

local function playerName(source)
    return GetPlayerName(source) or ('source ' .. tostring(source))
end

local function ensurePlayer(source)
    local key = tostring(source)
    if not players[key] then
        players[key] = {
            id = tonumber(source),
            name = playerName(source),
            identifiers = identifiers(source),
            endpoint = GetPlayerEndpoint(source) or 'Protected',
            ping = GetPlayerPing(source),
            score = 0,
            flags = {},
            firstSeen = os.date('!%Y-%m-%dT%H:%M:%SZ'),
            lastSeen = os.date('!%Y-%m-%dT%H:%M:%SZ')
        }
    end
    players[key].name = playerName(source)
    players[key].ping = GetPlayerPing(source)
    players[key].lastSeen = os.date('!%Y-%m-%dT%H:%M:%SZ')
    return players[key]
end

local function hasBan(source)
    local current = identifiers(source)
    for _, ban in ipairs(bans) do
        for _, left in ipairs(current) do
            for _, right in ipairs(ban.identifiers or {}) do
                if left == right then return ban end
            end
        end
    end
    return nil
end

local function trimStore()
    while #incidents > 250 do table.remove(incidents, 1) end
end

local function addIncident(source, module, severity, message, data)
    source = tonumber(source) or 0
    module = tostring(module or 'UNKNOWN'):upper()
    if not moduleNames[module] then module = 'EVENT_FIREWALL' end
    severity = math.max(1, math.min(100, tonumber(severity) or 40))
    message = tostring(message or 'Suspicious activity'):sub(1, 220)
    local player = source > 0 and ensurePlayer(source) or nil
    local incident = {
        id = ('%s-%04d'):format(os.date('!%Y%m%d%H%M%S'), math.random(1000, 9999)),
        source = source,
        name = player and player.name or 'server',
        identifiers = player and player.identifiers or {},
        module = module,
        moduleLabel = moduleNames[module],
        severity = severity,
        message = message,
        data = data or {},
        createdAt = os.date('!%Y-%m-%dT%H:%M:%SZ'),
        profile = activeProfile()
    }
    incidents[#incidents + 1] = incident
    trimStore()
    saveJson(INCIDENTS_FILE, incidents)

    if player then
        player.score = math.max(0, (player.score or 0) + severity)
        player.flags[#player.flags + 1] = incident
        while #player.flags > 12 do table.remove(player.flags, 1) end
        local policy = profiles[activeProfile()] or profiles.Balanced
        if severity >= policy.dropSeverity or player.score >= policy.maxScore then
            local reason = ('Neko Anti-Cheat: %s'):format(message)
            bans[#bans + 1] = {
                name = player.name,
                identifiers = player.identifiers,
                reason = reason,
                module = module,
                severity = severity,
                createdAt = os.date('!%Y-%m-%dT%H:%M:%SZ'),
                provider = 'Neko Anti-Cheat'
            }
            saveJson(BANS_FILE, bans)
            DropPlayer(source, reason)
            print(('[NekoAC] Dropped %s: %s'):format(player.name, message))
        end
    end
    print(('[NekoAC] %s severity %d from %s: %s'):format(module, severity, player and player.name or 'server', message))
    return incident
end

RegisterNetEvent('nekoac:heartbeat', function(payload)
    local src = source
    local player = ensurePlayer(src)
    player.lastHeartbeat = os.date('!%Y-%m-%dT%H:%M:%SZ')
    player.telemetry = payload or {}
    local policy = profiles[activeProfile()] or profiles.Balanced
    player.score = math.max(0, (player.score or 0) - policy.decay)
end)

RegisterNetEvent('nekoac:flag', function(module, severity, message, data)
    addIncident(source, module, severity, message, data)
end)

AddEventHandler('playerConnecting', function(_, setKickReason)
    local ban = hasBan(source)
    if ban then
        setKickReason(('Banned by Neko Anti-Cheat: %s'):format(ban.reason or 'No reason supplied'))
        CancelEvent()
    end
end)

AddEventHandler('playerDropped', function()
    local key = tostring(source)
    if players[key] then
        players[key].droppedAt = os.date('!%Y-%m-%dT%H:%M:%SZ')
    end
end)

AddEventHandler('explosionEvent', function(sender, event)
    local src = tonumber(sender) or 0
    local explosionType = tonumber(event and event.explosionType) or -1
    local stamp = os.time()
    explosionWindows[src] = explosionWindows[src] or { start = stamp, count = 0 }
    if stamp - explosionWindows[src].start > 10 then
        explosionWindows[src] = { start = stamp, count = 0 }
    end
    explosionWindows[src].count = explosionWindows[src].count + 1
    if (NekoAC.blacklistedExplosions or {})[explosionType] or explosionWindows[src].count > (NekoAC.explosionBurstLimit or 5) then
        CancelEvent()
        addIncident(src, 'EVENT_FIREWALL', 92, 'Blocked suspicious explosion event', {
            explosionType = explosionType,
            count = explosionWindows[src].count
        })
    end
end)

AddEventHandler('entityCreating', function(entity)
    local owner = 0
    pcall(function() owner = NetworkGetEntityOwner(entity) or 0 end)
    if owner <= 0 then return end
    local stamp = os.time()
    entityWindows[owner] = entityWindows[owner] or { start = stamp, count = 0 }
    if stamp - entityWindows[owner].start > 8 then
        entityWindows[owner] = { start = stamp, count = 0 }
    end
    entityWindows[owner].count = entityWindows[owner].count + 1
    if entityWindows[owner].count > (NekoAC.entityBurstLimit or 34) then
        CancelEvent()
        addIncident(owner, 'ENTITY_DEFENCE', 86, 'Blocked entity creation burst', { count = entityWindows[owner].count })
    end
end)

RegisterCommand('nekoac', function(source, args)
    if source ~= 0 then return end
    local action = tostring(args[1] or 'status')
    if action == 'profile' and args[2] and profiles[args[2]] then
        runtimeSettings.profile = args[2]
        saveJson(SETTINGS_FILE, runtimeSettings)
        print('[NekoAC] Runtime profile set to ' .. args[2])
    else
        print(('[NekoAC] version %s // profile %s // incidents %d // players %d'):format(NekoAC.version or '1.0.0', activeProfile(), #incidents, #GetPlayers()))
    end
end, true)

local function statusPayload()
    local livePlayers = {}
    for _, source in ipairs(GetPlayers()) do
        livePlayers[#livePlayers + 1] = ensurePlayer(source)
    end
    local recent = {}
    for index = math.max(1, #incidents - 49), #incidents do
        recent[#recent + 1] = incidents[index]
    end
    return {
        ok = true,
        provider = 'Neko Anti-Cheat',
        resource = RESOURCE,
        version = NekoAC.version or '1.0.0',
        profile = activeProfile(),
        players = livePlayers,
        incidents = recent,
        incidentCount = #incidents,
        banCount = #bans,
        modules = moduleNames
    }
end

SetHttpHandler(function(req, res)
    if not isAuthorized(req) then
        return sendJson(res, 403, { ok = false, error = 'unauthorized' })
    end
    if req.method == 'GET' and req.path:match('/status$') then
        return sendJson(res, 200, statusPayload())
    end
    if req.method == 'GET' and req.path:match('/incidents$') then
        return sendJson(res, 200, incidents)
    end
    req.setDataHandler(function(body)
        local payload = json.decode(body or '{}') or {}
        if req.method == 'POST' and req.path:match('/profile$') then
            local profile = tostring(payload.profile or '')
            if not profiles[profile] then return sendJson(res, 400, { ok = false, error = 'invalid profile' }) end
            runtimeSettings.profile = profile
            saveJson(SETTINGS_FILE, runtimeSettings)
            return sendJson(res, 200, statusPayload())
        end
        if req.method == 'POST' and req.path:match('/clear$') then
            incidents = {}
            saveJson(INCIDENTS_FILE, incidents)
            return sendJson(res, 200, statusPayload())
        end
        return sendJson(res, 404, { ok = false, error = 'route not found' })
    end)
end)

print(('[NekoAC] Runtime protection online. Profile: %s'):format(activeProfile()))
`;
  const readme = [
    "# Neko Anti-Cheat",
    "",
    "Installed and managed by WOLFHQ.",
    "",
    "Modules:",
    "- Player integrity: health, armour, invincibility, invisibility",
    "- Movement analysis: on-foot speed and teleport deltas",
    "- Weapon control: configured blacklisted weapons",
    "- Event firewall: suspicious explosion bursts",
    "- Entity defence: entity creation burst protection",
    "- Identity signals: persistent identifier bans",
    "",
    "Profiles:",
    "- Monitor: logs only",
    "- Balanced: drops severe or repeated offenders",
    "- Strict: faster enforcement for high-risk servers",
    ""
  ].join("\n");
  return { manifest, config, client, server, readme };
}

function patchNekoAntiCheatConfig(serverCfg) {
  const ensureLines = [];
  if (!/^\s*(?:ensure|start)\s+neko-anticheat\s*$/im.test(serverCfg)) ensureLines.push("ensure neko-anticheat");
  if (!ensureLines.length) return { content: serverCfg, changed: false };
  const suffix = `${serverCfg.endsWith("\n") ? "" : "\n"}\n# Neko Anti-Cheat managed by WOLFHQ\n${ensureLines.join("\n")}\n`;
  return { content: `${serverCfg}${suffix}`, changed: true };
}

module.exports = {
  NEKO_ANTI_CHEAT_RESOURCE,
  NEKO_ANTI_CHEAT_VERSION,
  nekoAntiCheatFiles,
  patchNekoAntiCheatConfig
};
