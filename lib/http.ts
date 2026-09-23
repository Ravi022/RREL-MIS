import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, MAX_BODY_BYTES, PUBLIC_ORIGIN, SECURE_COOKIES, SESSION_SECONDS } from "./config";
import { ApiError } from "./errors";

export type JsonObject = Record<string, unknown>;

export function jsonResponse(value: unknown, status = 200, cookie?: [string, string]) {
  const body = JSON.stringify(value);
  const response = new NextResponse(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
  if (cookie) setSessionCookie(response, cookie[1]);
  return response;
}

export function noContent(clearSession = false) {
  const response = new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
  if (clearSession) setSessionCookie(response, "");
  return response;
}

export function setSessionCookie(response: NextResponse, value: string) {
  response.cookies.set(COOKIE_NAME, value, {
    maxAge: value === "" ? 0 : SESSION_SECONDS,
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: SECURE_COOKIES,
  });
}

export async function readJsonObject(request: NextRequest, allowEmpty = false): Promise<JsonObject> {
  const raw = await request.text();
  if (!raw) {
    if (allowEmpty) return {};
    throw new ApiError(400, "Request body must be between 1 byte and 2 MB");
  }
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
    throw new ApiError(400, "Request body must be between 1 byte and 2 MB");
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ApiError(400, "Request body must be valid JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError(400, "Request body must be a JSON object");
  }
  return value as JsonObject;
}

export function rejectCrossSiteWrite(request: NextRequest) {
  if ((request.headers.get("sec-fetch-site") || "") === "cross-site") {
    throw new ApiError(403, "Cross-site requests are not allowed");
  }
  const origin = (request.headers.get("origin") || "").replace(/\/$/, "");
  if (!origin) return;

  const allowed = new Set<string>([request.nextUrl.origin.replace(/\/$/, "")]);
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").split(",")[0].trim();
  const proto = (
    request.headers.get("x-forwarded-proto") ||
    request.nextUrl.protocol.replace(":", "") ||
    "http"
  )
    .split(",")[0]
    .trim();
  if (host) allowed.add(`${proto}://${host}`);
  if (PUBLIC_ORIGIN) allowed.add(PUBLIC_ORIGIN);

  if (!allowed.has(origin)) {
    throw new ApiError(403, "Invalid request origin");
  }
}

export function sessionToken(request: NextRequest) {
  return request.cookies.get(COOKIE_NAME)?.value || null;
}
