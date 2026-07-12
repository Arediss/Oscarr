import axios, { type AxiosInstance } from 'axios';
import type { ArrTag, ArrQualityProfile, ArrRootFolder } from './types.js';
import { attachAxiosRetry } from '../utils/fetchWithRetry.js';

/** Shared Radarr/Sonarr v3 API surface — the endpoints that are identical across both connectors
 *  (tags, quality profiles, root folders, system status, webhook existence/removal). Per-client
 *  logic (media mapping, history paging, queue, webhook registration shape) stays in the subclass. */
export abstract class ArrClientBase {
  protected readonly api: AxiosInstance;

  constructor(url: string, apiKey: string, serviceName: string) {
    this.api = attachAxiosRetry(axios.create({
      baseURL: `${url}/api/v3`,
      params: { apikey: apiKey },
      timeout: 5000,
    }), serviceName);
  }

  async getTags(): Promise<ArrTag[]> {
    const { data } = await this.api.get('/tag');
    return data;
  }

  async createTag(label: string): Promise<ArrTag> {
    const { data } = await this.api.post('/tag', { label });
    return data;
  }

  async getOrCreateTag(username: string): Promise<number> {
    const label = `oscarr-${username}`.toLowerCase().replaceAll(/[^a-z0-9-]/g, '');
    const tags = await this.getTags();
    const existing = tags.find((t) => t.label === label);
    if (existing) return existing.id;
    const created = await this.createTag(label);
    return created.id;
  }

  async getQualityProfiles(): Promise<ArrQualityProfile[]> {
    const { data } = await this.api.get('/qualityprofile');
    return data;
  }

  async getRootFolders(): Promise<ArrRootFolder[]> {
    const { data } = await this.api.get('/rootfolder');
    return data;
  }

  async getSystemStatus(): Promise<{ version: string }> {
    const { data } = await this.api.get('/system/status');
    return data;
  }

  async removeWebhook(webhookId: number): Promise<void> {
    await this.api.delete(`/notification/${webhookId}`);
  }

  async checkWebhookExists(webhookId: number): Promise<boolean> {
    const { data } = await this.api.get('/notification');
    return Array.isArray(data) && data.some((n: { id: number }) => n.id === webhookId);
  }
}
