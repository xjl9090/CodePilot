import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const EXEC_PLANS_DIR = path.join(REPO_ROOT, 'docs', 'exec-plans');
const README_PATH = path.join(EXEC_PLANS_DIR, 'README.md');
const ACTIVE_DIR = path.join(EXEC_PLANS_DIR, 'active');
const COMPLETED_DIR = path.join(EXEC_PLANS_DIR, 'completed');
// Archive buckets (document-system-governance). Phase 1 only teaches the linter
// to RECOGNIZE these dirs (link resolution + index sync + table shape); the
// structured top-banner rule that forbids superseded/deferred markers in active/
// is added later (Phase 4), after files are moved, to avoid a must-fail window.
const DEFERRED_DIR = path.join(EXEC_PLANS_DIR, 'deferred');
const SUPERSEDED_DIR = path.join(EXEC_PLANS_DIR, 'superseded');

// Active files that are long-running orchestrators (never archive). Completed
// plans MAY reference these — they're stable indices, not phase work.
const LONG_LIVED_ACTIVE = new Set([
  'refactor-closeout.md',
  'issue-tracker.md',
]);

const errors = [];

function listMd(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.md'))
    .map((d) => d.name);
}

function extractLinks(md) {
  const out = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    out.push({ label: m[1], target: m[2] });
  }
  return out;
}

if (!fs.existsSync(README_PATH)) {
  errors.push(`docs/exec-plans/README.md not found at ${README_PATH}`);
} else {
  const readme = fs.readFileSync(README_PATH, 'utf8');
  const links = extractLinks(readme);

  for (const { label, target } of links) {
    if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('#')) continue;
    const onlyPath = target.split('#')[0];
    if (!onlyPath) continue;
    const isPlanLink =
      onlyPath.startsWith('active/') ||
      onlyPath.startsWith('completed/') ||
      onlyPath.startsWith('deferred/') ||
      onlyPath.startsWith('superseded/') ||
      onlyPath.startsWith('./active/') ||
      onlyPath.startsWith('./completed/') ||
      onlyPath.startsWith('./deferred/') ||
      onlyPath.startsWith('./superseded/');
    if (!isPlanLink) continue;
    const resolved = path.resolve(EXEC_PLANS_DIR, onlyPath);
    if (!fs.existsSync(resolved)) {
      errors.push(
        `README link broken: [${label}](${target}) — target file does not exist (resolved: ${path.relative(REPO_ROOT, resolved)})`,
      );
    }
  }

  const activeFiles = listMd(ACTIVE_DIR).filter((f) => f !== 'README.md');
  const completedFiles = listMd(COMPLETED_DIR).filter((f) => f !== 'README.md');

  for (const name of activeFiles) {
    const patterns = [`active/${name}`, `./active/${name}`];
    const found = patterns.some((p) => readme.includes(`(${p})`));
    if (!found) {
      errors.push(
        `Active file not indexed: docs/exec-plans/active/${name} exists but is not linked anywhere in README.md`,
      );
    }
  }

  for (const name of completedFiles) {
    const patterns = [`completed/${name}`, `./completed/${name}`];
    const found = patterns.some((p) => readme.includes(`(${p})`));
    if (!found) {
      errors.push(
        `Completed file not indexed: docs/exec-plans/completed/${name} exists but is not linked anywhere in README.md`,
      );
    }
  }

  // Archive buckets must be indexed too (README.md per-dir excluded).
  for (const [dir, label] of [[DEFERRED_DIR, 'deferred'], [SUPERSEDED_DIR, 'superseded']]) {
    const files = listMd(dir).filter((f) => f !== 'README.md');
    for (const name of files) {
      const patterns = [`${label}/${name}`, `./${label}/${name}`];
      const found = patterns.some((p) => readme.includes(`(${p})`));
      if (!found) {
        errors.push(
          `${label} file not indexed: docs/exec-plans/${label}/${name} exists but is not linked anywhere in README.md`,
        );
      }
    }
  }
}

if (fs.existsSync(COMPLETED_DIR)) {
  const completedFiles = listMd(COMPLETED_DIR).filter((f) => f !== 'README.md');
  for (const name of completedFiles) {
    const fullPath = path.join(COMPLETED_DIR, name);
    const text = fs.readFileSync(fullPath, 'utf8');
    const links = extractLinks(text);
    for (const { label, target } of links) {
      const onlyPath = target.split('#')[0];
      if (!onlyPath) continue;
      const goesIntoActive = onlyPath.includes('../active/') || onlyPath.startsWith('active/');
      if (!goesIntoActive) continue;
      const targetName = path.basename(onlyPath);
      if (LONG_LIVED_ACTIVE.has(targetName)) continue;
      errors.push(
        `Completed file links into active/: docs/exec-plans/completed/${name} has link [${label}](${target}). Archived plans should link to handover/, completed/ peers, or long-lived orchestrators (${[...LONG_LIVED_ACTIVE].join(', ')}) — not phase-work active files.`,
      );
    }
  }
}

// Table-structure guard. The index tables are all 3-column
// (文件 | 主题 | 状态/日期/...). A botched edit can mash two rows onto one
// line (`...才进 Phase 2 || [active/phase-8...]`); the link-existence
// checks above MISS this because both links still resolve. Found
// 2026-05-26 when a hunk split merged the Phase 8 row into the row
// above it. Enforce: every table row that links to a plan must be a
// single, well-formed 3-column row.
if (fs.existsSync(README_PATH)) {
  const lines = fs.readFileSync(README_PATH, 'utf8').split('\n');
  const planLinkRe = /\]\((?:\.\/)?(?:active|completed|deferred|superseded)\//;
  lines.forEach((line, idx) => {
    if (!line.trimStart().startsWith('|')) return; // table rows only
    if (!planLinkRe.test(line)) return; // rows that link to a plan only
    const lineNo = idx + 1;
    if (line.includes('|| ') || line.includes('||[')) {
      errors.push(
        `README.md line ${lineNo}: merged-row artifact ('||') — two table rows mashed onto one line: ${line.slice(0, 90)}…`,
      );
      return;
    }
    // `| a | b | c |` → split('|') → ['', a, b, c, ''] = 5 parts = 3 cells.
    const parts = line.split('|');
    const columns = parts.length - 2;
    if (parts.length !== 5) {
      errors.push(
        `README.md line ${lineNo}: table row has ${columns} columns, expected 3 (index tables are 3-column): ${line.slice(0, 90)}…`,
      );
    }
  });
}

if (errors.length > 0) {
  console.error('\n[lint:docs-drift] FAILED — docs/exec-plans is out of sync:\n');
  for (const e of errors) console.error('  - ' + e);
  console.error(
    '\nFix: update docs/exec-plans/README.md index, or move stale files to completed/, or repoint completed/ internal links to handover/ or completed/ peers.\n',
  );
  process.exit(1);
}

console.log('[lint:docs-drift] ok — docs/exec-plans/README.md is in sync with active/ and completed/.');
