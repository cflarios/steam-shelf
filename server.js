import express from "express";
import dotenv from "dotenv";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.STEAM_API_KEY || "";

app.use(express.static(path.join(__dirname, "dist")));
app.use(express.json({ limit: "1mb" }));

// Resolve a vanity URL (custom profile name) to a SteamID64
async function resolveVanity(key, vanity) {
  const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${key}&vanityurl=${encodeURIComponent(vanity)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Steam API responded ${res.status}`);
  const data = await res.json();
  if (data.response?.success === 1) return data.response.steamid;
  return null;
}

// Accepts a SteamID64, vanity name, or a full profile URL
async function normalizeSteamId(key, input) {
  let value = input.trim();

  const profilesMatch = value.match(/steamcommunity\.com\/profiles\/(\d{17})/);
  if (profilesMatch) return profilesMatch[1];

  const idMatch = value.match(/steamcommunity\.com\/id\/([^/?#]+)/);
  if (idMatch) value = idMatch[1];

  if (/^\d{17}$/.test(value)) return value;

  return resolveVanity(key, value);
}

// Best-effort persona name + avatar for the loaded profile
async function getPlayerSummary(key, steamid) {
  if (!key) return null;
  try {
    const res = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${steamid}`
    );
    if (!res.ok) return null;
    const p = (await res.json()).response?.players?.[0];
    return p ? { name: p.personaname, avatar: p.avatarfull } : null;
  } catch {
    return null;
  }
}

// --- Steam login (OpenID 2.0) ---
const STEAM_OPENID = "https://steamcommunity.com/openid/login";

function baseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

app.get("/auth/steam", (req, res) => {
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": `${baseUrl(req)}/auth/steam/return`,
    "openid.realm": baseUrl(req),
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });
  res.redirect(`${STEAM_OPENID}?${params}`);
});

