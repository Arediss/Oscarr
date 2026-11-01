# Providers

Providers are the core extension point for adding external services to Oscarr. Each provider is a self-contained module that defines how Oscarr connects to, tests, and interacts with an external service.

## Architecture

```
packages/backend/src/providers/
  types.ts                  # All interfaces: Provider, ServiceDefinition, ArrClient, AuthProvider
  index.ts                  # Central registry + ArrClient factory (getArrClient, createArrClient)
  radarr/
    index.ts                # Provider definition + createClient + re-exports
    client.ts               # RadarrClient implements ArrClient
    types.ts                # RadarrMovie, RadarrQueueItem, RadarrHistoryRecord
  sonarr/
    index.ts                # Same structure
    client.ts               # SonarrClient implements ArrClient
    types.ts                # SonarrSeries, SonarrSeason, etc.
  plex/index.ts             # Service + Auth (OAuth, link, import)
  qbittorrent/index.ts      # Service only
  tautulli/index.ts         # Service only
```

## Provider types

### Service-only providers

Providers like qBittorrent and Tautulli only need a `ServiceDefinition`: metadata, config fields, and a test function. These appear in the admin Services tab and can be tested/configured.

### Service + Auth providers

Providers like Plex add an `AuthProvider` for OAuth login, account linking, and user import. See [Auth Providers](./auth-providers.md).

### Arr providers (media management)

Providers with `category: 'arr'` (Radarr, Sonarr, future Lidarr/Readarr) implement the full `ArrClient` interface. This enables:
- **Sync** — import media libraries into Oscarr's DB
- **Requests** — send media requests to the service
- **Live check** — verify availability in real-time
- **Admin** — fetch quality profiles, root folders

The business logic (sync, requests, media service) works exclusively through the `ArrClient` interface — it never knows which specific provider it's talking to.

## The Provider interface

```typescript
interface Provider {
  service: ServiceDefinition;   // Required — config, fields, test, optional createClient
  auth?: AuthProvider;          // Optional — OAuth, account linking, user import
}
```

## ArrClient interface

The `ArrClient` is the abstraction that all *arr providers implement. Business code never imports provider-specific types.

```typescript
interface ArrClient {
  // ─── Metadata ─────────────────────────────────────────────────────
  readonly mediaType: 'movie' | 'tv';
  readonly serviceType: string;           // 'radarr', 'sonarr', etc.
  readonly dbIdField: 'radarrId' | 'sonarrId';
  readonly defaultRootFolder: string;     // '/movies', '/tv', etc.

  // ─── Tag management ───────────────────────────────────────────────
  getTags(): Promise<ArrTag[]>;
  createTag(label: string): Promise<ArrTag>;
  getOrCreateTag(username: string): Promise<number>;

  // ─── Configuration ────────────────────────────────────────────────
  getQualityProfiles(): Promise<ArrQualityProfile[]>;
  getRootFolders(): Promise<ArrRootFolder[]>;
  getSystemStatus(): Promise<{ version: string }>;

  // ─── Queue / History / Calendar ───────────────────────────────────
  getQueue(): Promise<{ records: unknown[] }>;
  getHistory(since?: Date | null): Promise<unknown[]>;
  getCalendar(start: string, end: string): Promise<unknown[]>;
  getHistoryEntries(since?: Date | null): Promise<ArrHistoryEntry[]>;

  // ─── Sync ─────────────────────────────────────────────────────────
  getAllMedia(): Promise<ArrMediaItem[]>;

  // ─── Live availability check ──────────────────────────────────────
  checkAvailability(externalId: number): Promise<ArrAvailabilityResult>;

  // ─── Request dispatch ─────────────────────────────────────────────
  findByExternalId(externalId: number): Promise<{ id: number } | null>;
  addMedia(options: ArrAddMediaOptions): Promise<void>;
  searchMedia(serviceMediaId: number): Promise<void>;

  // ─── Episodes (TV only, optional) ─────────────────────────────────
  getEpisodesNormalized?(serviceMediaId: number, seasonNumber?: number): Promise<ArrEpisode[]>;
}
```

## Registry API

### Service tag capability

Any `ServiceDefinition` can opt into tags independently of its category or `ArrClient`:

