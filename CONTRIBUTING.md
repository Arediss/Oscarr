# Contributing to Oscarr

Thanks for wanting to help! This guide covers how to propose a change, what's expected of a PR, and the patterns the codebase relies on.

If you're just looking for the list of people who've worked on Oscarr, see [CONTRIBUTORS.md](./CONTRIBUTORS.md).

## Before you start

- **Issue first for anything non-trivial.** Bug reports, feature requests, architecture questions — open an issue and discuss before writing code. We'd rather align on approach early than have a PR revert at review time.
- **Check existing patterns.** Oscarr leans heavily on a few conventions (provider registry, plugin capability system, `ALL_PROVIDERS` registry, `useModal` hook, `toastApiError`…). Follow the pattern already in the code for the area you touch — don't invent a new one.
- **Respect the plugin / core split.** Core stays generic. Provider-specific logic (Plex, Jellyfin, Emby, Discord…) lives under `packages/backend/src/providers/<id>/`. Plugins are self-contained under `packages/plugins/<id>/`. If you catch yourself adding a provider-specific method to `PluginContext`, stop and rework.

## Using AI

Allowed, and no disclosure ceremony required — but you must understand what you're proposing,
have actually run it, and be willing to maintain it. Review here is one maintainer reading a
diff; it won't verify that your code works. Full details: [`AI_POLICY.md`](./AI_POLICY.md).

## Dev setup

```bash
# From repo root
npm install --legacy-peer-deps
npm run db:migrate
npm run dev
```

- Backend runs on `http://localhost:3001`, frontend on `http://localhost:5173`.
- `SETUP_SECRET` must be set in `.env` before the first install wizard run.
- Prisma schema lives at `packages/backend/prisma/schema.prisma`. After schema changes: `npm run db:migrate:dev --workspace=packages/backend -- --name <description>`.

## Branch + commit

- Work on a feature branch off `main`. Name it `<kind>/<short-topic>` (e.g. `feat/plex-sync-rework`, `fix/csrf-header`, `security/hardening-wave-2`).
- Commit messages follow conventional-ish style — first line is `<kind>(<scope>): <summary>` (e.g. `fix(backup): HMAC-sign archives on create`). No Claude signature in commits.
- Small, focused commits beat one mega-commit. PRs are easier to review when each commit tells a coherent story.

## The PR itself

- **Typecheck must pass** on both workspaces before you push:
  ```bash
  cd packages/backend && npx tsc --noEmit
  cd packages/frontend && npx tsc --noEmit
  ```
- **`npm audit --audit-level=high` should return zero vulnerabilities.** If a new dep pulls in a flagged transitive, add an `overrides` entry in the root `package.json` (see `serialize-javascript` / `follow-redirects` precedent).
- **No patch-on-patch.** If the area you're touching has accumulated fixes-on-fixes, surface it in the PR description and propose a refactor as a follow-up — don't pile another patch on top.
- **Security-sensitive changes** (auth, backup, admin endpoints, plugin capabilities) need a second look. Flag them in the PR description.

## Plugins

- Plugin authoring docs: [`docs/plugins.md`](./docs/plugins.md).
- Plugins declare capabilities in their manifest. The engine's double-gate (capability + services) is enforced at call time, not install — don't try to bypass it.
- Per-plugin Tailwind: use `npm run plugin:add-tailwind -- <plugin-id>` to scaffold the build.

## i18n

- All user-facing strings route through `useTranslation()` / `t()`. French and English are both first-class.
- Backend emits stable `UPPER_SNAKE` error tokens; frontend translates via `translateBackendError(token, fallback)` + `errors.*` keys.
- Plural keys need `_one` / `_other` variants when `{{count}}` is passed.

## Accessibility

- Every modal uses the `useModal` hook (Escape to close, focus-trap, focus return).
- Icon-only buttons carry `aria-label={t('…')}`.
- Form `<label>` elements pair with `<input id={…}>` via `htmlFor`.
- New UI components should meet WCAG AA contrast on `ndp-*` tokens.

## Testing

Oscarr's test suite is nascent. If you're touching a pure function — capability gates, SSRF guards, request-status transitions — land a unit test with the change. Integration tests against the running app are appreciated for any flow that touches the DB.

## Migrations

- Schema migrations via Prisma (`prisma migrate dev --name …`).
- Data fixes go in a seed function, **not** a standalone data-only migration. See [`packages/backend/prisma/README.md`](./packages/backend/prisma/README.md) for the rationale.

## Getting your PR merged

- CI must be green (typecheck + Trivy + CodeQL where applicable).
- Reviewer feedback addressed or discussed.
- No force-push after review starts unless explicitly agreed.
- Squash-merge is the default — keep the first commit's message clean because it becomes the squash message.

## Questions

Open an issue or hop on the [Discord](https://discord.gg/BKMaWhVCRr).
