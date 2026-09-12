# How the README screenshot is captured

The screenshot is taken from the running app itself with html2canvas, using demo
family data (no real libraries). Procedure:

1. Temporarily add a save endpoint to `server.js` (and bump the JSON body limit
   to `25mb` while it exists — remove both afterwards):

   ```js
   app.post("/dev/screenshot", async (req, res) => {
     const m = (req.body?.dataUrl || "").match(/^data:image\/png;base64,(.+)$/);
     if (!m) return res.status(400).json({ error: "bad dataUrl" });
     await fs.writeFile(path.join(__dirname, "docs", "screenshot.png"), Buffer.from(m[1], "base64"));
     res.json({ ok: true });
   });
   ```

2. Open the app in a 1440px-wide viewport, mock `/api/family` (and `/api/games`)
   from the DevTools console with the demo family, and load it.

3. Capture with html2canvas from the console. **Native `<select>` elements and
   `<input>` placeholders render with clipped text in html2canvas** — the
   `onclone` hook below swaps selects for styled `<div>`s with the selected
   option's text (do the same for the `.search input`, using its value or
   placeholder), which fixes it:

   ```js
   const s = document.createElement("script");
   s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
   document.head.appendChild(s);
   await new Promise((r) => (s.onload = r));

   const origSelects = [...document.querySelectorAll("select")];
   const canvas = await html2canvas(document.body, {
     backgroundColor: "#1b2838",
     scale: 1,
     useCORS: true,
     onclone: (doc) => {
       [...doc.querySelectorAll("select")].forEach((c, i) => {
         const orig = origSelects[i];
         const d = doc.createElement("div");
         d.className = c.className;
         d.textContent = orig?.selectedOptions[0]?.textContent || "";
         d.style.display = "flex";
         d.style.alignItems = "center";
         d.style.width = (orig?.offsetWidth || 120) + "px";
         d.style.height = (orig?.offsetHeight || 36) + "px";
         c.replaceWith(d);
       });
     },
   });

   // Crop the empty space below the content
   const bottom = Math.ceil(document.querySelector(".page").getBoundingClientRect().bottom) + 8;
   const crop = document.createElement("canvas");
   crop.width = canvas.width;
   crop.height = Math.min(canvas.height, bottom);
   crop.getContext("2d").drawImage(canvas, 0, 0);
   await fetch("/dev/screenshot", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ dataUrl: crop.toDataURL("image/png") }),
   });
   ```

4. Remove the temp endpoint, restore the `1mb` JSON limit, and commit
   `docs/screenshot.png`.
