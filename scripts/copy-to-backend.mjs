#!/usr/bin/env node
/**
 * Copies the built admin into the Laravel backend's public directory.
 *
 * The two live in separate repos but must be served from one origin: the API
 * client calls /api with relative paths, and the backend answers /webhooks and
 * /proxy on the same host. This is the step that puts them there.
 */
import { cp, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "..", "build", "client");
const target = resolve(
  process.env.KOURIFY_BACKEND_PUBLIC ??
    join(here, "..", "..", "kourify-guarantee-backend", "public"),
);

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

if (!(await isDirectory(source))) {
  console.error(`No build to copy. Run \`npm run build\` first (${source}).`);
  process.exit(1);
}

/*
 * The check below is what makes the delete safe. This script removes the
 * previous build's hashed bundles, and without proof that the target really is
 * a Laravel public directory a mistyped path would take something else with it.
 */
if (!(await exists(join(target, "index.php")))) {
  console.error(
    `${target} does not look like a Laravel public directory (no index.php).\n` +
      "Set KOURIFY_BACKEND_PUBLIC to the right path.",
  );
  process.exit(1);
}

// Only this directory is cleared: every file in it is content-hashed, so a
// previous deploy's bundles would otherwise accumulate there forever.
await rm(join(target, "assets"), { recursive: true, force: true });
await cp(source, target, { recursive: true });

const copied = await readdir(source);
console.log(`Copied ${copied.length} entries from build/client into ${target}`);
