// Usage: npm run set-admin -- first@example.com [second@example.com …]
// Saves the admin emails as ADMIN_EMAILS in .env.local (used by the AI route)
// and regenerates firestore.rules from the template. Pass the full list every
// time — it replaces the previous one. Then run: npm run deploy:rules
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { buildRules } from "./build-rules.mjs";

const emails = [...new Set(process.argv.slice(2).map((e) => e.trim().toLowerCase()).filter(Boolean))];
if (emails.length === 0) {
  console.error("Usage: npm run set-admin -- first@example.com second@example.com");
  process.exit(1);
}

buildRules(emails); // validates the addresses before anything is written to .env.local

const envFile = ".env.local";
let env = existsSync(envFile) ? readFileSync(envFile, "utf8") : readFileSync(".env.example", "utf8");
env = env.replace(/^ADMIN_EMAIL=.*\n?/m, ""); // older single-admin setting
env = /^ADMIN_EMAILS=.*$/m.test(env) ? env.replace(/^ADMIN_EMAILS=.*$/m, `ADMIN_EMAILS=${emails.join(",")}`) : `${env.trimEnd()}\nADMIN_EMAILS=${emails.join(",")}\n`;
writeFileSync(envFile, env);
console.log(`Updated ${envFile}`);
console.log("Next: npm run deploy:rules, and set ADMIN_EMAILS in your Vercel environment variables too.");
