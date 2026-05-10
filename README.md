<p align="center">
  <img src="docs/logo.png" width="120" alt="Oscarr" />
</p>

<h1 align="center">Oscarr</h1>

<p align="center">
  A modern, self-hosted media request &amp; management platform.
  <br />
  Radarr &amp; Sonarr are the source of truth. Oscarr is the interface.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.8.1-6366f1?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs Welcome" />
  <a href="https://discord.gg/BKMaWhVCRr"><img src="https://img.shields.io/badge/Discord-join-5865F2?style=flat-square&amp;logo=discord&amp;logoColor=white" alt="Discord" /></a>
  <br />
  <a href="https://sonarcloud.io/summary/overall?id=arediss_Oscarr"><img src="https://sonarcloud.io/api/project_badges/measure?project=arediss_Oscarr&amp;metric=alert_status" alt="Quality Gate" /></a>
  <a href="https://sonarcloud.io/summary/overall?id=arediss_Oscarr"><img src="https://sonarcloud.io/api/project_badges/measure?project=arediss_Oscarr&amp;metric=security_rating" alt="Security Rating" /></a>
  <a href="https://sonarcloud.io/summary/overall?id=arediss_Oscarr"><img src="https://sonarcloud.io/api/project_badges/measure?project=arediss_Oscarr&amp;metric=reliability_rating" alt="Reliability Rating" /></a>
  <a href="https://sonarcloud.io/summary/overall?id=arediss_Oscarr"><img src="https://sonarcloud.io/api/project_badges/measure?project=arediss_Oscarr&amp;metric=sqale_rating" alt="Maintainability Rating" /></a>
</p>

<p align="center">
  <img src="docs/preview.jpg" alt="Oscarr Preview" width="900" />
</p>

<p align="center">
  <a href="#the-idea">The idea</a> &middot;
  <a href="#core-capabilities">Core capabilities</a> &middot;
  <a href="#seerr-compatible-api">Seerr API</a> &middot;
  <a href="#installation">Installation</a> &middot;
  <a href="#plugins">Plugins</a> &middot;
  <a href="#contributing">Contributing</a>
</p>

---

**Oscarr** is a lightweight, plugin-first media request interface for **Radarr** and **Sonarr**.

It gives your users a clean way to request movies and shows without exposing the *arr admin panels. Authentication, routing, quality, notifications, and a polished UI are baked into the core — the rest grows through plugins.

If Seerr / Overseerr / Jellyseerr already fits your setup, keep using it. Oscarr is for people who want something more modular, hackable, and easier to extend around their own stack.

---

## The idea

Oscarr sits on top of your existing media stack.

- Your users get a simple request interface.
- Your Radarr/Sonarr instances stay central to the request, download, and import workflow.
- Your setup grows through plugins instead of stuffing every feature into the core.

The philosophy:

- keep the core lean;
- avoid the "all-in-one" trap;
- let plugins handle specific integrations and custom workflows;
- make the app easy to self-host, customise, and extend.

---

## Core capabilities

What ships in the core, no plugin needed:

- **Multi-instance Radarr & Sonarr** with priority-based folder rules (genre, language, country, user, role, keyword tag) so a 4K library, an anime Sonarr and a regional Radarr coexist naturally.
- **Quality selection for users** — SD / HD / 4K / 4K HDR mapped to specific *arr profiles per service, with role-based gating.
- **Multi-provider auth** — Email + password, Plex OAuth, Jellyfin, Emby, Discord. Each provider toggleable independently.
- **AES-256-GCM encryption at rest** for stored service credentials. Master key derived from the `OSCARR_SECRET_KEY` env var via HKDF-SHA256.
- **Per-app API keys** with revocation (Admin → Access → API Keys) so each external integration gets its own scoped credential.
- **Seerr-compatible API** at `/api/v1/*` so existing Seerr-aware tools can talk to Oscarr without a custom integration. See below.
- **Customisable admin dashboard** with drag-and-drop widgets and multi-tab layout.
- **Notification matrix** (Discord, Telegram, Email) per event type, plus VAPID web push.
- **Backups** with HMAC-signed archives and a re-auth gate before restore.
- **i18n** — EN + FR shipped, more locales contribution-friendly.
- **PWA** — installable, offline-tolerant.

---

## Seerr-compatible API

