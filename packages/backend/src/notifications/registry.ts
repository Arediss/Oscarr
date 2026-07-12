import { prisma } from '../utils/prisma.js';
import { getAppSettings } from '../utils/appSettings.js';
import { logEvent } from '../utils/logEvent.js';
import type { NotificationProvider, NotificationEventType, NotificationPayload } from './types.js';

export class NotificationRegistry {
  private readonly providers = new Map<string, NotificationProvider>();
  private readonly eventTypes = new Map<string, NotificationEventType>();
  // Tracks which plugin owns which provider id so disable/uninstall can clean up — without
  // this, plugin providers stayed wired to the singleton across hot reloads / uninstalls.
  private readonly providerOwners = new Map<string, Set<string>>();

  // ─── Provider management ───────────────────────────────

  registerProvider(provider: NotificationProvider, pluginId?: string): void {
    if (this.providers.has(provider.id)) {
      logEvent('warn', 'NotificationRegistry', `Provider "${provider.id}" already registered, overwriting`);
    }
    this.providers.set(provider.id, provider);
    if (pluginId) {
      if (!this.providerOwners.has(pluginId)) this.providerOwners.set(pluginId, new Set());
      this.providerOwners.get(pluginId)!.add(provider.id);
    }
    logEvent('debug', 'NotificationRegistry', `Registered provider "${provider.id}"${pluginId ? ` (plugin: ${pluginId})` : ''}`);
  }

  /** Drop every provider registered by the given plugin. Called on disable + uninstall. */
  removeAllForPlugin(pluginId: string): number {
    const owned = this.providerOwners.get(pluginId);
    if (!owned) return 0;
    let removed = 0;
    for (const providerId of owned) {
      if (this.providers.delete(providerId)) removed++;
    }
    this.providerOwners.delete(pluginId);
    return removed;
  }

  getAllProviders(): NotificationProvider[] {
    return Array.from(this.providers.values());
  }

  // ─── Event type management ─────────────────────────────

  registerEventType(eventType: NotificationEventType): void {
    this.eventTypes.set(eventType.key, eventType);
  }

  registerEventTypes(eventTypes: NotificationEventType[]): void {
    for (const et of eventTypes) {
      this.registerEventType(et);
    }
  }

  getAllEventTypes(): NotificationEventType[] {
    return Array.from(this.eventTypes.values());
  }

  // ─── Dispatch ──────────────────────────────────────────

  async send(type: string, data: Omit<NotificationPayload, 'type'>): Promise<void> {
    const eventType = this.eventTypes.get(type);
    const payload: NotificationPayload = { ...data, type, label: eventType?.label ?? type, color: eventType?.color };

    try {
      // Load all provider configs from DB
      const configs = await prisma.notificationProviderConfig.findMany();
      const configMap = new Map(configs.map(c => [c.providerId, c]));

      // Load notification matrix from AppSettings
      const settings = await getAppSettings();
      if (!settings) return;

      const matrix: Record<string, Record<string, boolean>> = settings.notificationMatrix
        ? JSON.parse(settings.notificationMatrix)
        : {};

      const eventMatrix = matrix[type] || {};

      const promises: Promise<void>[] = [];

      for (const [providerId, provider] of this.providers) {
        // Check matrix: is this provider enabled for this event?
        if (!eventMatrix[providerId]) continue;

        // Check config: does this provider have saved credentials?
        const config = configMap.get(providerId);
        if (!config?.enabled) continue;

        const providerSettings: Record<string, string> = config.settings
          ? JSON.parse(config.settings)
          : {};

        promises.push(
          provider.send(providerSettings, payload)
            .then(() => logEvent('info', 'Notification', `${providerId}: ${type}`))
            .catch(err => {
              logEvent('error', 'Notification', `${providerId} failed: ${err.message}`);
            })
        );
      }

      await Promise.all(promises);
    } catch (err) {
      logEvent('error', 'Notification', `Dispatch failed: ${String(err)}`);
    }
  }

  // ─── Test ──────────────────────────────────────────────

  async testProvider(providerId: string, settings: Record<string, string>): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    await provider.testConnection(settings);
  }

  // ─── Serialization for API ─────────────────────────────

  toJSON() {
    return {
      providers: this.getAllProviders().map(p => ({
        id: p.id,
        nameKey: p.nameKey,
        icon: p.icon,
        settingsSchema: p.settingsSchema,
      })),
      eventTypes: this.getAllEventTypes().map(e => ({
        key: e.key,
        labelKey: e.labelKey,
        color: e.color,
      })),
    };
  }
}

// Singleton
export const notificationRegistry = new NotificationRegistry();
