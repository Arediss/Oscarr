import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { getPluginDataDir, pluginDataDirPath } from '../../utils/dataPath.js';
import { PluginKV } from './kv.js';
import { openDb, migrate, type PluginDatabase, type Migration } from './sqlite.js';

const kvByPlugin = new Map<string, PluginKV>();
const dbByPlugin = new Map<string, Map<string, PluginDatabase>>();

export async function getKV(pluginId: string): Promise<PluginKV> {
  let kv = kvByPlugin.get(pluginId);
  if (!kv) {
    const dir = await getPluginDataDir(pluginId);
    kv = new PluginKV(join(dir, 'kv.json'));
    kvByPlugin.set(pluginId, kv);
  }
  return kv;
}

const DB_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export async function openPluginDb(
  pluginId: string,
  name: string,
  migrations?: Migration[],
): Promise<PluginDatabase> {
  // `name` becomes a filename inside the plugin's data dir. Refuse anything that could
  // escape it (`..`, `/`, dots, spaces) — keeps path traversal off the table.
  if (!DB_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid db name "${name}" — must match ${DB_NAME_PATTERN}`);
  }
  let perPlugin = dbByPlugin.get(pluginId);
  if (!perPlugin) {
    perPlugin = new Map();
    dbByPlugin.set(pluginId, perPlugin);
  }
  let db = perPlugin.get(name);
  if (!db) {
    const dir = await getPluginDataDir(pluginId);
    db = openDb(join(dir, `${name}.db`));
    perPlugin.set(name, db);
  }
  if (migrations && migrations.length > 0) {
    await migrate(db, migrations);
  }
  return db;
}

/** Closes all SQLite handles for the plugin and drops the in-memory caches. Idempotent.
 *  Called from engine.uninstall AND engine.togglePlugin(false) so the next enable starts
 *  with fresh handles (and uninstall can rm the data dir without WAL/SHM file locks). */
export function closePluginStorage(pluginId: string): void {
  const perPlugin = dbByPlugin.get(pluginId);
  if (perPlugin) {
    for (const db of perPlugin.values()) {
      try { db.close(); } catch { /* ignore — best effort */ }
    }
    dbByPlugin.delete(pluginId);
  }
  kvByPlugin.delete(pluginId);
}

/** Close every plugin's SQLite handles. Used before a restore swaps the plugin data directory
 *  underneath the process — a handle left open would keep writing into the replaced files
 *  (and hold WAL/SHM locks on them). Handles are reopened lazily on next use. */
export function closeAllPluginStorage(): void {
  for (const pluginId of [...dbByPlugin.keys()]) {
    closePluginStorage(pluginId);
  }
  kvByPlugin.clear();
}

/** Wipe the on-disk data directory. Caller must call closePluginStorage first. */
export async function rmPluginDataDir(pluginId: string): Promise<void> {
  await rm(pluginDataDirPath(pluginId), { recursive: true, force: true });
}

export { migrate, type Migration, type PluginDatabase };
