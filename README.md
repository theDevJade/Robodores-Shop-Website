# Robotics Shop Portal

Full-stack web portal for attendance scanning, CNC/3DP job intake, inventory tracking, and purchasing requests. Backend is FastAPI + SQLModel; frontend is a Vite/React SPA. Designed to run on a Raspberry Pi 5 that serves the UI to anyone on the robotics Wi-Fi.

## Features
- Role-based access (student/lead/admin) with JWT auth.
- USB barcode attendance kiosk with schedule enforcement and warnings.
- CNC & 3D-print job submissions with file uploads and status tracking.
- Google Sheets integration for order requests.
- Inventory catalog with quantity adjustments + change history.

## Local testing (Docker Compose)
There's a dev stack that runs both services so you can poke it in your browser without installing Python/Node globally.

Prereqs: Docker Desktop (or Docker Engine) with Compose v2.

```
# from repo root
cp backend/.env.example backend/.env   # optionally tweak SECRET_KEY, uploads path, etc.
docker compose up --build
```

- Backend hot-reloads at `http://localhost:8000` (mounted source + `uvicorn --reload`).
- Frontend dev server runs at `http://localhost:5173` and proxies API calls straight to the backend.
- Uploaded files land in the named volume `backend_uploads`; remove it via `docker volume rm webapp_for_robotics_backend_uploads` if you need a clean slate.
- Stop with `Ctrl+C` (or `docker compose down`), restart with `docker compose up`.

Log output from both services stays in your terminal so you can watch requests roll in while testing.

## Backend
```
cd backend
python -m venv .venv
. .venv/Scripts/activate  # or source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # fill values (SECRET_KEY, GOOGLE_* IDs, etc.)
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Important env vars:
- `SECRET_KEY`: random string for JWT signing.
- `DATABASE_URL`: default SQLite path; use PostgreSQL in production if desired.
- `UPLOAD_ROOT`: absolute path for `.tap/.step/.stl` uploads.
- `GOOGLE_SERVICE_ACCOUNT_FILE` / `GOOGLE_SHEET_ID`: enable Sheets logging when set.

Default API surface:
- `/auth/*` login/register/me/user management (first registered user becomes admin).
- `/attendance/scan` accepts `{barcode_id, timestamp}`; `/attendance/logs` for leads+admins.
- `/jobs`, `/inventory`, `/orders`, `/schedules` as described in the requirements.

## Frontend
```
cd frontend
npm install
npm run dev -- --host
# or build static assets for FastAPI
npm run build
```
Set `VITE_API_URL` to the FastAPI base (e.g., `http://pi-shop.local/api`). Copy `frontend/dist` next to the backend so FastAPI can serve it, or point nginx at it.

## Raspberry Pi deployment
1. Create a `robotics` user, clone/copy this repo to `/opt/robotics-portal`.
2. Install system deps: `sudo apt install python3.11-venv nginx`. Optionally install Redis for background tasks.
3. Configure systemd service `/etc/systemd/system/robotics-backend.service`:
```
[Unit]
Description=Robotics Portal Backend
After=network.target

[Service]
User=robotics
WorkingDirectory=/opt/robotics-portal/backend
EnvironmentFile=/opt/robotics-portal/backend/.env
ExecStart=/opt/robotics-portal/backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```
4. `sudo systemctl enable --now robotics-backend`.
5. nginx site (serving `frontend/dist` and proxying `/api` to `127.0.0.1:8000`):
```
server {
    listen 443 ssl;
    server_name pi-shop.local;
    ssl_certificate /etc/ssl/pi-shop.crt;
    ssl_certificate_key /etc/ssl/pi-shop.key;

    root /opt/robotics-portal/frontend/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_http_version 1.1;
    }

    location / {
        try_files $uri /index.html;
    }

    allow 192.168.4.0/24;
    deny all;
}
```
6. Use `ufw` to restrict to your Wi-Fi: `sudo ufw allow from 192.168.4.0/24 to any port 443 proto tcp` and deny others.
7. Plug USB barcode scanner into the kiosk computer; open the SPA, log in with a kiosk account (student role) so scans auto-submit.

## Next steps
- Add background worker to convert `.step` to `.tap` (integrate FreeCAD/pycam) and attach results to jobs.
- Build nightly cron report for missing check-outs by querying attendance entries without `check_out`.
- Harden uploads (size limit, file type validation) and add auditing dashboards for inventory transactions.