```typescript
interface ServiceTagClient {
  getTags(): Promise<ServiceTag[]>; // { id: number; label: string } from @oscarr/shared
  addTagsToMedia(serviceMediaId: number, tagIds: number[]): Promise<void>;
}

// In the provider definition:
createTagClient(config: Record<string, string>): ServiceTagClient;
// In generic consumers:
const tags = createServiceTagClient(service.type, service.config);
```

IDs are positive integers scoped to one configured service instance. Providers validate and
normalize upstream responses. `addTagsToMedia` must preserve existing tags and unrelated
settings. Sonarr and Radarr reuse their existing clients for this capability. A future Readarr
provider can expose its own adapter without changes to the tag endpoint, badges or editor.
This does not itself add book requests: new media types still need their own request support.

`GET /admin/service-schemas` derives `supportsTags` from `createTagClient` and
`supportsRouting` from `createClient`, and exposes `handlesMediaTypes`. The frontend consumes
this metadata instead of matching provider names. `GET /admin/services/:id/tags` uses the
exact enabled instance's tag adapter. Unsupported providers return `SERVICE_TAGS_UNSUPPORTED`;
upstream failures return `RULE_TAGS_UNAVAILABLE`. Rule validation and dispatch use the same
tag factory. New media creation carries the validated tag IDs in `ArrAddMediaOptions.tags`;
updates to existing media use `ServiceTagClient.addTagsToMedia`.

### Client factories

The provider registry in `providers/index.ts` provides factory functions:

```typescript
// Get the default cached client for a service type
const radarr = await getArrClient('radarr');

// Get a cached client for a specific service ID + config
const radarr4k = getArrClientForService(serviceId, 'radarr', config);

// Create a fresh (uncached) client
const client = createArrClient('radarr', config);

// Map media type to service type
const serviceType = getServiceTypeForMedia('movie'); // 'radarr'
```

## Creating a new *arr provider

### Step 1: Create the provider directory

```
packages/backend/src/providers/lidarr/
  types.ts
  client.ts
  index.ts
```

### Step 2: Define provider-specific types

`providers/lidarr/types.ts`:
```typescript
export interface LidarrAlbum {
  id: number;
  title: string;
  artistId: number;
  musicBrainzId: string;
  monitored: boolean;
  hasFile: boolean;
  // ... other Lidarr-specific fields
}
```

### Step 3: Implement the client

`providers/lidarr/client.ts`:
```typescript
import axios, { type AxiosInstance } from 'axios';
import type { ArrClient, ArrMediaItem, ArrAvailabilityResult, ArrHistoryEntry, ArrAddMediaOptions, ArrTag, ArrQualityProfile, ArrRootFolder } from '../types.js';
import { extractImageFromArr } from '../types.js';
import type { LidarrAlbum } from './types.js';

export class LidarrClient implements ArrClient {
  private api: AxiosInstance;

  readonly mediaType = 'music' as const;  // New media type
  readonly serviceType = 'lidarr';
  readonly dbIdField = 'lidarrId' as const;
  readonly defaultRootFolder = '/music';

  constructor(url: string, apiKey: string) {
    this.api = axios.create({
      baseURL: `${url}/api/v1`,
      params: { apikey: apiKey },
      timeout: 5000,
    });
  }

  // Implement all ArrClient methods...
  async getAllMedia(): Promise<ArrMediaItem[]> { /* ... */ }
  async checkAvailability(musicBrainzId: number): Promise<ArrAvailabilityResult> { /* ... */ }
  async findByExternalId(id: number): Promise<{ id: number } | null> { /* ... */ }
  async addMedia(options: ArrAddMediaOptions): Promise<void> { /* ... */ }
  async searchMedia(albumId: number): Promise<void> { /* ... */ }
  async getHistoryEntries(since?: Date | null): Promise<ArrHistoryEntry[]> { /* ... */ }
  async getTags(): Promise<ArrTag[]> { /* ... */ }
  async createTag(label: string): Promise<ArrTag> { /* ... */ }
  async getOrCreateTag(username: string): Promise<number> { /* ... */ }
  async getQualityProfiles(): Promise<ArrQualityProfile[]> { /* ... */ }
  async getRootFolders(): Promise<ArrRootFolder[]> { /* ... */ }
  async getSystemStatus(): Promise<{ version: string }> { /* ... */ }
  async getQueue(): Promise<{ records: unknown[] }> { /* ... */ }
  async getHistory(since?: Date | null): Promise<unknown[]> { /* ... */ }
  async getCalendar(start: string, end: string): Promise<unknown[]> { /* ... */ }
}
```

