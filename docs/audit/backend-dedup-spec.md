# Spec — Backend dedup & cleanup refactor

**Date:** 2026-06-21 · **Branch:** feature/centralized-media-states · **Status:** IMPLEMENTED (13 WS done, typecheck clean, uncommitted — pending manual tests + Quentin validation)
**Source:** `docs/audit/backend-dedup-audit-2026-06-21.md` (78 verified findings: 2 HIGH / 22 MEDIUM / 54 LOW).

## Why (rule 5)
The army audit found the same logic mirrored across 3-54 sites and a handful of risky/inconsistent paths. Goal: collapse each duplicated concern into **one master implementation** the rest of the core consumes, remove dead code, and close the correctness/security gaps — without hardcoding any module (services are pluggable).

## Principles applied
1. Reimplement the method cleanly when it's patch-encrusted (no fix-on-fix).
2. One master, zero mirror.
3. Comments: short, useful, English.
4. **No hardcode** — derive from module metadata (e.g. `ArrClient.dbIdField`), never `if service === 'radarr'`.
5. Behaviour-preserving by default; when N copies diverge, converge to the **single correct** behaviour (named per workstream).

## Validation protocol (rule 9) — must run before/at dev
- **Feasibility agent(s):** confirm against the real code that each workstream's master API + call-site migration is feasible and viable (no missing context, no circular import, no type wall).
- **Adversary agent(s) ("méchant"):** try to destroy the spec — find where a converge changes behaviour incorrectly, breaks a caller, races, or misses a site.
- Findings fold back into this spec before/while coding. Breakers (see risk register) get a recap to Quentin first.

---

## Workstreams

### Foundational helpers (high leverage, low risk)
- **WS1 — AppSettings accessor.** New `utils/appSettings.ts`: `getAppSettings(select?)` (find-or-create id:1) + `patchAppSettings(partial)` (upsert deriving create from the same partial). Replaces ~54 inline `where:{id:1}` sites; **fixes** the PUT-settings create branch dropping `nsfwBlurEnabled`/`siteUrl`. Risk: low.
- **WS2 — Single service-config accessor.** Converge all single-service reads onto the default-aware `getServiceConfig`/`getServiceConfigRaw`; delete the 6+ inline `findFirst(type,enabled)+parseServiceConfig`. Fix `routes/admin/plex.ts` raw `JSON.parse` → decrypt helper. **No hardcode.** Risk: low.
- **WS3 — `ttlCache` primitive.** New `utils/ttlCache.ts`: bounded TTL cache (evict on read AND cap size). Replace 7+ hand-rolled module caches + the 2 arr memoizers; fixes `_userStateCache`/`releaseCache` unbounded growth. Risk: low.
- **WS4 — ID parse + 404 guard.** Standardise on `parseId()` + a `findOr404`-style guard; unify the error code. Kills ~18 admin + ~24 seerr inline ID validations (two idioms / two codes today). Risk: low.
- **WS5 — Public base URL.** Single `getPublicBaseUrl()` + `buildWebhookUrl()`; remove the 3 parallel resolvers + the inline webhook-URL build. Risk: low.
- **WS9 — `reachArr` wrapper.** One helper wrapping `getArrClient().<m>()` → 502 "Unable to reach <service>"; remove the per-endpoint copies. Risk: low.
- **WS17 — Dead code.** Wire `utils/batch.ts chunk()` into keywordSync (or delete if truly unused), remove `NotificationRegistry` never-called methods, dead `config.baseUrl` fallback, `_lastUsedQueue`, now_playing region, unreachable `eventBus.emit().catch`. Risk: low.

