// Usage: npm run set-admin -- you@example.com
// Writes the administrator email into the Firestore and Storage security
// rules and functions/.env so all three agree.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const email = (process.argv[2] || "").trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: npm run set-admin -- you@example.com");
  process.exit(1);
}

for (const file of ["firestore.rules", "storage.rules"]) {
  const src = readFileSync(file, "utf8");
  const next = src.replace(/(request\.auth\.token\.email\.lower\(\) == ')[^']*(')/g, `$1${email}$2`);
  writeFileSync(file, next);
  console.log(`Updated ${file}`);
}

const envFile = "functions/.env";
let env = existsSync(envFile) ? readFileSync(envFile, "utf8") : readFileSync("functions/.env.example", "utf8");
env = /^ADMIN_EMAIL=.*$/m.test(env) ? env.replace(/^ADMIN_EMAIL=.*$/m, `ADMIN_EMAIL=${email}`) : `${env.trimEnd()}\nADMIN_EMAIL=${email}\n`;
writeFileSync(envFile, env);
console.log(`Updated ${envFile}`);
