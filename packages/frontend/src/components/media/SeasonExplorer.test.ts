import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import SeasonExplorer from './SeasonExplorer';

vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  // Open season three without a DOM; other state (submitted requests) stays at its initial value.
  useState: (initial: unknown) => [initial === null ? { number: 3, requesting: false } : initial, () => {}],
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 1 } }) }));
vi.mock('@/context/FeaturesContext', () => ({ useFeatures: () => ({ features: { requestsEnabled: true }, loading: false }) }));
vi.mock('@/hooks/useDownloads', () => ({ useDownloads: () => [] }));
vi.mock('./SeasonPoster', () => ({ SeasonPoster: () => null }));
vi.mock('./SeasonQuickRequest', () => ({ SeasonQuickRequest: (props: { allowed: boolean }) => props.allowed ? createElement('button', { 'data-quick-request': true }) : null }));
vi.mock('./SeasonDialog', () => ({ SeasonDialog: (props: {
  state: { canRequest: boolean; defaultAllowed: boolean; takenQualityIds: Set<number> };
  qualityOptions: { id: number; label: string }[];
}) => createElement('section', { 'data-modal-can-request': props.state.canRequest,
  'data-modal-default-allowed': props.state.defaultAllowed },
  props.qualityOptions.filter(option => !props.state.takenQualityIds.has(option.id))
    .map(option => createElement('button', { key: option.id, 'data-selectable-quality': option.id }, option.label))) }));

type Props = ComponentProps<typeof SeasonExplorer>;
const season = { seasonNumber: 3, title: 'Apothecary Diaries season three', posterPath: null,
  episodeCount: 24, episodeFileCount: 5, monitored: true };
function render(overrides: Partial<Props> = {}) {
  return renderToStaticMarkup(createElement(SeasonExplorer, {
    media: { id: 220542, name: 'The Apothecary Diaries' }, seasons: [season],
    catalog: { numbering: 'tvdb:official', tracked: true, seasons: [season], stale: false,
      fetchedAt: '2026-10-31T00:00:00Z', source: { serviceId: 7, serviceName: 'Sonarr', provider: 'sonarr', token: 'source' } },
    requests: [], qualityOptions: [{ id: 1, label: 'HD' }], activeQualityOptionIds: [1],
    blocked: false, onRefresh: async () => {}, ...overrides,
  } as Props));
}

describe('native monitored season requests', () => {
  it('offers neither another modal request nor its existing HD option for a monitored 5/24 season', () => {
    const html = render();
    expect(html).toContain('data-modal-can-request="false"');
    expect(html).toContain('data-modal-default-allowed="false"');
    expect(html).not.toContain('data-selectable-quality="1"');
    expect(html).not.toContain('data-quick-request');
  });
  it('keeps a genuinely different quality selectable without offering the existing HD again', () => {
    const html = render({ qualityOptions: [{ id: 1, label: 'HD' }, { id: 2, label: '4K' }] });
    expect(html).toContain('data-modal-can-request="true"');
    expect(html).toContain('data-selectable-quality="2"');
    expect(html).not.toContain('data-selectable-quality="1"');
    expect(html).not.toContain('data-quick-request');
  });
  it('allows an unmonitored incomplete season even when another season satisfies HD', () => {
    const html = render({ seasons: [{ ...season, monitored: false }] });
    expect(html).toContain('data-modal-can-request="true"');
    expect(html).toContain('data-modal-default-allowed="true"');
    expect(html).toContain('data-quick-request');
    expect(html).toContain('data-selectable-quality="1"');
  });
  it('does not let stale monitoring information suppress a fresh request', () => {
    const html = render({ catalog: { numbering: 'tvdb:official', tracked: true, seasons: [season], stale: true,
      fetchedAt: '2026-10-01T00:00:00Z', source: { serviceId: 7, serviceName: 'Sonarr', provider: 'sonarr', token: 'source' } } });
    expect(html).toContain('data-modal-can-request="true"');
    expect(html).toContain('data-modal-default-allowed="true"');
    expect(html).toContain('data-selectable-quality="1"');
    expect(html).toContain('data-quick-request');
    expect(html).toContain('season-status-unknown');
  });
});