### Step 4: Create the provider definition

`providers/lidarr/index.ts`:
```typescript
import axios from 'axios';
import type { Provider } from '../types.js';
import { LidarrClient } from './client.js';

export const lidarrProvider: Provider = {
  service: {
    id: 'lidarr',
    label: 'Lidarr',
    icon: 'https://raw.githubusercontent.com/Lidarr/Lidarr/develop/Logo/128.png',
    category: 'arr',
    fields: [
      { key: 'url', labelKey: 'common.url', type: 'text', placeholder: 'http://localhost:8686' },
      { key: 'apiKey', labelKey: 'common.api_key', type: 'password' },
    ],
    async test(config) {
      const { data } = await axios.get(`${config.url}/api/v1/system/status`, {
        params: { apikey: config.apiKey },
        timeout: 5000,
      });
      return { ok: true, version: data.version };
    },
    createClient(config) {
      return new LidarrClient(config.url || '', config.apiKey || '');
    },
  },
};

export { LidarrClient } from './client.js';
export type { LidarrAlbum } from './types.js';
```

### Step 5: Register the provider

In `providers/index.ts`:
```typescript
import { lidarrProvider } from './lidarr/index.js';

const ALL_PROVIDERS: Provider[] = [
  radarrProvider,
  sonarrProvider,
  plexProvider,
  qbittorrentProvider,
  tautulliProvider,
  lidarrProvider,  // Add here
];
```

And add the media type mapping:
```typescript
const MEDIA_TYPE_TO_SERVICE: Record<string, string> = {
  movie: 'radarr',
  tv: 'sonarr',
  music: 'lidarr',  // Add here
};
```

### What works automatically

After these 5 steps, with zero changes in routes or business logic:
- Admin Services tab shows Lidarr with config form
- Connection test works
- Quality profiles and root folders are fetchable
- Sync pipeline processes Lidarr media generically
- Request dispatch sends to Lidarr via the interface
- Live availability check works

### What needs additional work

- **Prisma schema**: add `lidarrId Int?` to the `Media` model + migration
- **Frontend**: add Lidarr-specific UI if needed (e.g. album artwork instead of poster)
- **Metadata provider**: if Lidarr uses MusicBrainz instead of TMDB, a new metadata provider is needed (see #91)

## ServiceDefinition reference

```typescript
interface ServiceDefinition {
  id: string;
  label: string;
  icon: string;
  category: 'arr' | 'media-server' | 'download-client' | 'monitoring';
  fields: ServiceField[];
  test(config: Record<string, string>): Promise<{ ok: boolean; version?: string }>;
  createClient?(config: Record<string, string>): ArrClient;  // Required for 'arr' category
}
```

### ServiceField

```typescript
interface ServiceField {
  key: string;          // Config key stored in DB (e.g. 'url', 'apiKey')
  labelKey: string;     // i18n key for the field label
  type: 'text' | 'password';
  placeholder?: string;
  helper?: string;      // Optional UI helper (e.g. 'plex-oauth')
}
```

### Categories

| Category | Description | Examples |
|----------|-------------|----------|
| `arr` | Media management (*arr stack) | Radarr, Sonarr, Lidarr, Readarr |
| `media-server` | Media servers | Plex, Jellyfin, Emby |
| `download-client` | Download clients | qBittorrent, Transmission, SABnzbd |
| `monitoring` | Monitoring & analytics | Tautulli, Overseerr |

## Database: Service table

```prisma
model Service {
  id        Int     @id @default(autoincrement())
  name      String  // Display name (e.g. "Radarr 4K")
  type      String  // Provider ID (e.g. "radarr")
  config    String  // JSON: { url, apiKey, ... }
  isDefault Boolean @default(false)
  enabled   Boolean @default(true)
}
```

Multiple instances of the same provider type are supported (e.g. "Radarr HD" + "Radarr 4K").

## API endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /setup/service-schemas` | Setup secret | Service schemas for the wizard |
| `GET /admin/service-schemas` | Admin | Service schemas for the admin panel |
| `POST /setup/test-service` | Setup secret | Test a service during setup |
| `POST /admin/services/:id/test` | Admin | Test an existing service |
| `GET /admin/services/:id/profiles` | Admin | Quality profiles (generic, uses ArrClient) |
| `GET /admin/services/:id/rootfolders` | Admin | Root folders (generic, uses ArrClient) |
