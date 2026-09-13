import { useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

// Steam content descriptors: 3 = adult-only sexual content, 4 = frequent nudity.
// Descriptor 1 (some nudity) is deliberately excluded: it would flag AAA games like Cyberpunk.
// "Nudity" and "Sexual Content" are deliberately not matched: mainstream games
// like Cyberpunk or The Witcher 3 carry those community tags. Truly adult games
// have the descriptors above; these tags are only a fallback for delisted ones.
const SEXUAL_DESCRIPTORS = new Set([3, 4]);
const NSFW_TAG_RE = /hentai|nsfw|porn|eroge/i;

// Saved form state so a page refresh doesn't require signing in again.
// This is a local tool: everything stays in this browser's localStorage.
const STORAGE_KEY = "sle:settings";

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

const SAVED = loadSaved();

// Library values are approximate: current US store prices, F2P and delisted games count as $0
function formatUsd(cents) {
  return "$" + Math.round(cents / 100).toLocaleString("en-US");
}

// Labels used in the export header when a sort other than A–Z is active
const SORT_LABELS = {
  copies: "sorted by copies",
  "price-desc": "sorted by price (high to low)",
  "price-asc": "sorted by price (low to high)",
  playtime: "sorted by most played",
  release: "sorted by newest release",
};

function SteamIcon({ size = 22, color = "#66c0f4" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M12 2C6.7 2 2.4 6.1 2 11.3l5.4 2.2c.5-.3 1-.5 1.6-.5l2.4-3.5v-.1c0-2.1 1.7-3.8 3.8-3.8s3.8 1.7 3.8 3.8-1.7 3.8-3.8 3.8h-.1l-3.4 2.5v.4c0 1.6-1.3 2.9-2.9 2.9-1.4 0-2.6-1-2.8-2.4l-3.9-1.6C3.2 19.4 7.2 22.5 12 22.5c5.8 0 10.5-4.7 10.5-10.5S17.8 2 12 2z" />
    </svg>
  );
}

function DownloadIcon({ color }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  );
}

function GitHubLink() {
  return (
    <a
      className="gh-link"
      href="https://github.com/cflarios/steam-shelf"
      target="_blank"
      rel="noopener noreferrer"
      title="View on GitHub"
      aria-label="View on GitHub"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
      </svg>
    </a>
  );
}

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #66c0f4, #2e6da4)",
  "linear-gradient(135deg, #a4622e, #7a3c1e)",
  "linear-gradient(135deg, #4c8c55, #2a5e33)",
  "linear-gradient(135deg, #7a4d8c, #4d2e5e)",
  "linear-gradient(135deg, #a48d2e, #6e5e1e)",
  "linear-gradient(135deg, #a42e50, #6e1e36)",
];

function avatarGradient(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}

function MemberAvatar({ name, size = 22 }) {
  const dark = avatarGradient(name) === AVATAR_GRADIENTS[0];
  return (
    <span
      className="member-avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.5,
        background: avatarGradient(name),
        color: dark ? "#14232f" : "#ffffff",
      }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true">
        <span className="knob" />
      </span>
      {label}
    </label>
  );
}

function GameCard({ game, playerName, free, nsfw }) {
  const [failed, setFailed] = useState(false);
  let ownerLabel = null;
  if (game.owners) {
    // Uniform badge on every family card: all owners, "You" first
    const owners = game.owners
      .map((o) => (playerName && o === playerName ? "You" : o))
      .sort((a, b) => (a === "You" ? -1 : b === "You" ? 1 : a.localeCompare(b, "en")));
    ownerLabel = owners.join(", ");
  }
  const copies = game.owners?.length || 0;
  return (
    <div className="card">
      <div className="thumb">
        {failed ? (
          <div className="noimg">No image</div>
        ) : (
          <img src={`/img/${game.appid}?v=2`} alt="" loading="lazy" onError={() => setFailed(true)} />
        )}
        <span className="badges">
          {free ? (
            <span className="copies f2p">Free to Play</span>
          ) : (
            copies > 1 && <span className="copies">{copies}</span>
          )}
          {nsfw && <span className="copies f2p">NSFW</span>}
        </span>
      </div>
      <div className="name">{game.name}</div>
      {ownerLabel && <div className="owner">Owned by {ownerLabel}</div>}
    </div>
  );
}