app.get("/auth/steam/return", async (req, res) => {
  try {
    // Send the response back to Steam to verify the signature
    const params = new URLSearchParams(req.query);
    params.set("openid.mode", "check_authentication");
    const verifyRes = await fetch(STEAM_OPENID, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const text = await verifyRes.text();
    if (!text.includes("is_valid:true")) {
      return res.redirect("/?loginerror=1");
    }
    const match = String(req.query["openid.claimed_id"] || "").match(
      /steamcommunity\.com\/openid\/id\/(\d{17})/
    );
    if (!match) return res.redirect("/?loginerror=1");
    res.redirect(`/?steamid=${match[1]}`);
  } catch (err) {
    console.error(err);
    res.redirect("/?loginerror=1");
  }
});

app.get("/api/games", async (req, res) => {
  try {
    const key = (req.query.key || API_KEY).trim();
    if (!key) {
      return res.status(400).json({ error: "Missing API key. Set STEAM_API_KEY in .env or enter it in the form." });
    }
    const rawId = req.query.steamid;
    if (!rawId) {
      return res.status(400).json({ error: "Missing SteamID or profile URL." });
    }

    const steamid = await normalizeSteamId(key, rawId);
    if (!steamid) {
      return res.status(404).json({ error: "Could not resolve that profile. Check the SteamID or URL." });
    }

    const url =
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/` +
      `?key=${key}&steamid=${steamid}&include_appinfo=1&include_played_free_games=1&format=json`;
    const apiRes = await fetch(url);
    if (apiRes.status === 401 || apiRes.status === 403) {
      return res.status(401).json({ error: "Invalid API key or insufficient permissions." });
    }
    if (!apiRes.ok) {
      return res.status(502).json({ error: `Steam API responded ${apiRes.status}.` });
    }
    const data = await apiRes.json();
    const games = data.response?.games;

    if (!games) {
      return res.status(403).json({
        error:
          "Steam returned no games. The profile (or its 'Game details') is most likely private. " +
          "Make it public at: Profile → Edit Profile → Privacy Settings.",
      });
    }

    games.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

    res.json({
      steamid,
      player: await getPlayerSummary(key, steamid),
      count: games.length,
      games: games.map((g) => ({
        appid: g.appid,
        name: g.name,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal error: " + err.message });
  }
});

// --- Steam Family shared library ---
// Requires a store access token (the plain Web API key cannot read family data).
// The user copies it from https://store.steampowered.com/pointssummary/ajaxgetasyncconfig
// while logged in to the Steam store.
app.get("/api/family", async (req, res) => {
  try {
    const token = (req.query.token || "").trim();
    if (!token) {
      return res.status(400).json({ error: "Missing access token." });
    }
    const key = (req.query.key || API_KEY).trim();
    const rawId = req.query.steamid;
    if (!rawId) {
      return res.status(400).json({ error: "Missing SteamID (sign in or enter your profile first)." });
    }
    const steamid = key ? await normalizeSteamId(key, rawId) : (rawId.match(/\d{17}/) || [])[0];
    if (!steamid) {
      return res.status(404).json({ error: "Could not resolve that profile." });
    }

    const groupRes = await fetch(
      `https://api.steampowered.com/IFamilyGroupsService/GetFamilyGroupForUser/v1/` +
        `?access_token=${encodeURIComponent(token)}&steamid=${steamid}&include_family_group_response=true`
    );
    if (groupRes.status === 401 || groupRes.status === 403) {
      return res.status(401).json({ error: "Steam rejected the access token. Copy a fresh one (they expire after ~24h)." });
    }
    if (!groupRes.ok) {
      return res.status(502).json({ error: `Steam API responded ${groupRes.status} while fetching the family group.` });
    }
    const groupData = (await groupRes.json()).response || {};
    const familyGroupId = groupData.family_groupid;
    if (!familyGroupId) {
      return res.status(404).json({ error: "This account does not belong to a Steam Family group." });
    }
    const familyName = groupData.family_group?.name || "Steam Family";
    const members = groupData.family_group?.members || [];

    const appsRes = await fetch(
      `https://api.steampowered.com/IFamilyGroupsService/GetSharedLibraryApps/v1/` +
        `?access_token=${encodeURIComponent(token)}&family_groupid=${familyGroupId}&include_own=true&language=english`
    );
    if (!appsRes.ok) {
      return res.status(502).json({ error: `Steam API responded ${appsRes.status} while fetching the shared library.` });
    }
    const appsData = (await appsRes.json()).response || {};
    const apps = appsData.apps || [];

    // Resolve member persona names (best effort — needs the API key)
    const personaNames = {};
    const memberIds = members.map((m) => String(m.steamid)).filter(Boolean);
    if (key && memberIds.length) {
      try {
        const sumRes = await fetch(
          `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${memberIds.join(",")}`
        );
        if (sumRes.ok) {
          for (const p of (await sumRes.json()).response?.players || []) {
            personaNames[p.steamid] = p.personaname;
          }
        }
      } catch {
        // fall back to raw SteamIDs
      }
    }

    const games = apps
      .filter((a) => a.appid && a.name)
      .map((a) => {
        const owners = (a.owner_steamids || []).map(String);
        return {
          appid: a.appid,
          name: a.name,
          owners: owners.map((id) => personaNames[id] || id),
          own: owners.includes(steamid),
        };
      });
    games.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

    // The webapi_token is a JWT — surface its expiry so the UI can show it
    let tokenExpiresAt = null;
    try {
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
      if (Number.isFinite(payload.exp)) tokenExpiresAt = payload.exp * 1000;
    } catch {
      // not a JWT-shaped token; no expiry info
    }

    res.json({
      steamid,
      player: await getPlayerSummary(key, steamid),
      tokenExpiresAt,
      familyName,
      memberCount: members.length,
      count: games.length,
      games,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal error: " + err.message });
  }
});

// --- Tags, content descriptors and assets (filters, NSFW detection, images) ---
const CACHE_DIR = path.join(__dirname, "cache");
const TAG_CACHE_FILE = path.join(CACHE_DIR, "tags.json");
const TAG_NAMES_FILE = path.join(CACHE_DIR, "tagnames_en.json");
const GETITEMS_URL = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=";
const SHARED_ASSETS = "https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/";

let appTagCache = null; // { [appid]: { t: [tagids], d: [descriptors], h: "hash/header.jpg" | null } }
let tagNamesCache = null; // { [tagid]: name }
let saveTimer = null;

function scheduleSaveCache() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveAppTagCache().catch(console.error), 2000);
}

function cacheStoreItem(cache, item) {
  cache[item.appid] = {
    t: item.tagids || [],
    d: item.content_descriptorids || [],
    h: item.assets?.header || null,
    f: !!item.is_free,
  };
}

async function loadAppTagCache() {
  if (!appTagCache) {
    try {
      appTagCache = JSON.parse(await fs.readFile(TAG_CACHE_FILE, "utf8"));
    } catch {
      appTagCache = {};
    }
  }
  return appTagCache;
}

async function saveAppTagCache() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(TAG_CACHE_FILE, JSON.stringify(appTagCache));
}

async function getTagNames() {
  if (tagNamesCache) return tagNamesCache;
  try {
    tagNamesCache = JSON.parse(await fs.readFile(TAG_NAMES_FILE, "utf8"));
    return tagNamesCache;
  } catch {
    // no disk cache yet, ask Steam
  }
  const res = await fetch("https://api.steampowered.com/IStoreService/GetTagList/v1/?language=english");
  if (!res.ok) throw new Error(`GetTagList responded ${res.status}`);
  const data = await res.json();
  tagNamesCache = {};
  for (const t of data.response?.tags || []) tagNamesCache[t.tagid] = t.name;
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(TAG_NAMES_FILE, JSON.stringify(tagNamesCache));
  return tagNamesCache;
}

