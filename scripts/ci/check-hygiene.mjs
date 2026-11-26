import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const scanAll = args.includes('--all');
let baseSha = process.env.BASE_SHA?.trim() || '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base' && args[i + 1]) {
    baseSha = args[i + 1];
    i++;
  }
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@flacso\.edu\.uy/gi;
const ALLOWED_PUBLIC_EMAILS = new Set(['inscripciones@flacso.edu.uy']);

const FORBIDDEN_FILE_PATTERNS = [
  /^\.env$/,
  /^\.env\.(?!example$|production\.example$).+/,
  /^\.secrets\//,
];

const isForbiddenFile = (file) => FORBIDDEN_FILE_PATTERNS.some((pattern) => pattern.test(file));

const SECRET_PATTERNS = [
  { name: 'Clave privada PEM/SSH', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'Access Key ID de AWS', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Google API Key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
];

const ALLOWED_PLACEHOLDER_SECRETS = new Set(['AKIAIOSFODNN7EXAMPLE']);

function git(cmdArgs) {
  return execFileSync('git', cmdArgs, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

function resolveBaseRange() {
  if (baseSha && !/^0+$/.test(baseSha)) {
    try {
      git(['rev-parse', '--verify', `${baseSha}^{commit}`]);
      return `${baseSha}...HEAD`;
    } catch {
      // Fallback if shallow clone or unknown base SHA
    }
  }
  try {
    git(['rev-parse', '--verify', 'HEAD~1^{commit}']);
    return 'HEAD~1..HEAD';
  } catch {
    return null;
  }
}

function findDisallowedEmailsInText(text) {
  const hits = [];
  for (const match of text.matchAll(EMAIL_PATTERN)) {
    const email = match[0].toLowerCase();
    if (!ALLOWED_PUBLIC_EMAILS.has(email)) {
      hits.push(match[0]);
    }
  }
  return hits;
}

const trackedFiles = git(['ls-files']).split(/\r?\n/).filter(Boolean);
const untrackedFiles = git(['ls-files', '--others', '--exclude-standard']).split(/\r?\n/)
  .filter((file) => file && !isForbiddenFile(file));
const allRepoFiles = [...new Set([...trackedFiles, ...untrackedFiles])];

let failed = false;

// 1. Archivos prohibidos rastreados
for (const file of trackedFiles) {
  if (isForbiddenFile(file)) {
    console.error(`[check-hygiene] ERROR: archivo sensible rastreado por git: ${file}`);
    failed = true;
  }
}
if (failed) process.exit(1);

// 2. Búsqueda de secretos de alta confianza en archivos del repositorio
for (const file of allRepoFiles) {
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory() || fs.statSync(file).size > 1024 * 1024) {
    continue;
  }
  const buf = fs.readFileSync(file);
  if (buf.includes(0)) continue; // binario
  const content = buf.toString('utf8');
  for (const secret of SECRET_PATTERNS) {
    const matches = [...content.matchAll(secret.regex)].filter(
      (m) => !ALLOWED_PLACEHOLDER_SECRETS.has(m[0]),
    );
    if (matches.length > 0) {
      console.error(`[check-hygiene] ERROR: posible secreto (${secret.name}) detectado en ${file}`);
      failed = true;
    }
  }
}

// 3. Guarda de correos reales @flacso.edu.uy
if (scanAll) {
  for (const file of allRepoFiles) {
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory() || fs.statSync(file).size > 1024 * 1024) {
      continue;
    }
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) continue;
    const hits = findDisallowedEmailsInText(buf.toString('utf8'));
    if (hits.length > 0) {
      console.error(`[check-hygiene] ERROR: correo real no permitido en ${file}: ${[...new Set(hits)].join(', ')}`);
      failed = true;
    }
  }
} else {
  const range = resolveBaseRange();
  const diffs = [];
  if (range) {
    diffs.push(git(['diff', '-U0', '--no-color', range]));
  }
  try {
    git(['rev-parse', '--verify', 'HEAD^{commit}']);
    diffs.push(git(['diff', '-U0', '--no-color', 'HEAD']));
  } catch {
    // Repo sin commits aún
  }
  for (const diff of diffs) {
    let currentFile = '(desconocido)';
    for (const line of diff.split(/\r?\n/)) {
      if (line.startsWith('+++ b/')) {
        currentFile = line.slice(6);
        continue;
      }
      if (!line.startsWith('+') || line.startsWith('+++')) continue;
      const hits = findDisallowedEmailsInText(line.slice(1));
      if (hits.length > 0) {
        console.error(
          `[check-hygiene] ERROR: correo real agregado en ${currentFile}: ${[...new Set(hits)].join(', ')}`
        );
        failed = true;
      }
    }
  }

  for (const file of untrackedFiles) {
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory() || fs.statSync(file).size > 1024 * 1024) {
      continue;
    }
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) continue;
    const hits = findDisallowedEmailsInText(buf.toString('utf8'));
    if (hits.length > 0) {
      console.error(`[check-hygiene] ERROR: correo real en archivo nuevo ${file}: ${[...new Set(hits)].join(', ')}`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}

console.log(
  `[check-hygiene] OK (${allRepoFiles.length} archivos revisados; guarda de correos en modo ${scanAll ? 'completo' : 'diff'}).`
);