### Structural dedup (medium)
- **WS6 — `ArrClientBase`.** Extract ~120 shared lines (ctor, tags, profiles, root folders, system status, webhook CRUD) shared by Radarr/Sonarr clients. Keep per-client only what differs. Risk: medium (arr clients).
- **WS7 — Provider HTTP base.** Shared axios scaffolding (URL trim, timeout, validateStatus, retry, auth-error classification via the magic-string codes → a typed enum) for torrent/usenet/arr/media-server. Risk: medium (touches many providers) — phase if needed.
- **WS8 — Seerr route scaffolding.** Shared `clampInt`/`pageInfo`/`countRequestsPerUser`/ID-validation + the mediaRequest include-graph constant; magic numeric statuses → `statusMap` constants. Risk: low-medium.
- **WS10 — Typed `request.user` + route generics.** Fastify type augmentation + `getAuthUser(req)`; remove ~38 ad-hoc casts and migrate ~53 hand-cast params/query to route generics. Risk: low (mechanical, broad).
- **WS13/14 — Request pipeline convergence.** Converge `requestCollectionMovie`, create-request, the cascade (`cascadeRequestsForCategory` everywhere), post-`sendToService` SEARCHING-flip + failed transition, active-request dedup, and the notification ritual (link+channel+bell+log) into canonical `requestService` functions. Risk: medium.
- **WS18 — Misc shared helpers.** `getUserTagName`/slugify, hardened `instanceLanguages` parse (no-crash), one hardened `MediaRequest.seasons` parser used everywhere, **arr id field via `ArrClient.dbIdField`** (kill the hardcoded radarr/sonarr map — rule 4), ArrMediaItem→Season mapping, "next ordered position" helper, password re-auth + MASK helper, plugin ownership/teardown registry, Plex `X-Plex-*` header builder, single NSFW-id source, swallowed-catch policy, error-field-as-stable-code. Risk: low.

### Risks / correctness & security
- **WS15 — SSRF guard helper applied consistently:** import preview/execute, setup `/service`, dynamic service-webhook send. Risk: security.
- **WS16 — Correctness gaps:** last-admin lock on the danger delete paths; plugin update must prove the new version loadable **before** `rm -rf`; webhook `grab` must run the request cascade. Risk: correctness.

### HIGH (behaviour-affecting — adversary agent must pressure-test)
- **WS11 (H2) — RBAC `authorize()` extraction.** One `authorize(role, rule, viewAsRoleHeader) → {allowed, ownerScoped}` used by both `rbac.ts` entry points; align the plugin path to the **fresh** DB role (the core path already does). Behaviour-preserving except the fresh-role alignment (a tightening). Risk: HIGH (auth).
- **WS12 (H1) — TV placeholder merge.** mediaService owns `placeholderTmdbId(tvdbId)=-tvdbId`, `isPlaceholder(row)`, `findTvPlaceholder(tvdbId)`, `upgradeOrMergeTvPlaceholder(tvdbId, realTmdbId, data)` (conflict policy = `mergeIntoCanonical`, the most complete). Route requestService/keywordSync/mediaSync/webhooks through it. Risk: HIGH (data integrity).

## Risk register (rule 6 — recap before dev if breaker)
- WS11 (auth) and WS12 (data merge) are behaviour-affecting. Plan: implement as behaviour-preserving extractions + converge to the named correct behaviour; **not** expected to "totally break the app", so proceed per rule 6 — but they are the adversary agent's priority targets, and the test recap will call them out explicitly.

## Hardening verdicts (2026-06-21 — rule 9: 3 feasibility + 3 adversary agents; 7 blocker / 27 major / 22 minor)
Revised scope per workstream (the naive plan would have broken several things):

