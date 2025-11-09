# How to Setup on Raspberry Pi 5 (Docker + HTTPS)

This guide runs the entire portal (frontend + backend) on a Raspberry Pi 5 using Docker and Caddy for HTTPS at your domain (e.g., `RobodoresShopPortal.com`).

## 1) Prepare the Pi 5 (64‑bit)

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker
sudo apt install -y docker-compose-plugin git
```

Verify ARM64 containers work:

```bash
docker run --rm arm64v8/alpine uname -m   # expect: aarch64
```

## 2) Clone and configure the app

```bash
git clone <YOUR_REPO_URL> robodores-portal
cd robodores-portal
cp backend/.env.example backend/.env
# edit backend/.env if needed (secrets, etc.)
```

Recommended persistence (keeps files/DB across restarts). Ensure these host paths exist:

- `backend/uploads/` (job uploads)
- `backend/robotics.db` (SQLite DB)

If your `docker-compose.yml` does not already bind them, add under the `backend` service:

```yaml
services:
  backend:
    volumes:
      - ./backend/uploads:/app/uploads
      - ./backend/robotics.db:/app/robotics.db
```

## 3) Add Caddy reverse proxy (automatic HTTPS)

Create `Caddyfile` at the repo root:

```caddyfile
RobodoresShopPortal.com {
  encode zstd gzip

  # Frontend (served by the frontend container's Vite dev server)
  @frontend {
    path /
    not path /api* /uploads*
  }
  handle @frontend {
    reverse_proxy frontend:5173
  }

  # Backend
  handle_path /api* {
    reverse_proxy backend:8000
  }
  handle_path /uploads* {
    reverse_proxy backend:8000
  }

  log {
    output stdout
  }
}
```

Add the Caddy service to `docker-compose.yml`:

```yaml
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
    depends_on:
      - frontend
      - backend
    networks:
      - default
```

## 4) DNS and router

- In your domain registrar/DNS, create an A record: `RobodoresShopPortal.com` → your public WAN IP.
- Port-forward on your router: 80/tcp and 443/tcp → the Pi’s LAN IP.
- Caddy will auto-issue and renew Let’s Encrypt certificates when the site becomes reachable.

If you cannot open ports, use Cloudflare Tunnel instead (optional). See the “Cloudflare Tunnel (no port‑forwarding)” section below.

## 5) Build and run

```bash
docker compose up --build -d
docker compose logs -f caddy
docker compose logs -f backend
docker compose logs -f frontend
```

Visit: `https://RobodoresShopPortal.com`

Notes:
- The proxy routes `/api` and `/uploads` to the backend; everything else to the frontend.
- The frontend is currently served by Vite’s dev server in Docker. You can switch to a static production build (below) for lower CPU/RAM.

## 6) Optional: serve a static production frontend

Build once in the `frontend` container or locally:

```bash
cd frontend
npm ci || npm install
npm run build   # outputs dist/
```

Update `Caddyfile` to serve static files (remove the `reverse_proxy frontend:5173` block):

```caddyfile
RobodoresShopPortal.com {
  encode zstd gzip
  handle_path /api* { reverse_proxy backend:8000 }
  handle_path /uploads* { reverse_proxy backend:8000 }

  root * /app/frontend/dist
  file_server

  log { output stdout }
}
```

Then mount the built assets into Caddy (and you may disable/remove the `frontend` service):

```yaml
services:
  caddy:
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./frontend/dist:/app/frontend/dist:ro
```

Restart:

```bash
docker compose up --build -d
```

## 7) Backups and maintenance

- Database backup:
  - `cp backend/robotics.db backups/robotics-$(date +%F).db`
- Uploads backup:
  - `rsync -av backend/uploads/ backups/uploads/`
- Update deployments:
  - `git pull`
  - `docker compose up --build -d`

## Cloudflare Tunnel (no port‑forwarding) — optional

If you can’t forward ports 80/443, use Cloudflare Tunnel; Cloudflare terminates TLS and routes traffic to your containers.

1) Create a tunnel on the Pi and authenticate it with your Cloudflare account.
2) Point your hostname (e.g., `RobodoresShopPortal.com`) at the tunnel.
3) Configure ingress rules to send `/api` and `/uploads` to `backend:8000` and everything else to `frontend:5173` (or the static build path if you’re serving via Caddy).

Cloudflare provides full docs and an official `cloudflared` Docker image if you prefer to run it in this compose stack.

---

That’s it! Your Pi 5 will host the entire server (backend + frontend). If you’d like this repo updated with a ready-made `Caddyfile` and compose service, you can copy the snippets above directly into your files and run a single `docker compose up --build -d`.

