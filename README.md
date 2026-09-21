# RREL MIS Essential

Production MIS dashboard: Python 3 stdlib server + SQLite + `index.html`. No extra packages.

Do not commit `data/`. That folder holds accounts, sessions, and plant entries.

## What to fetch on the server

```bash
git clone git@github.com:<YOUR_ORG>/rrel-mis-essential.git
cd rrel-mis-essential
python3 server.py
```

Open http://127.0.0.1:8765  
First visit: create the master account (`/api/auth/setup`). After that, setup stays closed.

Update later:

```bash
cd rrel-mis-essential
git pull
# restart the service (systemd example below)
```

`git pull` does not overwrite the database if you keep `data/` local (it is gitignored) or set `MIS_DATA_DIR` outside the repo.

## Environment

| Variable | Default | Production |
|---|---|---|
| `MIS_TIMEZONE` | `Asia/Kolkata` | Plant timezone |
| `MIS_PUBLIC_ORIGIN` | empty (uses request Host) | `https://mis.example.com` |
| `MIS_SECURE_COOKIES` | `0` | `1` when serving HTTPS |
| `MIS_DATA_DIR` | `./data` | `/var/lib/rrel-mis` |

Run:

```bash
python3 server.py --host 127.0.0.1 --port 8765
```

Health check: `GET /api/health`

## Production (one machine)

1. Clone this repo to e.g. `/opt/rrel-mis`.
2. Put SQLite on local disk, not a network share:

   ```bash
   sudo mkdir -p /var/lib/rrel-mis
   sudo chown "$USER:$USER" /var/lib/rrel-mis
   ```

3. Bind Python to localhost. Put nginx or Caddy on 443 and proxy to `127.0.0.1:8765`.
4. systemd unit (`/etc/systemd/system/rrel-mis.service`):

```ini
[Unit]
Description=RREL MIS
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/rrel-mis
Environment=MIS_TIMEZONE=Asia/Kolkata
Environment=MIS_PUBLIC_ORIGIN=https://mis.example.com
Environment=MIS_SECURE_COOKIES=1
Environment=MIS_DATA_DIR=/var/lib/rrel-mis
ExecStart=/usr/bin/python3 /opt/rrel-mis/server.py --host 127.0.0.1 --port 8765
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rrel-mis
```

5. Firewall: 443 (and SSH/VPN). Do not open 8765 publicly.
6. Backup: signed-in master can download `GET /api/backup`, or copy that file on a schedule. Do not copy `mis.db` + `-wal` by hand while the process is running.

## Files

- `server.py` — HTTP API, sessions, SQLite
- `index.html` — dashboard
- `data/mis.db` — created at first run (local only)
