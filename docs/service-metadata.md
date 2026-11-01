# Service metadata

TMDB supplies discovery, trends, popular titles, recommendations and supplementary credits/trailers.
Configured media services supply primary detail metadata and the native TV season/episode
catalogue. Sonarr and Radarr implement the optional `ArrClient.lookupMetadata` capability.
Reading a catalogue never adds a title to a service.

## Identity and ownership

- A linked media uses its owning instance. An unavailable instance is never replaced by another
  instance just because it has the same local media ID.
- Discovered series are resolved by the applicable routing rules/default service. A TMDB ID is
  sufficient for Sonarr lookup: `series/lookup?term=tmdb:<id>`. A result must match that TMDB ID
  and carry a positive TVDB ID. Missing/cached-null TMDB external IDs do not block this lookup.
- Requests resolve missing TVDB IDs on the actual routed target and persist verified mappings.
  No-match, ambiguous, invalid and unavailable responses fail without adding another title.
- A season number belongs to a numbering scheme. TMDB and Sonarr episodes are never joined by
  season/episode integers. Selected seasons are checked against the target service before writes.
  `MediaRequest.seasonNumbering` preserves that scheme through approval and retry. Legacy null
  selections have unknown provenance and must be selected again; approval/retry cannot silently
  treat their old TMDB integers as TVDB seasons. Whole-series requests remain compatible.

## Cache and fallback

Metadata is cached persistently per instance URL, provider and global media identity, fresh for
60 seconds and retained for 30 days. Simultaneous reads share one in-flight fetch. During an
outage the last native catalogue is marked stale. A linked series with no cached catalogue shows
an unavailable state rather than replacing its numbering with TMDB's. TMDB remains the fallback
for discovery without a supported service. Untracked Sonarr lookup supplies seasons, but its
public API does not supply their full episode catalogue until the series has been added.

## Validation

Regression coverage includes Pokémon's 20 native seasons versus 25 TMDB seasons; issue #237's
missing TVDB mapping; mismatched identities; multiple instances; source changes; cached outages;
season selection on approval/retry; and movies served through Radarr metadata.

The schema migration is additive and nullable. Rolling back application code can leave the new
column in place; no production data needs to be removed.

## API

- `GET /api/media/:mediaType/:id/metadata` returns `ServiceMetadata | null`, with TMDB IDs in the
  URL. `refresh=true` bypasses the fresh cache but retains explicitly stale data on outage.
- `GET /api/media/tv/:id/seasons` returns the native `SeriesCatalog | null` projection.
- `GET /api/media/tv/:id/seasons/:seasonNumber/episodes?source=<token>` binds episode reads to
  the displayed instance and numbering. Changed source tokens return 409.
- Scoped TV requests carry `seasonNumbering` from the catalogue. The core API, plugin context
  and Seerr-compatible endpoint accept this additional field. Legacy callers omitting it can
  still request whole series; scoped requests remain pending/failed rather than dispatching an
  unverified numbering scheme. They must be selected again from the native catalogue.
- Download rows include `serviceId` and `seasonNumbering`; native episode overlays require
  both to match. Movie and series queues are read from all enabled instances independently.

Upstream references: [Sonarr API](https://sonarr.tv/docs/api/) and
[Radarr API](https://radarr.video/docs/api/). Sonarr's `SeriesLookupController`/SkyHook lookup
accepts `tmdb:<id>`; Radarr's `/movie?tmdbId=` supplies tracked movie metadata.

## Upgrade refresh

The native metadata upgrade queues a durable full library sync after SQL migrations succeed.
It refreshes persisted seasons and invalidates derived metadata/episode snapshots without a
database reset. See [post-migration jobs](post-migration-jobs.md) for retry, observability and
rollback details.
