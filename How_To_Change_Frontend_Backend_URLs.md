# How To Change Frontend/Backend URLs

This guide shows exactly where to update hostnames, ports, and API base URLs for local use, LAN access, or a reverse proxy. Each bullet links to the relevant file and line.

## Quick Scenarios
- Local only (same computer): use `http://localhost:5173` (frontend) and `http://localhost:8000` (backend).
- Devices on your LAN: use `http://<your-host-LAN-IP>:5173` and set the frontend API to `http://<your-host-LAN-IP>:8000`.
- Reverse proxy / single origin: serve the SPA at a domain (e.g., `https://portal.local`) and proxy `/api` to the backend; set the frontend API to `/api`.

---

## 1) Frontend ? Backend API base URL
- File: `frontend/src/api.ts:3`
  - What: Default and env-driven API base.
  - Change: Prefer an environment variable via Vite, or replace the default fallback.
  - Example values:
    - Localhost/dev: `http://localhost:8000`
    - LAN: `http://192.168.1.50:8000`
    - Reverse proxy (same origin): `/api`

- File: `docker-compose.yml:24`
  - What: The `VITE_API_URL` value injected at dev time to the Vite server.
  - Change: Set to the backend origin you want the browser to call.
  - Example: `VITE_API_URL: http://192.168.1.50:8000` or `VITE_API_URL: /api` when using a reverse proxy that forwards `/api` to FastAPI.

Notes
- The frontend reads `import.meta.env.VITE_API_URL` at build/dev time. If not set, it falls back to the hardcoded default in `frontend/src/api.ts:3`.
- After changing envs in Docker Compose, restart: `docker compose down && docker compose up --build -d`.

---

## 2) Frontend dev server URL (what you type in the browser)
- File: `docker-compose.yml:25-31`
  - What: Vite dev server runs on `0.0.0.0:5173`, published to the host with `ports: ["5173:5173"]`.
  - How to access:
    - On the same machine: `http://localhost:5173`
    - From another device on your LAN: `http://<host-LAN-IP>:5173`
  - Optional: change the external port by editing the left side of the mapping, e.g., `"8080:5173"` ? then browse `http://<host-LAN-IP>:8080`.

- File: `frontend/vite.config.ts:6-8`
  - What: Vite server port default (`5173`). You can change it here if not using Docker or if you want a new internal port.
  - If you change this, also update the Compose port mapping accordingly.

Firewall reminder
- On Windows/macOS/Linux, allow inbound traffic for the chosen port if you want phones/tablets to reach it on your LAN.

---

## 3) Backend base URL and CORS
- File: `backend/app/main.py:13-19`
  - What: CORS configuration pulls allowed origins from settings. Currently permissive (`["*"]`).
  - If you want to restrict to a single origin (recommended for production), change `allowed_hosts` below.

- File: `backend/app/core/config.py:14`
  - What: `allowed_hosts` default. You can override via env file `backend/.env` with a JSON array, e.g. `ALLOWED_HOSTS=["https://portal.local", "http://192.168.1.50:5173"]`.

- Backend listen address and port are set in Docker Compose:
  - File: `docker-compose.yml:8` (command) and `docker-compose.yml:16-17` (ports)
  - Change the right-hand side of `"8000:8000"` only if you change the FastAPI internal port; change the left-hand side to expose a different external port.

---

## 4) Reverse proxy (optional, recommended)
When serving everything at a single origin, point the frontend to `/api` and configure your proxy to send `/api` to FastAPI.

- Example Caddy setup is in the Pi guide:
  - File: `How_To_Setup_On_Pi5.md:48-72` (dev server proxy)
  - File: `How_To_Setup_On_Pi5.md:129-139` (static build served by Caddy)

Frontend change for single origin
- File: `docker-compose.yml:24`
  - Set: `VITE_API_URL: /api`
- File: `frontend/src/api.ts:3`
  - Optional: change fallback default to `/api` so builds without envs still work behind the proxy.

---

## 5) Common pitfalls and quick checks
- “Works on desktop but not on phone”:
  - Likely `VITE_API_URL` points to `http://localhost:8000`, which on a phone means the phone itself. Use your host LAN IP instead.
- Confirm ports published:
  - `docker compose ps` should show `0.0.0.0:5173->5173/tcp` and `0.0.0.0:8000->8000/tcp`.
- Test from another device:
  - `curl http://<host-LAN-IP>:5173` (frontend) and `curl http://<host-LAN-IP>:8000/docs` (backend Swagger).
- Firewall:
  - Allow inbound on chosen ports (Windows Defender, macOS pf/ALF, Linux ufw/firewalld).

---

## TL;DR edits
- Change frontend API target:
  - `docker-compose.yml:24` ? set `VITE_API_URL` to `http://<host-LAN-IP>:8000` or `/api` (proxy).
  - `frontend/src/api.ts:3` ? optional fallback tweak.
- Change frontend dev port:
  - `frontend/vite.config.ts:6-8` and `docker-compose.yml:29-30`.
- Change backend port:
  - `docker-compose.yml:8` and `docker-compose.yml:16-17`.
- Lock down CORS for production:
  - `backend/app/core/config.py:14` and env `ALLOWED_HOSTS`.
