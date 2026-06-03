# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project shape

云微 / WechatOnCloud runs the official Linux WeChat client headlessly in a container so multiple browser users share a single WeChat session. Two Docker images:

- **panel** (`panel/`) — Node/Fastify backend + React/Vite frontend. The only image exposed to the outside world. Mounts `/var/run/docker.sock` to spawn/stop/exec WeChat instance containers, and reverse-proxies WebSockets to their KasmVNC servers.
- **wechat-on-cloud** (`docker/`) — KasmVNC + Xvfb + openbox + Chinese fonts + WeChat's missing libs. The WeChat binary is **not** baked in; it's downloaded at runtime into the data volume by `wechat-ctl.sh` when the panel triggers install.

A user-facing run is a panel container plus N dynamically created `woc-wx-<id>` instance containers on the panel's docker network. The panel doesn't expose instance ports — it path-proxies `/desktop/:id/*` to `http://woc-wx-<id>:3000` and injects per-instance Basic auth on every proxy request.

For the full design see `doc/技术方案.md` and `doc/运行原理.md`. README.md is the user-facing tour.

## Commands

Build & run the full stack:
```bash
./scripts/build-local.sh                # build both images locally (used when GHCR has no published tag)
WOC_VERSION=v1.0.0 ./scripts/build-local.sh   # tag must match .env's WOC_VERSION
docker compose up -d                    # compose pull_policy=missing → local builds win over GHCR
docker compose pull && docker compose up -d   # force pull latest from GHCR
```

Panel backend (Fastify + dockerode, runs TypeScript directly via `tsx`, no build step):
```bash
cd panel/server
npm install
npm run dev      # tsx watch src/index.ts
npm run start    # tsx src/index.ts  (what the Docker image runs)
```

Panel frontend (Vite + React, PWA via vite-plugin-pwa):
```bash
cd panel/web
npm install
npm run dev      # vite dev server, proxies /api + /desktop (ws) to BACKEND (default http://localhost:8080)
BACKEND=http://nas.local:36080 npm run dev   # point dev frontend at a remote panel
npm run build    # gen-icons + vite build → dist/  (copied into panel image at build time)
```

There are no tests or linters configured in either package. There is no top-level package.json.

CI publishes both images to GHCR as `linux/amd64,linux/arm64` on tag push `v*.*.*` (`.github/workflows/release.yml`).

## Architecture notes that aren't obvious from the file tree

**Panel-as-orchestrator.** `panel/server/src/docker.ts` is the entire Docker driver — it talks to the host's docker.sock via dockerode to create/inspect/remove instance containers, exec the wechat-ctl script, putArchive/getArchive for file transfer, and stream container logs (it demuxes the 8-byte-header multiplexed stream itself; see `instanceLogs`). The `ensureNetwork` step probes the panel's own network from inside its container so newly spawned instances join the same bridge and are reachable by container name.

**KasmVNC credentials never reach the browser.** Each instance gets random hex `kasmUser`/`kasmPassword` stored in `accounts.json`. The panel injects them as Basic auth on `proxyReq` / `proxyReqWs` and strips `WWW-Authenticate` from upstream 401s so the browser never sees a native auth prompt. Hex (not base64url) is deliberate — the kasmvnc base image runs `openssl passwd -apr1 ${PASSWORD}` unquoted and a leading `-` would be parsed as a flag.

**Two-axis access control.** Users are `admin` (implicit access to all instances) or `sub` (`allowedInstances: string[]`). Both ends of the mapping have admin endpoints (`POST /api/admin/users/:id/instances` and `POST /api/admin/instances/:id/users`) and they edit the same underlying field — `panel/server/src/store.ts` is the single source of truth and persists atomically via `${FILE}.tmp` + rename to `/data/accounts.json`.