app.post("/api/tags", async (req, res) => {
  try {
    const appids = (req.body?.appids || []).filter((n) => Number.isInteger(n) && n > 0);
    if (!appids.length) return res.status(400).json({ error: "Missing appids." });

    const cache = await loadAppTagCache();
    // h/f === undefined: entry from an older cache version (no assets / no free flag) → refresh
    const missing = appids.filter(
      (id) => !cache[id] || cache[id].h === undefined || cache[id].f === undefined
    );

    const CHUNK = 200;
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK);
      const input = {
        ids: chunk.map((appid) => ({ appid })),
        context: { language: "english", country_code: "US" },
        data_request: { include_tag_count: 20, include_ratings: true, include_assets: true },
      };
      const apiRes = await fetch(GETITEMS_URL + encodeURIComponent(JSON.stringify(input)));
      if (!apiRes.ok) throw new Error(`GetItems responded ${apiRes.status}`);
      const data = await apiRes.json();
      const returned = new Set();
      for (const item of data.response?.store_items || []) {
        if (!item.appid) continue;
        returned.add(item.appid);
        cacheStoreItem(cache, item);
      }
      // apps delisted from the store: cache an empty entry so we don't re-query every time
      for (const id of chunk) {
        if (!returned.has(id)) cache[id] = { t: [], d: [], h: null, f: false };
      }
    }
    if (missing.length) await saveAppTagCache();

    const apps = {};
    for (const id of appids) apps[id] = cache[id] || { t: [], d: [], h: null, f: false };
    res.json({ apps, tagNames: await getTagNames() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching tags: " + err.message });
  }
});

// Image proxy (same origin → html2canvas can capture without tainting the canvas)
// Newer games (e.g. Battlefield 6) host their real header under store_item_assets/<hash>/,
// while the classic CDN path returns a ~1.4KB gray placeholder with a 200 status.
const PLACEHOLDER_MAX_BYTES = 2500;

async function fetchImg(url) {
  try {
    const r = await fetch(url);
    if (r.ok) {
      return {
        buf: Buffer.from(await r.arrayBuffer()),
        type: r.headers.get("content-type") || "image/jpeg",
      };
    }
  } catch {
    // source unavailable
  }
  return null;
}

app.get("/img/:appid", async (req, res) => {
  const appid = req.params.appid;
  if (!/^\d+$/.test(appid)) return res.status(400).end();

  const send = (img) => {
    res.set("Content-Type", img.type);
    res.set("Cache-Control", "public, max-age=86400");
    res.send(img.buf);
  };

  const cache = await loadAppTagCache();

  // 1. Known hashed asset (from cache)
  const cachedHash = cache[appid]?.h;
  if (cachedHash) {
    const img = await fetchImg(`${SHARED_ASSETS}${appid}/${cachedHash}`);
    if (img) return send(img);
  }

  // 2. Classic CDN, rejecting the gray placeholder
  const legacy = await fetchImg(`https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`);
  if (legacy && legacy.buf.length > PLACEHOLDER_MAX_BYTES) return send(legacy);

  // 3. Resolve this app's assets individually
  if (cachedHash === undefined) {
    try {
      const input = {
        ids: [{ appid: Number(appid) }],
        context: { language: "english", country_code: "US" },
        data_request: { include_tag_count: 20, include_ratings: true, include_assets: true },
      };
      const r = await fetch(GETITEMS_URL + encodeURIComponent(JSON.stringify(input)));
      if (r.ok) {
        const data = await r.json();
        const item = (data.response?.store_items || [])[0];
        if (item?.appid) {
          cacheStoreItem(cache, item);
          scheduleSaveCache();
          if (cache[appid].h) {
            const img = await fetchImg(`${SHARED_ASSETS}${appid}/${cache[appid].h}`);
            if (img) return send(img);
          }
        }
      }
    } catch {
      // no store data for this app
    }
  }

  // 4. Last resort: the gray placeholder or the small capsule
  if (legacy) return send(legacy);
  const capsule = await fetchImg(`https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/capsule_231x87.jpg`);
  if (capsule) return send(capsule);
  res.status(404).end();
});

app.listen(PORT, () => {
  console.log(`Steam Library Export running at http://localhost:${PORT}`);
  if (!API_KEY) {
    console.log("Note: no STEAM_API_KEY in .env — you can enter one on the page.");
  }
});
