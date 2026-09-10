# Collab Editor

A real-time collaborative text editor — multiple people editing the same
document simultaneously, seeing each other's cursors and changes instantly,
like a minimal Google Docs. Built to explore CRDT-based collaborative editing
end to end: auth, real-time sync, presence, permissions, and version history.

## Features

- Email/password auth (JWT)
- Create documents, list them, share by link
- Real-time collaborative editing (Monaco editor + Y.js CRDT + Socket.io)
- Live colored cursors and selections, with each user's name
- Online presence ("who's here right now")
- Automatic + manual version history, with restore
- Owner / editor / viewer permissions, enforced server-side (not just hidden
  in the UI)
- Rate-limited auth endpoints, Zod-validated request bodies, Helmet security
  headers
- Playwright E2E tests exercising two independent user accounts
  collaborating in real browser contexts

## Running it locally

Prerequisites: Node.js, PostgreSQL running locally.

```bash
# 1. Database
psql -U postgres -c "CREATE DATABASE collab_editor;"

# 2. Backend
cd server
cp .env.example .env   # fill in DATABASE_URL and a JWT_SECRET
npm install
npm run migrate
npm run dev             # http://localhost:4000

# 3. Frontend (separate terminal)
cd client
npm install
npm run dev              # http://localhost:5173
```

## Running the E2E tests

```bash
cd client
npx playwright install chromium   # first time only
```

In one terminal (rate limiting disabled so the suite's own user registrations don't trip it):
```bash
cd server
NODE_ENV=test npm run dev
```

In another terminal:
```bash
cd client
npm run dev
```

Then:
```bash
cd client
npm run test:e2e
```

## Tech stack

- **Frontend:** React, TypeScript, Monaco Editor, Y.js, Socket.io-client
- **Backend:** Node.js, Express, Socket.io, Y.js, y-protocols
- **Database:** PostgreSQL
- **Testing:** Playwright (E2E)
