import { describe, expect, it } from 'vitest';
import type { ServiceSchema } from '@/hooks/useServiceSchemas';
import { supportsRoutingMedia } from './routingServices';

const service = { id: 4, name: 'Books', type: 'readarr', enabled: true };
const schema: ServiceSchema = { id: 'readarr', label: 'Readarr', icon: '', category: 'arr', fields: [],
  supportsRouting: true, supportsTags: true, handlesMediaTypes: ['book'] };

describe('routing service discovery', () => {
  it('discovers future providers through their declared media types', () => {
    expect(supportsRoutingMedia(service, schema, 'book')).toBe(true);
    expect(supportsRoutingMedia(service, schema, 'any')).toBe(true);
    expect(supportsRoutingMedia(service, schema, 'tv')).toBe(false);
  });
  it('does not infer routing from the provider name, category or tag support', () => {
    expect(supportsRoutingMedia(service, { ...schema, supportsRouting: false }, 'book')).toBe(false);
    expect(supportsRoutingMedia({ ...service, type: 'sonarr' }, undefined, 'tv')).toBe(false);
  });
  it('excludes disabled instances', () => {
    expect(supportsRoutingMedia({ ...service, enabled: false }, schema, 'book')).toBe(false);
  });
});
