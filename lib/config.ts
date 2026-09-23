export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const SESSION_SECONDS = 12 * 60 * 60;
export const PBKDF2_ITERATIONS = 210_000;
export const MIS_TIMEZONE = process.env.MIS_TIMEZONE || "Asia/Kolkata";
export const PUBLIC_ORIGIN = (process.env.MIS_PUBLIC_ORIGIN || "").replace(/\/$/, "");
export const SECURE_COOKIES =
  process.env.MIS_SECURE_COOKIES === "1" ||
  (process.env.VERCEL === "1" && process.env.MIS_SECURE_COOKIES !== "0");
export const COOKIE_NAME = "mis_session";
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const USERNAME_RE = /^[a-zA-Z0-9._-]{3,24}$/;

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; " +
    "connect-src 'self'; base-uri 'none'; form-action 'self'",
};
