import { useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

// Steam content descriptors: 3 = adult-only sexual content, 4 = frequent nudity.
// Descriptor 1 (some nudity) is deliberately excluded: it would flag AAA games like Cyberpunk.
const SEXUAL_DESCRIPTORS = new Set([3, 4]);
const NSFW_TAG_RE = /hentai|nsfw|sexual content|nudity|porn|eroge/i;

const STEAM_ICON = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="#66c0f4">
    <path d="M12 2C6.7 2 2.4 6.1 2 11.3l5.4 2.2c.5-.3 1-.5 1.6-.5l2.4-3.5v-.1c0-2.1 1.7-3.8 3.8-3.8s3.8 1.7 3.8 3.8-1.7 3.8-3.8 3.8h-.1l-3.4 2.5v.4c0 1.6-1.3 2.9-2.9 2.9-1.4 0-2.6-1-2.8-2.4l-3.9-1.6C3.2 19.4 7.2 22.5 12 22.5c5.8 0 10.5-4.7 10.5-10.5S17.8 2 12 2z" />
  </svg>
);

function GameCard({ game }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="card">
      {failed ? (
        <div className="noimg">No image</div>
      ) : (
        <img src={`/img/${game.appid}?v=2`} alt="" loading="lazy" onError={() => setFailed(true)} />
      )}
      <div className="name">{game.name}</div>
      {game.owners && !game.own && <div className="owner">Owned by {game.owners.join(", ")}</div>}
    </div>
  );
}

