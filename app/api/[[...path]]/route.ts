import { NextRequest } from "next/server";
import {
  audit,
  createSession,
  currentSession,
  loadAccount,
  loadSession,
  passwordCredential,
  publicAccount,
  requireSession,
  sessionView,
  storeAccount,
  validPassword,
  validUsername,
  verifyPassword,
  type Account,
} from "@/lib/auth";
import { DATE_RE } from "@/lib/config";
import { ApiError } from "@/lib/errors";
import { initializeDatabase, isDatabaseError, withDb } from "@/lib/db";
import { jsonResponse, noContent, readJsonObject, rejectCrossSiteWrite, sessionToken } from "@/lib/http";
import { activeShiftContext, utcIso } from "@/lib/shift";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteParams = { path?: string[] };
type EntryDoc = { _id: string; payload: Record<string, unknown>; updated_at: string };
type AccountDoc = { _id: string; payload: Account; updated_at: string };
type LoginAttemptDoc = { _id: string; failures: number; locked_until: number };
type AuditDoc = {
  id: number;
  occurred_at: string;
  actor: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  detail: unknown;
};

function parseRoute(method: string, parts: string[]): { key: string; params: Record<string, string> } {
  const path = parts.join("/");
  const impersonate = path.match(/^auth\/impersonate\/(.+)$/);
  if (impersonate) {
    return { key: `${method} /auth/impersonate/:username`, params: { username: impersonate[1] } };
  }
  if (method !== "GET" && method !== "POST") {
    const account = path.match(/^accounts\/(.+)$/);
    if (account) {
      return { key: `${method} /accounts/:username`, params: { username: account[1] } };
    }
  }
  const entry = path.match(/^entries\/(.+)$/);
  if (entry && method !== "GET") {
    return { key: `${method} /entries/:entry_date`, params: { entry_date: entry[1] } };
  }
  return { key: `${method} /${path}`, params: {} };
}

function auditView(row: AuditDoc) {
  return {
    id: Number(row.id),
    occurredAt: row.occurred_at,
    actor: row.actor,
    action: row.action,
    entity: row.entity,
    entityId: row.entity_id,
    detail: row.detail && typeof row.detail === "object" ? row.detail : {},
  };
}

