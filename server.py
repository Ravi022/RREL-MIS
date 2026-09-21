#!/usr/bin/env python3
"""Production-style local server for the RREL production MIS dashboard."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import tempfile
import time
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("MIS_DATA_DIR", str(ROOT / "data"))).expanduser().resolve()
DB_PATH = DATA_DIR / "mis.db"
MAX_BODY_BYTES = 2 * 1024 * 1024
SESSION_SECONDS = 12 * 60 * 60
PBKDF2_ITERATIONS = 210_000
MIS_TIMEZONE = os.environ.get("MIS_TIMEZONE", "Asia/Kolkata")
PUBLIC_ORIGIN = os.environ.get("MIS_PUBLIC_ORIGIN", "").rstrip("/")
SECURE_COOKIES = os.environ.get("MIS_SECURE_COOKIES", "0") == "1"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
USERNAME_RE = re.compile(r"^[a-zA-Z0-9._-]{3,24}$")


def utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def active_shift_context(now: datetime | None = None) -> dict:
    zone = ZoneInfo(MIS_TIMEZONE)
    local = now.astimezone(zone) if now else datetime.now(zone)
    hour = local.hour
    if 6 <= hour < 14:
        shift, start, end = "A", "06:00", "14:00"
        operational_date = local.date()
    elif 14 <= hour < 22:
        shift, start, end = "B", "14:00", "22:00"
        operational_date = local.date()
    else:
        shift, start, end = "C", "22:00", "06:00"
        operational_date = local.date() - timedelta(days=1) if hour < 6 else local.date()
    return {
        "date": operational_date.isoformat(),
        "shift": shift,
        "hours": f"{start} – {end}",
        "timezone": MIS_TIMEZONE,
        "serverTime": local.isoformat(),
    }


class ClosingConnection(sqlite3.Connection):
    """Commit/rollback like sqlite3.Connection, then release the Windows file handle."""

    def __exit__(self, exc_type, exc_value, traceback):
        result = super().__exit__(exc_type, exc_value, traceback)
        self.close()
        return result


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=10, factory=ClosingConnection)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


def initialize_database() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with connect() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS entries (
                entry_date TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS accounts (
                username TEXT PRIMARY KEY COLLATE NOCASE,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                actor_username TEXT,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS login_attempts (
                username TEXT PRIMARY KEY COLLATE NOCASE,
                failures INTEGER NOT NULL,
                locked_until INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                occurred_at TEXT NOT NULL,
                actor TEXT,
                action TEXT NOT NULL,
                entity TEXT NOT NULL,
                entity_id TEXT,
                detail TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_audit_occurred_at ON audit_log(occurred_at DESC);
            CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
            """
        )


def password_credential(password: str) -> dict:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return {"passwordHash": digest.hex(), "salt": salt.hex(), "iterations": PBKDF2_ITERATIONS}


def valid_password(password: str) -> bool:
    return len(password) >= 8 and any(c.isalpha() for c in password) and any(c.isdigit() for c in password)


def verify_password(password: str, account: dict) -> bool:
    try:
        iterations = int(account.get("iterations", 0))
        salt = bytes.fromhex(account["salt"])
        expected = account["passwordHash"]
        if iterations <= 0 or len(salt) < 8:
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations).hex()
        return hmac.compare_digest(actual, expected)
    except (KeyError, TypeError, ValueError):
        return False


def public_account(account: dict) -> dict:
    return {k: v for k, v in account.items() if k not in {"passwordHash", "salt", "iterations"}}


def load_account(connection: sqlite3.Connection, username: str) -> dict | None:
    row = connection.execute("SELECT payload FROM accounts WHERE username = ?", (username.lower(),)).fetchone()
    return json.loads(row["payload"]) if row else None


def store_account(connection: sqlite3.Connection, username: str, account: dict) -> None:
    username = username.lower()
    account["username"] = username
    connection.execute(
        """INSERT INTO accounts(username,payload,updated_at) VALUES (?,?,?)
           ON CONFLICT(username) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at""",
        (username, json.dumps(account, ensure_ascii=False), utc_iso()),
    )


