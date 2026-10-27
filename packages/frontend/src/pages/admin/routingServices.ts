import type { ServiceSchema } from '@/hooks/useServiceSchemas';

export interface RoutingService {
  id: number; name: string; type: string; enabled?: boolean; config?: { url?: string };
}

export function supportsRoutingMedia(service: RoutingService, schema: ServiceSchema | undefined, mediaType: string): boolean {
  return service.enabled !== false && schema?.supportsRouting === true
    && (mediaType === 'any' || schema.handlesMediaTypes?.includes(mediaType) === true);
}