export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [profile, setProfile] = useState("");
  const [familyEnabled, setFamilyEnabled] = useState(false);
  const [familyToken, setFamilyToken] = useState("");
  const [status, setStatus] = useState(null); // { msg, error }
  const [loading, setLoading] = useState(false);
  const [library, setLibrary] = useState(null); // { steamid, games, familyName? }
  const [tagData, setTagData] = useState(null); // { apps, tagNames }
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagFilter, setTagFilter] = useState("");
  const [hideNsfw, setHideNsfw] = useState(true);
  const [exportMsg, setExportMsg] = useState(null);
  const captureRef = useRef(null);

  async function load(profileValue, keyValue, useFamily, tokenValue) {
    setLoading(true);
    setStatus({ msg: "Querying the Steam API…" });
    setLibrary(null);
    setTagData(null);
    setTagFilter("");
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
      if (!res.ok) throw new Error(data.error || "Unknown error");
      setLibrary(data);
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

  // Steam login return: /?steamid=... → load automatically
  useEffect(() => {
    const url = new URL(window.location.href);
    const sid = url.searchParams.get("steamid");
    if (sid) {
      setProfile(sid);
      history.replaceState(null, "", "/");
      load(sid, "", false, "");
    } else if (url.searchParams.get("loginerror")) {
      history.replaceState(null, "", "/");
      setStatus({ msg: "Steam sign-in failed. Try again or enter your profile manually.", error: true });
    }
  }, []);

  function isNsfw(appid) {
    const info = tagData?.apps?.[appid];
    if (!info) return false;
    if (info.d.some((d) => SEXUAL_DESCRIPTORS.has(d))) return true;
    return info.t.some((t) => NSFW_TAG_RE.test(tagData.tagNames?.[t] || ""));
  }

  const tagOptions = useMemo(() => {
    if (!library || !tagData) return [];
    const counts = new Map();
    for (const g of library.games) {
      for (const t of tagData.apps[g.appid]?.t || []) counts.set(t, (counts.get(t) || 0) + 1);
    }
    return [...counts.entries()]
      .filter(([t]) => tagData.tagNames[t])
      .sort(
        (a, b) =>
          b[1] - a[1] || tagData.tagNames[a[0]].localeCompare(tagData.tagNames[b[0]], "en")
      );
  }, [library, tagData]);

  const visibleGames = useMemo(() => {
    if (!library) return [];
    if (!tagData) return library.games;
    const tag = tagFilter ? Number(tagFilter) : null;
    return library.games.filter((g) => {
      if (hideNsfw && isNsfw(g.appid)) return false;
      if (tag !== null && !(tagData.apps[g.appid]?.t || []).includes(tag)) return false;
      return true;
    });
  }, [library, tagData, tagFilter, hideNsfw]);

  const subtitle = useMemo(() => {
    if (!library) return "";
    const parts = [
      visibleGames.length === library.count
        ? `${visibleGames.length} games`
        : `${visibleGames.length} of ${library.count} games`,
    ];
    if (library.familyName) parts.push(`family: ${library.familyName}`);
    if (tagFilter && tagData) parts.push(`tag: ${tagData.tagNames[tagFilter]}`);
    if (tagData && hideNsfw) parts.push("NSFW hidden");
    parts.push(`SteamID ${library.steamid}`);
    parts.push(`generated ${new Date().toLocaleDateString("en")}`);
    return parts.join(" · ");
  }, [library, visibleGames, tagFilter, tagData, hideNsfw]);

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

  function onSubmit(e) {
    e.preventDefault();
    load(profile.trim(), apiKey.trim(), familyEnabled, familyToken.trim());
  }

  return (
    <>
      <header>
        {STEAM_ICON}
        <h1>Steam Library Export</h1>
      </header>

      <div className="panel">
        <button
          type="button"
          className="steam-login"
          onClick={() => (window.location.href = "/auth/steam")}
        >
          {STEAM_ICON}
          Sign in through Steam
        </button>
        <div className="divider">or enter your profile manually</div>
        <form className="load-form" onSubmit={onSubmit}>
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
          <button type="submit" disabled={loading}>
            Load library
          </button>

          <div className="family-box">
            <label className="toggle">
              <input
                type="checkbox"
                checked={familyEnabled}
                onChange={(e) => setFamilyEnabled(e.target.checked)}
              />
              Include the whole Steam Family library
            </label>
            {familyEnabled && (
              <>
                <input
                  type="password"
                  placeholder="Steam access token (required for family data)"
                  autoComplete="off"
                  value={familyToken}
                  onChange={(e) => setFamilyToken(e.target.value)}
                  required
                />
                <p className="hint">
                  Family data needs an access token from your Steam session (the regular API key
                  cannot read it). While logged in to the Steam store, open{" "}
                  <a
                    href="https://store.steampowered.com/pointssummary/ajaxgetasyncconfig"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    this Steam page
                  </a>{" "}
                  and copy the <code>webapi_token</code> value here. Tokens expire after ~24h and
                  stay on your machine.
                </p>
              </>
            )}
          </div>
        </form>
        <p className="hint">
          Get a free API key at{" "}
          <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noopener noreferrer">
            steamcommunity.com/dev/apikey
          </a>
          . Your profile and its "Game details" must be <b>public</b> for Steam to return the list.
        </p>
      </div>

      {status && <div className={"status" + (status.error ? " error" : "")}>{status.msg}</div>}

      {library && (
        <>
          <div className="toolbar">
            <span className="count">
              <b>{visibleGames.length}</b> games
            </span>
            {tagsLoading && <span className="tags-loading">Loading tags…</span>}
            {tagData && (
              <>
                <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
                  <option value="">All tags</option>
                  {tagOptions.map(([t, n]) => (
                    <option key={t} value={t}>
                      {tagData.tagNames[t]} ({n})
                    </option>
                  ))}
                </select>
                <label className="nsfw">
                  <input
                    type="checkbox"
                    checked={hideNsfw}
                    onChange={(e) => setHideNsfw(e.target.checked)}
                  />
                  Hide NSFW (18+)
                </label>
              </>
            )}
            <button onClick={exportPdf} disabled={!!exportMsg}>
              Download PDF
            </button>
            <button onClick={exportJpg} disabled={!!exportMsg}>
              Download JPG
            </button>
          </div>

          <div className="capture" ref={captureRef}>
            <h2>{library.familyName ? `${library.familyName} — Steam Family library` : "My Steam library"}</h2>
            <p className="subtitle">{subtitle}</p>
            <div className="grid">
              {visibleGames.map((g) => (
                <GameCard key={g.appid} game={g} />
              ))}
            </div>
          </div>
        </>
      )}

      {exportMsg && (
        <div className="overlay">
          <span>{exportMsg}</span>
        </div>
      )}
    </>
  );
}
