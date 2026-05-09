import { prisma } from './prisma.js';
import { decryptServiceConfig, encryptServiceConfig } from './secrets.js';

export interface ServiceWithConfig {
  id: number;
  name: string;
  type: string;
  config: Record<string, string>;
  isDefault: boolean;
}

/** Parse a Service row's stringified JSON config and decrypt any `enc:v1:`-prefixed secret
 *  fields transparently. Plaintext values pass through untouched (legacy rows from before
 *  encryption shipped) and are surfaced via `hasPlaintextSecret()` for the admin banner. */
export function parseServiceConfig(configString: string): Record<string, string> {
  const raw = JSON.parse(configString) as Record<string, string>;
  return decryptServiceConfig(raw);
}

/** Inverse of `parseServiceConfig` — encrypt sensitive fields and serialise to JSON. Use this
 *  on every write path so a stored Service row never holds plaintext credentials. */
export function serializeServiceConfig(config: Record<string, string>): string {
  return JSON.stringify(encryptServiceConfig(config));
}

/** Get a single service config (first default, then any enabled). Used for backwards compat. */
export async function getServiceConfig(type: string): Promise<Record<string, string> | null> {
  const service = await prisma.service.findFirst({
    where: { type, enabled: true, isDefault: true },
  });
  if (!service) {
    const fallback = await prisma.service.findFirst({
      where: { type, enabled: true },
    });
    if (!fallback) return null;
    return parseServiceConfig(fallback.config);
  }
  return parseServiceConfig(service.config);
}

/** Get ALL enabled services of a given type, with parsed config */
export async function getAllServices(type: string): Promise<ServiceWithConfig[]> {
  const services = await prisma.service.findMany({
    where: { type, enabled: true },
    orderBy: { isDefault: 'desc' },
  });
  return services.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    config: parseServiceConfig(s.config),
    isDefault: s.isDefault,
  }));
}

/** Get a specific service by ID with parsed config */
export async function getServiceById(id: number): Promise<ServiceWithConfig | null> {
  const service = await prisma.service.findUnique({ where: { id } });
  if (!service?.enabled) return null;
  return {
    id: service.id,
    name: service.name,
    type: service.type,
    config: parseServiceConfig(service.config),
    isDefault: service.isDefault,
  };
}
