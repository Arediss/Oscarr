import { describe, it, expect } from 'vitest';
import {
  loadMasterKeyOrExit, mergeSecretFields, encryptSecretFields, decryptSecretFields,
  encryptServiceConfig, decryptServiceConfig,
} from '../src/utils/secrets.js';

loadMasterKeyOrExit();

/**
 * `decryptSecretFields` collapses anything it cannot decrypt to `''` on purpose, so ciphertext
 * never reaches an admin form. The admin panel then sends the whole settings blob back on every
 * save — so after a master-key rotation or a cross-environment restore, the first Save silently
 * replaced live credentials with empty strings, unrecoverably.
 *
 * The UI cannot tell "the admin cleared this" from "we could not read this", and the two
 * outcomes are not symmetric: refusing to clear costs an annoyance, clearing by accident costs a
 * credential nobody has a copy of. So an empty incoming secret never overwrites a stored one.
 */
describe('mergeSecretFields', () => {
  it('keeps a stored secret when the incoming value is the empty decrypt sentinel', () => {
    const stored = encryptSecretFields({ webhookUrl: 'https://discord.test/hook' });
    const merged = mergeSecretFields(stored, { webhookUrl: '' });
    expect(merged.webhookUrl).toBe(stored.webhookUrl);
  });

  it('accepts a real new secret', () => {
    const stored = encryptSecretFields({ botToken: 'old-token' });
    const merged = mergeSecretFields(stored, { botToken: 'new-token' });
    expect(merged.botToken).not.toBe(stored.botToken);
    expect(merged.botToken).toMatch(/^enc:/);
  });

  it('carries over fields the caller did not send', () => {
    const stored = encryptSecretFields({ botToken: 'keep-me', chatId: '123' });
    const merged = mergeSecretFields(stored, { chatId: '456' });
    expect(merged.botToken).toBe(stored.botToken);
    expect(merged.chatId).toBe('456');
  });

  // Only secrets are protected: a non-sensitive field must stay clearable.
  it('lets a non-sensitive field be emptied', () => {
    const stored = encryptSecretFields({ chatId: '123' });
    const merged = mergeSecretFields(stored, { chatId: '' });
    expect(merged.chatId).toBe('');
  });

  it('does not resurrect a secret that was empty to begin with', () => {
    const merged = mergeSecretFields({ webhookUrl: '' }, { webhookUrl: '' });
    expect(merged.webhookUrl).toBe('');
  });

  it('adds a field the stored blob never had', () => {
    const merged = mergeSecretFields({}, { botToken: 'fresh' });
    expect(merged.botToken).toMatch(/^enc:/);
  });
});

/**
 * These blobs are rebuilt key by key from a request body, so a field named `__proto__` would
 * reshape the object being built instead of being stored in it. No setting is ever called that,
 * and the guard is invisible in normal use — which is exactly why it needs a test to survive.
 *
 * Built with JSON.parse, not an object literal: in a literal `__proto__:` is special-cased by the
 * language and sets the prototype instead of creating a property, so a literal would test nothing.
 * JSON.parse creates a real own property, and it is also how a request body actually arrives.
 */
describe('prototype-shaped field names', () => {
  const hostile = () => JSON.parse(
    String.raw`{"__proto__":"x","constructor":"y","prototype":"z","apiKey":"real"}`,
  ) as Record<string, string>;

  it('is built with a real own __proto__ property', () => {
    expect(Object.hasOwn(hostile(), '__proto__')).toBe(true);
  });

  it('drops them when merging a patch, and keeps the real fields', () => {
    const merged = mergeSecretFields({}, hostile());
    expect(Object.keys(merged)).toEqual(['apiKey']);
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
  });

  it('drops them when encrypting and decrypting a blob', () => {
    const encrypted = encryptSecretFields(hostile());
    expect(Object.keys(encrypted)).toEqual(['apiKey']);
    expect(Object.keys(decryptSecretFields(encrypted))).toEqual(['apiKey']);
  });

  it('drops them when encrypting and decrypting a service config', () => {
    const encrypted = encryptServiceConfig(hostile());
    expect(Object.keys(encrypted)).toEqual(['apiKey']);
    expect(Object.keys(decryptServiceConfig(encrypted))).toEqual(['apiKey']);
  });

  it('still round-trips the real secret it kept', () => {
    const encrypted = encryptSecretFields(hostile());
    expect(decryptSecretFields(encrypted).apiKey).toBe('real');
  });
});
