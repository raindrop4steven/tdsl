/**
 * M7 多文件工程端到端驱动：
 *   tdsl/*.tdsl → parseProject → typecheck → codegen(java) + codegen(react)
 *   → 与单文件拼接文本 parse 的产物逐字节对拍 → 写盘 → 双端 build
 * 任一步失败即退出非零。
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GeneratedFile } from '@tdsl/core';
import { generateJava } from '@tdsl/codegen-java';
import { generateReact } from '@tdsl/codegen-react';
import { parse, parseProject } from '@tdsl/parser';
import { check } from '@tdsl/typecheck';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TDSL_DIR = join(ROOT, 'tdsl');

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

// 1. 读入功能域分片（文件名序 = 功能域序）
step('read tdsl/*.tdsl');
const files = readdirSync(TDSL_DIR)
  .filter((f) => f.endsWith('.tdsl'))
  .sort()
  .map((name) => ({ path: name, content: readFileSync(join(TDSL_DIR, name), 'utf8') }));
console.log(`files: ${files.map((f) => f.path).join(', ')}`);

// 2. parseProject（多文件）
step('parseProject');
const app = parseProject(files, 'todomulti');
console.log(
  `AST: ${app.datasources.length} datasource(s), ${app.structures.length} structure(s), ${app.logics.length} logic(s), ${app.views.length} view(s)`,
);

// 3. 对拍：单文件拼接文本 parse vs 多文件 parseProject，双端产物必须逐字节一致
step('single-file 对拍');
const concat = files.map((f) => f.content).join('\n');
const singleApp = parse(concat);
// app 名是入参而非解析产物，对拍前对齐（codegen 包名/路径依赖它）
singleApp.name = app.name;
const javaSingle = generateJava(singleApp);
const javaMulti = generateJava(app);
const reactSingle = generateReact(singleApp);
const reactMulti = generateReact(app);
const diff = (a: GeneratedFile[], b: GeneratedFile[], label: string): void => {
  const key = (x: GeneratedFile) => `${x.path}\n${x.content}`;
  if (a.length !== b.length || a.some((x, i) => key(x) !== key(b[i]))) {
    console.error(`对拍失败: ${label} 产物不一致`);
    process.exit(1);
  }
};
diff(javaSingle, javaMulti, 'java');
diff(reactSingle, reactMulti, 'react');
console.log(`对拍 OK: java ${javaMulti.length} files, react ${reactMulti.length} files 与单文件版逐字节一致`);

// 4. typecheck
step('typecheck');
const result = check(app);
if (!result.ok) {
  for (const d of result.diagnostics) {
    console.error(`[${d.severity}] ${d.file ?? ''} ${d.path}: ${d.message}`);
  }
  process.exit(1);
}
console.log('typecheck OK');

// 5. codegen 双端
step('codegen');
writeAll(join(ROOT, 'generated', 'java'), javaMulti);
writeAll(join(ROOT, 'generated', 'react'), reactMulti);

// 6. 双端真实 build
run('mvn -q -DskipTests compile', join(ROOT, 'generated', 'java'), 'Java build (mvn compile)');
run('npm install --no-audit --no-fund --registry=https://registry.npmjs.org/', join(ROOT, 'generated', 'react'), 'React npm install');
run('npm run build', join(ROOT, 'generated', 'react'), 'React build (vite build)');

console.log('\n✅ SLICE-MULTI OK: 5 个功能域分片 → parseProject → typecheck → 双端 codegen → 对拍一致 → build 通过');
