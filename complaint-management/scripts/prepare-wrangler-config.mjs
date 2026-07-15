import { readFile, writeFile } from "node:fs/promises";

const target = process.env.TARGET_ENV;
const databaseId = process.env.D1_DATABASE_ID;
const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN;
const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY;

if (!['preview', 'production'].includes(target ?? '')) throw new Error('TARGET_ENV must be preview or production.');
if (!databaseId || !/^[a-f0-9-]{20,}$/i.test(databaseId)) throw new Error('D1_DATABASE_ID is missing or invalid.');
if (!allowedDomain || !/^[a-z0-9.-]+$/i.test(allowedDomain)) throw new Error('ALLOWED_EMAIL_DOMAIN is missing or invalid.');
if (!turnstileSiteKey) throw new Error('TURNSTILE_SITE_KEY is required.');

const path = new URL('../wrangler.jsonc', import.meta.url);
const config = JSON.parse(await readFile(path, 'utf8'));
const environment = config.env[target];
environment.d1_databases[0].database_id = databaseId;
environment.vars.ALLOWED_EMAIL_DOMAIN = allowedDomain;
environment.vars.TURNSTILE_SITE_KEY = turnstileSiteKey;

await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
console.log(`Prepared Wrangler configuration for ${target}.`);
