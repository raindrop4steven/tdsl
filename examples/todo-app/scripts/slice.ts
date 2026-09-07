/**
 * P0 最小切面闭环驱动：
 *   todo.tdsl → parse → typecheck → codegen(java) + codegen(react) → 写盘 → 双端 build
 * 任一步失败即退出非零。
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GeneratedFile } from '@tdsl/core';
import { generateJava } from '@tdsl/codegen-java';
import { generateReact } from '@tdsl/codegen-react';
import { parse } from '@tdsl/parser';
import { check } from '@tdsl/typecheck';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function step(label: string): void {
  console.log(`\n=== ${label} ===`);
}

function run(cmd: string, cwd: string, label: string): void {
  step(`${label}: ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
  console.log(`${label} OK`);
}

function writeAll(outDir: string, files: GeneratedFile[]): void {
  rmSync(outDir, { recursive: true, force: true });
  for (const f of files) {
    const p = join(outDir, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.content, 'utf8');
  }
}

// 1. parse
step('parse todo.tdsl');
const tdsl = readFileSync(join(ROOT, 'todo.tdsl'), 'utf8');
const app = parse(tdsl);
console.log(`AST: ${app.datasources.length} datasource(s), ${app.structures.length} structure(s), ${app.enums.length} enum(s), ${app.logics.length} logic(s)`);

// 2. typecheck
step('typecheck');
const result = check(app);
if (!result.ok) {
  for (const d of result.diagnostics) {
    console.error(`[${d.severity}] ${d.path}: ${d.message}`);
  }
  process.exit(1);
}
console.log('typecheck OK');

// 3. codegen 双端
step('codegen');
const javaFiles = generateJava(app);
const reactFiles = generateReact(app);
writeAll(join(ROOT, 'generated', 'java'), javaFiles);
writeAll(join(ROOT, 'generated', 'react'), reactFiles);
console.log(`java: ${javaFiles.length} files, react: ${reactFiles.length} files`);

// 4. 双端真实 build
run('mvn -q -DskipTests compile', join(ROOT, 'generated', 'java'), 'Java build (mvn compile)');
run('npm install --no-audit --no-fund --registry=https://registry.npmjs.org/', join(ROOT, 'generated', 'react'), 'React npm install');
run('npm run build', join(ROOT, 'generated', 'react'), 'React build (vite build)');

console.log('\n✅ SLICE OK: TDSL → parse → typecheck → codegen → Java(compile) + React(build) 全链路通过');