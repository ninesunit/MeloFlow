// Copies the pure TypeScript modules shared with the web app into
// functions/src/shared so Cloud Functions use exactly the same split,
// running-balance and recurring-bill logic. The copy is git-ignored.
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "..", "..", "src", "lib", "shared");
const to = join(here, "..", "src", "shared");

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
for (const name of readdirSync(from)) {
  if (name.endsWith(".ts")) cpSync(join(from, name), join(to, name));
}
console.log(`Synced shared modules → ${to}`);