**Offline admin password recovery.** Stop the panel, edit `data-panel/accounts.json`, set `"resetPassword": true` on the user, restart. `initStore` resets that user's password to `$PANEL_ADMIN_PASSWORD` (or `wechat`) and clears the flag. Both `resetPassword` and `reset_password` keys are recognized.

**Multi-end soft lock (control heartbeat).** Same instance + multiple browsers = key/mouse fights. `/api/instances/:id/control/beat` is a 10-second TTL lock the active client renews; others poll `/control` and either show a read-only overlay or call `/control/take` to seize it. State is in-memory (`controlHolders` Map), not persisted.

**WeChat install lifecycle.** `docker/wechat-ctl.sh install|update|status` runs inside the instance container. The panel fires it detached via `docker exec` and polls `status` (JSON written atomically to `/config/.woc-state/status.json`). `autostart` is an openbox-launched daemon that waits for `/config/wechat/opt/wechat/wechat` to appear, then keep-restarts it; a parallel watcher re-activates any window that gets minimized (the bare openbox session has no taskbar, so minimize == lost). `woc-update-autostart` in `/custom-cont-init.d/` overwrites the per-volume autostart copy on every container start so image upgrades actually take effect for old instances.

**IME / Chinese input.** Two layers fix CJK input over noVNC:
1. Build-time patch (`docker/woc-www-patch.sh` + `woc-ime.pl`) rewrites the KasmVNC web client's `dist/*.bundle.js` to (a) default `enable_ime: true` and (b) stop the buggy differential-keysym path during composition. The script asserts both markers landed; if upstream changes the bundle structure the build fails loudly rather than silently shipping broken IME.
2. The panel exposes `POST /api/instances/:id/type` which `docker exec`s `xclip` + `xdotool ctrl+v` inside the container. Used as a fallback paste path that bypasses VNC keysym limits entirely.

**File transfer.** `/api/instances/:id/upload|download|files` reads/writes `/config/Desktop` inside the instance. Upload uses a hand-rolled single-file tar (`tarSingleFile` in `docker.ts`) so dockerode's `putArchive` works without a tar dependency. `safeName` rejects path traversal; filenames are passed via argv to avoid shell injection.

**Camera passthrough.** `WOC_VIDEO_DEVICES` overrides; otherwise the panel scans `/host-dev` (mounted ro from the host's `/dev` in compose) for `videoN` and maps each as a device into new instances, adding the `video` group. Requires `v4l2loopback` loaded on the host.

**SPA + WebSocket routing.** The Fastify server registers `@fastify/static` for the built frontend with a `notFoundHandler` that returns `index.html` for non-`/api`/`/desktop` paths (React Router fallback). The `upgrade` event re-parses cookies and runs the same auth/access check before letting `http-proxy` forward the WebSocket — Fastify's regular auth middleware doesn't run on raw upgrades.

## Conventions

- Source files use Chinese comments (especially in `panel/server/src/`); these encode design rationale for non-obvious choices — preserve them on edits.
- `panel/server` runs TypeScript directly via `tsx` in both dev and prod; there is no compile step. Imports use `.js` extensions because `tsconfig.json` uses `moduleResolution: "Bundler"` + ESM.
- The `panel/web` build runs `npm run icons` first (`scripts/gen-icons.mjs`) to regenerate PWA icons from source — don't commit hand-edited icons.
- Persistent data goes to two host bind mounts: `./data-panel` (accounts.json) and Docker named volumes `woc-data-<id>` (instance config + WeChat install + chat history). `.gitignore` excludes both `/data/` and `/data-panel/`.

## Trellis

This project is Trellis-managed — see `AGENTS.md` and `.trellis/workflow.md` for the development phases (Plan → Execute → Finish) and `.trellis/spec/{backend,frontend}/index.md` for layer-scoped coding guidelines that should be consulted before writing code in either layer. Active tasks live in `.trellis/tasks/`. Prefer Trellis slash commands (`/trellis:continue`, `/trellis:finish-work`) when available.
