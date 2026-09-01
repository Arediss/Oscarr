import { describe, it, expect } from 'vitest';
import { loadMasterKeyOrExit, mergeSecretFields, encryptSecretFields } from '../src/utils/secrets.js';

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
