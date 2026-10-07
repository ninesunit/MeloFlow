// Usage: npm run set-admin -- you@example.com
// Writes the administrator email into firestore.rules and ADMIN_EMAIL in
// .env.local so the database rules and the AI route agree.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const email = (process.argv[2] || "").trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: npm run set-admin -- you@example.com");
  process.exit(1);
}

const rules = readFileSync("firestore.rules", "utf8").replace(/(request\.auth\.token\.email\.lower\(\) == ')[^']*(')/g, `$1${email}$2`);
writeFileSync("firestore.rules", rules);
console.log("Updated firestore.rules");

const envFile = ".env.local";
let env = existsSync(envFile) ? readFileSync(envFile, "utf8") : readFileSync(".env.example", "utf8");
env = /^ADMIN_EMAIL=.*$/m.test(env) ? env.replace(/^ADMIN_EMAIL=.*$/m, `ADMIN_EMAIL=${email}`) : `${env.trimEnd()}\nADMIN_EMAIL=${email}\n`;
writeFileSync(envFile, env);
console.log(`Updated ${envFile}`);
console.log("Next: npm run deploy:rules, and set ADMIN_EMAIL in your Vercel environment variables too.");
