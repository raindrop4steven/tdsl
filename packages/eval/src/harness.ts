/**
 * 单样例评测动作（C4）：
 *   样卷 → PromptPack → LLM → validateTdsl → 修复闭环 ≤N → 绿则 codegen 双端 build
 * 指标：首轮 parse/check 通过、修复轮次、build 通过、耗时；产物落盘。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import type { AppNode, GeneratedFile } from '@tdsl/core';
import { generateJava } from '@tdsl/codegen-java';
import { generateReact } from '@tdsl/codegen-react';
import { parseProject } from '@tdsl/parser';
import { check as typecheck } from '@tdsl/typecheck';
import { composePrompt } from '@tdsl/llm';
import { repairPrompt } from '@tdsl/llm';
import { stripCodeBlock as stripFence } from './provider';

export type LlmCall = (prompt: string) => Promise<string>;

export interface EvalOptions {
  maxRounds: number;
  skipBuild: boolean;
  artifactDir: string;
}

export interface EvalRecord {
  sampleId: string;
  firstParsePass: boolean;
  firstCheckPass: boolean;
  repairRounds: number;
  finalPass: boolean;
  buildJava: 'skip' | 'pass' | 'fail';
  buildReact: 'skip' | 'pass' | 'fail';
  durationMs: number;
  error: string | null;
}

/** 单样例评测（llm 可注入 mock） */
export async function evalSample(
  sample: { id: string; title: string; requirement: string },
  llm: LlmCall,
  opts: EvalOptions,
): Promise<EvalRecord> {
  const started = Date.now();
  const record: EvalRecord = {
    sampleId: sample.id,
    firstParsePass: false,
    firstCheckPass: false,
    repairRounds: 0,
    finalPass: false,
    buildJava: opts.skipBuild ? 'skip' : 'skip',
    buildReact: opts.skipBuild ? 'skip' : 'skip',
    durationMs: 0,
    error: null,
  };
  mkdirSync(opts.artifactDir, { recursive: true });
  writeFileSync(join(opts.artifactDir, 'spec.md'), sample.requirement, 'utf8');

  try {
    const prompt = composePrompt({ requirement: sample.requirement, maxExamples: 5 } as never);
    let draft = stripFence(await llm(prompt));
    writeFileSync(join(opts.artifactDir, 'draft.tdsl'), draft, 'utf8');

    let st = compileTdsl(draft);
    record.firstParsePass = resultPassesParse(st);
    record.firstCheckPass = st.ok;

    // 修复闭环 ≤N 轮
    let current = draft;
    for (let i = 0; i < opts.maxRounds && !st.ok; i++) {
      const rp = repairPrompt(current, humanFeedback(st));
      current = stripFence(await llm(rp));
      record.repairRounds = i + 1;
      writeFileSync(join(opts.artifactDir, `repair-${i}.tdsl`), current, 'utf8');
      const newState = compileTdsl(current);
      if (newState.ok) {
        record.finalPass = true;
        st = newState;
        break;
      }
      if (betterThan(st, newState)) st = newState;
    }
    if (st.ok) {
      record.finalPass = true;
      writeFileSync(join(opts.artifactDir, 'final.tdsl'), current, 'utf8');
    }
    if (!record.finalPass) {
      record.error = firstErrorText(st);
      record.durationMs = Date.now() - started;
      return record;
    }

    // 绿了 → codegen
    const app = st.app!;
    if (!opts.skipBuild) {
      record.buildJava = await buildJavaDir(app, join(opts.artifactDir, 'java'));
      if (record.buildJava === 'pass') {
        record.buildReact = 'pass'; // vite build 见下
        if (!opts.skipBuild) record.buildReact = await buildReactDir(app, join(opts.artifactDir, 'react')) as 'pass' | 'fail';
      }
    }
    record.buildJava = opts.skipBuild ? 'skip' : record.buildJava;
  } catch (e) {
    record.error = e instanceof Error ? e.message : String(e);
  }
  record.durationMs = Date.now() - started;
  return record;
}

interface CompileState {
  ok: boolean;
  app: AppNode | null;
  diagnostics: string[];
  stage: 'parse' | 'check' | 'none';
}
function resultPassesParse(s: CompileState): boolean {
  return s.stage === 'check' || (s.ok && s.stage === 'none');
}
function betterThan(prev: CompileState, next: CompileState): boolean {
  // 修复轮进度 = 诊断更少
  return next.diagnostics.length < prev.diagnostics.length;
}
function firstErrorText(s: CompileState): string {
  return s.diagnostics.slice(0, 3).join('；');
}

function compileState(input: string): CompileState {
  try {
    const app = parseProject([{ path: 'input.tdsl', content: input }], 'evalapp');
    const t = typecheck(app);
    if (t.diagnostics.length > 0) {
      return { ok: false, app, diagnostics: t.diagnostics.map((d) => d.message), stage: 'check' };
    }
    return { ok: true, app, diagnostics: [], stage: 'none' };
  } catch (e) {
    return { ok: false, app: null, diagnostics: [e instanceof Error ? e.message : String(e)], stage: 'parse' };
  }
}

/** 单轮修复后编译 */
function compileTdsl(input: string): CompileState {
  return compileState(input);
}

function humanFeedback(s: CompileState): string {
  return `当前编译失败，请输出修正后的完整 TDSL。失败信息：\n${s.diagnostics.slice(0, 6).join('；')}`;
}

/** build：java → mvn；react → vite（不 npm install 时 skip） */
function buildJavaDir(app: AppNode, javaDir: string): Promise<'pass' | 'fail'> {
  mkdirSync(javaDir, { recursive: true });
  const files = generateJava(app);
  return buildSync(files, javaDir, 'mvn -q -DskipTests compile');
}

function buildSync(files: GeneratedFile[], dir: string, cmd: string): Promise<'pass' | 'fail'> {
  for (const f of files) {
    mkdirSync(join(dir, dirname(f.path)), { recursive: true });
    writeFileSync(join(dir, f.path), f.content, 'utf8');
  }
  try {
    execSync(cmd, { cwd: dir, stdio: 'ignore', timeout: 5 * 60 * 1000 });
    return Promise.resolve('pass');
  } catch (e) {
    void e;
    return Promise.resolve('fail');
  }
}

function buildReactDir(app: AppNode, reactDir: string): Promise<'pass' | 'fail'> {
  const files = generateReact(app);
  mkdirSync(reactDir, { recursive: true });
  for (const f of files) {
    mkdirSync(join(reactDir, dirname(f.path)), { recursive: true });
    writeFileSync(join(reactDir, f.path), f.content, 'utf8');
  }
  try {
    execSync('npm install --no-audit --no-fund --registry=https://registry.npmjs.org/', { cwd: reactDir, stdio: 'ignore', timeout: 8 * 60 * 1000 });
    execSync('npm run build', { cwd: reactDir, stdio: 'ignore', timeout: 5 * 60 * 1000 });
    return Promise.resolve('pass');
  } catch (e) {
    void e;
    return Promise.resolve('fail');
  }
}