Oscarr exposes an experimental **Seerr-compatible API layer** at `/api/v1/*`, so third-party tools that already speak Overseerr / Jellyseerr / Seerr can point to Oscarr **without** waiting for a native Oscarr integration.

Tested clients:

- **Homarr** (dashboard widget integration)
- **Doplarr** (Discord request bot)

Each external app gets its own revokable API key from *Admin → Access → API Keys*. Endpoints not yet implemented return a clean `501 Not Implemented` so clients degrade gracefully instead of hanging.

> Compatibility is best-effort and limited to the endpoints third-party clients commonly call (status, auth/me, search, request, media, movie/tv, settings, user). Oscarr is **not affiliated** with Overseerr, Jellyseerr or Seerr — this is interoperability, not a clone.

---

## Installation

### Quick Start with Docker

Generate a secret key (32-byte hex) — keep it safe, lose it = stored credentials unrecoverable:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```yaml
services:
  oscarr:
    image: ghcr.io/arediss/oscarr:latest
    container_name: oscarr
    restart: unless-stopped
    network_mode: host
    volumes:
      - oscarr-data:/data
    environment:
      - JWT_SECRET=your_random_jwt_secret
      - OSCARR_SECRET_KEY=your_64_hex_chars_key

volumes:
  oscarr-data:
```

```bash
docker compose up -d
```

Open `http://localhost:3456` and follow the setup wizard.

> `network_mode: host` lets Oscarr reach Radarr/Sonarr/Plex on the local network. If `OSCARR_SECRET_KEY` is missing or malformed, the container exits at boot with a friendly message + a freshly-generated key you can copy-paste.
>
> **macOS Docker Desktop caveat:** containers can't reach LAN IPs even with `--network host`. Use [Colima](https://github.com/abiosoft/colima) locally, or deploy to a Linux host for end-to-end testing.

### Manual / development install

See [`docs/installation.md`](docs/installation.md) for bare-metal, dev mode, full env-var reference, and the project structure walkthrough.

---

## Plugins

Plugins are optional. The base app works out of the box: connect Radarr/Sonarr, configure your users, request media.

Plugins exist so Oscarr can grow around your own setup — think browser extensions: install what you need, ignore the rest.

### Featured plugins

| Plugin | What it does |
|---|---|
| **Leonarr** | Discord bridge: link accounts, search TMDB, submit requests with slash commands, DMs when media is ready. |
| **Subscription** | Per-user subscription tiers with automatic role changes and expiration notifications. |
| **Communication** | Broadcast markdown announcements with scheduled publishing, role targeting, severity levels. |
| **qBittorrent Manager** | View qBittorrent queue and transfer stats inside Oscarr. |
| **Radarr Manager** | Library browser, quality monitoring, releases, analytics, file management. |
| **Sonarr Manager** | Series browser, season/episode drill-down, releases, analytics, file management. |
| **Support** | Ticket system extracted from the core in 0.8.0 — users open tickets, admins reply. |

Discover and install from *Admin → Plugins → Discover*. Each install shows the manifest's requested capabilities so you can review what the plugin is allowed to do.

Building a plugin? See [`docs/plugins.md`](docs/plugins.md).

---

## Verifying image provenance

Published `ghcr.io/arediss/oscarr` images are keyless-signed by the GitHub Actions release workflow (Sigstore / cosign). Each signed manifest also carries an SPDX SBOM.

```bash
cosign verify ghcr.io/arediss/oscarr:latest \
  --certificate-identity-regexp 'https://github.com/arediss/Oscarr/.github/workflows/release.yml@.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Any image without a valid signature from this workflow is not an official Oscarr release.

---

## Contributing

Contributions welcome — bug reports, features, plugins, real-stack testing.

Before opening a large PR, please open an issue first so we can discuss the direction.

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — dev setup, conventions, PR expectations
- [`CONTRIBUTORS.md`](CONTRIBUTORS.md) — everyone who's shipped code to Oscarr

> **Development workflow** — This project uses [Claude Code](https://claude.com/claude-code) as a dev assistant for code reviews, security audits, brainstorming, documentation, and issue/PR management. All architecture decisions and implementation are made by the maintainers — Claude serves as a quality and productivity tool, much like a linter or a CI pipeline.

---

## License

MIT
