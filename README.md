# GejuBot MVP

Minimal Go application powered by KataGo analysis.

## Features

- 19x19 board in browser
- Place stones by click
- Basic rule engine (capture / suicide illegal / simple ko)
- Pass move support
- SGF export and import (single variation)
- Move browsing controls (start/end/prev/next/-5/+5)
- Move number display modes (all / last5 / current / last-marker)
- Undo and reset position
- Ask KataGo for top candidate moves
- Show principal variations (PV) sorted by winrate
- User-controlled `Top N` display size (default: remaining empty points on board)
- Board overlay mode: off / all-points heatmap
- List scope mode: Top N / All candidates
- Two-stage analyze flow: quick result first, then optional background refinement
- Show winrate / score lead / visits for top moves
- In-memory analysis cache (LRU-style) for repeated positions/parameters
- Note: requesting large `Top N` with full-candidate scan can still be slower

## Project Layout

- `app/server.py`: Python HTTP server + KataGo engine bridge
- `app/static/index.html`: UI shell
- `app/static/style.css`: styling
- `app/static/app.js`: board logic + API calls
- `.env.example`: required environment variables

## Requirements

- Python 3.9+
- KataGo binary (must match your OS; this repo currently bundles a Windows build)
- KataGo model file (`.bin.gz`)
- KataGo config file (from KataGo release package)

## Quick Start (PowerShell)

1. Set environment variables:

```powershell
$env:KATAGO_BINARY="C:\path\to\katago.exe"
$env:KATAGO_MODEL="C:\path\to\kata1-*.bin.gz"
$env:KATAGO_CONFIG="C:\path\to\analysis_example.cfg"
```

2. Run server:

```powershell
python app\server.py
```

3. Open:

`http://127.0.0.1:8080`

## GitHub Pages (Static Demo)

This repo includes a static site under `docs/` for GitHub Pages.

- Works on Pages: board interaction, rules, SGF import/export, move browsing.
- Not available on Pages by default: KataGo `Analyze` (needs external backend API).
- Fallback: repository root `index.html` redirects to `docs/`, so `main/(root)` Pages setup still lands on the site.

### Enable Analyze on Pages

Edit `docs/index.html` and set:

```html
<script>
  window.GEJUBOT_API_BASE = "https://your-backend.example.com";
</script>
```

Your backend must expose `POST /api/analyze` and allow CORS from your Pages domain.

## API

- `GET /api/health`
- `POST /api/analyze`
  - body:
    - `moves`: list of `[player, move]`, example: `[["B","D4"],["W","Q16"]]`
    - `maxVisits` (optional): integer, default 120
    - `topN` (optional): integer in `[1,400]`, default is UI `Top N` value
    - `pvLength` (optional): integer in `[1,30]`, default 10
    - `candidateMoves` (optional): legal candidate move list for expanded scan
    - `nextPlayer` (optional): `B` or `W`
    - `returnAllCandidates` (optional): boolean, when true returns full candidate list
    - `expandCandidates` (optional): boolean, when true enables chunked allowMoves expansion
  - response:
    - `topMoves`: sorted top N moves
    - `candidateCount`: total merged candidate count
    - `allCandidates` (optional): full sorted candidate list when `returnAllCandidates=true`

## Performance Tips

- Use lower `Max Visits` (for example `20`~`60`) while exploring.
- Keep `Board Overlay` as `Off` and `List Scope` as `Top N` for fast interaction.
- Turn on `All candidates` only when needed; the app now does quick-first + refine-later automatically.
