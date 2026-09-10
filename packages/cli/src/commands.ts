/**
 * 命令逻辑层（M8，薄命令层）：返回结构化结果（code + stdout），
 * bin 层只负责打印与退出码——编译服务（P3 常驻）直接复用本层。
 * 写盘边界：只有 generate/build 落盘；parse/check 永不写盘。
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AppNode, GeneratedFile } from '@tdsl/core';
import { generateJava } from '@tdsl/codegen-java';
import { generateReact } from '@tdsl/codegen-react';
import { parseProject, TdslSyntaxError } from '@tdsl/parser';
import { check, type Diagnostic } from '@tdsl/typecheck';
import type { TdslInput } from './input';

export interface CommandResult {
  code: number;
  stdout: string;
  /** parse 产物（generate/build 复用，避免重复编译） */
  app?: AppNode;
}

/** parse：编译 + 摘要（--json 输出完整 AST） */
export function runParse(input: TdslInput, json: boolean): CommandResult {
  const { app, code, message } = compile(input);
  if (!app) return { code, stdout: message! };

  if (json) {
    return {
      code: 0,
      stdout: JSON.stringify(app, null, 2),
      app,
    };
  }
  const n = (a: readonly unknown[]) => a.length;
  const nEntities = app.datasources.reduce((s, ds) => s + ds.entities.length, 0);
  const stdout = [
    `✓ 编译通过: ${input.appName}`,
    `  datasources ${n(app.datasources)}（entities ${nEntities}）`,
    `  structures ${n(app.structures)} / enums ${n(app.enums)} / logics ${n(app.logics)}`,
    `  interfaces ${n(app.interfaces)} / views ${n(app.views)} / services ${n(app.services)} / components ${n(app.components)}`,
  ].join('\n');
  return { code: 0, stdout, app };
}

/** check：parse + typecheck，诊断人话化输出 */
export function runCheck(input: TdslInput): CommandResult {
  const { app, code, message } = compile(input);
  if (!app) return { code, stdout: message! };

  const result = check(app);
  if (result.ok) {
    return { code: 0, stdout: `✓ ${input.appName}: 0 问题`, app };
  }
  return { code: 1, stdout: result.diagnostics.map(formatDiagnostic).join('\n'), app };
}

/** generate：双端 codegen 并写盘（默认 generated/{java,react}） */
export function runGenerate(input: TdslInput, outDir: string, targets: { java: boolean; react: boolean }): CommandResult & { wrote: GeneratedFile[] } {
  const { app, code, message } = compile(input);
  if (!app) return { code, stdout: message!, wrote: [] };

  const java = targets.java ? generateJava(app) : [];
  const react = targets.react ? generateReact(app) : [];
  // 双端各写各的子目录（与 runBuild 的 outDir/{java,react} 声明一致；合写根目录会混树）
  if (targets.java) writeAll(join(outDir, 'java'), java);
  if (targets.react) writeAll(join(outDir, 'react'), react);
  const wrote = [...java, ...react];

  const parts = [
    targets.java && `java: ${java.length} files → ${join(outDir, 'java')}`,
    targets.react && `react: ${react.length} files → ${join(outDir, 'react')}`,
  ].filter(Boolean);
  return { code: 0, stdout: `生成完成: ${parts.join('，')}`, app, wrote };
}

/** build：generate + 双端真实 build（与 slice 同路径） */
export function runBuild(input: TdslInput, outDir: string): CommandResult {
  const gen = runGenerate(input, outDir, { java: true, react: true });
  if (gen.code !== 0) return gen;

  const javaDir = join(outDir, 'java');
  const reactDir = join(outDir, 'react');
  try {
    run('mvn -q -DskipTests compile', javaDir, 'Java build (mvn compile)');
    run('npm install --no-audit --no-fund --registry=https://registry.npmjs.org/', reactDir, 'React npm install');
    run('npm run build', reactDir, 'React build (vite build)');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { code: 1, stdout: `${gen.stdout}\nbuild 失败: ${msg}`, app: gen.app };
  }
  return { code: 0, stdout: `${gen.stdout}\n✅ BUILD OK: Java(mvn compile) + React(vite build)` };
}

// ---------- 内部 ----------

/** 编译公共路径：compile 失败时返回 code=1 + 人话 message */
function compile(input: TdslInput): { app?: AppNode; code: number; message?: string } {
  try {
    const app = parseProject(input.files, input.appName);
    return { app, code: 0 };
  } catch (e) {
    if (e instanceof TdslSyntaxError) {
      return {
        code: 1,
        message: formatParseError(e),
      };
    }
    throw e;
  }
}

function formatDiagnostic(d: Diagnostic): string {
  const file = d.file && d.file !== '<stdin>' ? ` ${d.file}` : '';
  return `[${d.severity}]${file} ${d.path}: ${d.message}`;
}

function formatParseError(e: TdslSyntaxError): string {
  const file = e.file && e.file !== '<stdin>' ? `${e.file}:` : '';
  const linkStage = e.line === 0 && e.col === 0;
  const hint = linkStage ? '（引用绑定期失败：请检查实体/结构/逻辑/页面引用是否都已声明）' : '';
  return `${file}${e.message}${hint}`;
}

function run(cmd: string, cwd: string, label: string): void {
  console.log(`\n=== ${label}: ${cmd} ===`);
  execSync(cmd, { cwd, stdio: 'inherit' });
  console.log(`${label} OK`);
}

function writeAll(outDir: string, files: GeneratedFile[]): void {
  for (const f of files) {
    const p = join(outDir, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.content, 'utf8');
  }
}
