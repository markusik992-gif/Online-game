# HackChat

Live chat + hacking-terminal simulator. Deploy on Render as a Node web service.

## Deploy on Render (FREE plan ready)
1. Push this folder to GitHub.
2. Render → New → Web Service → connect repo. Plan: Free.
3. Build: `npm install`, Start: `npm start`. Node 18+.
4. No disk / no env vars needed — `render.yaml` is free-compatible.

How it survives free-tier sleep: server pays catch-up mining on wake
(capped), each device keeps a full account backup in localStorage and
silently re-registers (same host/port/balance/hacks) if the server was
wiped, and chat caches the last messages on device. Browsers open also
ping `/api/ping` every 5 min while someone is online.
Optional: add a free UptimeRobot monitor on `https://YOUR.onrender.com/api/ping`
to reduce sleep.

## The last 1%: permanent tamper-proof DB (optional, free)
Code already supports it — I chose **MongoDB** over Supabase because your
data is plain JSON documents (users/messages/bans): one connection string,
no SQL tables to create.

- Do nothing: site runs in fallback mode (device-backup self-heal). Works.
- For bulletproof mode: create a free Atlas M0 cluster once (~4 min):
  1. mongodb.com → free account → Create → M0 Free → any region.
  2. Database Access → add user + password. Network Access → Allow `0.0.0.0/0`.
  3. Cluster → Connect → Drivers → copy the `mongodb+srv://...` string.
  4. Render → your service → Environment → add `MONGODB_URI` = that string → Save (auto-redeploys).
Server auto-detects it on boot (`MongoDB: loaded N users...` in logs) and
persists every change there. Balances/hacks then come from the server, not
from device restore, so they can't be edited via localStorage and bans
survive wipes.

## Run locally
```
npm install
npm start
```
Open http://localhost:3000

## Game manual
- First visit: pick display name + server password (letters = 10s to crack, +symbols = 30s, +numbers = +30s).
- Chat (left): live messages + photos, click a sender to open their profile in the chat tab. Edit your name/avatar there. Your host + income shown.
- Terminal (right): `help`, `color [0-9]`, `install bruce`, `install nos`, `bruce`, `nos`, `open [host]/[port]/core/[name]`, `db open`.
- Flow: `nos` → scan victim host → copy OPEN port → `bruce` → crack → `1` copies `open ...` path → `open ...` → password → `1` balance → `1` transfer / `2` leak.
- Mining: every 10s you earn by rank. Ranks: 1+ bronze, 3+ silver, 5+ gold, 7+ elite, 10+ legend. Legend mines 50$/10s.
- Admin: `db open` in terminal. Floating white/blue deck lists ALL users, set balance, ban (banned device gets a fresh account on next open, old progress/name/pic gone).
