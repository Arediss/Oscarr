# Backend audit — duplication & code smells

**Date:** 2026-06-21  
**Scope:** `app/packages/backend/src` (168 files, ~20k LOC)  
**Method:** 18 hunters (10 cross-cutting concerns + 8 subsystems) → consolidation/dedup → adversarial verification of every group (97 agents). Findings with a rejected verdict are excluded.  
**Result:** 78 findings — high: 2, medium: 22, low: 54.  
**By kind:** duplication: 41, smell: 14, inconsistency: 12, risk: 6, dead-code: 5.

> Verified report. `flaggedBy` = how many independent hunters surfaced the issue. Locations are `file:line` relative to `app/packages/backend/src`.

## 🔴 HIGH (2)

### H1. Negative-tmdbId TV placeholder lookup + upgrade reimplemented in 3-4 services with divergent conflict handling
_`duplication` · flaggedBy 4_

**Locations:** `services/mediaService.ts:18`, `services/requestService.ts:53`, `services/sync/keywordSync.ts:122`, `services/sync/mediaSync.ts:145`, `services/sync/mediaSync.ts:326`, `routes/webhooks.ts:116`, `services/mediaService.ts:28`

mediaService.findMediaByExternalId() is the stated canonical 'TV row matches tvdbId OR tmdbId=-tvdbId' lookup, but the placeholder upgrade routine (find {mediaType:tv,tvdbId,tmdbId<0} then upgrade tmdbId in place) is hand-rolled again in requestService, keywordSync, and mediaSync, each handling the unique-(tmdbId,mediaType) conflict differently: findOrCreateMedia returns the placeholder unchanged, keywordSync detects a conflict and bails leaving both rows, mediaSync catches P2002 and merges. Same intent, three behaviors, so placeholders can survive un-merged depending on which path runs first — directly causing the duplicate/orphaned rows the keywordSync comments warn about. The encoding itself (placeholder tmdbId === -tvdbId) is also an implicit convention enforced only by hand across these writers/readers.

**Fix:** Centralize in mediaService: findTvPlaceholder(tvdbId), placeholderTmdbId(tvdbId)=>-tvdbId, isPlaceholder(row), and one upgradeOrMergeTvPlaceholder(tvdbId, realTmdbId, data) owning the merge/conflict policy (mergeIntoCanonical is the most complete). Route requestService, keywordSync, mediaSync and the webhook writers through it.

**Verify:** Reproduced from the actual code in /Users/quentin/Oscarr/app/packages/backend/src.

### H2. View-as-role + hasPermission + owner-scope decision block duplicated verbatim in two RBAC entry points, with a stale-role security drift
_`duplication` · flaggedBy 3_

**Locations:** `middleware/rbac.ts:389`, `middleware/rbac.ts:463`

