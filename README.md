# RREL MIS Essential

Next.js production MIS dashboard with MongoDB.

## Local

```bash
cp .env.example .env
# set MONGODB_URI
npm install
npm run dev
```

Open http://127.0.0.1:8765 and create the master account.

## Vercel

1. Import the GitHub repo (Next.js is detected automatically).
2. Add environment variables:

   | Variable | Value |
   |---|---|
   | `MONGODB_URI` | Atlas connection string |
   | `MIS_TIMEZONE` | `Asia/Kolkata` |
   | `MIS_SECURE_COOKIES` | `1` |
   | `MIS_PUBLIC_ORIGIN` | Your live URL, e.g. `https://your-app.vercel.app` |

3. In Atlas → Network Access, allow `0.0.0.0/0`.
4. Deploy, open the site, and create the master account.

Health check: `GET /api/health`