export default function App() {
  const [apiKey, setApiKey] = useState(SAVED.apiKey || "");
  const [profile, setProfile] = useState(SAVED.profile || "");
  const [familyToken, setFamilyToken] = useState(SAVED.familyToken || "");
  const [mode, setMode] = useState(SAVED.mode === "family" ? "family" : "own");
  const [status, setStatus] = useState(null); // { msg, error }
  // Start in loading state when a session will auto-load on mount, so the
  // sign-in button doesn't flash while the library is being fetched.
  const [loading, setLoading] = useState(
    () => !!(SAVED.profile || new URLSearchParams(window.location.search).get("steamid"))
  );
  const [library, setLibrary] = useState(null); // { steamid, games, familyName?, player? }
  const [tagData, setTagData] = useState(null); // { apps, tagNames }
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagFilter, setTagFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [hideNsfw, setHideNsfw] = useState(true);
  const [hideFree, setHideFree] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("name"); // "name" | "copies"
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [tokenDialog, setTokenDialog] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");
  const [exportMsg, setExportMsg] = useState(null);
  const captureRef = useRef(null);

  async function load(profileValue, keyValue, useFamily, tokenValue) {
    setLoading(true);
    setStatus({ msg: "Querying the Steam API…" });
    try {
      const params = new URLSearchParams({ steamid: profileValue });
      if (keyValue) params.set("key", keyValue);
      let url = "/api/games?" + params.toString();
      if (useFamily) {
        params.set("token", tokenValue);
        url = "/api/family?" + params.toString();
      }
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        // Expired/rejected family token: stay where we are and ask for a fresh one
        if (useFamily && res.status === 401) {
          setTokenDraft("");
          setTokenDialog(true);
        }
        throw new Error(data.error || "Unknown error");
      }
      // Commit only on success, so a failed load never drops the current view
      setLibrary(data);
      setMode(useFamily ? "family" : "own");
      setTagData(null);
      setTagFilter("");
      setOwnerFilter("");
      setSortBy("name");
      setSearch("");
      // Family view compares the shareable pool: members' F2P never appear there
      // (Steam doesn't share them), so hide your own by default for symmetry.
      setHideFree(useFamily);
      setStatus(null);
      loadTags(data.games.map((g) => g.appid));
    } catch (err) {
      setStatus({ msg: err.message, error: true });
    } finally {
      setLoading(false);
    }
  }

  async function loadTags(appids) {
    setTagsLoading(true);
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error fetching tags");
      setTagData(data);
    } catch (err) {
      setStatus({ msg: "Could not load tags (filters unavailable): " + err.message, error: true });
    } finally {
      setTagsLoading(false);
    }
  }

  // Persist form state so refreshing the page doesn't lose the session
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ apiKey, profile, familyToken, mode }));
    } catch {
      // storage unavailable (private window, etc.)
    }
  }, [apiKey, profile, familyToken, mode]);

  // On mount: handle the Steam login return (/?steamid=...) or restore the saved session
  useEffect(() => {
    const url = new URL(window.location.href);
    const sid = url.searchParams.get("steamid");
    const useFamily = SAVED.mode === "family" && !!SAVED.familyToken;
    if (sid) {
      setProfile(sid);
      history.replaceState(null, "", "/");
      load(sid, SAVED.apiKey || "", useFamily, SAVED.familyToken || "");
    } else if (url.searchParams.get("loginerror")) {
      history.replaceState(null, "", "/");
      setStatus({ msg: "Steam sign-in failed. Try again or enter your profile manually.", error: true });
    } else if (SAVED.profile) {
      load(SAVED.profile, SAVED.apiKey || "", useFamily, SAVED.familyToken || "");
    }
  }, []);

  function signOut() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // storage unavailable
    }
    setApiKey("");
    setProfile("");
    setFamilyToken("");
    setMode("own");
    setLibrary(null);
    setTagData(null);
    setStatus(null);
    setAdvancedOpen(false);
  }

  function switchMode(next) {
    if (loading || next === mode) return;
    if (next === "family") {
      if (!familyToken) {
        setTokenDraft("");
        setTokenDialog(true);
        return;
      }
      load(profile, apiKey, true, familyToken);
    } else {
      load(profile, apiKey, false, "");
    }
  }

  function submitToken(e) {
    e.preventDefault();
    const token = tokenDraft.trim();
    if (!token) return;
    setFamilyToken(token);
    setTokenDialog(false);
    load(profile, apiKey, true, token);
  }

  function isNsfw(appid) {
    const info = tagData?.apps?.[appid];
    if (!info) return false;
    if (info.d.some((d) => SEXUAL_DESCRIPTORS.has(d))) return true;
    return info.t.some((t) => NSFW_TAG_RE.test(tagData.tagNames?.[t] || ""));
  }

  // Family-mode only: member persona names with how many games each one owns
  const ownerOptions = useMemo(() => {
    if (!library?.familyName) return [];
    const counts = new Map();
    for (const g of library.games) {
      for (const o of g.owners || []) counts.set(o, (counts.get(o) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"));
  }, [library]);

  // Games owned by the selected family member (or the whole library)
  const ownerGames = useMemo(() => {
    if (!library) return [];
    if (!ownerFilter) return library.games;
    return library.games.filter((g) => (g.owners || []).includes(ownerFilter));
  }, [library, ownerFilter]);

  // Tag options adapt to the member filter: only tags present in their games
  const tagOptions = useMemo(() => {
    if (!tagData) return [];
    const counts = new Map();
    for (const g of ownerGames) {
      for (const t of tagData.apps[g.appid]?.t || []) counts.set(t, (counts.get(t) || 0) + 1);
    }
    return [...counts.entries()]
      .filter(([t]) => tagData.tagNames[t])
      .sort(
        (a, b) =>
          b[1] - a[1] || tagData.tagNames[a[0]].localeCompare(tagData.tagNames[b[0]], "en")
      );
  }, [ownerGames, tagData]);

  // If the selected tag doesn't exist in the new member's library, reset it
  useEffect(() => {
    if (tagFilter && !tagOptions.some(([t]) => String(t) === tagFilter)) setTagFilter("");
  }, [tagOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleGames = useMemo(() => {
    const tag = tagData && tagFilter ? Number(tagFilter) : null;
    const q = search.trim().toLowerCase();
    const games = ownerGames.filter((g) => {
      if (q && !g.name.toLowerCase().includes(q)) return false;
      if (tagData && hideNsfw && isNsfw(g.appid)) return false;
      if (tagData && hideFree && tagData.apps[g.appid]?.f) return false;
      if (tag !== null && !(tagData.apps[g.appid]?.t || []).includes(tag)) return false;
      return true;
    });
    // games arrive sorted by name, so ties stay alphabetical (Array.sort is stable)
    const info = (g) => tagData?.apps?.[g.appid];
    if (sortBy === "copies") {
      games.sort((a, b) => (b.owners?.length || 0) - (a.owners?.length || 0));
    } else if (sortBy === "price-desc") {
      games.sort((a, b) => (info(b)?.p || 0) - (info(a)?.p || 0));
    } else if (sortBy === "price-asc") {
      // unpriced (free/delisted) games sink to the end
      games.sort((a, b) => (info(a)?.p ?? 1e15) - (info(b)?.p ?? 1e15));
    } else if (sortBy === "playtime") {
      games.sort((a, b) => (b.playtime || 0) - (a.playtime || 0));
    } else if (sortBy === "release") {
      games.sort((a, b) => (info(b)?.r || 0) - (info(a)?.r || 0));
    }
    return games;
  }, [ownerGames, tagData, tagFilter, hideNsfw, hideFree, sortBy, search]);

  // Value of what's on screen (follows the member filter and every other filter)
  const visibleValue = useMemo(() => {
    if (!tagData) return 0;
    return visibleGames.reduce((sum, g) => sum + (tagData.apps[g.appid]?.p || 0), 0);
  }, [visibleGames, tagData]);

  // Per-member library value, for the chip tooltips
  const ownerValues = useMemo(() => {
    if (!tagData || !library?.familyName) return {};
    const values = {};
    for (const g of library.games) {
      const p = tagData.apps[g.appid]?.p || 0;
      for (const o of g.owners || []) values[o] = (values[o] || 0) + p;
    }
    return values;
  }, [library, tagData]);

  const pageSubtitle = useMemo(() => {
    if (!library) return "";
    const parts = [];
    if (library.familyName) parts.push(`${library.memberCount} members`);
    parts.push(`${library.count} games`);
    if (visibleGames.length !== library.count) parts.push(`${visibleGames.length} shown`);
    if (visibleValue > 0) parts.push(`≈ ${formatUsd(visibleValue)} value`);
    if (SORT_LABELS[sortBy]) parts.push(SORT_LABELS[sortBy]);
    return parts.join(" · ");
  }, [library, visibleGames, visibleValue, sortBy]);

  const exportSubtitle = useMemo(() => {
    if (!library) return "";
    const parts = [
      visibleGames.length === library.count
        ? `${visibleGames.length} games`
        : `${visibleGames.length} of ${library.count} games`,
    ];
    if (library.familyName) parts.push(`family: ${library.familyName}`);
    if (ownerFilter) parts.push(`owner: ${ownerFilter}`);
    if (tagFilter && tagData) parts.push(`tag: ${tagData.tagNames[tagFilter]}`);
    if (search.trim()) parts.push(`search: "${search.trim()}"`);
    if (tagData && hideNsfw) parts.push("NSFW hidden");
    if (tagData && hideFree) parts.push("free-to-play hidden");
    if (SORT_LABELS[sortBy]) parts.push(SORT_LABELS[sortBy]);
    if (visibleValue > 0) parts.push(`≈ ${formatUsd(visibleValue)} value`);
    parts.push(`SteamID ${library.steamid}`);
    parts.push(`generated ${new Date().toLocaleDateString("en")}`);
    return parts.join(" · ");
  }, [library, visibleGames, visibleValue, tagFilter, ownerFilter, tagData, hideNsfw, hideFree, sortBy, search]);

  const tokenHoursLeft = useMemo(() => {
    if (!library?.tokenExpiresAt) return null;
    const h = Math.round((library.tokenExpiresAt - Date.now()) / 3600000);
    return h > 0 ? h : null;
  }, [library]);

  async function renderCanvas() {
    const el = captureRef.current;
    setExportMsg("Loading images…");
    const imgs = [...el.querySelectorAll("img")];
    imgs.forEach((i) => (i.loading = "eager"));
    await Promise.all(
      imgs.map((i) =>
        i.complete
          ? Promise.resolve()
          : new Promise((r) => {
              i.addEventListener("load", r, { once: true });
              i.addEventListener("error", r, { once: true });
            })
      )
    );
    setExportMsg("Rendering… (large libraries can take a while)");
    await new Promise((r) => setTimeout(r, 100));
    return html2canvas(el, {
      backgroundColor: "#1b2838",
      scale: el.scrollHeight > 4000 ? 1 : 1.5,
      useCORS: true,
      logging: false,
      // The export header (title + filters + date) only exists in the capture:
      // injecting it into html2canvas's clone is race-free, unlike toggling
      // React state and hoping the DOM repaints before the snapshot.
      onclone: (doc) => {
        const target = doc.querySelector(".capture");
        if (!target) return;
        const hdr = doc.createElement("div");
        hdr.className = "export-header";
        const h = doc.createElement("h2");
        h.textContent = library.familyName
          ? `${library.familyName} — Steam Family library`
          : "My Steam library";
        const p = doc.createElement("p");
        p.textContent = exportSubtitle;
        hdr.append(h, p);
        target.prepend(hdr);
      },
    });
  }

  async function exportJpg() {
    try {
      const canvas = await renderCanvas();
      const a = document.createElement("a");
      a.download = "steam-library.jpg";
      a.href = canvas.toDataURL("image/jpeg", 0.9);
      a.click();
    } catch (err) {
      setStatus({ msg: "JPG export failed: " + err.message, error: true });
    } finally {
      setExportMsg(null);
    }
  }

  async function exportPdf() {
    try {
      const canvas = await renderCanvas();
      setExportMsg("Building PDF…");

      const pageW = 210; // A4 mm
      const pageH = 297;
      const margin = 8;
      const imgW = pageW - margin * 2;
      const pxPerMm = canvas.width / imgW;
      const pageContentPx = Math.floor((pageH - margin * 2) * pxPerMm);

      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      let y = 0;
      let first = true;

      while (y < canvas.height) {
        const sliceH = Math.min(pageContentPx, canvas.height - y);
        const slice = document.createElement("canvas");
        slice.width = canvas.width;
        slice.height = sliceH;
        const ctx = slice.getContext("2d");
        ctx.fillStyle = "#1b2838";
        ctx.fillRect(0, 0, slice.width, slice.height);
        ctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

        if (!first) pdf.addPage();
        pdf.addImage(slice.toDataURL("image/jpeg", 0.85), "JPEG", margin, margin, imgW, sliceH / pxPerMm);
        first = false;
        y += sliceH;
      }

      pdf.save("steam-library.pdf");
    } catch (err) {
      setStatus({ msg: "PDF export failed: " + err.message, error: true });
    } finally {
      setExportMsg(null);
    }
  }

  function onManualSubmit(e) {
    e.preventDefault();
    load(profile.trim(), apiKey.trim(), false, "");
  }

  const exportButtons = (
    <>
      <button className="btn primary" onClick={exportPdf} disabled={!!exportMsg}>
        <DownloadIcon color="#14232f" />
        Download PDF
      </button>
      <button className="btn outline" onClick={exportJpg} disabled={!!exportMsg}>
        <DownloadIcon color="#66c0f4" />
        Download JPG
      </button>
    </>
  );

  return (
    <>
      <header>
        <SteamIcon size={26} />
        <h1>SteamShelf</h1>
        <div className="header-right">
          {library && (
            <div className="user-chip">
              {library.player?.avatar ? (
                <img src={library.player.avatar} alt="" />
              ) : (
                <MemberAvatar name={library.player?.name || "?"} size={26} />
              )}
              <span>{library.player?.name || `SteamID ${library.steamid}`}</span>
              <button type="button" className="linklike" onClick={signOut}>
                Sign out
              </button>
            </div>
          )}
          <GitHubLink />
        </div>
      </header>

      {!library && !loading && (
        <div className="welcome">
          <div className="hero">
            <div className="hero-pill">Free · Open source · Runs on your machine</div>
            <h2>Show off your Steam library</h2>
            <p className="hero-sub">
              Load every game you own, hide the ones you'd rather not show, and export a clean
              list — perfect for joining a Steam Family.
            </p>
            <div className="hero-cta">
              <button
                type="button"
                className="steam-login"
                onClick={() => (window.location.href = "/auth/steam")}
              >
                <SteamIcon size={22} color="#14232f" />
                Sign in through Steam
              </button>
              <button type="button" className="linklike" onClick={() => setAdvancedOpen(true)}>
                or paste a SteamID / profile URL instead
              </button>
            </div>
          </div>

          <div className="steps">
            <div className="step">
              <div className="step-head">
                <span className="step-num">1</span>
                <span className="step-title">Sign in</span>
              </div>
              <p>One click with your Steam account. We only read your public game list — never your password.</p>
            </div>
            <div className="step">
              <div className="step-head">
                <span className="step-num">2</span>
                <span className="step-title">Filter</span>
              </div>
              <p>Hide 18+ games, pick a tag, or switch to your whole Steam Family's shared library.</p>
            </div>
            <div className="step">
              <div className="step-head">
                <span className="step-num">3</span>
                <span className="step-title">Export</span>
              </div>
              <p>Download a tidy PDF or JPG of exactly what's on screen, ready to share anywhere.</p>
            </div>
          </div>

          <div className="advanced">
            <button type="button" className="advanced-toggle" onClick={() => setAdvancedOpen(!advancedOpen)}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ transform: advancedOpen ? "rotate(90deg)" : "none" }}
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
              Advanced options — use your own API key or load a public profile manually
            </button>
            {advancedOpen && (
              <form className="advanced-form" onSubmit={onManualSubmit}>
                <input
                  type="password"
                  placeholder="API Key (optional if set in .env)"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <input
                  type="text"
                  placeholder="SteamID64, profile name or URL (e.g. https://steamcommunity.com/id/you)"
                  required
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                />
                <button type="submit" className="btn primary" disabled={loading}>
                  Load library
                </button>
                <p className="hint">
                  Get a free API key at{" "}
                  <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noopener noreferrer">
                    steamcommunity.com/dev/apikey
                  </a>
                  . The profile's "Game details" must be <b>public</b> for Steam to return the list.
                  Your inputs are saved in this browser.
                </p>
              </form>
            )}
          </div>

          <p className="trust-line">
            Not affiliated with Valve. Your API key and family token never leave this computer.
          </p>
        </div>
      )}

      {status && <div className={"status" + (status.error ? " error" : "")}>{status.msg}</div>}

      {library && (
        <div className="page">
          <div className="title-row">
            <div className="title-block">
              <div className="title-line">
                <h2>{library.familyName || "My Steam library"}</h2>
                {library.familyName && <span className="pill">Family library</span>}
              </div>
              <p className="page-sub">
                {pageSubtitle}
                {tagsLoading && <span className="tags-loading"> · loading tags…</span>}
              </p>
            </div>
            <div className="title-actions">
              {library.familyName && (
                <div className="token-pill">
                  <span className="dot" />
                  Family access active{tokenHoursLeft !== null && ` · renews in ${tokenHoursLeft} h`}
                  <button
                    type="button"
                    className="linklike"
                    onClick={() => {
                      setTokenDraft("");
                      setTokenDialog(true);
                    }}
                  >
                    Update
                  </button>
                </div>
              )}
              <div className="export-actions">{exportButtons}</div>
            </div>
          </div>

          <div className="controls">
            <div className="segmented">
              <button
                type="button"
                className={mode === "own" ? "active" : ""}
                onClick={() => switchMode("own")}
              >
                My library
              </button>
              <button
                type="button"
                className={mode === "family" ? "active" : ""}
                onClick={() => switchMode("family")}
              >
                Family library
              </button>
            </div>
            <span className="vdiv" />
            {ownerOptions.length > 0 && (
              <>
                <div className="member-chips">
                  <button
                    type="button"
                    className={"chip" + (ownerFilter === "" ? " active" : "")}
                    onClick={() => setOwnerFilter("")}
                  >
                    All members
                  </button>
                  {ownerOptions.map(([name, n]) => (
                    <button
                      type="button"
                      key={name}
                      className={"chip" + (ownerFilter === name ? " active" : "")}
                      onClick={() => setOwnerFilter(name)}
                      title={ownerValues[name] ? `≈ ${formatUsd(ownerValues[name])} library value` : undefined}
                    >
                      <MemberAvatar name={name} />
                      {library.player?.name === name ? "You" : name} <span className="count">({n})</span>
                    </button>
                  ))}
                </div>
                <span className="vdiv" />
              </>
            )}
            {tagData && (
              <>
                <select className="select" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
                  <option value="">Tag: All</option>
                  {tagOptions.map(([t, n]) => (
                    <option key={t} value={t}>
                      {tagData.tagNames[t]} ({n})
                    </option>
                  ))}
                </select>
                <select className="select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="name">Sort: A–Z</option>
                  {library.familyName && <option value="copies">Sort: Most copies</option>}
                  <option value="price-desc">Sort: Price high to low</option>
                  <option value="price-asc">Sort: Price low to high</option>
                  <option value="playtime">Sort: Most played</option>
                  <option value="release">Sort: Newest first</option>
                </select>
                <Toggle checked={hideNsfw} onChange={setHideNsfw} label="Hide NSFW (18+)" />
                <Toggle checked={hideFree} onChange={setHideFree} label="Hide free-to-play" />
              </>
            )}
            <div className="search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.8-3.8" />
              </svg>
              <input
                type="text"
                placeholder="Search games…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button type="button" className="clear" onClick={() => setSearch("")} aria-label="Clear search">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          <div className="capture" ref={captureRef}>
            <div className="grid">
              {visibleGames.map((g) => (
                <GameCard
                  key={g.appid}
                  game={g}
                  playerName={library.player?.name}
                  free={!!tagData?.apps?.[g.appid]?.f}
                  nsfw={tagData ? isNsfw(g.appid) : false}
                />
              ))}
            </div>
          </div>

          <div className="export-bar">{exportButtons}</div>
        </div>
      )}

      {tokenDialog && (
        <div className="overlay" onClick={() => setTokenDialog(false)}>
          <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={submitToken}>
            <h3>Connect your Steam Family</h3>
            <p>
              Family data needs an access token from your Steam session (the regular API key
              cannot read it):
            </p>
            <ol>
              <li>Make sure you're logged in to the Steam store in your browser.</li>
              <li>
                Open{" "}
                <a
                  href="https://store.steampowered.com/pointssummary/ajaxgetasyncconfig"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  this Steam page
                </a>
                .
              </li>
              <li>
                Copy the <code>webapi_token</code> value and paste it below.
              </li>
            </ol>
            <input
              type="password"
              placeholder="Paste your webapi_token here"
              autoComplete="off"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              required
            />
            <p className="hint">Tokens expire after ~24 hours and never leave this computer.</p>
            <div className="dialog-actions">
              <button type="button" className="btn outline" onClick={() => setTokenDialog(false)}>
                Cancel
              </button>
              <button type="submit" className="btn primary">
                Load family library
              </button>
            </div>
          </form>
        </div>
      )}

      {exportMsg && (
        <div className="overlay">
          <span className="overlay-msg">{exportMsg}</span>
        </div>
      )}
    </>
  );
}