enforcePluginRoutePermission (389-407) and the main rbacPlugin preHandler (463-476) re-implement the identical sequence: read x-view-as-role, isKnownRole lookup, effectiveRole derivation (only when admin and rule isn't admin.*), then hasPermission + ownerScoped/shouldOwnerScope flag. The two copies already differ in a security-relevant way: the preHandler uses the FRESH DB role (freshRole, line 465) while enforcePluginRoutePermission uses the stale jwtUser.role (line 394) — so a user demoted within the 30s cache window is re-checked against fresh state on core routes but against a stale JWT role on plugin sub-routes. A future tightening can land in one path and silently miss the other.

**Fix:** Extract one authorize(role, rule, viewAsRoleHeader) -> {allowed, ownerScoped} and have both call sites pass their resolved role into it; ensure the plugin path also fetches fresh state so staleness behavior matches the core path.

**Verify:** Both legs of the finding reproduce from the actual code in /Users/quentin/Oscarr/app/packages/backend/src.

## 🟠 MEDIUM (22)

### M1. AppSettings singleton fetch (where:{id:1}) copy-pasted ~54x with no shared accessor; create/update branches drift
_`duplication` · flaggedBy 3_

**Locations:** `services/requestService.ts:200`, `services/requestService.ts:338`, `services/tmdb.ts:34`, `services/folderRules.ts:160`, `services/scheduler.ts:155`, `services/sync/index.ts:11`, `routes/webhooks.ts:34`, `routes/app.ts:70`, `routes/app.ts:94`, `routes/admin/settings.ts:47`, `routes/admin/settings.ts:63`, `routes/admin/settings.ts:121`, `routes/admin/homepage.ts:32`, `routes/admin/dashboard.ts:99`, `routes/admin/setupChecklist.ts:17`, `routes/admin/sync.ts:11`, `routes/admin/plex.ts:25`, `routes/admin/services/webhooks.ts:58`, `utils/safeNotify.ts:17`, `notifications/registry.ts:83`

The AppSettings row is a hardcoded singleton (id:1) read/written ~54 times across the backend (34 reads service-wide + ~30 admin write sites) with no core helper. Every write re-types the create:{id:1,...,updatedAt} boilerplate, and the create-on-miss/upsert idiom drifts: settings.ts:63 does findUnique-then-create, dashboard.ts:99 upsert with empty create, and settings.ts PUT omits nsfwBlurEnabled and siteUrl from its create branch while including them in update — so a brand-new settings row silently loses those two fields. Read shapes are also inconsistent (app.ts:94 fetches the whole row to read one column vs webhooks.ts:34 which selects only apiKey).

**Fix:** Add utils/appSettings.ts exporting getAppSettings(select?) (find-or-create id:1) and patchAppSettings(partial) (upsert deriving the create payload from the same partial). Replace all inline access; this also fixes the create-branch field omissions in settings.ts PUT.

**Verify:** Reproduced every sub-claim from the actual code.

### M2. Seerr mediaRequest include graph (media+seasons / user+providers / approvedBy+providers) duplicated across 5 sites and drops seasons on 2
_`duplication` · flaggedBy 3_

**Locations:** `seerr/routes/request.ts:30`, `seerr/routes/request.ts:137`, `seerr/routes/request.ts:175`, `seerr/routes/user.ts:93`, `seerr/adapters/media.ts:9`

The include graph {media:{include:{seasons:{select:{statusCategory:true}}}}, user:{include:{providers:true}}, approvedBy:{include:{providers:true}}} feeding buildSeerrRequest is repeated for every read. The GET list keeps seasons but the POST /request read-back (request.ts:138) and GET /request/:id (request.ts:176) use media:true with NO seasons — and buildSeerrMedia->resolveSeerrMediaStatus needs media.seasons to emit PARTIALLY_AVAILABLE(4). So the same TV request reports a different mediaInfo.status depending on which endpoint a client hits: a real Overseerr-contract divergence, not cosmetic.

**Fix:** Export a SEERR_REQUEST_INCLUDE const (Prisma.MediaRequestInclude) next to buildSeerrRequest and reuse it at all read sites including the POST read-back and GET /request/:id so the adapter always receives the same shape.

**Verify:** Reproduced from actual code.

### M3. Last-admin lock check duplicated and missing entirely from the danger delete paths
_`duplication` · flaggedBy 1_

**Locations:** `routes/admin/users.ts:210`, `routes/admin/users.ts:257`, `routes/admin/danger.ts:39`, `routes/admin/danger.ts:57`

prisma.user.count({where:{role:'admin',disabled:false}}) <= 1 -> LAST_ADMIN_LOCK is duplicated in the role-change and disable handlers, but the DELETE /danger/users/:id and bulk DELETE /danger/users paths have NO such guard — they only block deleting yourself, so an admin can delete the only other admin (or a purge-all-except-self leaves zero admins). Duplicated-but-incomplete coverage is exactly the gap a shared helper closes.

**Fix:** Add assertNotLastAdmin(targetUserId) used by role-change, disable, and both danger delete routes so 'at least one enabled admin remains' is enforced uniformly.

**Verify:** Both halves of the finding reproduce against the actual code.

### M4. RadarrClient and SonarrClient duplicate ~120 lines (constructor, tags, profiles, root folders, system status, webhook CRUD, 404 guard, history pagination) and already drift
_`duplication` · flaggedBy 3_

**Locations:** `providers/radarr/client.ts:17`, `providers/sonarr/client.ts:17`, `providers/radarr/client.ts:67`, `providers/sonarr/client.ts:107`, `providers/radarr/client.ts:108`, `providers/sonarr/client.ts:142`, `providers/radarr/client.ts:248`, `providers/sonarr/client.ts:354`, `providers/radarr/client.ts:293`, `providers/sonarr/client.ts:398`

Both classes implement ArrClient and share, character-for-character: the constructor (attachAxiosRetry(axios.create({baseURL:`${url}/api/v3`,params:{apikey},timeout:5000}))), getTags/createTag/getOrCreateTag (label normalization oscarr-${username} byte-identical), getQualityProfiles, getRootFolders, getSystemStatus, removeWebhook, checkWebhookExists, the response.status===404 -> null getMediaById guard, the paginated /history loop filtering downloadFolderImported, and the webhook eventType->type map (Download/Grab/Test + fallback). registerWebhook differs only by two event-flag names. Drift already crept in: Radarr pages /history by 1000 while Sonarr pages by 500, and the radarr history catch lost the richer logging sonarr has.

**Fix:** Extract an abstract ArrClientBase holding the api instance, constructor, tag helpers, profiles, rootfolders, system status, webhook remove/exists/typeMap, 404-guarded getById and paginated getHistory; let Radarr/Sonarr override only media-specific mapping and the registerWebhook event-flag object.

**Verify:** Verified every cited claim against the actual source in providers/radarr/client.ts and providers/sonarr/client.ts.

### M5. Single-service lookup (findFirst type+enabled + parseServiceConfig) reimplemented 6+ times, bypassing default-aware getServiceConfig
_`duplication` · flaggedBy 2_

**Locations:** `providers/plex/index.ts:37`, `providers/plex/index.ts:220`, `providers/mediaServerProvider.ts:60`, `plugins/context/v1.ts:265`, `plugins/context/v1.ts:279`, `routes/admin/plex.ts:28`

utils/services.ts exposes getServiceConfig(type) which prefers isDefault then falls back, but plex getPlexToken/resolveMachineId, mediaServerProvider.getConfig, the plugin SDK and admin/plex all hand-roll prisma.service.findFirst({where:{type,enabled:true}}) + parseServiceConfig. So with two enabled Plex/Jellyfin rows these copies pick an arbitrary one while getServiceConfig picks the default — inconsistent service selection plus 6 copies of the parse-with-try/catch boilerplate.

**Fix:** Route all single-service reads through getServiceConfig(type) (or a getDefaultServiceRow helper); reserve raw findFirst for the rare cases that genuinely need the row id.

**Verify:** Reproduced from actual code.

### M6. (err as Error).message -> HTTP-status switch + link-provider creds/pin branch duplicated across auth/user routes
_`duplication` · flaggedBy 2_

**Locations:** `routes/auth.ts:196`, `routes/auth.ts:225`, `routes/auth.ts:269`, `routes/admin/users.ts:53`, `routes/admin/users.ts:83`, `routes/admin/users.ts:125`

Six catch blocks hand-roll `const msg=(err as Error).message; if (msg==='X') return reply.status(...).send({error:'X'}); ... throw err` over the same sentinel set (NO_TOKEN, PIN_INVALID, PROVIDER_ALREADY_LINKED, NOT_CONFIGURED, INVALID_CREDENTIALS...). Worse, the self-link (auth.ts:269) and admin-link (users.ts:125) handlers are near-identical (same creds/pin branch + same catch) differing only in the response body (stable CODE vs human sentence), so fixing one leaves the other behind.

**Fix:** Define a PROVIDER_ERROR_MAP (or throw typed errors the global handler translates) and extract linkProviderToUser(authProvider,{userId,pinId,username,password}) returning a typed result; both routes call it and only format the response.

**Verify:** Verified all six cited locations in the actual source; every line number is accurate.

### M7. DATABASE_URL -> filesystem-path resolution + plugin-data-dir duplicated 3x (two export the same getDbPath name)
_`duplication` · flaggedBy 2_

**Locations:** `utils/dataPath.ts:5`, `services/backupService.ts:41`, `services/supportLegacyExport.ts:78`, `services/supportLegacyExport.ts:61`, `services/supportLegacyExport.ts:88`

The logic DATABASE_URL||'file:../data/oscarr.db' -> replace('file:','') -> resolve against the prisma dir is reimplemented three times; dataPath.ts and backupService.ts both export a function literally named getDbPath, and supportLegacyExport duplicates it as getOscarrDbPath plus rebuilds the prisma dir by hand (dirname(getDataRoot())+'/prisma') and re-derives the plugin data dir instead of pluginDataDirPath(). The 'avoid circular import' comment is stale. Drift means backup/restore and DB-path code disagree on where the DB lives.

**Fix:** Keep one resolver in utils/dataPath.ts (export getDbPath), import it in backupService.ts and supportLegacyExport.ts, and use pluginDataDirPath + the imported BACKEND_PRISMA_DIR; delete the copies.

**Verify:** All claims reproduce from the actual code in /Users/quentin/Oscarr/app/packages/backend/src.

### M8. Install-finalize (markInstalled+initScheduler) duplicated and both copies drop the pluginEngine arg, losing plugin cron jobs
_`duplication` · flaggedBy 1_

**Locations:** `routes/setup.ts:206`, `routes/admin/import.ts:157`, `bootstrap/jobs.ts:9`

setup.ts and import.ts both finalize an install with initScheduler()+markInstalled() (order even differs), but both call initScheduler() with NO pluginEngine, whereas the canonical boot path calls initScheduler(pluginEngine). Per scheduler.ts:170-186, without pluginEngine the plugin job handlers/defs are never seeded — so when an install finalizes and startAllJobs() runs, plugin-contributed cron jobs are silently missing until the next backend restart.

**Fix:** Add one finalizeInstall() helper that imports pluginEngine, calls initScheduler(pluginEngine) then markInstalled() in a fixed order, and have both setup/sync and import/config-execute call it.

**Verify:** Reproduced from actual code.

### M9. Hand-rolled module-level TTL cache re-implemented in 7+ places (+ two arr-client memoizers) with no shared primitive
_`duplication` · flaggedBy 2_

**Locations:** `middleware/rbac.ts:5`, `middleware/rbac.ts:190`, `services/tmdb.ts:23`, `plugins/registry.ts:42`, `routes/admin/homepage.ts:7`, `routes/media.ts:399`, `utils/safeNotify.ts:9`, `providers/index.ts:114`

At least seven independent module-level caches each re-implement fetch-store-with-expiry-then-invalidate with a different timestamp field name and TTL idiom (_userStateCache 30s, roleCache no-TTL, _cachedLangs 5min, registryCache/releaseCache, homepageLayoutCache 60s, nsfwIdsCache 5min, _siteUrl/_instanceLang flags). utils/cache.ts is DB-backed (TMDB) so none reuse it; there is no in-memory TtlCache. Separately getArrClient and getArrClientForService are near-identical configKey-keyed memoizers (createArrClient is a third copy of the create+throw). Every cache ships its own invalidate* export, multiplying the surface where a missed invalidation = stale data.

**Fix:** Add utils/memCache.ts (TtlCache<K,V> / memoizeWithTtl(fetcher,ttl) with get/set/invalidate) and migrate these sites, keeping invalidate* exports as thin wrappers; extract resolveCachedClient(cache,key,type,config) shared by both arr getters.

**Verify:** All eight cited locations reproduce from the actual code:  - middleware/rbac.ts:5 — `_userStateCache = new Map<number,{...; at}>()`, 30s TTL, `invalidateUserStateCache` export.

### M10. parseId->400 then findUnique->404 guard duplicated across ~18 admin handlers with inconsistent error strings
_`duplication` · flaggedBy 1_

**Locations:** `routes/admin/roles.ts:74`, `routes/admin/folderRules.ts:76`, `routes/admin/blacklist.ts:52`, `routes/admin/quality.ts:64`, `routes/admin/services/crud.ts:155`, `routes/admin/services/webhooks.ts:78`, `routes/admin/users.ts:116`, `routes/admin/danger.ts:42`

Nearly every parameterized admin handler opens with `const id=parseId(...); if(!id) return 400 {error:'Invalid ID'}; const row=await prisma.X.findUnique({where:{id}}); if(!row) return 404 {error:'Not found'}`. The error strings are inconsistent ('Invalid ID' vs 'INVALID_ID' vs 'Invalid userId'; 'Not found' vs 'Service not found' vs 'Rule not found'). The dominant admin-CRUD boilerplate.

**Fix:** Add parseIdOr400(reply,raw) and/or findOr404(reply, prisma.model, id, label) returning the row or null-after-reply, and standardize on the structured UPPER_SNAKE codes used elsewhere.

**Verify:** Reproduced from actual code.

### M11. Three independent 'resolve Oscarr's public base URL' implementations; webhook URL built twice inline
_`duplication` · flaggedBy 3_

**Locations:** `utils/publicUrl.ts:15`, `utils/safeNotify.ts:15`, `routes/admin/services/webhooks.ts:92`, `routes/admin/services/webhooks.ts:137`

resolvePublicBaseUrl (OSCARR_PUBLIC_URL -> x-forwarded -> request fallback), getSiteUrl/buildSiteLink (AppSettings.siteUrl -> FRONTEND_URL), and webhooks.ts (settings.siteUrl -> proto+swapLoopbackForLan(host)) are three different precedence rules for one concept, so a deploy behind a proxy can get a different base URL in an OAuth callback vs a notification link vs a webhook URL. The webhook builder block + `${baseUrl.replace(/\/$/,'')}/api/webhooks/${type}` is also duplicated between /webhook/status and /webhook/enable, and OSCARR_PUBLIC_URL is honored by publicUrl but not the webhook builder.

**Fix:** Define one canonical resolver (settings.siteUrl + OSCARR_PUBLIC_URL + x-forwarded in an agreed precedence) consumed by OAuth callbacks, notification links and webhook URLs; add buildWebhookUrl(request,type) used by both webhook handlers.

**Verify:** All factual claims reproduce from the actual code.

### M12. Queue->progress mapping, getSystemStatus probe, and tvdb->tmdb resolution each duplicated across radarr-sonarr endpoints (one is N+1)
_`duplication` · flaggedBy 2_

**Locations:** `routes/radarr-sonarr.ts:33`, `routes/radarr-sonarr.ts:87`, `routes/radarr-sonarr.ts:8`, `routes/radarr-sonarr.ts:107`, `routes/radarr-sonarr.ts:194`, `routes/app.ts:107`

Three transforms are repeated: (1) the queue-record->progress/size/time mapping (progress=size>0?round((size-sizeleft)/size*100):0 plus the inline anonymous cast, the providers already return typed records) is reimplemented 4x; (2) the getArrClient->getSystemStatus->{online,version} probe is written for /radarr/status, /sonarr/status and per-service in /health; (3) tvdbId->tmdbId resolution is batched correctly in /calendar (findMany+Map) but done as a per-record findFirst N+1 inside the /downloads loop.

**Fix:** Add mapArrQueueRecord(raw) (and type ArrClient.getQueue() to the real record type), probeService(type):{online,version?}, and tvdbToTmdbMap(tvdbIds) (the batched version); use them in all sites including /downloads.

**Verify:** All three sub-claims reproduce against the actual code in /Users/quentin/Oscarr/app/packages/backend/src.

### M13. App-version read, GitHub tag normalization, and path-traversal guard each reimplemented across plugin/version sites
_`duplication` · flaggedBy 3_

**Locations:** `services/backupService.ts:13`, `routes/app.ts:13`, `bootstrap/static.ts:6`, `plugins/compat.ts:20`, `plugins/registry.ts:195`, `plugins/routes.ts:232`, `plugins/manifestSchema.ts:7`, `plugins/installer.ts:200`, `plugins/routes.ts:475`

JSON.parse(readFileSync(PROJECT_PACKAGE_JSON)).version is duplicated 4x (a partial getBackupAppVersion exists but isn't the single source), alongside duplicated oscarr_v cookie/version-mismatch logic. tag_name.replace(/^v/i,'') is reimplemented 3x. And plugin-supplied paths are validated for traversal in three places with three subtly different rules (manifestSchema.relativePath, installer tar filter, frontend file server) so guarantees differ (the manifest guard misses a bare '..' mid-segment the installer catches) — security-relevant logic that should be one audited primitive.

**Fix:** Expose one getAppVersion(), one tagToVersion(tag), and one isPathInside(root,candidate)/assertSafeRelative(path); route all version readers, the cookie-mismatch handler, tag normalizers, and the three traversal guards through them.

**Verify:** All four sub-claims reproduce from the actual code.

### M14. linkProvider conflict-check + UserProvider upsert + refreshAvatar block duplicated across plex, media-server, discord
_`duplication` · flaggedBy 1_

**Locations:** `providers/mediaServerProvider.ts:134`, `providers/plex/index.ts:174`, `providers/discord/index.ts:233`

plex and emby/jellyfin both implement the same link flow: findUnique on provider_providerId, throw PROVIDER_ALREADY_LINKED if owned by another user, upsert UserProvider with the same create/update field set, then refreshUserAvatar + logEvent. The discord callback repeats the upsert shape a third time inline. Each copy must remember to re-check the PROVIDER_ALREADY_LINKED contract.

**Fix:** Extract AuthHelpers.linkProvider({provider,providerId,userId,token,username,email,avatar}) used by plex, emby/jellyfin and discord so the conflict check and upsert field set live in one place.

**Verify:** Verified all three cited locations in /Users/quentin/Oscarr/app/packages/backend/src.

### M15. requestCollectionMovie reimplements the create-request pipeline and diverges (no auto-approve, no notifications, no guard, no SEARCHING flip)
_`inconsistency` · flaggedBy 3_

**Locations:** `services/requestService.ts:442`, `services/requestService.ts:307`, `routes/requests/create.ts:64`, `services/requestService.ts:480`

createUserRequest is documented as the single pipeline shared by HTTP + plugin paths (validate -> guard -> blacklist -> findOrCreateMedia -> dedup -> quality gate -> create -> send -> notify). POST /collection instead calls requestCollectionMovie, a parallel reimplementation that does its own blacklist/dedup/findOrCreateMedia/auto-approve/sendToService and notably ignores appSettings.autoApproveRequests (only admins auto-approve), runs no per-movie plugin guard, applies no quality-option logic, emits no safeNotify/safeUserNotify/logEvent, and omits the post-dispatch media->SEARCHING flip. Its dedup also differs (across ALL users, non-transactional, includes 'available') giving a different definition of 'already requested' with a TOCTOU gap the main path closed.

**Fix:** Make requestCollectionMovie delegate to createUserRequest({userId, tmdbId, mediaType:'movie', skipPluginGuard:true}) (guard already run once at the route) so behavior, notifications, auto-approve, dedup and the SEARCHING flip stay consistent.

**Verify:** Verified against the actual code in /Users/quentin/Oscarr/app/packages/backend/src.

### M16. Webhook 'grab' sets media PROCESSING but skips the request cascade that refreshMediaCategory performs
_`inconsistency` · flaggedBy 1_

**Locations:** `routes/webhooks.ts:84`, `services/mediaService.ts:210`

When a Radarr/Sonarr 'grab' webhook arrives the handler updates Media.statusCategory to PROCESSING but never moves the linked approved/failed requests to processing, whereas refreshMediaCategory (the live-check path) calls cascadeRequestsForCategory(media.id,'PROCESSING'). So the same media state produces different request rows depending on whether it was discovered via webhook vs live check, leaving requests stuck at 'approved' while media shows PROCESSING.

**Fix:** After the grab->PROCESSING update in webhooks.ts, call the shared cascadeRequestsForCategory(media.id,'PROCESSING') so webhook and live-check paths converge.

**Verify:** Reproduced directly from the code.

### M17. Three parallel logging sinks with no routing policy, inconsistent domain labels, and debug spam
_`inconsistency` · flaggedBy 3_

**Locations:** `utils/logEvent.ts:20`, `routes/requests/lifecycle.ts:47`, `services/requestStatusTransition.ts:38`, `plugins/engine.ts:54`, `utils/safeNotify.ts:65`

Errors land in three sinks with different durability/visibility: logEvent (AppLog DB table, shown in Logs tab), request.log/app.log (pino stdout only), and bare console.* (requestStatusTransition, engine, secrets — nowhere persistent). Within one lifecycle handler both are used (status-flip failure via request.log.warn invisible to admins, success via logEvent). logEvent('debug',...) also always console.logs even when DEBUG_LOGS is off while never persisting, so production stdout is permanently noisy. The logEvent label for the notification/event domain is also spelled 4 ways ('Notif'/'Notification'/'UserNotification'/'PluginEvent' vs 'EventBus'), defeating filtering.

**Fix:** Document one policy (logEvent for admin-visible, request.log for HTTP noise), convert the admin-relevant console.*/request.log error sites to logEvent, gate the debug console.log behind DEBUG_LOGS, and define a small const of canonical log labels.

**Verify:** All sub-claims reproduce from the actual code.

### M18. Import preview/execute fetch a user-supplied URL with no SSRF guard, unlike the config-probe/execute siblings
_`risk` · flaggedBy 1_

**Locations:** `routes/admin/import.ts:54`, `routes/admin/import.ts:68`, `routes/admin/import.ts:116`, `routes/admin/import.ts:139`, `importers/seerr.ts:65`

In the same file, /import/config-probe and /import/config-execute call assertPublicUrl(url) before touching the source, but /import/preview and /import/execute call preview()/execute() — which fetch the admin-supplied url via seerrFetch (no internal guard) — with NO SSRF check. An admin (or anything reaching the admin RBAC tier) can point the importer at http://169.254.169.254/ or internal services and exfiltrate responses. The guarded siblings prove the project treats this URL as untrusted; preview/execute are the gap.

**Fix:** Call the shared SSRF guard helper at the top of the preview and execute handlers (before pickAdapter/preview/execute), and add the guard inside seerrFetch as defense in depth.

**Verify:** Reproduced from the actual code.

### M19. Plugin update uninstalls (rm -rf dir + wipes data dir) before the new version is proven loadable
_`risk` · flaggedBy 1_

**Locations:** `plugins/routes.ts:337`, `plugins/engine.ts:427`, `plugins/engine.ts:430`

POST /:id/update resolves the URL (good) but then runs uninstall(id) BEFORE performInstall. uninstall() rm -rf's the plugin dir AND rmPluginDataDir (wiping KV + SQLite). If performInstall then fails (download blip, bad tarball, incompat manifest, id mismatch) the plugin is gone WITH its data and the admin must reinstall from scratch; the code comment acknowledges 'no stale-version rollback' but the silent loss of the data dir is sharper than implied.

**Fix:** Download+extract+parse the new tarball into a staging dir and validate id/compat BEFORE uninstalling; only swap once known-good, and do not delete the data dir on the update path — only on a true uninstall.

**Verify:** Reproduced directly from the cited code.

### M20. Magic-string error codes ('AUTH_FAILED' etc.) are the only undocumented contract between provider test() and classifyTestError; qbittorrent mislabels 5xx
_`smell` · flaggedBy 2_

**Locations:** `utils/serviceTestError.ts:36`, `providers/qbittorrent/index.ts:26`, `providers/sabnzbd/index.ts:31`, `providers/deluge/index.ts:47`, `providers/nzbget/index.ts:32`

classifyTestError matches err.message==='AUTH_FAILED'/'AUTH_BANNED'/'AUTH_NO_SESSION'/'DELUGE_DAEMON_DETACHED' but providers signal these by throwing free-form string Errors across six files with no shared enum, so a typo silently degrades to UNKNOWN with no compile-time check. qbittorrent compounds it: validateStatus:()=>true then maps every non-200 (incl. 502/503) to AUTH_FAILED, so an upstream-5xx is reported as 'bad API key' (other providers use validateStatus:(s)=>s===200 so a 5xx throws and classifies correctly).

**Fix:** Export the auth-error codes as named constants / a custom Error subclass from serviceTestError.ts and have providers throw those; fix qbittorrent to validateStatus:(s)=>s===200 so non-2xx classifies correctly.

**Verify:** All claims reproduced from actual code.

### M21. Admin route permissions live in a separate exact-match map; unlisted routes silently fall through to admin.*
_`smell` · flaggedBy 1_

**Locations:** `middleware/rbac.ts:152`, `middleware/rbac.ts:170`, `routes/admin/index.ts:27`

Admin permissions are an exact-match METHOD:url ROUTE_PERMISSIONS map decoupled from handlers. Granular perms (admin.roles/plugins/danger) are enforced only because someone remembered the exact key; any admin route NOT listed falls through to PREFIX_DEFAULTS /api/admin->admin.*. Invisible coupling: adding a DELETE under /api/admin/roles without an entry quietly requires admin.* instead of admin.roles, widening/narrowing access with no compile-time signal, and keys must match Fastify's parameterized URLs char-for-char.

**Fix:** Co-locate the permission with the route ({config:{permission:'admin.roles'}} read in the hook via request.routeOptions.config), or add a startup assertion that every registered /api/admin route has an explicit ROUTE_PERMISSIONS entry.

**Verify:** Reproduced from actual code.

### M22. Channel providers reimplement media-label + banner special-case with hardcoded French, bypassing the i18n template system
_`smell` · flaggedBy 3_

**Locations:** `notifications/providers/discord.ts:5`, `notifications/providers/telegram.ts:4`, `notifications/providers/email.ts:8`, `services/sync/helpers.ts:48`

discord.buildDescription/telegram.buildText/email.buildHtml each special-case payload.type==='incident_banner', compute mediaType==='movie'?'Film':'Series', and append username identically, with hardcoded French labels ('Film','Series','Voir dans Oscarr') even though the in-app bell goes through renderNotificationTemplate + locale machinery. The media_available web-push body/title are also hardcoded English while the bell entry for the same event is translated — non-English instances get a translated bell and an English push.

**Fix:** Add formatNotificationParts(payload,lang) (title/body/mediaLabel/link, incident handling) resolving via the existing template/locale machinery; each provider maps the parts into its transport shape, and route the push title/body through the same path.

**Verify:** All sub-claims reproduce from the actual code.

## 🟡 LOW (54)

### L1. config.baseUrl fallback in plugin SDK getServiceConfig is dead — no provider stores baseUrl
_`dead-code` · flaggedBy 1_

**Locations:** `plugins/context/v1.ts:272`

`return {url: config.url || config.baseUrl, apiKey: config.apiKey}` — a grep of every provider's fields[] shows no service declares a baseUrl config key (all use url), so the || config.baseUrl branch can never fire. It is dead and misleads plugin authors into thinking baseUrl is supported (the only baseUrl in code is a derived OUTPUT field in the Seerr settings adapter).

**Fix:** Drop || config.baseUrl; return {url: config.url, apiKey: config.apiKey}.

### L2. pluginEventBus.emit() never rejects, yet 2 callers add an unreachable, mislabeled .catch
_`dead-code` · flaggedBy 1_

**Locations:** `plugins/eventBus.ts:41`, `services/sync/helpers.ts:44`, `utils/safeNotify.ts:82`

emit() wraps every handler in try/catch and logs 'Handler for X threw' itself, so the returned Promise resolves void and can never reject. The two callers chain .catch(err=>logEvent('error',...,`Subscriber of X threw`)) which is unreachable for handler errors and would double-log if it fired; the messages also lie (in safeNotify the catch only guards getInstanceLanguage, which itself never rejects).

**Fix:** Drop the redundant .catch in helpers.ts:44 and safeNotify.ts:82-85; rely on emit()'s internal logging. If guarding the async language resolution, keep one catch but relabel it accurately.

### L3. utils/batch.ts chunk() is entirely unused while keywordSync hand-rolls the same loop
_`dead-code` · flaggedBy 2_

**Locations:** `utils/batch.ts:2`, `services/sync/keywordSync.ts:53`

chunk<T>(arr,size=500) is imported by nobody (rg returns zero hits), yet keywordSync.ts:53 hand-rolls `for (let i=0;i<arr.length;i+=BATCH_SIZE){const batch=arr.slice(i,i+BATCH_SIZE)...}` — exactly what chunk() provides. The helper's stated purpose (stay under SQLite's 999-param limit) means a real bulk-insert path may be silently passing oversized arrays to Prisma.

**Fix:** Use chunk() in keywordSync (and confirm the 999-param limit is handled in bulk-insert paths); otherwise the file is dead and should be deleted.

### L4. NotificationRegistry exposes 5 never-called public methods; v1.1 'stubs' comment is stale
_`dead-code` · flaggedBy 2_

**Locations:** `notifications/registry.ts:26`, `notifications/registry.ts:43`, `notifications/registry.ts:53`, `plugins/context/v1.ts:352`

unregisterProvider, getProvider, registerEventType (singular), getEventType and getAllEventTypes are never called outside registry.ts (cleanup goes through removeAllForPlugin, registration through registerEventTypes plural, dispatch reads this.eventTypes directly). Separately the v1.1 'stubs filled in by subsequent phase commits ... Stubs throw' comment block in context/v1.ts:352 is stale — the methods that follow (getArrClients, tmdb.*, media.*, requests.*, internalFetch) are all fully implemented, misleading readers into thinking the section is unfinished.

**Fix:** Delete the unused registry methods (or mark @internal) and inline registerEventType into the plural loop; delete the stale 'stubs' comment block.

### L5. now_playing region derived from an already-region-stripped lang; _lastUsedQueue stores an unread timestamp
_`dead-code` · flaggedBy 2_

**Locations:** `routes/tmdb/list.ts:46`, `routes/tmdb/helpers.ts:24`, `middleware/userApiKeyAuth.ts:7`

getLang() already returns only the primary subtag ('en','fr'), so /movies/now_playing's region: lang.split('-')[0]?.toUpperCase()||'US' just uppercases the language code (en->EN, which is not an ISO 3166-1 country), making the TMDB region filter wrong/no-op for most locales — dead split logic on a stale assumption. Separately _lastUsedQueue is Map<number,number> and writes Date.now() per id, but flushLastUsed only reads .keys() and stamps a single flush-time Date, so the stored value is never read (a Set would express the intent).

**Fix:** Derive region from the raw Accept-Language region subtag (or a configured default) and drop the no-op split; change _lastUsedQueue to a Set<number>.

### L6. "Mark COMPLETABLE requests as available" cascade re-implemented in 5+ places despite cascadeRequestsForCategory existing
_`duplication` · flaggedBy 2_

**Locations:** `services/mediaService.ts:139`, `services/sync/mediaSync.ts:226`, `services/sync/mediaSync.ts:278`, `services/sync/helpers.ts:25`, `services/requestService.ts:496`, `routes/media.ts:186`

The exact updateMany({where:{mediaId,status:{in:COMPLETABLE_REQUEST_STATUSES}},data:{status:'available'}}) write is hand-rolled in mediaService.cascadeRequestsForCategory, twice in mediaSync (applyUpdate + mergeIntoCanonical), in helpers' notification query, in requestService.promoteStaleStatuses, and mirrored in-memory in routes/media.ts. The canonical helper exists but is not reused. A change to which statuses complete (or adding a transition log) must be edited in 5+ spots or they silently drift.

**Fix:** Export cascadeRequestsForCategory from mediaService (accepting an optional Prisma tx) and call it from mediaSync.applyUpdate/mergeIntoCanonical and requestService.promoteStaleStatuses; have routes/media.ts reuse a shared in-memory projection helper.

### L7. Request-event notification ritual (link + channel + bell + log) duplicated across 3 sites with copy-pasted metadata shape
_`duplication` · flaggedBy 2_

**Locations:** `services/requestService.ts:406`, `routes/requests/lifecycle.ts:62`, `routes/requests/lifecycle.ts:97`, `services/sync/helpers.ts:31`

Each request lifecycle event repeats the same 4-step ritual: buildSiteLink(`/${mediaType}/${tmdbId}`), safeNotify(type,{title,mediaType,username,posterPath,url}), safeUserNotify(userId,{type,title,message,metadata:{mediaId,tmdbId,mediaType,msgParams:{title}}}), then logEvent. The safeUserNotify metadata shape is copy-pasted verbatim in request_approved/declined/media_available — drift between these payloads is exactly how channels and the in-app bell end up showing different data for the same event. The admin/requester fan-out loop (findMany role=admin -> per-user safeUserNotify) is also hand-rolled in two of these sites.

**Fix:** Add notifyRequestEvent(kind,{media,mediaType,username,userId}) that builds the link, fires both safeNotify and safeUserNotify with the canonical metadata shape, and logs once; add safeUserNotifyMany(userIds,...) + getActiveAdminIds(excludeUserId?) for the fan-out. Call from all three sites.

### L8. SSRF-guard try/catch -> URL_BLOCKED_BY_SSRF_GUARD 400 boilerplate copy-pasted across 7 route sites; setup.ts already drifted
_`duplication` · flaggedBy 3_

**Locations:** `routes/admin/import.ts:118`, `routes/admin/import.ts:138`, `routes/admin/services/crud.ts:118`, `routes/admin/services/crud.ts:173`, `routes/admin/services/crud.ts:231`, `routes/admin/services/helpers.ts:68`, `routes/setup.ts:108`

The idiom try { await assertPublicUrl(url) } catch (err) { if (err instanceof SsrfBlockedError) return reply.status(400).send({error:'URL_BLOCKED_BY_SSRF_GUARD',detail:err.message}); throw err } is copy-pasted in 7 places. Any change to the SSRF error contract must be made 7 times, and setup.ts:111 already drifts: it uses bare err.message without the instanceof SsrfBlockedError narrowing the others use, and a new write path can simply forget the guard.

**Fix:** Add guardUrl(url) in utils/ssrfGuard.ts whose SsrfBlockedError the global setErrorHandler maps to 400 + URL_BLOCKED_BY_SSRF_GUARD (or a guardPublicUrl(reply,url) helper), and call it everywhere.

### L9. clampInt helper + pageInfo envelope copy-pasted verbatim in 4 seerr route files
_`duplication` · flaggedBy 4_

**Locations:** `seerr/routes/user.ts:125`, `seerr/routes/media.ts:92`, `seerr/routes/request.ts:191`, `seerr/routes/search.ts:55`, `seerr/routes/user.ts:43`, `seerr/routes/media.ts:34`, `seerr/routes/request.ts:47`

The identical 4-line clampInt(raw,fallback,min,max) is defined byte-for-byte in four seerr files, and the pageInfo envelope {pages:Math.max(1,Math.ceil(total/take)), pageSize:take, results:total, page:Math.floor(skip/take)+1} is hand-built identically in four list handlers. utils/params.ts already owns pagination helpers (parsePage) but stops short of a clamp, so each route re-rolled its own; a wrong edit in one (e.g. forgetting Math.max(1,...)) diverges the Seerr-compat contract per-endpoint.

**Fix:** Hoist clampInt into utils/params.ts (or seerr/pagination.ts), add buildSeerrPageInfo(take,skip,total) and a paginated(...) wrapper, and use across all four routes; delete the local copies.

### L10. countRequestsPerUser groupBy helper duplicated byte-for-byte in user.ts and request.ts
_`duplication` · flaggedBy 2_

**Locations:** `seerr/routes/user.ts:131`, `seerr/routes/request.ts:202`

The same async function (prisma.mediaRequest.groupBy by userId where in -> Map) exists in both seerr/routes/user.ts and request.ts. user.ts even dynamically imports buildSeerrRequest from request.ts yet re-declares this helper instead of sharing — a clear sign the request adapter scaffolding wants its own module. One copy diverging gives inconsistent request-count badges across endpoints.

**Fix:** Promote countRequestsPerUser next to buildSeerrRequest (seerr/adapters/request.ts or a seerr util) and import it in both routes.

### L11. Positive-int ID validation re-implemented ~24x with two idioms and two error codes instead of using parseId()
_`duplication` · flaggedBy 4_

**Locations:** `seerr/routes/user.ts:59`, `seerr/routes/media.ts:47`, `seerr/routes/request.ts:171`, `seerr/routes/settings.ts:165`, `seerr/routes/movieTv.ts:19`, `routes/admin/apiKeys.ts:45`, `routes/requests/lifecycle.ts:20`, `routes/admin/services/crud.ts:155`, `routes/tmdb/details.ts:19`, `utils/params.ts:1`

utils/params.ts:parseId already does Number.parseInt + NaN/<1 guard returning null, used ~24x in routes/ as `const x = parseId(...); if (!x) return 400 {error:'Invalid ID'}`. The whole seerr layer (which never imports utils/params) and admin/apiKeys instead inline `Number(x); if (!Number.isInteger(x)||x<1) return 400 {error:'INVALID_ID'}` ~13x. Two parsers for one job (Number vs Number.parseInt differ on '12.0'/'0x0c'/' 12 ') and two error codes for the identical failure; movieTv even emits INVALID_ID for a param named tmdbId.

**Fix:** Provide one parseIdParam(request, reply, key) (or a preHandler) returning the id or having sent the canonical 400, and use it in both routes/ and seerr/; standardize the error body.

### L12. Three parallel create-request body validators (core validateRequestBody, seerr inline, collection inline) that can diverge
_`duplication` · flaggedBy 1_

**Locations:** `services/requestService.ts:19`, `seerr/routes/request.ts:74`, `routes/requests/create.ts:60`

validateRequestBody() validates {tmdbId,mediaType,seasons} for core POST /requests. The Seerr POST /request re-implements the same logic inline (positive-int tmdbId, mediaType in {movie,tv}, seasons.filter(Number.isInteger)), and the collection route hand-rolls typeof x!=='number' || !Number.isFinite || <1. Three encodings of 'valid positive media id' that already differ (seerr allows season>=0, core allows any finite number).

**Fix:** Have seerr/routes/request.ts map its payload and call the shared validateRequestBody; extract the positive-int check into a parsePositiveInt helper reused by the collection route.

### L13. getArrClient().method()/catch -> 502 'Unable to reach <service>' repeated per *arr endpoint with competing implementations
_`duplication` · flaggedBy 1_

**Locations:** `routes/admin/services/helpers.ts:86`, `routes/admin/services/helpers.ts:136`, `routes/admin/services/helpers.ts:161`, `routes/media.ts:355`, `routes/admin/services/crud.ts:247`, `routes/setup.ts:122`

profiles/rootfolders endpoints each repeat try{const c=await getArrClient(type); return await c.getX()}catch{return reply.status(502).send({error:'Unable to reach Radarr/Sonarr'})}, and the :id variants re-implement the err.message.includes('does not support client creation')->400 branch twice. Inconsistency: media.ts:358 hardcodes 'Unable to reach Sonarr' while crud.ts:247 and setup.ts funnel the identical failure through classifyTestError for a structured code+detail. At least two competing implementations of the 'reach an *arr or 502' path.

**Fix:** Add withArrClient(type, fn, reply) (or route everything through classifyTestError) so the 502 body and the 'does not support client creation'->400 branch live in one place.

### L14. request.user cast to ad-hoc {id}/{id,role} shape in ~38 sites instead of the typed augmentation or one helper
_`duplication` · flaggedBy 2_

**Locations:** `routes/requests/lifecycle.ts:19`, `routes/requests/list.ts:29`, `routes/requests/create.ts:30`, `routes/notifications.ts:21`, `routes/auth.ts:261`, `routes/admin/users.ts:48`, `routes/admin/danger.ts:45`, `routes/admin/apiKeys.ts:15`, `routes/admin/services/helpers.ts:19`, `middleware/userApiKeyAuth.ts:57`, `seerr/routes/request.ts:95`

types/fastify.d.ts already augments request.user as {id,email,role}, yet ~38 sites cast it to a narrower ad-hoc literal (mostly as {id:number}, sometimes with role, once optional at media.ts/app.ts) while ~5 others read .id directly with no cast. The casts add no safety and the divergence (cast vs no-cast, with-role vs without, optional vs not) means there's no single answer to 'is the user present here'. Root cause: the API-key auth path writes request.user via an unknown-cast (userApiKeyAuth.ts:57), a second producer of the same field with no shared contract.

**Fix:** Define one AuthUser type, type both the JWT augmentation and authenticateUserApiKey against it, expose setAuthUser(request,user) used by both auth paths, and replace casts with getAuthUserId(request)/getOptionalAuthUserId(request).

### L15. owner-scope enforcement and 'cannot act on own account' self-guard reimplemented per handler with inconsistent codes
_`duplication` · flaggedBy 2_

**Locations:** `routes/requests/list.ts:38`, `routes/requests/list.ts:91`, `routes/requests/lifecycle.ts:141`, `routes/admin/users.ts:207`, `routes/admin/users.ts:247`, `routes/admin/danger.ts:46`

RBAC sets request.ownerScoped but each handler re-implements what it means: list.ts turns it into where.userId filters two different ways while lifecycle.ts:141 does a post-fetch 403 (the only path that fetches-then-checks, giving a 404-vs-403 oracle difference). Separately the self-guard (block admin demoting/disabling/deleting self) is hand-written 3x with inconsistent comparisons and codes (CANNOT_DEMOTE_SELF vs 'You cannot disable your own account' vs 'Cannot delete your own account'). Easy to omit on a future destructive route, silently leaking rows or allowing self-lockout.

**Fix:** Add ownerWhere(request,userId) + assertOwnsOr403(request,ownerId,actorId) for owner scoping and guardNotSelf(request,targetUserId) returning one canonical code; route all sites through them.

### L16. 'if non-admin, run request.create plugin guard' copy-pasted across 3 request entry points with divergent shapes
_`duplication` · flaggedBy 3_

**Locations:** `routes/requests/create.ts:64`, `routes/requests/maintenance.ts:30`, `services/requestService.ts:322`

The gate if (user.role!=='admin'){ runGuards('request.create',uid); if blocked -> 4xx } is reimplemented in the collection route, search-missing (via a local runPluginGuard wrapper that wraps nothing), and inside createUserRequest, with different status fallbacks (403 vs guardResult.statusCode||403) and different context payloads passed to runGuards (createUserRequest passes a request context, the routes don't). The collection route runs the guard once for the whole collection while per-movie create re-runs it inside createUserRequest, so semantics can drift.

**Fix:** Expose one assertRequestGuard(reply,user) (or always funnel through createUserRequest) and delete the inline copies; pass the request context consistently.

### L17. Provider HTTP boilerplate (trim URL, timeout, validateStatus, magic-string auth throw) reimplemented per provider with no base client
_`duplication` · flaggedBy 4_

**Locations:** `providers/qbittorrent/index.ts:15`, `providers/sabnzbd/index.ts:16`, `providers/deluge/index.ts:16`, `providers/transmission/index.ts:18`, `providers/nzbget/index.ts:17`, `providers/prowlarr/index.ts:16`, `providers/jackett/index.ts:15`, `providers/radarr/index.ts:18`, `providers/tautulli/client.ts:16`, `providers/plex/index.ts:28`

Every download-client/indexer/media-server provider hand-rolls the same shape: config.url?.replace(/\/+$/,'') trailing-slash trim, a hardcoded timeout (5000 vs 10000 across providers), a validateStatus closure, then throws Error('AUTH_FAILED'). radarr/sonarr use config.url||'' with NO trim and plex uses /\/$/ (single slash) so http://host// normalizes differently per provider. None go through a shared base client so timeout/normalization/retry are inconsistent.

**Fix:** Add createHttpClient(url,{timeout,apiKeyHeader,retry}) (+ a trimTrailingSlash/normalizeServiceUrl util using greedy /\/+$/) that normalizes once, sets a single default timeout, and optionally attaches attachAxiosRetry; have every provider call it.

### L18. Plex.tv X-Plex-* headers + seerr fetch wrappers reimplemented per call with drifted values
_`duplication` · flaggedBy 2_

**Locations:** `providers/plex/client.ts:43`, `providers/plex/client.ts:82`, `providers/plex/index.ts:10`, `importers/seerr.ts:60`, `importers/seerrConfig.ts:57`, `seerr/routes/settings.ts:59`

Each plex.tv function inlines the X-Plex-Client-Identifier/Product/Version bag with subtly different values (clientId arg in create/checkPin vs literal 'oscarr-client' elsewhere; Product/Version present in some, omitted in others), and PLEX_CLIENT_ID='oscarr-client' is separately defined in plex/index.ts:10, drifted from the literals. Separately two near-identical Seerr fetch wrappers (seerrFetch throwing vs getJson returning null) each redefine trim()+X-Api-Key headers + a private SeerrStatus type.

**Fix:** Create one plexTvClient (axios baseURL https://plex.tv + buildPlexHeaders(token,clientId)) and one importers/seerrClient.ts (trimBase + seerrGet/tryGet + shared SeerrStatus); route all callers through them; import PLEX_CLIENT_ID instead of re-typing the literal.

### L19. Plugin-ownership tracking + removeAllForPlugin cleanup re-implemented across 3 registries; disable/uninstall teardown also duplicated
_`duplication` · flaggedBy 2_

**Locations:** `notifications/registry.ts:19`, `plugins/eventBus.ts:15`, `middleware/rbac.ts:247`, `plugins/engine.ts:414`, `plugins/engine.ts:486`

Three subsystems each maintain a Map<pluginId, owned-collection>, populate on register, and expose removeAllForPlugin that iterates the owned set and drops the key (Set<providerId> / Array<{event,handler}> / Set<routeKey> + a separately-cleaned pluginPermissions array). Identical bookkeeping where one subsystem forgetting a secondary structure causes a zombie-handler leak after uninstall. Separately the 5-step teardown (routers.delete, unregisterPluginRbac, eventBus.removeAllForPlugin, notificationRegistry.removeAllForPlugin, closePluginStorage) is written twice (uninstall does all five; togglePlugin(false) splits them), so a future 6th resource can be added to one and forgotten in the other.

**Fix:** Introduce OwnershipIndex<TItem> backing all three registries, and extract private teardownLiveResources(id) running all five drops in a fixed order, called by both uninstall() and togglePlugin's disable branch.

### L20. TMDB details dispatch, tvdbId resolution, discover path/date-fields, and poster URL each inlined 3-5x despite helpers existing
_`duplication` · flaggedBy 5_

**Locations:** `services/requestService.ts:45`, `services/sync/keywordSync.ts:58`, `services/mediaService.ts:34`, `services/tmdb.ts:311`, `routes/tmdb/discover.ts:121`, `notifications/providers/discord.ts:27`, `notifications/providers/email.ts:13`, `services/sync/helpers.ts:57`, `utils/tmdbDiscoverQuery.ts:19`, `utils/mediaKey.ts:3`

Four TMDB idioms are each scattered: (1) `mediaType ? getMovieDetails : getTvDetails` dispatch re-inlined 4x with no getDetailsByType helper; (2) resolveTvdbId() exists but external_ids?.tvdb_id is re-derived inline in 4 spots (one with a needless dynamic import in performLiveCheck); (3) dateFieldsFor() and the discover path/'/discover/movie' selection re-written 3x; (4) the TMDB poster URL https://image.tmdb.org/t/p/w{NNN} is hand-built in 3 notification paths with inconsistent widths (w200 vs w185). mediaKey() is also re-inlined in search.ts (twice) and plugins/context. Each change must touch every copy.

**Fix:** Add getDetailsByType(mediaType,id,lang) and discoverPathFor(mediaType) to services/tmdb.ts, route the four external_ids sites through resolveTvdbId(), reuse dateFieldsFor()/mediaKey(), and add tmdbPosterUrl(path,size='w185') used by all notification + sync sites.

### L21. Timing-safe AppSettings.apiKey verification duplicated across two routes, with an over-fetch inconsistency
_`duplication` · flaggedBy 2_

**Locations:** `routes/app.ts:94`, `routes/webhooks.ts:34`

Both endpoints repeat fetch appSettings.apiKey, Buffer.from(provided)/Buffer.from(stored), length check + crypto.timingSafeEqual, 403 on mismatch. Security-critical code copy-pasted is exactly where you don't want drift, and they already diverge: app.ts findUnique fetches the full row (the secret apiKey into memory unnecessarily) while webhooks.ts narrows with select:{apiKey:true}. utils centralizes the user API-key path but not the admin/global one.

**Fix:** Extract verifyAdminApiKey(provided):Promise<boolean> (or a preHandler) loading only {apiKey} and running the timing-safe compare; call from both routes.

### L22. Admin password re-auth block and password-field masking/MASK constant each duplicated across two security-sensitive sites
_`duplication` · flaggedBy 2_

**Locations:** `routes/admin/backup.ts:140`, `routes/admin/services/crud.ts:83`, `routes/admin/services/crud.ts:11`, `routes/admin/authProviders.ts:17`

Backup-restore and service-config-reveal repeat the exact re-auth sequence (cast user, findUnique passwordHash, 400 ADMIN_HAS_NO_PASSWORD, verifyPassword, warn+401 INVALID_PASSWORD) differing only in the log label. Separately MASK='__MASKED__' and the password-masking loop are byte-identical in maskServiceConfig (crud.ts) and maskPasswords (authProviders.ts), as is the companion drop-unknown-keys/skip-MASK-on-write merge. Two copies of security-sensitive re-auth and secret-redaction that can drift (one gets a new secret field type, the other doesn't).

**Fix:** Extract requireAdminPassword(request,reply,password,logLabel) and a shared utils/secretMask.ts (MASK, maskSecretFields(schema,config), mergeRedactedPatch(schema,stored,patch)); consume from both sites.

### L23. ArrMediaItem->Season row mapping repeated 4x; TMDB-sourced create path uses a different episode-count field
_`duplication` · flaggedBy 2_

**Locations:** `services/sync/mediaSync.ts:94`, `services/sync/mediaSync.ts:206`, `services/sync/mediaSync.ts:249`, `routes/webhooks.ts:135`, `services/requestService.ts:94`

seasons.filter(s=>s.seasonNumber>0).map(s=>({mediaId,seasonNumber,episodeCount,statusCategory})) is duplicated 4x against *arr items (episodeCount=s.totalEpisodeCount). requestService.findOrCreateMedia builds the same Season rows from TMDB data with episodeCount=s.episode_count and no statusCategory — so the same media's season rows differ depending on whether they were created from TMDB (request flow) or *arr (sync/webhook).

**Fix:** Add buildArrSeasonRows(mediaId, item.seasons) in sync/helpers.ts used by mediaSync + webhooks, and normalize the TMDB-sourced create path to produce equivalent rows.

### L24. Post-sendToService SEARCHING-flip/failed-transition and active-request dedup duplicated and divergent across create/approve/collection
_`duplication` · flaggedBy 2_

**Locations:** `services/requestService.ts:384`, `routes/requests/lifecycle.ts:42`, `services/requestService.ts:480`, `services/requestService.ts:353`, `services/requestService.ts:449`

The post-dispatch bookkeeping (guard statusCategory!==AVAILABLE&&!==PROCESSING -> update media to SEARCHING, on failure transitionRequestStatus(...,'failed','dispatch-failed')) is hand-written in createUserRequest, the approve route, and partially in requestCollectionMovie which omits the SEARCHING flip entirely. Separately the active-request dedup differs: createUserRequest dedups per-(mediaId,userId) in a transaction over ACTIVE_REQUEST_STATUSES while requestCollectionMovie dedups across ALL users non-transactionally including 'available' — two definitions of 'already requested' plus a TOCTOU gap the main path closed.

**Fix:** Extract applyDispatchOutcome(requestId,media,sent) and a shared findActiveRequest(tx,mediaId,userId?,includeAvailable?) with documented semantics; call from all three sites.

### L25. NSFW tmdbId set computed two ways (raw SQL json_each vs JS JSON.parse) that can disagree
_`duplication` · flaggedBy 1_

**Locations:** `routes/media.ts:362`, `routes/tmdb/helpers.ts:33`

GET /media/nsfw-ids builds the NSFW id set via isMatureRating(contentRating) + a $queryRawUnsafe json_each(keywordIds) lookup, while flagNsfwFromDb (used by every tmdb list/discover endpoint) computes the SAME 'is this media NSFW' answer via prisma keyword.findMany + JSON.parse(row.keywordIds) + Set membership. Two independent implementations of one rule (mature rating OR nsfw-tagged keyword) that can disagree, one SQL one JS, with different cache layers (5min in-memory vs background hydration).

**Fix:** Extract one isNsfwMedia(row, nsfwKeywordSet) predicate and one keyword-set loader; have both endpoints consume it (pick SQL or JS consistently).

### L26. getUserTagName fallback (displayName||email||user-<id>) and slugify normalization re-inlined despite helpers existing
_`duplication` · flaggedBy 2_

**Locations:** `services/requestService.ts:117`, `services/requestService.ts:523`, `routes/requests/lifecycle.ts:37`, `providers/radarr/client.ts:78`, `providers/mediaServerProvider.ts:23`

getUserTagName(userId) is the canonical helper but retryFailedRequests and the approve handler re-inline displayName||email||`user-${id}` off an already-loaded relation, so the *arr tag rule lives in three places. Separately the slug normalization name.toLowerCase().replaceAll(/[^a-z0-9-]/g,'') (arr tag label) and the /[^a-z0-9]/ synthEmail variant are inlined three times with no slugify helper.

**Fix:** Make getUserTagName accept either an id or a loaded {displayName,email,id}; add utils/slugify(s,{allowDash}) used for the arr tag label and synthetic-email local part.

### L27. Calendar inlines poster extraction (different output) and arr audio/sub language split duplicated, bypassing shared helpers
_`duplication` · flaggedBy 2_

**Locations:** `routes/radarr-sonarr.ts:213`, `providers/types.ts:136`, `providers/radarr/client.ts:204`, `providers/sonarr/client.ts:276`, `utils/languages.ts:25`

providers/types.ts exports extractImageFromArr(images,'poster') used by both arr clients, but /calendar inlines `images?.find(i=>i.coverType==='poster')?.remoteUrl||null` twice — and behaves differently: extractImageFromArr strips the /t/p/<size> prefix to a relative path while the calendar copies return the full remoteUrl, so the same poster is represented two ways per endpoint. Separately both arr clients parse mediaInfo audioLanguages/subtitles by splitting on '/' (radarr keeps all, sonarr adds a 50%-of-files threshold) while utils/languages.ts already has a '/'-aware splitter neither reuses.

**Fix:** Use extractImageFromArr in the calendar mappers; extract parseArrLanguages(raw) shared by both clients with the Sonarr frequency threshold as a thin wrapper.

### L28. runNewMediaSync and runFullSync are near-identical bodies differing only by the `since` argument
_`duplication` · flaggedBy 1_

**Locations:** `services/sync/index.ts:10`, `services/sync/index.ts:25`

Both functions do sequential syncArrService('radarr',X) then ('sonarr',Y), then syncAvailabilityDates(Z), then fold avail.*Updated into the results; full-sync passes null everywhere while incremental passes per-service lastSync + an earliest-sync. The duplicated fold-and-return scaffolding will drift if a third service or result field is added — only the `since` derivation actually differs.

**Fix:** Implement one runSync(mode:'full'|'incremental') computing the since values, keeping the two exports as thin wrappers.

### L29. Keyword upsert + NSFW auto-tag loop duplicated between batch sync and on-view tracking
_`duplication` · flaggedBy 1_

**Locations:** `services/sync/keywordSync.ts:15`, `services/sync/keywordSync.ts:105`

upsertKeywordsAndRating and trackKeywordsFromDetails both run the identical for(kw){autoTag=AUTO_NSFW_KEYWORDS.has(...); prisma.keyword.upsert(...)} block then write keywordIds/contentRating onto the media. Only the media-row write diverges (update by id vs upsert/upgrade placeholder), so a new auto-tag rule or batched upserts must be applied to both ingestion paths.

**Fix:** Extract upsertKeywords(keywords) called by both functions, leaving only the media-row write divergent.

### L30. 'next ordered position' computed three ways (aggregate _max vs count) across roles/quality/folderRules create
_`duplication` · flaggedBy 1_

**Locations:** `routes/admin/roles.ts:41`, `routes/admin/quality.ts:35`, `routes/admin/folderRules.ts:166`

roles.ts and quality.ts both append a new ordered row with aggregate {_max:{position}} then position ?? (max ?? 0)+1, while folderRules uses count() for the same 'next slot' intent — a third spelling of the same ordering semantics.

**Fix:** Add nextPosition(delegate) returning (max ?? 0)+1 and decide on _max vs count consistently for append-at-end.

### L31. instanceLanguages JSON.parse reimplemented 4x; two sites have no try/catch (crash risk on admin-editable field)
_`inconsistency` · flaggedBy 2_

**Locations:** `services/tmdb.ts:34`, `routes/app.ts:135`, `utils/safeNotify.ts:40`, `routes/admin/settings.ts:72`

settings?.instanceLanguages ? JSON.parse(...) : ['en'] lives in 4 places. safeNotify and tmdb each maintain their own module-level cache; safeNotify wraps in try/catch but tmdb.ts and app.ts/features parse raw with no guard. instanceLanguages is admin-editable, so one malformed value crashes TMDB language resolution AND the /features endpoint (whole page fails to mount) while notifications survive — inconsistent failure modes for the same field. Two caches also mean a settings change can flush one and leave the other stale.

**Fix:** Add a single getInstanceLanguages():Promise<string[]> helper (try/catch -> ['en'], plus the 'en' append logic) with one cache; have safeNotify take [0] from it and call it from all four sites.

### L32. `error` field is a stable CODE in most routes but a human sentence in others (native vs Seerr create diverge)
_`inconsistency` · flaggedBy 1_

**Locations:** `routes/requests/create.ts:42`, `services/requestService.ts:283`, `seerr/routes/request.ts:130`, `routes/admin/users.ts:137`, `routes/requests/maintenance.ts:46`

createUserRequest returns both code (stable, e.g. DUPLICATE/INVALID_INPUT) and error (human message). The Seerr route correctly sends {error:result.code, message:result.error}, but native POST /api/requests sends {error:result.error} (create.ts:42) — so the same failure yields a stable code on /api/v1 and a full English sentence on /api/requests. users.ts:137 and maintenance.ts:46 also stuff untranslatable prose into error, which the frontend can't reliably localize.

**Fix:** Make create.ts:42 send {error:result.code, message:result.error} like the Seerr route; standardize on error=stable code, message/detail=human text everywhere.

### L33. attachAxiosRetry applied to only 3 of ~13 axios callers; fetch-based 5xx-to-throw shim duplicated 3x
_`inconsistency` · flaggedBy 2_

**Locations:** `services/tmdb.ts:78`, `providers/radarr/client.ts:18`, `providers/tautulli/client.ts:17`, `providers/mediaServerProvider.ts:26`, `providers/plex/client.ts:16`, `routes/app.ts:33`, `providers/discord/index.ts:189`, `plugins/installer.ts:98`

Only TMDB/Radarr/Sonarr wrap axios in attachAxiosRetry; Tautulli, the Emby/Jellyfin factory, all plex.tv calls and the version-check create plain axios with no retry, so the same transient 5xx is swallowed in some flows and retried in others. Separately, because native fetch resolves on 5xx, three call sites hand-write the same adapter `if (r.status>=500&&<600) throw Object.assign(new Error(...),{response:{status}})` (discord token + discord user + plugin download).

**Fix:** Decide retry policy at the transport layer (base client attaches retry by default, opt-out for security-critical calls), and add fetchRetryable(url,init,opts) in utils/fetchWithRetry.ts that throws a synthetic {response:{status}} on 5xx; replace the three inline shims.

### L34. setup.ts POST /service skips the SSRF guard AND the single-default invariant that crud.ts enforces
_`inconsistency` · flaggedBy 1_

**Locations:** `routes/setup.ts:172`, `routes/admin/services/crud.ts:118`

crud.ts POST /services runs assertPublicUrl(config.url) and clears any existing default (updateMany {isDefault:true}->false) before creating. The setup.ts equivalent does neither: it never validates the URL through the SSRF guard and unconditionally writes isDefault:true, so creating two services of the same type during install leaves two rows flagged default — getServiceConfig's findFirst({isDefault:true}) then returns whichever the DB orders first.

**Fix:** Make both creation paths share one helper that runs the SSRF check + clears prior defaults; or have setup.ts delegate to the same code as crud.ts.

### L35. Overseerr numeric status enum mapped with magic numbers in importer + media filter mappers diverge from statusMap constants
_`inconsistency` · flaggedBy 2_

**Locations:** `importers/seerr.ts:100`, `importers/seerr.ts:107`, `seerr/adapters/statusMap.ts:7`, `seerr/adapters/statusMap.ts:57`, `seerr/routes/media.ts:82`, `seerr/adapters/media.ts:68`

seerr/adapters/statusMap.ts defines SEERR_REQUEST_STATUS / SEERR_MEDIA_STATUS as the single source for the Overseerr enum, but the importer re-encodes the same enum as bare literals (code===1/3, status===5||4) that must stay in sync by hand. Separately filterToWhere (request filters) and mapFilterToOscarrStatus (media filters) are two hand-maintained switches that disagree on what 'pending' means (request:['pending'] vs media:UPCOMING only, dropping SEARCHING), and media.ts:68 hardcodes status4k:1 instead of SEERR_MEDIA_STATUS.UNKNOWN.

**Fix:** Import SEERR_REQUEST_STATUS/SEERR_MEDIA_STATUS into the importer and adapters; co-locate both filter mappers in statusMap.ts and align 'pending' to include UPCOMING+SEARCHING; use the enum for status4k.

### L36. Update preflight uses raw string equality while /updates and runtime-status use semver-aware isUpdateAvailable
_`inconsistency` · flaggedBy 1_

**Locations:** `plugins/routes.ts:233`, `plugins/statusDetection.ts:23`, `plugins/registry.ts:199`

GET /:id/update/preflight gates 'No update available' with latestVersion===plugin.manifest.version (raw compare, only strips leading v), but /updates and list-runtime-status use isUpdateAvailable() (semver.gt). So preflight treats a LOWER latest (downgrade) as an available update (only checks !==) and can disagree with the badge for non-semver tags.

**Fix:** In preflight replace the raw compare with !latestVersion || !isUpdateAvailable(plugin.manifest.version, latestVersion) so all three paths agree.

### L37. encryptServiceConfig gates on key name, decryptServiceConfig does not; undecryptable-secret detection decrypts twice
_`inconsistency` · flaggedBy 2_

**Locations:** `utils/secrets.ts:100`, `utils/secrets.ts:118`, `utils/secrets.ts:139`, `routes/admin/security.ts:34`

encryptServiceConfig only encrypts fields matching SENSITIVE_KEY_RE, but decryptServiceConfig decrypts ANY enc:v1:-prefixed value regardless of key name, while hasUndecryptableSecret/hasPlaintextSecret gate on isSensitiveKey — so a renamed sensitive field can be hidden from the admin security banner (undocumented asymmetry). Separately the security route calls parseServiceConfig (decrypts every field) then hasUndecryptableSecret (decryptFields every sensitive field again, discarding plaintext) — two full AES-GCM passes per service per banner render that can disagree if logic drifts.

**Fix:** Make the three functions agree on one predicate and document which is authoritative; have decryptServiceConfig optionally report failedKeys (single pass) and drive the banner from that.

### L38. arrIdFieldForService hardcodes radarr/sonarr while ArrClient.dbIdField already carries it; externalId selection duplicated 4x
_`inconsistency` · flaggedBy 2_

**Locations:** `providers/index.ts:165`, `providers/types.ts:130`, `services/mediaService.ts:80`, `services/requestService.ts:203`, `services/sync/mediaSync.ts:42`

arrIdFieldForService(type) is a hardcoded if type==='radarr' return 'radarrId' etc., contradicting the data-driven registry design (findServiceTypeForMedia scans handlesMediaTypes precisely to avoid hardcoded lookups), so adding lidarr updates handlesMediaTypes everywhere except here, silently returning null. Relatedly the 'externalId = movie?tmdbId:tvdbId' rule is a bare ternary in 4 sites that already disagree (mediaSync falls back to tmdbId when tvdbId is null; the others don't), so a divergence can send Sonarr a tmdbId.

**Fix:** Derive arrIdFieldForService from the providers' dbIdField (single source with handlesMediaTypes), and add arrExternalId(media) encoding the movie->tmdbId / tv->tvdbId + placeholder rule, called from all four sites.

### L39. contextFor() documented as 'single construction point' but two bootstrap paths build the ctx directly
_`inconsistency` · flaggedBy 1_

**Locations:** `plugins/engine.ts:95`, `plugins/engine.ts:140`, `plugins/engine.ts:602`

contextFor(plugin) is documented as the single construction point and used by 6 call sites, but _loadFromDisk and _registerRoutes build the ctx with createContext(manifest, this.getContextDeps()) directly because they have a manifest-but-not-yet-a-LoadedPlugin. The result is the construction logic exists in 3 spots and the 'single point' comment is false; a future change (per-plugin ctx cache, passing LoadedPlugin into ctx) must touch all three.

**Fix:** Add private contextForManifest(manifest) that both contextFor and the two bootstrap sites call (or have contextFor accept LoadedPlugin | {manifest}); fix the comment.

### L40. plex.ts parses service config with raw JSON.parse, bypassing the decryption helper used everywhere else
_`risk` · flaggedBy 1_

**Locations:** `routes/admin/plex.ts:31`, `utils/services.ts:15`

Every other service-config read goes through parseServiceConfig() which transparently decrypts enc:v1: secret fields. plex.ts:31 instead does JSON.parse(plexService.config) and reads cfg.machineId inside a bare catch that swallows parse errors. It works today only because machineId isn't encrypted, but if machineId (or any field this handler later needs) becomes a secret it will silently read ciphertext, and the empty catch hides config corruption.

**Fix:** Use parseServiceConfig(plexService.config) (or getServiceConfig('plex')) in plex.ts, matching the rest of the codebase.

### L41. blacklist /check feeds an unguarded Number.parseInt(NaN) into a Prisma compound-key lookup
_`risk` · flaggedBy 1_

**Locations:** `routes/admin/blacklist.ts:78`, `routes/admin/keywords.ts:50`

In blacklist /check, tmdbId: Number.parseInt(tmdbId,10) goes straight into findUnique({where:{tmdbId_mediaType:{...}}}) with no NaN guard (the querystring schema declares tmdbId as string), so ?tmdbId=abc produces tmdbId:NaN. keywords.ts:51 does the same parse but DOES guard with if (Number.isNaN(id)) return 400 — inconsistent, and the blacklist path can hit Prisma with NaN.

**Fix:** Guard with parseId/NaN-check before the query in blacklist.ts:78 (mirror keywords.ts) or coerce tmdbId to type:'integer' in the querystring schema.

### L42. Raw String(err) sent to HTTP clients leaks internal error text; plugin handlers also mislabel everything 404
_`risk` · flaggedBy 1_

**Locations:** `plugins/routes.ts:397`, `plugins/routes.ts:412`, `plugins/routes.ts:431`, `plugins/routes.ts:245`, `routes/setup.ts:215`

Plugin toggle/get-settings/update-settings reply {error:String(err)} and label all three 404 regardless of real cause; setup/sync replies {error:'Sync failed', details:String(err)} on 500; plugin import sends `Invalid manifest in ${tag}: ${(err as Error).message}`. String(err) exposes internal messages/paths/types to the API surface, and the blanket 404 misreports server-side failures as not-found.

**Fix:** Return a stable code (PLUGIN_NOT_FOUND vs PLUGIN_TOGGLE_FAILED with proper 404/500) and log the raw error via logEvent; never send String(err) in the body.

### L43. SSRF guard applied to Discord webhook notifications but missing from the dynamic service-webhook send path
_`risk` · flaggedBy 1_

**Locations:** `notifications/providers/discord.ts:26`, `notifications/providers/telegram.ts:34`

Discord's provider calls assertPublicUrl(settings.webhookUrl) before posting, but the protection was added per-provider rather than as a shared outbound-send wrapper (Telegram's host is fixed so lower risk, but any future provider can forget it). The asymmetry means the SSRF protection on admin-supplied URL fields isn't systematic.

**Fix:** Centralize outbound notification posting through one helper that applies assertPublicUrl for any admin-supplied URL field so every provider inherits the guard.

### L44. mediaType membership checked 4+ ways and page-parsing 3+ ways despite VALID_MEDIA_TYPES / parsePage existing
_`smell` · flaggedBy 3_

**Locations:** `utils/params.ts:11`, `routes/tmdb/discover.ts:63`, `routes/tmdb/genres.ts:26`, `seerr/routes/request.ts:74`, `routes/admin/logs.ts:21`, `routes/notifications.ts:23`, `seerr/routes/search.ts:25`

VALID_MEDIA_TYPES=['movie','tv'] exists and is used by requestService, but most routes inline mediaType!=='movie' && !=='tv' (discover adds 'all' in one spot, omits it in another). Likewise parsePage() exists but logs.ts uses Number.parseInt(page||'1',10)||1 (no >0 floor, so page=-5 slips through), notifications adds Math.max(1,...), and seerr uses clampInt — four clamping behaviors for one param.

**Fix:** Export isValidMediaType(x) (and VALID_MEDIA_TYPES_WITH_ALL) and use at every check site; route all page parsing through parsePage() and the shared clampInt for limits.

### L45. Swallowed catches in GET read paths return mixed degradations (200-with-error-key vs empty array vs silent) hiding outages
_`smell` · flaggedBy 1_

**Locations:** `routes/radarr-sonarr.ts:124`, `routes/radarr-sonarr.ts:157`, `routes/radarr-sonarr.ts:231`, `routes/requests/list.ts:134`, `routes/requests/list.ts:149`, `routes/media.ts:357`

Several GET handlers catch broadly and return an empty array / {online:false} / {error:'Unable to retrieve statistics'} — /stats returns a 200 body containing error (clients can't distinguish success by status), /downloads + /calendar log at debug only so a persistent *arr outage is invisible in normal logs, and list.ts:149 swallows a root-folder fetch with no log at all. The mix of degradation conventions makes outages hard to spot.

**Fix:** Pick one degradation convention (e.g. always 200 with {items:[],degraded:true}), log unreachable-service at warn not debug, and never return a 200 whose body carries error.

### L46. _userStateCache and releaseCache grow unbounded — TTL only checked on read, entries never evicted
_`smell` · flaggedBy 1_

**Locations:** `middleware/rbac.ts:5`, `plugins/registry.ts:43`

_userStateCache keeps one entry per userId that ever authenticated; the 30s TTL is only consulted on a subsequent read for that same user and stale entries are overwritten, never deleted. A user who authenticates once and never returns stays for the process lifetime — an unbounded per-user leak. releaseCache has the same shape (one entry per plugin repo ever queried, never pruned). Unlike the service-count-bounded caches these are bounded only by distinct users/repos seen.

**Fix:** Give these caches a max-size or periodic sweep (evict entries older than TTL on the existing flush interval), or fold them into the shared TtlCache with size capping.

### L47. MediaRequest.seasons parsed by one hardened parser but three unguarded JSON.parse copies that can 500 on a bad row
_`smell` · flaggedBy 1_

**Locations:** `seerr/adapters/request.ts:79`, `services/requestService.ts:524`, `routes/requests/lifecycle.ts:36`, `plugins/context/v1.ts:476`

seerr/adapters/request.ts has a hardened parseSeasons() that try/catches, verifies Array, and filters to integers, but the same seasons string is parsed elsewhere with a bare JSON.parse and no guard (requestService.ts:524, lifecycle.ts:36, plugins/context casts straight to number[]). A malformed seasons column is tolerated in the seerr adapter but throws in the plugin/lifecycle paths.

**Fix:** Promote parseSeasons() to a shared util (utils/seasons.ts) and use it everywhere MediaRequest.seasons is read.

### L48. Service-access ctx methods are the only capability-bearing methods not gated by a manifest capability; access-denied throw duplicated
_`smell` · flaggedBy 2_

**Locations:** `plugins/context/v1.ts:256`, `plugins/context/v1.ts:358`, `plugins/context/v1.ts:258`, `plugins/context/v1.ts:362`

Every other ctx method calls req(capability,name), but getArrClient/getServiceConfig/getServiceConfigRaw/getArrClients only call checkServiceAccess() against manifest services[] — there is no capability bucket for 'read a configured service's decrypted apiKey', the one sensitive surface with no entry in the PluginCapability enum (intentional second axis, but easy to miss). The 'not allowed to access service' throw string is also copy-pasted verbatim between getArrClient and getArrClients, while getServiceConfig/Raw translate the same false into return null.

**Fix:** Document explicitly that service access is gated solely by services[] (or add a services:read capability), and add requireServiceAccess(...) helper throwing the shared message used by both getArrClient/getArrClients.

### L49. getServiceConfig immediately followed by getArrClient (which re-reads + re-decrypts the same row) per sync cycle
_`smell` · flaggedBy 2_

**Locations:** `services/sync/mediaSync.ts:16`, `services/sync/availabilitySync.ts:26`, `routes/app.ts:108`

Each call does getServiceConfig(type) purely to null-check, then getArrClient(type) which internally calls getServiceConfig(type) AGAIN and re-parses/decrypts — two identical DB queries + two AES-GCM decrypt passes per service per sync cycle (every 15 min). The arr type list ['radarr','sonarr'] is also hardcoded in several loops rather than derived from the provider registry.

**Fix:** Have getArrClient return null (or a typed 'not configured' result) instead of throwing and drop the pre-check, or pass the already-fetched config into createArrClient; derive the arr-type list from the provider registry.

### L50. 'ombi' is an accepted ImportSource enum/schema value that throws 'not implemented'; preview/execute dedup pipelines diverge
_`smell` · flaggedBy 2_

**Locations:** `importers/types.ts:7`, `routes/admin/import.ts:37`, `importers/runner.ts:66`, `importers/runner.ts:161`

ImportSource includes 'ombi' and the preview/execute request schema advertises it, so clients see Ombi as valid, but pickAdapter throws 'Ombi importer not implemented yet.' and config-execute/probe omit it from their enum — internally inconsistent (preview/execute promise Ombi then 400). Separately preview() and execute() re-implement the same find-or-create + duplicate-skip pipeline divergently (preview dedups on media:{tmdbId,mediaType}, execute on mediaId after creating; execute re-runs the autoMatchUser cascade preview already computed), producing preview/execute count mismatches.

**Fix:** Drop 'ombi' from the type + both schema enums (or surface it as explicit 'coming soon'); factor resolveImportableRequest(request,userResolver) -> {action,media,reason} used by both loops.

### L51. MAX_TAKE/scaffolding diverges per seerr file, season id collisions, lazy dynamic import, untyped where objects
_`smell` · flaggedBy 3_

**Locations:** `seerr/routes/user.ts:6`, `seerr/routes/media.ts:6`, `seerr/adapters/request.ts:61`, `seerr/routes/user.ts:102`, `seerr/routes/media.ts:20`

Several smaller seerr-layer issues: MAX_TAKE is 200 in user routes but 100 in media/request routes (arbitrary per-file divergence); buildSeerrRequest emits seasons as {id:seasonNumber} so season-request ids collide across requests (Overseerr expects a globally-unique SeasonRequest id) and every season inherits the parent status; user.ts uniquely does a lazy `await import('../adapters/request.js')` inside the handler with no circular-dep reason; and media/request list routes build where:Record<string,unknown> discarding Prisma's generated where types so a field typo compiles and fails at runtime.

**Fix:** Define DEFAULT_TAKE/MAX_TAKE once in the shared paging helper; derive a stable synthetic season id (or document non-addressable); static-import buildSeerrRequest; type where objects as Prisma.MediaWhereInput/MediaRequestWhereInput.

### L52. test() success criteria inconsistent: prowlarr/jackett assert app identity, *arr/media-server accept any 200
_`smell` · flaggedBy 1_

**Locations:** `providers/prowlarr/index.ts:30`, `providers/jackett/index.ts:33`, `providers/radarr/index.ts:17`, `providers/mediaServerProvider.ts:235`, `providers/qbittorrent/index.ts:4`

Prowlarr and Jackett assert the response really came from that app (appName==='Prowlarr', server title='Jackett') precisely because *arr share URL/path shapes, but radarr/sonarr trust any 200 from /api/v3/system/status and the media-server factory trusts any /System/Info/Public — so pointing radarr's URL at sonarr (or emby at jellyfin) passes the connection test. Separately qbittorrent is the only download client not marked untested:true yet has no createClient/queue integration, so the flag set is applied inconsistently across the category.

**Fix:** Add an app-identity assertion to the *arr and media-server test()s (appName / MediaBrowser ProductName), and reconcile the untested flags so the category is consistent.

### L53. Three media-fetch endpoints with divergent include shapes; /media/tmdb mutates the prisma result in memory to fake statuses
_`smell` · flaggedBy 2_

**Locations:** `routes/media.ts:25`, `routes/media.ts:78`, `routes/media.ts:112`, `routes/media.ts:182`

GET /media/:id, GET /media/tmdb/:tmdbId/:mediaType, and the list endpoint each query prisma.media with near-identical-but-subtly-different include blocks (requests.include.user select varies; /:id adds approvedBy, the tmdb route omits it), so clients get inconsistent request sub-shapes for the same media. The tmdb route also reassigns media.statusCategory and rewrites media.requests in place (approved/failed->processing, completable->available) purely to shape the response without persisting, hardcoding the status sets inline — a second ad-hoc place where request-status promotion rules live (the real logic is promoteStaleStatuses), so the detail page can show 'available' while the row is 'approved'.

**Fix:** Define shared mediaInclude / mediaDetailInclude consts reused across the three handlers, and compute a derived view field (or persist via the transition helper) instead of mutating the entity; centralize the category->request-status mapping.

### L54. ~53 handlers hand-cast request.params/query instead of using Fastify route generics
_`smell` · flaggedBy 1_

**Locations:** `routes/requests/list.ts:115`, `routes/requests/lifecycle.ts:20`, `routes/admin/services/webhooks.ts:78`, `routes/admin/users.ts:116`

~53 handlers cast request.params as {id:string} / request.query as {...} inline even though sibling handlers in plugins/routes.ts use the typed app.put<{Params:{id:string}}>(...) form. The casts defeat the JSON-schema-derived typing, so a schema/param-name drift compiles fine and only fails at runtime — a mistyped param silently becomes NaN and falls into the generic 'Invalid ID' path rather than a precise error.

**Fix:** Use Fastify route generics (app.get<{Params:...}>) consistently so params are typed from the schema instead of hand-cast.
