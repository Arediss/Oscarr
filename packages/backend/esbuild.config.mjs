import { build } from 'esbuild';

/** Bundle the backend into a single dist/server.js for the Docker prod image.
 *
 *  Externals: modules that MUST stay on disk as real files.
 *  - @prisma/client + .prisma/client — Prisma generates platform-specific client code + native
 *    engines at `node_modules/.prisma/client/`, loaded via a regular `require`. Bundling them
 *    would break the `require('./query_engine-...')` call inside the generated client.
 *  - prisma — the CLI we shell out to for `migrate deploy`. Has to be an actual bin on PATH.
 *  - @prisma/engines — binary blobs, can't be bundled. */
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server.js',
  // esbuild emits `import { createRequire } from 'module'` shims for CJS-native deps (archiver
  // uses them). Banner is the canonical fix for ESM bundles on Node.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'module';",
      "import { fileURLToPath as __fileURLToPath } from 'url';",
      "import { dirname as __dirname_fn } from 'path';",
      "const require = __createRequire(import.meta.url);",
      "const __filename = __fileURLToPath(import.meta.url);",
      "const __dirname = __dirname_fn(__filename);",
    ].join('\n'),
  },
  external: [
    // Prisma: generated client + engines are platform-specific binaries, can't be bundled.
    '@prisma/client',
    '.prisma/client',
    '@prisma/engines',
    'prisma',
    // Native modules — node-gyp-build resolves prebuilds relative to the package dir on disk,
    // so they must stay as real files in node_modules.
    'bcrypt',
    'bare-fs',
    'bare-os',
    'bare-url',
    'bare-path',
    // better-sqlite3 backs the plugin storage API (ctx.db). `bindings` looks for the .node
    // relative to the package directory, so bundling it makes the lookup fail at runtime.
    'better-sqlite3',
  ],
  define: {
    __BUNDLED__: 'true',
  },
  // Source map keeps stack traces useful in prod logs.
  sourcemap: 'linked',
  // Tree-shaking + minify drop a large chunk of unused fastify/swagger paths without
  // affecting runtime behavior. Keep names so Error.stack is readable.
  minify: true,
  keepNames: true,
  logLevel: 'info',
});
