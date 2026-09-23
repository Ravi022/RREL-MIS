import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";
import type { Db } from "mongodb";
import { PBKDF2_ITERATIONS, SESSION_SECONDS, USERNAME_RE } from "./config";
import { nextAuditId } from "./db";
import { ApiError } from "./errors";
import { utcIso } from "./shift";

export type Account = {
  username: string;
  displayName?: string;
  role?: string;
  createdAt?: string;
  passwordHash: string;
  salt: string;
  iterations: number;
  [key: string]: unknown;
};

export type SessionRow = {
  token_hash: string;
  username: string;
  actor_username: string | null;
  expires_at: number;
};

type AccountDoc = { _id: string; payload: Account; updated_at: string };
type SessionDoc = {
  _id: string;
  username: string;
  actor_username: string | null;
  created_at: number;
  expires_at: number;
};

function sessionFrom(doc: SessionDoc): SessionRow {
  return {
    token_hash: doc._id,
    username: doc.username,
    actor_username: doc.actor_username ?? null,
    expires_at: doc.expires_at,
  };
}

export function passwordCredential(password: string) {
  const salt = randomBytes(16);
  const digest = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256");
  return {
    passwordHash: digest.toString("hex"),
    salt: salt.toString("hex"),
    iterations: PBKDF2_ITERATIONS,
  };
}

export function validPassword(password: string) {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

export function verifyPassword(password: string, account: Account) {
  try {
    const iterations = Number(account.iterations || 0);
    const salt = Buffer.from(account.salt, "hex");
    const expected = account.passwordHash;
    if (iterations <= 0 || salt.length < 8 || !expected) return false;
    const actual = pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
    const actualBuf = Buffer.from(actual, "utf8");
    const expectedBuf = Buffer.from(expected, "utf8");
    if (actualBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(actualBuf, expectedBuf);
  } catch {
    return false;
  }
}

export function publicAccount(account: Account) {
  const { passwordHash: _h, salt: _s, iterations: _i, ...rest } = account;
  return rest;
}

export async function loadAccount(db: Db, username: string): Promise<Account | null> {
  const doc = await db.collection<AccountDoc>("accounts").findOne({ _id: username.toLowerCase() });
  return doc?.payload || null;
}

export async function storeAccount(db: Db, username: string, account: Account) {
  const key = username.toLowerCase();
  account.username = key;
  await db.collection<AccountDoc>("accounts").updateOne(
    { _id: key },
    { $set: { payload: account, updated_at: utcIso() } },
    { upsert: true }
  );
}

export async function audit(
  db: Db,
  actor: string | null | undefined,
  action: string,
  entity: string,
  entityId?: string | null,
  detail?: unknown
) {
  const id = await nextAuditId(db);
  await db.collection("audit_log").insertOne({
    id,
    occurred_at: utcIso(),
    actor: actor ?? null,
    action,
    entity,
    entity_id: entityId ?? null,
    detail: detail || {},
  });
}

function tokenHashFrom(value: string | null | undefined) {
  return value ? createHash("sha256").update(value).digest("hex") : null;
}

export async function currentSession(db: Db, token: string | null): Promise<[SessionRow, Account] | null> {
  const hashed = tokenHashFrom(token);
  if (!hashed) return null;
  const now = Math.floor(Date.now() / 1000);
  await db.collection("sessions").deleteMany({ expires_at: { $lte: now } });
  const doc = await db.collection<SessionDoc>("sessions").findOne({ _id: hashed });
  if (!doc) return null;
  const account = await loadAccount(db, doc.username);
  return account ? [sessionFrom(doc), account] : null;
}

export async function requireSession(db: Db, token: string | null, master = false) {
  const current = await currentSession(db, token);
  if (!current) throw new ApiError(401, "Please sign in");
  if (master && current[1].role !== "master") throw new ApiError(403, "Master access is required");
  return current;
}

export async function sessionView(db: Db, row: SessionRow, account: Account) {
  const value: Record<string, unknown> = {
    username: row.username,
    displayName: account.displayName || row.username,
    role: account.role || "user",
    expiresAt: Number(row.expires_at) * 1000,
  };
  if (row.actor_username) {
    const actor = await loadAccount(db, row.actor_username);
    if (actor) {
      value.impersonator = {
        username: row.actor_username,
        displayName: actor.displayName || row.actor_username,
        role: actor.role || "master",
        expiresAt: Number(row.expires_at) * 1000,
      };
    }
  }
  return value;
}

export async function createSession(db: Db, username: string, actor: string | null = null) {
  const token = randomBytes(32).toString("base64url");
  const hashed = createHash("sha256").update(token).digest("hex");
  const now = Math.floor(Date.now() / 1000);
  const expires = now + SESSION_SECONDS;
  const doc: SessionDoc = {
    _id: hashed,
    username: username.toLowerCase(),
    actor_username: actor,
    created_at: now,
    expires_at: expires,
  };
  await db.collection<SessionDoc>("sessions").insertOne(doc);
  const account = await loadAccount(db, username);
  return { session: await sessionView(db, sessionFrom(doc), account as Account), token };
}

export async function loadSession(db: Db, tokenHash: string) {
  const doc = await db.collection<SessionDoc>("sessions").findOne({ _id: tokenHash });
  return doc ? sessionFrom(doc) : null;
}

export function validUsername(username: string) {
  return USERNAME_RE.test(username);
}
