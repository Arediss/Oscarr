import { describe, expect, it, vi } from 'vitest';
import type { ArrClient } from '../src/providers/types.js';
import { validateSeasonSelection } from '../src/services/seriesCatalog.js';
import { SonarrClient } from '../src/providers/sonarr/client.js';

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => http } }));
vi.mock('../src/utils/fetchWithRetry.js', () => ({ attachAxiosRetry: (client: unknown) => client }));

const native = () => ({ numbering: 'tvdb:official', tracked: true,
  seasons: Array.from({ length: 20 }, (_, index) => ({ seasonNumber: index + 1,
    title: null, posterPath: null, episodeCount: null, episodeFileCount: null, monitored: true })) });

describe('native season selection before dispatch', () => {
  it('accepts native season eighteen and reads the target catalog freshly on every validation', async () => {
    const getSeasonCatalog = vi.fn().mockResolvedValue(native());
    const client: Pick<ArrClient, 'getSeasonCatalog'> = { getSeasonCatalog };
    await expect(validateSeasonSelection(client, 76703, [18], 'tvdb:official')).resolves.toBeUndefined();
    getSeasonCatalog.mockResolvedValue({ ...native(), seasons: native().seasons.slice(0, 17) });
    await expect(validateSeasonSelection(client, 76703, [18], 'tvdb:official')).rejects.toThrow();
    expect(getSeasonCatalog).toHaveBeenCalledTimes(2);
    expect(getSeasonCatalog).toHaveBeenNthCalledWith(1, 76703);
    expect(getSeasonCatalog).toHaveBeenNthCalledWith(2, 76703);
  });

  it('rejects TMDB season twenty-five when the target has only twenty native seasons', async () => {
    const client = { getSeasonCatalog: vi.fn().mockResolvedValue(native()) };
    await expect(validateSeasonSelection(client, 76703, [18, 25], 'tvdb:official')).rejects.toThrow();
    expect(client.getSeasonCatalog).toHaveBeenCalledWith(76703);
  });

  it('rejects another numbering scheme even when the requested number exists', async () => {
    const client = { getSeasonCatalog: vi.fn().mockResolvedValue(native()) };
    await expect(validateSeasonSelection(client, 76703, [18], 'tmdb')).rejects.toThrow();
    await expect(validateSeasonSelection(client, 76703, [18], 'tvdb:alternate')).rejects.toThrow();
  });

  it('refuses selection when the provider capability or native catalog is unavailable', async () => {
    await expect(validateSeasonSelection({}, 76703, [18], 'tvdb:official')).rejects.toThrow();
    const client = { getSeasonCatalog: vi.fn().mockResolvedValue(null) };
    await expect(validateSeasonSelection(client, 76703, [18], 'tvdb:official')).rejects.toThrow();
    client.getSeasonCatalog.mockRejectedValue(new Error('offline'));
    await expect(validateSeasonSelection(client, 76703, [18], 'tvdb:official')).rejects.toThrow();
  });

  it('does not POST a series when lookup lacks one of its selected native seasons', async () => {
    http.get.mockReset();
    http.post.mockReset();
    http.get.mockResolvedValue({ data: [{ tvdbId: 76703, title: 'Pokémon', seasons: native().seasons }] });
    await expect(new SonarrClient('http://sonarr.test', 'test').addSeries({
      title: 'Pokémon', tvdbId: 76703, qualityProfileId: 1, rootFolderPath: '/tv', seasons: [18, 25],
    })).rejects.toThrow();
    expect(http.get).toHaveBeenCalledWith('/series/lookup', { params: { term: 'tvdb:76703' } });
    expect(http.post).not.toHaveBeenCalled();
  });
});