- **WS1 AppSettings** — SPLIT: read-only `getAppSettings(select?)` = plain `findUnique`, returns null, **NO create** (~20 null-tolerant readers must not gain a write); `patchAppSettings(partial)` = upsert applying field normalization (siteUrl trim→null, instanceLanguages stringify) in BOTH branches → fixes the create-branch omission.
- **WS2 service-config** — CORE single-service reads ONLY (plex getPlexToken/resolveMachineId, mediaServerProvider.getConfig, admin/plex raw JSON.parse→decrypt). **EXCLUDE the plugin SDK** getServiceConfig/Raw (different ACL-gated, enabled-only contract). Document plex first-enabled→default selection change.
- **WS3 ttlCache** — NARROWED: only the genuinely time-based caches. **EXCLUDE** `_userStateCache` (stale-on-error fail-closed), `roleCache` (load-once/invalidate), arr memoizers (configKey-revalidated). Low value now — optional; do not give them eviction.
- **WS4 id guard** — shared parser = `Number()`+`Number.isInteger` (rejects '12.5'/'1e3'), accepts string|number. **Seerr keeps its UPPER_SNAKE bodies verbatim** (external Overseerr contract); only admin migrates; `findOr404(code, msg?)`.
- **WS5 publicUrl** — `getPublicBaseUrl(request?)` for OAuth/notifications; **KEEP `buildWebhookUrl` separate** with swapLoopbackForLan + siteUrl-first (webhooks are called back by the *arr server → loopback must be swapped; OAuth must NOT).
- **WS6 ArrClientBase** — base = ctor, tags, profiles, rootfolders, systemStatus, removeWebhook, checkWebhookExists, parseWebhookPayload typeMap, `getHistory(pageSize, extraParams)` template. Per-client: getMediaById/queue/mapper, registerWebhook, getWebhookEvents. Preserve Radarr=1000 / Sonarr=500+includeEpisode.
- **WS7 provider HTTP** — SCOPE to `createHttpClient(url,{timeout,retry?})` + `normalizeServiceUrl` (greedy trim, intentional) + typed auth-error enum (replaces magic strings). Leave test()/validateStatus/auth per-provider; retry opt-in (never on POST writes).
- **WS8 seerr** — hoist clampInt + buildSeerrPageInfo + countRequestsPerUser; `SEERR_REQUEST_INCLUDE` at all read sites (NOTE: makes POST/GET /request return partial-TV=4 — observable + intended). Keep MAX_TAKE per-call (don't collapse 200 vs 100).
- **WS9 reachArr** — pure `getArrClient()` sites ONLY. EXCLUDE classifyTestError sites (crud:247, setup:122), the createArrClient+400 "does not support X" branches, and media:355 method-guard.
- **WS10 request.user** — ship BOTH `getAuthUserId` (asserting) + `getOptionalAuthUserId` (nullable: app.ts:76, media.ts:298, admin/index.ts:65) + `setAuthUser` (jwt + userApiKeyAuth producers). Route generics = safe mechanical.
- **WS13/14 request pipeline** — `findActiveRequest(userId?, includeAvailable?)` explicit params; collection keeps cross-user + includeAvailable + AVAILABLE-bail + admin-only auto-approve (pass options, don't silently honor appSettings); export `cascadeRequestsForCategory(mediaId, category, tx?)`.
- **WS15 SSRF** — guard is opt-in (strict mode; default no-op on LAN — don't over-credit). Real gaps: import preview/execute, setup /service, telegram provider. webhook-send is a non-gap.
- **WS16 correctness** — plugin update: split `installPluginFromUrl` into stage+validate then atomic swap; `uninstall(keepData)`/teardownForUpdate so update doesn't wipe the data dir; `assertNotLastAdmin(targetId)` (count enabled admins excluding target) on BOTH danger delete paths.
- **WS17 dead-code** — delete ONLY unregisterProvider/getProvider/getEventType (keep getAllEventTypes + registerEventType, called internally); wire `chunk()` into keywordSync; remove 2 unreachable `emit().catch`. now_playing region = behaviour-change, NOT dead-code (drop the region param instead).
- **WS18 misc** — **dbIdField → move onto static `ServiceDefinition` metadata** so `arrIdFieldForService` derives from the registry (true no-hardcode, rule 4). parseSeasons: keep null-for-movie for the plugin SDK path. getUserTagName/slugify/instanceLanguages helpers OK.

## ⚠️ Breakers needing validation (rule 6) — NOT coded until Quentin OKs
- **WS11 (RBAC)** — aligning the plugin auth path to the **fresh** DB role changes authorization in BOTH directions (demotion removes / promotion grants) within the 30s cache window. Behaviour change on auth → recap.
- **WS12 (TV placeholder merge)** — `mergeIntoCanonical` **silently deletes requests** (data-loss) and `upgradeOrMergeTvPlaceholder` may return a DIFFERENT media id; importer is a caller; centralizing alone doesn't kill dup rows from a null-tvdbId canonical + webhook placeholder. Needs an explicit request-reconciliation policy decision → recap.

## Status & test log (rules 7-8 — filled during/after dev)
| WS | Status | Typecheck | Notes |
|----|--------|-----------|-------|
| WS17 dead-code | ✅ done | ✅ clean | removed 3 dead NotificationRegistry methods (unregisterProvider/getProvider/getEventType); wired `chunk()` into keywordSync (batches indexed, inter-batch delay preserved) |
| WS11 RBAC | ✅ done | ✅ clean | extracted `applyRolePermission` (shared by both entry points); `enforcePluginRoutePermission` now async + fresh DB role (aligned to core path); caller awaits. Quentin OK'd "extract + fresh role". |
| WS18 dbIdField (no-hardcode) | ✅ done | ✅ clean | `dbIdField` moved to static `ServiceDefinition` metadata (radarr/sonarr declare it); `arrIdFieldForService` now derives from the module registry — no `if service===...`. Rule 4. (Other WS18 misc items still pending.) |
| WS1 AppSettings | ✅ done | ✅ clean | `utils/appSettings.ts` (getAppSettings/ensureAppSettings/patchAppSettings); 51 call-sites across 24 files migrated (5-agent parallel + tsc gate). create-branch field-omission bug fixed structurally (create derived from update partial). `updatedAt @updatedAt` confirmed → dropping explicit updatedAt is safe. Note: a few `.update`→upsert conversions make the never-initialised-row edge case create-instead-of-500 (intended). |
| WS8 seerr scaffolding | ✅ done | ✅ clean | `seerr/shared.ts` (clampInt/buildSeerrPageInfo/countRequestsPerUser/SEERR_REQUEST_INCLUDE); 4 routes migrated (4-agent parallel). MAX_TAKE kept per-route. Bonus: unified the 3 request includes onto SEERR_REQUEST_INCLUDE → fetch-by-id now returns partial-TV status like the list (was asymmetric). |
| WS16 correctness | 🟡 partial | ✅ clean | **import SSRF** guard added to /import/preview + /import/execute (matches config-probe). **last-admin on danger delete**: analysed → already covered by the own-account guard + admin-gating (acting admin always survives); only a rare concurrent-delete race remains → skipped (rule 1, no redundant guard). **webhook grab cascade** → ✅ DONE in WS13/14 (grab now flips approved/failed→processing). **plugin update load-before-rm** → deferred (needs stage+validate+atomic-swap restructure of installPluginFromUrl). |
| WS4 id-guard | ✅ done | ✅ clean | Scout found `parseId()` already exists + used everywhere except 2 stragglers (apiKeys.ts, keywords.ts) → migrated those. Did NOT harden parseId to Number()+isInteger (25 callers → behaviour change, rule 1) and did NOT churn the 27 varied error codes. No findOr404 (per-route 404s differ, marginal — rule 1). |
| WS2 service-config | ✅ done | ✅ clean | Only real gap was admin/plex.ts raw `JSON.parse` of service config → switched to `getServiceConfig('plex')` (default-aware + decrypt). admin/security.ts raw parse is intentional (checks encryption state) → left. The 12 other reads already use parseServiceConfig. |
| WS13/14 cascade | ✅ done | ✅ clean | `cascadeRequestsForCategory(mediaId, category, tx?)` exported as the single owner; converged WS12's `cascadeAvailableTx` (2 callers) + mediaSync.applyUpdate inline cascade onto it (removed now-unused imports). **webhook `grab` now cascades approved/failed→processing** (the missing WS16 fix), guarded by !wasProcessing, block rewritten clean (try/catch). promoteStaleStatuses left (bulk cross-media sweep, not a per-media dup). Broader request-pipeline convergence (collection/create/notification ritual) NOT in scope — separate larger refactor. |
| WS6 ArrClientBase | ✅ done + verified | ✅ clean | New `providers/arrClientBase.ts` abstract base holds the 9 identical members (api+ctor, getTags, createTag, getOrCreateTag, getQualityProfiles, getRootFolders, getSystemStatus, removeWebhook, checkWebhookExists — 2 more than the audit's 7). Both clients `extends ArrClientBase implements ArrClient`, ctor → `super(url,apiKey,'Radarr'/'Sonarr')`. Unused imports trimmed. Pure extraction (adversary: safe). Per-client kept: getMediaById/queue/mappers/getHistory(1000 vs 500)/registerWebhook/getWebhookEvents/parseWebhookPayload. |
| WS9 reachArr | ✅ done | ✅ clean | Local `reachArr(reply, serviceType, call)` helper in services/helpers.ts → 4 `/radarr|sonarr/(profiles|rootfolders)` handlers become one-liners; 502 label via `getServiceDefinition().label` (no-hardcode). maintenance.ts EXCLUDED (its catch wraps prisma.update+logEvent+custom message — not a pure reach-arr, rule 1). |
| WS10 typed-user | ✅ done | ✅ clean | `request.user` already globally typed `{id,email,role}` via types/fastify.d.ts → the 38 casts were redundant. Removed 35 across 21 files (4-agent parallel, tsc gate); rbac.ts (2, auth-critical, touched in WS11) left; optional-auth sites (app.ts/media.ts/admin/index.ts) kept their `?.`/`if(!user)` runtime guards. No new accessor helpers needed (augmentation + optional chaining suffice — rule 1). Route-generics churn (~53 param casts) NOT done: type-only, high churn, marginal — rule 1. |
| WS18-misc | ✅ done (partial) | ✅ clean | `parseInstanceLanguages(raw)` added to utils/appSettings.ts (safe, never-throws) → deduped + hardened the 4 raw `JSON.parse(instanceLanguages)` sites (tmdb, app /features, safeNotify, GET /settings — the last 3 could crash on malformed JSON). dbIdField already done earlier. SKIPPED (rule 1): seasons parser (3 sites, our own always-valid JSON, marginal), slugify (2 sites are different concerns: oscarr-tag keeps hyphens vs synth-email strips them), getUserTagName (single owner already). |
| WS7 createHttpClient | descoped | | Post-WS6 the arr HTTP construction is unified in ArrClientBase. The remaining providers (torrent/usenet/media-server/plex) use deliberately different per-call HTTP shapes (validateStatus quirks, CSRF dance, X-Plex/X-Emby headers, xml vs json) — a generic createHttpClient would lose clarity, not dedup. Auth-error magic strings are already centralized as the `TestErrorCode` union + the string→message map in classifyTestError; a parallel const map is churn for marginal typo-safety. Not a real dedup (rule 1). |
| WS16 plugin-update load-before-rm | deferred | | Needs a real restructure of `installPluginFromUrl` (stage to temp dir → validate loadable → atomic swap; `uninstall(keepData)`/teardownForUpdate so update doesn't wipe the data dir). Behaviour-affecting + larger than a dedup — warrants its own focused pass + adversary verify. Not started. |
| WS10 route-generics (~53 param casts) | descoped | | Type-only, high churn, marginal benefit — the `request.body/params/query as {...}` casts are localized and harmless. Rule 1. |
| WS3 ttlCache | descoped | | not true TTL caches (stale-on-error / load-once / configKey-revalidated) — forcing a shared primitive would break them |
| WS5 publicUrl | descoped | | 3 genuinely-distinct concerns (request-origin OAuth / configured siteUrl notifs / webhook loopback-swap) — not real duplication; merging would add complexity (rule 1) |
| WS12 placeholder | ✅ done + verified | ✅ clean | Single owner in mediaService (`findTvPlaceholder`/`isTmdbMediaTypeConflict`/`mergeTvPlaceholderInto`/`upgradeOrMergeTvPlaceholder`). Routed requestService (was crash), keywordSync (was leave-both), mediaSync (reused its proven merge). 2-agent verify: correctness=safe. Adversary fixes applied: per-user dedup now keeps the **most-advanced** request (was arbitrary), `tvdbId` copied onto canonical on merge, debug log restored. |

### Tests to perform (rule 7)
Backend `tsc --noEmit` is green after every workstream (type-only WS — WS10 — fully gated by it). Manual/behaviour checks, by risk:

**Behaviour-affecting (check these first):**
1. **WS11 RBAC (auth)** — log in as admin, then as a non-admin (e.g. `user`/`requester`): confirm admin-only routes 403 for the non-admin and 200 for admin. Demote a user from admin→user in another session and confirm their next admin call is refused **within the cache window** (now uses fresh DB role on the plugin route path too). Plugin routes with a permission still enforce it. The `x-view-as-role` admin simulation header still downgrades correctly.
2. **WS12 TV placeholder merge** — request a TV show that exists only as a sync-created `-tvdbId` placeholder, then have it resolve a real tmdbId (sync/keyword/request). Confirm: one canonical row survives, no duplicate requests, and when a user had a request on BOTH the placeholder and canonical, the **most-advanced** one is kept (available > processing > approved > pending > failed > declined). Importer path (Overseerr import) still links TV correctly.
3. **WS13/14 cascade + webhook grab** — trigger a Radarr/Sonarr **grab** webhook for a media with approved/failed requests: those requests should flip to **processing** (new behaviour; previously the media went PROCESSING but requests didn't). Media becoming AVAILABLE (sync or webhook) still cascades requests → available. No double-cascade if already processing.
4. **WS8 seerr partial-TV** — fetch a partially-available TV request via `GET /api/v1/request/:id` and `POST /api/v1/request` read-back (not just the list): `media.status` should now reflect partial availability (4) consistently with the list endpoint.
5. **WS2 plex** — `DELETE /admin/plex/shared/:userId` still resolves the Plex machineId (now via decrypt-aware `getServiceConfig('plex')`).
6. **WS1 AppSettings** — save settings (PUT /admin/settings) incl. `siteUrl`/`nsfwBlurEnabled` then GET them back; first-run with no row creates one with all fields (create-branch omission bug fixed). GET /settings still returns `instanceLanguages` as an array.

**Lower-risk (smoke):**
7. **WS6 ArrClientBase** — quality-profiles / root-folders pickers in the admin Service modal load (Radarr + Sonarr); webhook register/remove still works; library sync + availability still classify states.
8. **WS9 reachArr** — `/admin/radarr|sonarr/profiles|rootfolders` return data when the service is up and a 502 "Unable to reach <Label>" when it's down.
9. **WS16 SSRF** — with `OSCARR_BLOCK_PRIVATE_SERVICES=true`, `/admin/import/preview` + `/import/execute` reject a private/loopback URL (`URL_BLOCKED_BY_SSRF_GUARD`); default (off) unchanged.
10. **WS4/WS10** — admin id-param routes still 400 on bad ids; authenticated routes still read the user correctly (cast removal is type-only).

Optional: a backend boot smoke (`npm run dev` in packages/backend) to catch any runtime import-cycle regression from the cascade export, then a Playwright pass over the admin Services modal + a TV request flow.

### Results (rule 8)
**Implemented + `tsc --noEmit` clean (backend), uncommitted on `feature/centralized-media-states`:**
WS17, WS11, WS12 (2-agent verified + hardened), WS18-dbIdField, WS1 (51 sites), WS8 (+include unification), WS16-SSRF, WS4, WS2, WS13/14 (cascade master + webhook grab), WS6 (adversary: safe), WS9, WS10 (35 casts), WS18-instanceLanguages. = **13 workstreams implemented + 2 sub-fixes**, each typecheck-gated; WS12 and WS6 additionally adversary-verified.

**Descoped after analysis (not real duplication / rule 1):** WS3 ttlCache, WS5 publicUrl, WS7 createHttpClient, WS10 route-generics, WS18 seasons-parser + slugify, WS16 last-admin (already covered by own-account guard + admin gating).

**Deferred (needs its own focused pass):** WS16 plugin-update load-before-rm (atomic stage→validate→swap restructure).

**Not yet run:** manual/behaviour tests above; backend boot smoke; Playwright. No commit made (awaiting Quentin's validation per project rule).
