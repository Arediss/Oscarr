import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MediaInfoColumn } from './MediaInfoColumn';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('@/plugins/PluginSlot', () => ({ PluginSlot: () => null }));
vi.mock('./CriteriaPicker', () => ({ default: () => null }));

function render(overrides: Partial<ComponentProps<typeof MediaInfoColumn>> = {}) {
  return renderToStaticMarkup(createElement(MediaInfoColumn, {
    media: { id: 200709, name: 'Héros fragile' }, dbMedia: null, type: 'tv',
    title: 'Héros fragile', year: '2022', isAvailable: true, buttonState: 'available',
    requesting: false, justRequested: false, requestError: null, download: null, blacklisted: null,
    onBrowseSeasons: vi.fn(), onRequest: vi.fn(), onSearchMissing: vi.fn(),
    qualityOptions: [], selectedCriteria: {}, setSelectedCriteria: vi.fn(),
    takenQualityIds: new Set<number>(), selectedQuality: null, setSelectedQuality: vi.fn(),
    audioLanguages: [], subtitleLanguages: [], libraryLoading: false,
    ...overrides,
  }));
}

describe('series detail action', () => {
  it('shows Available for a complete series even with the season explorer enabled', () => {
    const html = render();
    expect(html).toMatch(/<button disabled=""[^>]*>[\s\S]*?status.available<\/button>/);
    expect(html).not.toContain('media.explorer.request_series');
  });

  it.each([
    ['downloading', '37%'], ['already_requested', 'status.already_requested'],
    ['blocked', 'media.blocked'], ['searching', 'status.searching_long'],
  ] as const)('preserves the %s state instead of offering a new series request', (buttonState, label) => {
    const html = render({ isAvailable: false, buttonState, download: { progress: 37, timeLeft: '' } });
    expect(html).toContain(label);
    expect(html).toContain('<button disabled=""');
    expect(html).not.toContain('media.explorer.request_series');
  });

  it('still offers the season explorer for a new series', () => {
    expect(render({ isAvailable: false, buttonState: 'can_request' })).toContain('media.explorer.request_series');
  });

  it('offers missing seasons when only part of the series is available', () => {
    expect(render({ buttonState: 'can_request_seasons' })).toContain('media.request_more_seasons');
  });

  it('does not offer a request before the asynchronous library check finishes', () => {
    const html = render({ libraryLoading: true, isAvailable: false, buttonState: 'can_request' });
    expect(html).toContain('<button disabled="" aria-busy="true"');
    expect(html).not.toContain('media.explorer.request_series');
  });
});
