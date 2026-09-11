# Steam Library Export

Local tool that shows every game in your Steam library (with cover images) and exports the full list as a **PDF** or **JPG**. Built for sharing your library when offering to join a Steam Family — it does not download games, it only generates the list.

## Features

- Sign in through Steam (OpenID) or enter a SteamID64 / profile name / profile URL manually
- Filter by tag and hide NSFW (18+) games (detected via Steam's content descriptors and tags)
- Optional: show the whole **Steam Family** shared library, with owner badges per game
- Export exactly what you see (filters apply) to a multi-page A4 PDF or a single JPG

## Stack

React + Vite frontend, Express backend. The backend proxies the Steam Web API (so your key never leaves the server), resolves vanity URLs, caches store metadata (tags, content descriptors, image asset hashes) on disk, and proxies game images so canvas export works without CORS issues.

## Requirements

- Node.js 18+
- A Steam API key (free): https://steamcommunity.com/dev/apikey
- Your Steam profile and its "Game details" set to **public** (Profile → Edit Profile → Privacy Settings)

## Setup

```bash
npm install
```

Copy `.env.example` to `.env` and paste your API key (optional — you can also enter it on the page):

```
STEAM_API_KEY=YOUR_KEY_HERE
```

## Usage

```bash
npm run serve
```

This builds the frontend and starts the server at http://localhost:3000. Sign in through Steam (or enter your profile) and press **Load library**, then use **Download PDF** / **Download JPG**.

For frontend development with hot reload, run the API and Vite separately:

```bash
npm start
```

```bash
npm run dev
```

and open the Vite URL (it proxies `/api`, `/img` and `/auth` to the Express server).

## Steam Family library

The family endpoints (`IFamilyGroupsService`) do not accept a regular API key — they need an access token from your logged-in Steam session. Tick "Include the whole Steam Family library", then, while logged in to the Steam store in your browser, open
https://store.steampowered.com/pointssummary/ajaxgetasyncconfig and copy the `webapi_token` value into the token field. Tokens expire after ~24 hours; the token is only sent from your browser to your local server and from there to the official Steam API.
