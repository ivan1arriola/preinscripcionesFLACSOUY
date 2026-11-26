import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const MIGRATIONS_DIR = 'apps/api/src/infrastructure/database/migrations';
const CONTRACTION_MARKER = '// @migration-contraction';

const args = process.argv.slice(2);
let baseSha = process.env.BASE_SHA?.trim() || '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base' && args[i + 1]) {
    baseSha = args[i + 1];
    i++;
  }
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function extractUpBody(source) {
  const upMatch = /export\s+async\s+function\s+up\s*\(/.exec(source);
  if (!upMatch) return source;
  const fromUp = source.slice(upMatch.index);
  const downMatch = /export\s+async\s+function\s+down\s*\(/.exec(fromUp);
  return downMatch ? fromUp.slice(0, downMatch.index) : fromUp;
}

const DESTRUCTIVE_PATTERNS = [
  { name: 'SQL DROP', regex: /\bDROP\s+(?:TABLE|COLUMN|INDEX|VIEW|SCHEMA|CONSTRAINT|TRIGGER|TYPE|FUNCTION)\b/i },
  { name: 'SQL RENAME', regex: /\bRENAME\s+(?:TABLE|COLUMN|INDEX|CONSTRAINT)\b/i },
  { name: 'ALTER TABLE DROP/RENAME', regex: /\bALTER\s+TABLE\b[^;]*\b(?:DROP|RENAME)\b/i },
  { name: 'Kysely schema drop/rename', regex: /\.(?:dropTable|dropColumn|dropIndex|renameTable|renameColumn)\s*\(/ },
];

function changedMigrationFiles(sha) {
  if (!sha || /^0+$/.test(sha)) return [];
  try {
    execFileSync('git', ['rev-parse', '--verify', `${sha}^{commit}`], { stdio: 'ignore' });
    const out = execFileSync(
      'git',
      ['diff', '--name-only', '--diff-filter=AM', `${sha}...HEAD`, '--', MIGRATIONS_DIR],
      { encoding: 'utf8' }
    );
    return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const allFiles = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map((name) => `${MIGRATIONS_DIR}/${name}`);

const changedSet = new Set(changedMigrationFiles(baseSha));
const targets = allFiles.filter((file) => {
  const numMatch = /^(\d+)_/.exec(path.basename(file));
  const num = numMatch ? Number(numMatch[1]) : 0;
  return num >= 31 || changedSet.has(file);
});

let failed = false;
for (const file of targets) {
  const raw = fs.readFileSync(file, 'utf8');
  if (raw.includes(CONTRACTION_MARKER)) {
    console.log(`[check-migrations] OK (marcada como contracción): ${file}`);
    continue;
  }
  const upBody = stripComments(extractUpBody(raw));
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    const hit = pattern.regex.exec(upBody);
    if (hit) {
      console.error(
        `[check-migrations] ERROR en ${file}: se detectó ${pattern.name} ("${hit[0]}"). ` +
          `Las migraciones nuevas deben ser solo aditivas; para contracción explícita usar "${CONTRACTION_MARKER}".`
      );
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}

console.log(`[check-migrations] Verificadas ${targets.length} migración(es) objetivo sin operaciones destructivas no autorizadas.`);