async function dispatch(request: NextRequest, parts: string[]) {
  const method = request.method.toUpperCase();
  const { key, params } = parseRoute(method, parts);
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(method);
  if (mutating) rejectCrossSiteWrite(request);

  const needsBody = ["POST", "PUT", "PATCH"].includes(method);
  const allowEmpty =
    needsBody && key !== "PATCH /me" && key !== "PATCH /accounts/:username" && key !== "PUT /entries/:entry_date";
  const body = needsBody ? await readJsonObject(request, allowEmpty) : {};
  const token = sessionToken(request);

  if (key === "GET /health") {
    try {
      await initializeDatabase();
      await withDb(async (db) => {
        await db.command({ ping: 1 });
      });
      return jsonResponse({ ok: true, version: "2.0", database: "mongodb" });
    } catch {
      return jsonResponse({ error: "Database unavailable" }, 503);
    }
  }

  return withDb(async (db) => {
    const entries = db.collection<EntryDoc>("entries");
    const accounts = db.collection<AccountDoc>("accounts");
    const sessions = db.collection<{ _id: string; username: string; actor_username: string | null }>("sessions");
    const loginAttempts = db.collection<LoginAttemptDoc>("login_attempts");
    const auditLog = db.collection<AuditDoc>("audit_log");

    switch (key) {
      case "GET /auth/status": {
        const hasAccounts = (await accounts.findOne({}, { projection: { _id: 1 } })) != null;
        const current = await currentSession(db, token);
        const session = current ? await sessionView(db, current[0], current[1]) : null;
        return jsonResponse({ hasAccounts, session });
      }
      case "GET /access": {
        const current = await requireSession(db, token);
        const context = activeShiftContext();
        return jsonResponse({
          ...context,
          role: current[1].role || "user",
          canManageAll: (current[1].role || "user") === "master",
        });
      }
      case "GET /entries": {
        await requireSession(db, token);
        const rows = await entries.find().sort({ _id: 1 }).toArray();
        const all: Record<string, unknown> = {};
        for (const row of rows) all[row._id] = row.payload;
        return jsonResponse(all);
      }
      case "GET /accounts": {
        await requireSession(db, token, true);
        const rows = await accounts.find().sort({ _id: 1 }).toArray();
        const all: Record<string, unknown> = {};
        for (const row of rows) all[row._id] = publicAccount(row.payload);
        return jsonResponse(all);
      }
      case "GET /audit": {
        await requireSession(db, token, true);
        const rows = await auditLog.find().sort({ id: -1 }).limit(200).toArray();
        return jsonResponse(rows.map(auditView));
      }
      case "GET /system": {
        await requireSession(db, token, true);
        const stats = await db.command({ dbStats: 1 });
        return jsonResponse({
          entries: await entries.countDocuments(),
          accounts: await accounts.countDocuments(),
          auditEvents: await auditLog.countDocuments(),
          databaseBytes: Number(stats.dataSize || 0),
        });
      }
      case "GET /backup": {
        const current = await requireSession(db, token, true);
        await audit(db, current[0].username, "backup", "database");
        const accountRows = await accounts.find().sort({ _id: 1 }).toArray();
        const entryRows = await entries.find().sort({ _id: 1 }).toArray();
        const events = (await auditLog.find().sort({ id: 1 }).toArray()).map(auditView);
        const payload = JSON.stringify({
          accounts: Object.fromEntries(accountRows.map((row) => [row._id, row.payload])),
          entries: Object.fromEntries(entryRows.map((row) => [row._id, row.payload])),
          auditLog: events,
        });
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        const filename = `rrel-mis-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
        return new Response(payload, {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-store",
          },
        });
      }
      case "POST /auth/setup": {
        const username = String(body.username || "").trim().toLowerCase();
        const name = String(body.displayName || "").trim().slice(0, 60);
        const password = String(body.password || "");
        if (!validUsername(username) || !name || !validPassword(password)) {
          throw new ApiError(400, "Enter a valid name, username, and strong password");
        }
        if (await accounts.findOne({}, { projection: { _id: 1 } })) {
          throw new ApiError(409, "Initial setup is already complete");
        }
        const account: Account = {
          username,
          displayName: name,
          role: "master",
          createdAt: utcIso(),
          ...passwordCredential(password),
        };
        await storeAccount(db, username, account);
        await audit(db, username, "setup", "account", username);
        const created = await createSession(db, username);
        return jsonResponse({ session: created.session }, 201, ["mis_session", created.token]);
      }
      case "POST /bootstrap/import": {
        const importedAccounts = body.accounts;
        const importedEntries = body.entries;
        if (
          typeof importedAccounts !== "object" ||
          importedAccounts === null ||
          Array.isArray(importedAccounts) ||
          typeof importedEntries !== "object" ||
          importedEntries === null ||
          Array.isArray(importedEntries) ||
          Object.keys(importedAccounts as object).length > 50 ||
          Object.keys(importedEntries as object).length > 10000
        ) {
          throw new ApiError(400, "Invalid import payload");
        }
        if (await accounts.findOne({}, { projection: { _id: 1 } })) {
          throw new ApiError(409, "Initial setup is already complete");
        }
        const validAccounts: [string, Account][] = [];
        for (const [username, account] of Object.entries(importedAccounts as Record<string, unknown>)) {
          const key = String(username).toLowerCase();
          if (
            !validUsername(key) ||
            typeof account !== "object" ||
            account === null ||
            !("passwordHash" in account) ||
            !("salt" in account) ||
            !("iterations" in account)
          ) {
            throw new ApiError(400, "Local account data is invalid");
          }
          validAccounts.push([key, { ...(account as Account) }]);
        }
        if (validAccounts.length && !validAccounts.some(([, account]) => account.role === "master")) {
          throw new ApiError(400, "Imported accounts must include a master");
        }
        for (const [username, account] of validAccounts) {
          await storeAccount(db, username, account);
        }
        let entryCount = 0;
        for (const [entryDate, payload] of Object.entries(importedEntries as Record<string, unknown>)) {
          if (DATE_RE.test(String(entryDate)) && typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
            await entries.updateOne(
              { _id: entryDate },
              { $set: { payload: payload as Record<string, unknown>, updated_at: utcIso() } },
              { upsert: true }
            );
            entryCount += 1;
          }
        }
        if (validAccounts.length) {
          await audit(db, null, "import", "database", null, {
            accounts: validAccounts.length,
            entries: entryCount,
          });
        }
        return jsonResponse({ ok: true, accounts: validAccounts.length, entries: entryCount });
      }
      case "POST /auth/login": {
        const username = String(body.username || "").trim().toLowerCase();
        const password = String(body.password || "");
        const now = Math.floor(Date.now() / 1000);
        const attempt = await loginAttempts.findOne({ _id: username });
        if (attempt && Number(attempt.locked_until) > now) {
          throw new ApiError(429, "Too many attempts. Try again later");
        }
        const account = await loadAccount(db, username);
        if (!account || !verifyPassword(password, account)) {
          const failures = (attempt ? Number(attempt.failures) : 0) + 1;
          const locked = failures >= 5 ? now + Math.min(30, 5 * 2 ** Math.max(0, failures - 5)) * 60 : 0;
          await loginAttempts.updateOne(
            { _id: username },
            { $set: { failures, locked_until: locked } },
            { upsert: true }
          );
          await audit(db, username || null, "login_failed", "session");
          throw new ApiError(401, "Incorrect username or password");
        }
        await loginAttempts.deleteOne({ _id: username });
        const created = await createSession(db, username);
        await audit(db, username, "login", "session");
        return jsonResponse({ session: created.session }, 200, ["mis_session", created.token]);
      }
      case "POST /auth/logout": {
        const current = await currentSession(db, token);
        if (current) {
          await audit(db, current[0].username, "logout", "session");
          await sessions.deleteOne({ _id: current[0].token_hash });
        }
        return noContent(true);
      }
      case "POST /auth/password": {
        const oldPassword = String(body.currentPassword || "");
        const newPassword = String(body.newPassword || "");
        if (!validPassword(newPassword) || newPassword === oldPassword) {
          throw new ApiError(400, "Choose a different strong password");
        }
        const current = await requireSession(db, token);
        const [row, account] = current;
        if (!verifyPassword(oldPassword, account)) {
          throw new ApiError(403, "Current password is incorrect");
        }
        Object.assign(account, passwordCredential(newPassword));
        await storeAccount(db, row.username, account);
        await audit(db, row.username, "password_changed", "account", row.username);
        return jsonResponse({ ok: true });
      }
      case "POST /accounts": {
        const username = String(body.username || "").trim().toLowerCase();
        const name = String(body.displayName || "").trim().slice(0, 60);
        const password = String(body.password || "");
        const role = body.role === "user" || body.role === "master" ? body.role : "user";
        if (!validUsername(username) || !name || !validPassword(password)) {
          throw new ApiError(400, "Enter a valid name, username, and strong password");
        }
        const current = await requireSession(db, token, true);
        if (await loadAccount(db, username)) {
          throw new ApiError(409, "That username already exists");
        }
        const account: Account = {
          username,
          displayName: name,
          role,
          createdAt: utcIso(),
          ...passwordCredential(password),
        };
        await storeAccount(db, username, account);
        await audit(db, current[0].username, "created", "account", username, { role });
        return jsonResponse({ account: publicAccount(account) }, 201);
      }
      case "POST /auth/impersonate/:username": {
        const username = decodeURIComponent(params.username).toLowerCase();
        const current = await requireSession(db, token, true);
        const row = current[0];
        const target = await loadAccount(db, username);
        if (!target) throw new ApiError(404, "Account not found");
        const actor = row.actor_username || row.username;
        await sessions.updateOne({ _id: row.token_hash }, { $set: { username, actor_username: actor } });
        await audit(db, actor, "impersonated", "account", username);
        const updated = await loadSession(db, row.token_hash);
        return jsonResponse({ session: await sessionView(db, updated!, target) });
      }
      case "POST /auth/stop-impersonation": {
        const current = await requireSession(db, token);
        const row = current[0];
        const actor = row.actor_username;
        if (!actor) throw new ApiError(409, "Not impersonating an account");
        const account = await loadAccount(db, actor);
        await sessions.updateOne({ _id: row.token_hash }, { $set: { username: actor, actor_username: null } });
        await audit(db, actor, "impersonation_stopped", "session");
        const updated = await loadSession(db, row.token_hash);
        return jsonResponse({ session: await sessionView(db, updated!, account as Account) });
      }
      case "PATCH /me": {
        const name = String(body.displayName || "").trim().slice(0, 60);
        if (!name) throw new ApiError(400, "Name cannot be empty");
        const [row, account] = await requireSession(db, token);
        account.displayName = name;
        await storeAccount(db, row.username, account);
        await audit(db, row.username, "updated", "profile", row.username);
        return jsonResponse({ account: publicAccount(account) });
      }
      case "PATCH /accounts/:username": {
        const username = decodeURIComponent(params.username).toLowerCase();
        const current = await requireSession(db, token, true);
        const account = await loadAccount(db, username);
        if (!account) throw new ApiError(404, "Account not found");
        const name = String(body.displayName ?? account.displayName ?? username).trim().slice(0, 60);
        const role = (body.role ?? account.role ?? "user") as string;
        if (!name || (role !== "user" && role !== "master")) {
          throw new ApiError(400, "Invalid account details");
        }
        if (account.role === "master" && role !== "master") {
          const rows = await accounts.find().toArray();
          if (rows.filter((row) => row.payload.role === "master").length <= 1) {
            throw new ApiError(409, "The last master cannot be demoted");
          }
        }
        account.displayName = name;
        account.role = role;
        await storeAccount(db, username, account);
        await audit(db, current[0].username, "updated", "account", username, { role });
        return jsonResponse({ account: publicAccount(account) });
      }
      case "PUT /entries/:entry_date": {
        const entryDate = params.entry_date;
        if (!DATE_RE.test(entryDate)) throw new ApiError(400, "Entry date must use YYYY-MM-DD");
        const current = await requireSession(db, token);
        const role = current[1].role || "user";
        let payload: Record<string, unknown> = { ...body };
        let acceptedShift: string | null = null;
        if (role !== "master") {
          const access = activeShiftContext();
          acceptedShift = access.shift;
          if (entryDate !== access.date) {
            throw new ApiError(403, `Users may edit only the active ${acceptedShift} shift sheet for ${access.date}`);
          }
          const shifts = payload.shifts;
          if (
            typeof shifts !== "object" ||
            shifts === null ||
            typeof (shifts as Record<string, unknown>)[acceptedShift] !== "object"
          ) {
            throw new ApiError(400, "The active shift sheet is missing");
          }
          const existing = await entries.findOne({ _id: entryDate });
          const stored = existing
            ? existing.payload
            : { date: entryDate, month: payload.month, year: payload.year, shifts: {} };
          const storedShifts =
            stored.shifts && typeof stored.shifts === "object" && !Array.isArray(stored.shifts)
              ? (stored.shifts as Record<string, unknown>)
              : {};
          storedShifts[acceptedShift] = (shifts as Record<string, unknown>)[acceptedShift];
          stored.shifts = storedShifts;
          stored.updatedAt = payload.updatedAt || utcIso();
          stored.updatedBy = current[0].username;
          stored.updatedShift = acceptedShift;
          payload = stored;
        } else {
          if (typeof payload.shifts !== "object" || payload.shifts === null) {
            throw new ApiError(400, "Production shifts are missing");
          }
          payload.updatedBy = current[0].username;
        }
        await entries.updateOne(
          { _id: entryDate },
          { $set: { payload, updated_at: utcIso() } },
          { upsert: true }
        );
        await audit(db, current[0].username, "saved", "entry", entryDate, {
          shift: acceptedShift || "ALL",
          role,
        });
        return jsonResponse({ ok: true, entryDate, acceptedShift: acceptedShift || "ALL" });
      }
      case "DELETE /entries/:entry_date": {
        const entryDate = params.entry_date;
        if (!DATE_RE.test(entryDate)) throw new ApiError(400, "Entry date must use YYYY-MM-DD");
        const current = await requireSession(db, token, true);
        await entries.deleteOne({ _id: entryDate });
        await audit(db, current[0].username, "deleted", "entry", entryDate);
        return noContent();
      }
      case "DELETE /accounts/:username": {
        const username = decodeURIComponent(params.username).toLowerCase();
        const current = await requireSession(db, token, true);
        if (username === current[0].username || username === current[0].actor_username) {
          throw new ApiError(409, "You cannot remove your active account");
        }
        const account = await loadAccount(db, username);
        if (!account) throw new ApiError(404, "Account not found");
        if (account.role === "master") {
          const rows = await accounts.find().toArray();
          if (rows.filter((row) => row.payload.role === "master").length <= 1) {
            throw new ApiError(409, "The last master cannot be removed");
          }
        }
        await sessions.deleteMany({ $or: [{ username }, { actor_username: username }] });
        await accounts.deleteOne({ _id: username });
        await audit(db, current[0].username, "deleted", "account", username);
        return noContent();
      }
      default:
        throw new ApiError(404, "Unknown API endpoint");
    }
  });
}

async function handle(request: NextRequest, context: { params: Promise<RouteParams> }) {
  try {
    const { path = [] } = await context.params;
    return await dispatch(request, path);
  } catch (error) {
    if (error instanceof ApiError) return jsonResponse({ error: error.message }, error.status);
    if (isDatabaseError(error)) return jsonResponse({ error: "Database unavailable" }, 503);
    console.error(error);
    return jsonResponse({ error: "Database unavailable" }, 503);
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