def audit(connection, actor, action, entity, entity_id=None, detail=None) -> None:
    connection.execute(
        "INSERT INTO audit_log(occurred_at,actor,action,entity,entity_id,detail) VALUES (?,?,?,?,?,?)",
        (utc_iso(), actor, action, entity, entity_id, json.dumps(detail or {}, ensure_ascii=False)),
    )


class MISRequestHandler(SimpleHTTPRequestHandler):
    server_version = "RREL-MIS/2.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'")
        super().end_headers()

    def send_json(self, value, status=HTTPStatus.OK, cookie=None) -> None:
        body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status, message) -> None:
        self.send_json({"error": message}, status)

    def send_no_content(self, cookie=None) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def read_json_object(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Invalid Content-Length") from exc
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ValueError("Request body must be between 1 byte and 2 MB")
        try:
            value = json.loads(self.rfile.read(length).decode())
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("Request body must be valid JSON") from exc
        if not isinstance(value, dict):
            raise ValueError("Request body must be a JSON object")
        return value

    @staticmethod
    def api_parts(path: str) -> list[str]:
        return [unquote(part) for part in path.split("/") if part]

    def reject_cross_site_write(self) -> bool:
        if self.headers.get("Sec-Fetch-Site", "") == "cross-site":
            self.send_error_json(HTTPStatus.FORBIDDEN, "Cross-site requests are not allowed")
            return True
        origin, host = self.headers.get("Origin"), self.headers.get("Host")
        allowed_origin = PUBLIC_ORIGIN or (f"http://{host}" if host else "")
        if origin and allowed_origin and origin.rstrip("/") != allowed_origin:
            self.send_error_json(HTTPStatus.FORBIDDEN, "Invalid request origin")
            return True
        return False

    def token_hash(self):
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        morsel = cookie.get("mis_session")
        return hashlib.sha256(morsel.value.encode()).hexdigest() if morsel and morsel.value else None

    def current_session(self, connection):
        token_hash = self.token_hash()
        if not token_hash:
            return None
        now = int(time.time())
        connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
        row = connection.execute("SELECT token_hash,username,actor_username,expires_at FROM sessions WHERE token_hash=?", (token_hash,)).fetchone()
        if not row:
            return None
        account = load_account(connection, row["username"])
        return (row, account) if account else None

    def require_session(self, connection, master=False):
        current = self.current_session(connection)
        if not current:
            self.send_error_json(HTTPStatus.UNAUTHORIZED, "Please sign in")
            return None
        if master and current[1].get("role") != "master":
            self.send_error_json(HTTPStatus.FORBIDDEN, "Master access is required")
            return None
        return current

    def session_view(self, connection, row, account):
        value = {"username": row["username"], "displayName": account.get("displayName") or row["username"], "role": account.get("role", "user"), "expiresAt": row["expires_at"] * 1000}
        if row["actor_username"]:
            actor = load_account(connection, row["actor_username"])
            if actor:
                value["impersonator"] = {"username": row["actor_username"], "displayName": actor.get("displayName") or row["actor_username"], "role": actor.get("role", "master"), "expiresAt": row["expires_at"] * 1000}
        return value

    def create_session(self, connection, username, actor=None):
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        now, expires = int(time.time()), int(time.time()) + SESSION_SECONDS
        connection.execute("INSERT INTO sessions(token_hash,username,actor_username,created_at,expires_at) VALUES (?,?,?,?,?)", (token_hash, username.lower(), actor, now, expires))
        row = connection.execute("SELECT token_hash,username,actor_username,expires_at FROM sessions WHERE token_hash=?", (token_hash,)).fetchone()
        secure = "; Secure" if SECURE_COOKIES else ""
        cookie = f"mis_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_SECONDS}{secure}"
        return self.session_view(connection, row, load_account(connection, username)), cookie

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            try:
                with connect() as c:
                    c.execute("SELECT 1")
                self.send_json({"ok": True, "version": "2.0", "database": DB_PATH.name})
            except sqlite3.Error:
                self.send_error_json(HTTPStatus.SERVICE_UNAVAILABLE, "Database unavailable")
            return
        if path == "/api/auth/status":
            with connect() as c:
                has_accounts = c.execute("SELECT 1 FROM accounts LIMIT 1").fetchone() is not None
                current = self.current_session(c)
                session = self.session_view(c, *current) if current else None
            self.send_json({"hasAccounts": has_accounts, "session": session})
            return
        if path == "/api/access":
            with connect() as c:
                current = self.require_session(c)
                if not current: return
                context = active_shift_context()
                context["role"] = current[1].get("role", "user")
                context["canManageAll"] = context["role"] == "master"
            self.send_json(context)
            return
        if path == "/api/entries":
            with connect() as c:
                if not self.require_session(c): return
                rows = c.execute("SELECT entry_date,payload FROM entries ORDER BY entry_date").fetchall()
            self.send_json({r["entry_date"]: json.loads(r["payload"]) for r in rows})
            return
        if path == "/api/accounts":
            with connect() as c:
                if not self.require_session(c, master=True): return
                rows = c.execute("SELECT username,payload FROM accounts ORDER BY username COLLATE NOCASE").fetchall()
            self.send_json({r["username"]: public_account(json.loads(r["payload"])) for r in rows})
            return
        if path == "/api/audit":
            with connect() as c:
                if not self.require_session(c, master=True): return
                rows = c.execute("SELECT id,occurred_at,actor,action,entity,entity_id,detail FROM audit_log ORDER BY id DESC LIMIT 200").fetchall()
            self.send_json([{"id": r["id"], "occurredAt": r["occurred_at"], "actor": r["actor"], "action": r["action"], "entity": r["entity"], "entityId": r["entity_id"], "detail": json.loads(r["detail"] or "{}")} for r in rows])
            return
        if path == "/api/system":
            with connect() as c:
                if not self.require_session(c, master=True): return
                values = {"entries": c.execute("SELECT COUNT(*) FROM entries").fetchone()[0], "accounts": c.execute("SELECT COUNT(*) FROM accounts").fetchone()[0], "auditEvents": c.execute("SELECT COUNT(*) FROM audit_log").fetchone()[0], "databaseBytes": DB_PATH.stat().st_size if DB_PATH.exists() else 0}
            self.send_json(values)
            return
        if path == "/api/backup":
            with connect() as c:
                current = self.require_session(c, master=True)
                if not current: return
                audit(c, current[0]["username"], "backup", "database")
            with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as temp:
                temp_path = Path(temp.name)
            try:
                source, target = connect(), sqlite3.connect(temp_path)
                source.backup(target); target.close(); source.close()
                body = temp_path.read_bytes()
            finally:
                temp_path.unlink(missing_ok=True)
            filename = f"rrel-mis-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/vnd.sqlite3")
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers(); self.wfile.write(body)
            return
        if path == "/":
            self.path = "/index.html"
            super().do_GET()
            return
        if path == "/index.html":
            super().do_GET()
            return
        if path.startswith("/api/"):
            self.send_error_json(HTTPStatus.NOT_FOUND, "Unknown API endpoint")
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if self.reject_cross_site_write(): return
        try:
            body = self.read_json_object() if self.headers.get("Content-Length", "0") != "0" else {}
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc)); return
        if path == "/api/auth/setup":
            username = str(body.get("username", "")).strip().lower()
            name, password = str(body.get("displayName", "")).strip()[:60], str(body.get("password", ""))
            if not USERNAME_RE.fullmatch(username) or not name or not valid_password(password):
                self.send_error_json(HTTPStatus.BAD_REQUEST, "Enter a valid name, username, and strong password"); return
            with connect() as c:
                if c.execute("SELECT 1 FROM accounts LIMIT 1").fetchone():
                    self.send_error_json(HTTPStatus.CONFLICT, "Initial setup is already complete"); return
                account = {"username": username, "displayName": name, "role": "master", "createdAt": utc_iso(), **password_credential(password)}
                store_account(c, username, account); audit(c, username, "setup", "account", username)
                session, cookie = self.create_session(c, username)
            self.send_json({"session": session}, HTTPStatus.CREATED, cookie); return
        if path == "/api/bootstrap/import":
            accounts, entries = body.get("accounts", {}), body.get("entries", {})
            if not isinstance(accounts, dict) or not isinstance(entries, dict) or len(accounts) > 50 or len(entries) > 10000:
                self.send_error_json(HTTPStatus.BAD_REQUEST, "Invalid import payload"); return
            with connect() as c:
                if c.execute("SELECT 1 FROM accounts LIMIT 1").fetchone():
                    self.send_error_json(HTTPStatus.CONFLICT, "Initial setup is already complete"); return
                valid_accounts = []
                for username, account in accounts.items():
                    key = str(username).lower()
                    if not USERNAME_RE.fullmatch(key) or not isinstance(account, dict) or not all(k in account for k in ("passwordHash", "salt", "iterations")):
                        self.send_error_json(HTTPStatus.BAD_REQUEST, "Local account data is invalid"); return
                    valid_accounts.append((key, dict(account)))
                if valid_accounts and not any(a.get("role") == "master" for _, a in valid_accounts):
                    self.send_error_json(HTTPStatus.BAD_REQUEST, "Imported accounts must include a master"); return
                for username, account in valid_accounts: store_account(c, username, account)
                imported_entries = 0
                for entry_date, payload in entries.items():
                    if DATE_RE.fullmatch(str(entry_date)) and isinstance(payload, dict):
                        c.execute("INSERT OR REPLACE INTO entries(entry_date,payload,updated_at) VALUES (?,?,?)", (entry_date, json.dumps(payload, ensure_ascii=False), utc_iso())); imported_entries += 1
                if valid_accounts: audit(c, None, "import", "database", detail={"accounts": len(valid_accounts), "entries": imported_entries})
            self.send_json({"ok": True, "accounts": len(valid_accounts), "entries": imported_entries}); return
        if path == "/api/auth/login":
            username, password, now = str(body.get("username", "")).strip().lower(), str(body.get("password", "")), int(time.time())
            with connect() as c:
                attempt = c.execute("SELECT failures,locked_until FROM login_attempts WHERE username=?", (username,)).fetchone()
                if attempt and attempt["locked_until"] > now:
                    self.send_error_json(HTTPStatus.TOO_MANY_REQUESTS, "Too many attempts. Try again later"); return
                account = load_account(c, username)
                if not account or not verify_password(password, account):
                    failures = (attempt["failures"] if attempt else 0) + 1
                    locked = now + min(30, 5 * (2 ** max(0, failures - 5))) * 60 if failures >= 5 else 0
                    c.execute("INSERT OR REPLACE INTO login_attempts(username,failures,locked_until) VALUES (?,?,?)", (username, failures, locked))
                    audit(c, username or None, "login_failed", "session")
                    self.send_error_json(HTTPStatus.UNAUTHORIZED, "Incorrect username or password"); return
                c.execute("DELETE FROM login_attempts WHERE username=?", (username,))
                session, cookie = self.create_session(c, username); audit(c, username, "login", "session")
            self.send_json({"session": session}, cookie=cookie); return
        if path == "/api/auth/logout":
            with connect() as c:
                current = self.current_session(c)
                if current:
                    audit(c, current[0]["username"], "logout", "session"); c.execute("DELETE FROM sessions WHERE token_hash=?", (current[0]["token_hash"],))
            secure = "; Secure" if SECURE_COOKIES else ""
            self.send_no_content("mis_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" + secure); return
        if path == "/api/auth/password":
            old, new = str(body.get("currentPassword", "")), str(body.get("newPassword", ""))
            if not valid_password(new) or new == old:
                self.send_error_json(HTTPStatus.BAD_REQUEST, "Choose a different strong password"); return
            with connect() as c:
                current = self.require_session(c)
                if not current: return
                row, account = current
                if not verify_password(old, account):
                    self.send_error_json(HTTPStatus.FORBIDDEN, "Current password is incorrect"); return
                account.update(password_credential(new)); store_account(c, row["username"], account)
                audit(c, row["username"], "password_changed", "account", row["username"])
            self.send_json({"ok": True}); return
        if path == "/api/accounts":
            username = str(body.get("username", "")).strip().lower()
            name, password = str(body.get("displayName", "")).strip()[:60], str(body.get("password", ""))
            role = body.get("role") if body.get("role") in {"user", "master"} else "user"
            if not USERNAME_RE.fullmatch(username) or not name or not valid_password(password):
                self.send_error_json(HTTPStatus.BAD_REQUEST, "Enter a valid name, username, and strong password"); return
            with connect() as c:
                current = self.require_session(c, master=True)
                if not current: return
                if load_account(c, username): self.send_error_json(HTTPStatus.CONFLICT, "That username already exists"); return
                account = {"username": username, "displayName": name, "role": role, "createdAt": utc_iso(), **password_credential(password)}
                store_account(c, username, account); audit(c, current[0]["username"], "created", "account", username, {"role": role})
            self.send_json({"account": public_account(account)}, HTTPStatus.CREATED); return
        if path.startswith("/api/auth/impersonate/"):
            username = unquote(path.rsplit("/", 1)[-1]).lower()
            with connect() as c:
                current = self.require_session(c, master=True)
                if not current: return
                row = current[0]; target = load_account(c, username)
                if not target: self.send_error_json(HTTPStatus.NOT_FOUND, "Account not found"); return
                actor = row["actor_username"] or row["username"]
                c.execute("UPDATE sessions SET username=?,actor_username=? WHERE token_hash=?", (username, actor, row["token_hash"]))
                audit(c, actor, "impersonated", "account", username)
                updated = c.execute("SELECT token_hash,username,actor_username,expires_at FROM sessions WHERE token_hash=?", (row["token_hash"],)).fetchone()
                session = self.session_view(c, updated, target)
            self.send_json({"session": session}); return
        if path == "/api/auth/stop-impersonation":
            with connect() as c:
                current = self.require_session(c)
                if not current: return
                row = current[0]; actor = row["actor_username"]
                if not actor: self.send_error_json(HTTPStatus.CONFLICT, "Not impersonating an account"); return
                account = load_account(c, actor)
                c.execute("UPDATE sessions SET username=?,actor_username=NULL WHERE token_hash=?", (actor, row["token_hash"]))
                audit(c, actor, "impersonation_stopped", "session")
                updated = c.execute("SELECT token_hash,username,actor_username,expires_at FROM sessions WHERE token_hash=?", (row["token_hash"],)).fetchone()
                session = self.session_view(c, updated, account)
            self.send_json({"session": session}); return
        self.send_error_json(HTTPStatus.NOT_FOUND, "Unknown API endpoint")

    def do_PATCH(self) -> None:
        path = urlparse(self.path).path
        if self.reject_cross_site_write(): return
        try: body = self.read_json_object()
        except ValueError as exc: self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc)); return
        if path == "/api/me":
            name = str(body.get("displayName", "")).strip()[:60]
            if not name: self.send_error_json(HTTPStatus.BAD_REQUEST, "Name cannot be empty"); return
            with connect() as c:
                current = self.require_session(c)
                if not current: return
                row, account = current; account["displayName"] = name; store_account(c, row["username"], account)
                audit(c, row["username"], "updated", "profile", row["username"])
            self.send_json({"account": public_account(account)}); return
        parts = self.api_parts(path)
        if len(parts) == 3 and parts[:2] == ["api", "accounts"]:
            username = parts[2].lower()
            with connect() as c:
                current = self.require_session(c, master=True)
                if not current: return
                account = load_account(c, username)
                if not account: self.send_error_json(HTTPStatus.NOT_FOUND, "Account not found"); return
                name = str(body.get("displayName", account.get("displayName", username))).strip()[:60]
                role = body.get("role", account.get("role", "user"))
                if not name or role not in {"user", "master"}: self.send_error_json(HTTPStatus.BAD_REQUEST, "Invalid account details"); return
                if account.get("role") == "master" and role != "master":
                    rows = c.execute("SELECT payload FROM accounts").fetchall()
                    if sum(json.loads(r["payload"]).get("role") == "master" for r in rows) <= 1:
                        self.send_error_json(HTTPStatus.CONFLICT, "The last master cannot be demoted"); return
                account.update({"displayName": name, "role": role}); store_account(c, username, account)
                audit(c, current[0]["username"], "updated", "account", username, {"role": role})
            self.send_json({"account": public_account(account)}); return
        self.send_error_json(HTTPStatus.NOT_FOUND, "Unknown API endpoint")

    def do_PUT(self) -> None:
        path = urlparse(self.path).path
        if self.reject_cross_site_write(): return
        parts = self.api_parts(path)
        try: payload = self.read_json_object()
        except ValueError as exc: self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc)); return
        if len(parts) == 3 and parts[:2] == ["api", "entries"]:
            entry_date = parts[2]
            if not DATE_RE.fullmatch(entry_date): self.send_error_json(HTTPStatus.BAD_REQUEST, "Entry date must use YYYY-MM-DD"); return
            with connect() as c:
                current = self.require_session(c)
                if not current: return
                role = current[1].get("role", "user")
                accepted_shift = None
                if role != "master":
                    access = active_shift_context()
                    accepted_shift = access["shift"]
                    if entry_date != access["date"]:
                        self.send_error_json(HTTPStatus.FORBIDDEN, f"Users may edit only the active {accepted_shift} shift sheet for {access['date']}")
                        return
                    shifts = payload.get("shifts")
                    if not isinstance(shifts, dict) or not isinstance(shifts.get(accepted_shift), dict):
                        self.send_error_json(HTTPStatus.BAD_REQUEST, "The active shift sheet is missing")
                        return
                    existing_row = c.execute("SELECT payload FROM entries WHERE entry_date=?", (entry_date,)).fetchone()
                    stored = json.loads(existing_row["payload"]) if existing_row else {
                        "date": entry_date,
                        "month": payload.get("month"),
                        "year": payload.get("year"),
                        "shifts": {},
                    }
                    stored.setdefault("shifts", {})[accepted_shift] = shifts[accepted_shift]
                    stored["updatedAt"] = payload.get("updatedAt") or utc_iso()
                    stored["updatedBy"] = current[0]["username"]
                    stored["updatedShift"] = accepted_shift
                    payload = stored
                else:
                    if not isinstance(payload.get("shifts"), dict):
                        self.send_error_json(HTTPStatus.BAD_REQUEST, "Production shifts are missing")
                        return
                    payload["updatedBy"] = current[0]["username"]
                c.execute("""INSERT INTO entries(entry_date,payload,updated_at) VALUES (?,?,?)
                             ON CONFLICT(entry_date) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at""", (entry_date, json.dumps(payload, ensure_ascii=False), utc_iso()))
                audit(c, current[0]["username"], "saved", "entry", entry_date, {"shift": accepted_shift or "ALL", "role": role})
            self.send_json({"ok": True, "entryDate": entry_date, "acceptedShift": accepted_shift or "ALL"}); return
        self.send_error_json(HTTPStatus.NOT_FOUND, "Unknown API endpoint")

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path
        if self.reject_cross_site_write(): return
        parts = self.api_parts(path)
        if len(parts) == 3 and parts[:2] == ["api", "entries"]:
            entry_date = parts[2]
            if not DATE_RE.fullmatch(entry_date): self.send_error_json(HTTPStatus.BAD_REQUEST, "Entry date must use YYYY-MM-DD"); return
            with connect() as c:
                current = self.require_session(c, master=True)
                if not current: return
                c.execute("DELETE FROM entries WHERE entry_date=?", (entry_date,)); audit(c, current[0]["username"], "deleted", "entry", entry_date)
            self.send_no_content(); return
        if len(parts) == 3 and parts[:2] == ["api", "accounts"]:
            username = parts[2].lower()
            with connect() as c:
                current = self.require_session(c, master=True)
                if not current: return
                if username in {current[0]["username"], current[0]["actor_username"]}:
                    self.send_error_json(HTTPStatus.CONFLICT, "You cannot remove your active account"); return
                account = load_account(c, username)
                if not account: self.send_error_json(HTTPStatus.NOT_FOUND, "Account not found"); return
                if account.get("role") == "master":
                    rows = c.execute("SELECT payload FROM accounts").fetchall()
                    if sum(json.loads(r["payload"]).get("role") == "master" for r in rows) <= 1:
                        self.send_error_json(HTTPStatus.CONFLICT, "The last master cannot be removed"); return
                c.execute("DELETE FROM sessions WHERE username=? OR actor_username=?", (username, username)); c.execute("DELETE FROM accounts WHERE username=?", (username,))
                audit(c, current[0]["username"], "deleted", "account", username)
            self.send_no_content(); return
        self.send_error_json(HTTPStatus.NOT_FOUND, "Unknown API endpoint")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the RREL MIS dashboard")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    initialize_database()
    server = ThreadingHTTPServer((args.host, args.port), MISRequestHandler)
    print(f"RREL MIS running at http://{args.host}:{args.port}", flush=True)
    print(f"SQLite database: {DB_PATH}", flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()


if __name__ == "__main__":
    main()
