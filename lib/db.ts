import { MongoClient, type Db } from "mongodb";
import { ApiError } from "./errors";

type GlobalMongo = typeof globalThis & {
  __misMongo?: { client: Promise<MongoClient>; dbName: string };
};

function mongoUri() {
  const url = (process.env.MONGODB_URI || process.env.DATABASE_URL || "").trim();
  if (!url) {
    console.error("Missing MONGODB_URI. Set it in .env locally, or in Vercel Project Settings → Environment Variables.");
    throw new ApiError(503, "Database unavailable");
  }
  return url;
}

function databaseName(uri: string) {
  const path = uri.replace(/^mongodb(\+srv)?:\/\//i, "").split("/")[1];
  if (!path) return "rrel_mis";
  return decodeURIComponent(path.split("?")[0]) || "rrel_mis";
}

async function getClient() {
  const globalForMongo = globalThis as GlobalMongo;
  const uri = mongoUri();
  const dbName = databaseName(uri);
  if (!globalForMongo.__misMongo) {
    const client = new MongoClient(uri, {
      maxPoolSize: 1,
      minPoolSize: 0,
      maxIdleTimeMS: 10_000,
      serverSelectionTimeoutMS: 15_000,
      connectTimeoutMS: 15_000,
    });
    globalForMongo.__misMongo = { client: client.connect(), dbName };
  }
  return { client: await globalForMongo.__misMongo.client, dbName: globalForMongo.__misMongo.dbName };
}

async function getDb(): Promise<Db> {
  const { client, dbName } = await getClient();
  return client.db(dbName);
}

let dbReady = false;
let dbInit: Promise<void> | null = null;

export async function initializeDatabase() {
  if (dbReady) return;
  if (!dbInit) {
    dbInit = (async () => {
      try {
        const db = await getDb();
        await db.command({ ping: 1 });
        await Promise.all([
          db.collection("sessions").createIndex({ expires_at: 1 }),
          db.collection("audit_log").createIndex({ id: -1 }),
          db.collection("audit_log").createIndex({ occurred_at: -1 }),
        ]);
        dbReady = true;
      } catch (error) {
        dbInit = null;
        const globalForMongo = globalThis as GlobalMongo;
        globalForMongo.__misMongo = undefined;
        throw error;
      }
    })();
  }
  await dbInit;
}

export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  await initializeDatabase();
  return fn(await getDb());
}

export async function nextAuditId(db: Db) {
  const result = await db.collection<{ _id: string; seq: number }>("counters").findOneAndUpdate(
    { _id: "audit_log" },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  return Number(result?.seq || 1);
}

export function isDatabaseError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const name = error.name || "";
  return Boolean(
    name.includes("Mongo") ||
      error.message.includes("connect") ||
      error.message.includes("ECONNREFUSED") ||
      error.message.includes("MongoServer") ||
      error.message.includes("authentication")
  );
}
