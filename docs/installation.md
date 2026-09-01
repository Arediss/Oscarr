# Installation Guide

The recommended way to run Oscarr is with Docker — see the README's *Quick Start* section. This document covers the manual install for development or bare-metal production.

## Prerequisites

- Node.js 20+
- npm 9+
- A media server (Plex, Jellyfin, or Emby — optional, can be added later)
- A TMDB API key (optional — a built-in read-access token is provided)

## Installation

```bash
git clone https://github.com/arediss/Oscarr.git
cd Oscarr/app
npm install --legacy-peer-deps
```

## Configuration

Create a `.env` file at `app/.env`. `OSCARR_SECRET_KEY`, `JWT_SECRET` and `SETUP_SECRET` are
required — Oscarr refuses to start on a placeholder or a value under 16 characters. Generate them
with `openssl rand -hex 32` for the first and `openssl rand -base64 32` for the other two:

```env
OSCARR_SECRET_KEY=
JWT_SECRET=
SETUP_SECRET=
DATABASE_URL=file:./dev.db
PORT=3456
FRONTEND_URL=http://localhost:5173

# Optional
# TMDB_API_TOKEN=your_own_key
# OSCARR_BLOCK_PRIVATE_SERVICES=true
# OSCARR_PLUGINS_DIR=/custom/plugins
# FORCE_HTTPS=true
# TRUST_PROXY=172.18.0.0/16   # proxy IP/CIDR — unset means X-Forwarded-* is ignored
# VAPID_PUBLIC_KEY=…
# VAPID_PRIVATE_KEY=…
# VAPID_SUBJECT=mailto:admin@example.com
```

Generate `OSCARR_SECRET_KEY` (32-byte hex):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> Lose `OSCARR_SECRET_KEY` and stored service credentials become unrecoverable — back it up like a password.

## Database

```bash
npm run db:generate
npm run db:migrate
```

Migrations also run automatically at every backend boot.

## Development

```bash
npm run dev
```

Starts the frontend (`:5173`) and backend (`:3456`) concurrently.

## Production

```bash
npm run build
NODE_ENV=production node packages/backend/dist/index.js
```

## First launch

Open the app and follow the setup wizard — create an admin account, connect Radarr/Sonarr and (optionally) a media server, then kick off the first sync. Setup routes unmount automatically once install completes.

## Project structure

```
oscarr/
├── packages/
│   ├── backend/          # Fastify API server
│   │   └── src/
│   │       ├── routes/         # API route modules
│   │       ├── services/       # Business logic (sync, backup, scheduler)
│   │       ├── providers/      # Auth + service providers (radarr, sonarr, plex…)
│   │       ├── plugins/        # Plugin engine (engine, loader, context)
│   │       ├── seerr/          # Seerr-compatible API layer (/api/v1/*)
│   │       ├── notifications/  # Notification registry + providers
│   │       ├── middleware/     # RBAC + auth
│   │       ├── bootstrap/      # Security, routes, plugins, jobs wiring
│   │       └── utils/          # Secrets, SSRF guard, prisma…
│   ├── frontend/         # React SPA
│   │   └── src/
│   │       ├── pages/          # Page components (admin/* included)
│   │       ├── components/     # Shared UI components
│   │       ├── context/        # React contexts
│   │       ├── plugins/        # Frontend plugin system
│   │       └── i18n/           # Translations (EN, FR)
│   └── plugins/          # Drop-in plugin directory
└── package.json          # npm workspace root
```
