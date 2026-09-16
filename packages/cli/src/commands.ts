/**
 * 命令逻辑层（M8，薄命令层）：返回结构化结果（code + stdout），
 * bin 层只负责打印与退出码——编译服务（P3 常驻）直接复用本层。
 * 写盘边界：只有 generate/build 落盘；parse/check 永不写盘。
 */
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { AppNode, GeneratedFile, LoadedCatalog } from '@tdsl/core';
import { generateJava } from '@tdsl/codegen-java';
import { generateReact } from '@tdsl/codegen-react';
import { parseProject, TdslSyntaxError } from '@tdsl/parser';
import { check, type Diagnostic } from '@tdsl/typecheck';
import { loadLibs, type TdslInput } from './input';

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
    `  interfaces ${n(app.interfaces)} / views ${n(app.views)} / services ${n(app.services)}`,
  ].join('\n');
  return { code: 0, stdout, app };
}

/** check：parse + typecheck（含 libs 产物装载），诊断人话化输出 */
export function runCheck(input: TdslInput): CommandResult {
  const { app, code, message } = compile(input);
  if (!app) return { code, stdout: message! };

  const result = check(app, { libs: loadLibs(input.baseDir) });
  if (result.ok) {
    return { code: 0, stdout: `✓ ${input.appName}: 0 问题`, app };
  }
  return { code: 1, stdout: result.diagnostics.map(formatDiagnostic).join('\n'), app };
}

/** generate：双端 codegen 并写盘（默认 generated/{java,react}） */
export function runGenerate(input: TdslInput, outDir: string, targets: { java: boolean; react: boolean }): CommandResult & { wrote: GeneratedFile[] } {
  const { app, code, message } = compile(input);
  if (!app) return { code, stdout: message!, wrote: [] };

  const libs = loadLibs(input.baseDir);
  const java = targets.java ? generateJava(app, { libs }) : [];
  const react = targets.react ? generateReact(app) : [];
  // 双端各写各的子目录（与 runBuild 的 outDir/{java,react} 声明一致；合写根目录会混树）
  // java 目录由生成器全权所有（含 target/ 构建产物）→ 整目录重建，杜绝旧 app 名孤儿类（双主类事故）与陈旧 class
  // react 不能整目录清（node_modules 由用户 npm install）；由 writeAll 清其管理的 src/ 顶层子树
  if (targets.java) {
    rmTree(join(outDir, 'java'));
    writeAll(join(outDir, 'java'), java);
  }
  if (targets.react) {
    rmTree(join(outDir, 'react', 'src'));
    writeAll(join(outDir, 'react'), react);
  }
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

function rmTree(p: string): void {
  // Windows：句柄释放有延迟（杀进程后仍短暂 EPERM）→ 重试兜底
  try {
    rmSync(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    /* 目录不存在或被占用：后者极少发生，写盘会覆盖存活路径 */
  }
}

function writeAll(outDir: string, files: GeneratedFile[]): void {
  // 生成前先清（防孤儿：实体/端点从 AST 消失后旧文件残留——两次踩坑 com.tdsl 孤儿主类后的根治）。
  // 只清本批文件路径里的顶层子目录（如 java 的 src/、react 的 src/），根级散文件由覆盖写保证不残留过时内容。
  const managedDirs = new Set(
    files.map((f) => f.path.split(/[\\/]/)[0]).filter((t) => t !== '' && !t.includes('.')),
  );
  for (const d of managedDirs) rmTree(join(outDir, d));
  mkdirSync(outDir, { recursive: true });
  for (const f of files) {
    const p = join(outDir, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.content, 'utf8');
  }
}

// ---------- FF 是 I 通用并入（dev/27 C1）：jar → 目录 JSON（离线；java 工具链仅并入时需要） ----------

export interface BundleResult {
  code: number;
  stdout: string;
}

/** 解析 javap 输出段（单类）→ 成员列表 */
function parseJavapBody(text: string): Array<{ name: string; static: boolean; params: string[]; ret: string }> {
  const members: Array<{ name: string; static: boolean; params: string[]; ret: string }> = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('Compiled from') || t.startsWith('public class') || t.startsWith('public final class') || t.startsWith('public ' + 'abstract class') || t.startsWith('public interface') || t.startsWith('public enum') || t === '}') continue;
    const m = /^.*?\s([\w$]+)\(((?:[^\(\)]|\(.*\))*)\)\s*;?$/.exec(t);
    if (!m) continue;
    const name = m[1];
    if (name === '') continue;
    const isStatic = /\bstatic\b/.test(t);
    const argPart = m[2] ?? '';
    const ret = /;\s*descriptor:/.test('') ? '' : t.slice(t.lastIndexOf(')') + 1)?.replace(/;$/, '');
    const params = argPart === '' ? [] : argPart.split(',').map((p) => p.trim()).filter(Boolean);
    members.push({ name, static: isStatic, params, ret: ret || 'void' });
  }
  return members;
}

/** jar → 目录 JSON（dev/32 头对象形态）：javap 逐类签名 → 不对称目录（backend-only 选写） */
export function runBundleJar(jarPath: string, outPath: string, opts: { classes?: string[]; coord?: string } = {}): BundleResult {
  let text = '';
  try {
    // 类清单：jar tf
    const tf = execSync(`jar tf "${jarPath}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    const all = tf
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.endsWith('.class') && !s.includes('$') && s.includes('/'))
      .map((s) => s.replace(/\.class$/, '').replaceAll('/', '.'))
      .filter((s) => !s.endsWith('.package-info') && !s.endsWith('.module-info'));
    const filter = opts.classes?.filter(Boolean) ?? [];
    const classes = filter.length > 0
      ? all.filter((c) => filter.some((want) => c.endsWith(want) || c === want))
      : all;
    if (classes.length === 0) {
      return { code: 1, stdout: `jar 中无可编目类（或过滤条件未命中）: ${jarPath}` };
    }
    const coordinate = deriveCoordinate(jarPath, opts.coord);
    const chunks = classes.map((cls) => {
      let jp = '';
      try {
        jp = execSync(`javap -s -p -classpath "${jarPath}" "${cls}"`, { encoding: 'utf8' });
      } catch (e) {
        return '';
      }
      const members = parseJavapBody(jp);
      if (members.length === 0) return '';
      return JSON.stringify({
        class: cls,
        alias: cls.split('.').pop() ?? cls,
        frontend: false,
        members,
      }, null, 2);
    }).filter((x) => x !== '');
    const catalog = `{
  "eco": "java",
  "coordinate": ${JSON.stringify(coordinate)},
  "classes": [
${chunks.map((c) => '    ' + c.replaceAll('\n', '\n    ')).join(',\n')}
  ]
}
`;
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, catalog, 'utf8');
    return { code: 0, stdout: `✓ 并入 ${classes.length} 类 → ${outPath}（coordinate=${coordinate}；放到工程 libs/ 目录后由 dependency 声明匹配生效）` };
  } catch (e) {
    return { code: 1, stdout: `bundle-jar 失败: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}（需要 JDK：jar/javap）` };
  }
}

/** 产物坐标：--coord 覆盖 → jar 内 META-INF/maven 下 pom.properties → 文件名 stem 猜测（?:artifact:version，须人工 --coord 修正） */
function deriveCoordinate(jarPath: string, coordFlag?: string): string {
  if (coordFlag) return coordFlag;
  try {
    const tf = execSync(`jar tf "${jarPath}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    const entry = tf
      .split('\n')
      .map((s) => s.trim())
      .find((s) => s.startsWith('META-INF/maven/') && s.endsWith('/pom.properties'));
    if (entry) {
      const tmp = mkdtempSync(join(tmpdir(), 'tdsl-bundle-'));
      try {
        execSync(`jar xf "${resolve(jarPath)}" "${entry}"`, { cwd: tmp, stdio: 'ignore' });
        const props = readFileSync(join(tmp, entry), 'utf8');
        const get = (k: string): string | undefined => new RegExp(`^${k}=(.*)$`, 'm').exec(props)?.[1]?.trim();
        const g = get('groupId');
        const a = get('artifactId');
        const v = get('version');
        if (g && a && v) return `${g}:${a}:${v}`;
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }
  } catch {
    // fallthrough to filename guess
  }
  const stem = basename(jarPath).replace(/\.jar$/i, '');
  const m = /^(.*)-([0-9][^-]*)$/.exec(stem);
  return m ? `?:${m[1]}:${m[2]}` : `?:${stem}`;
}
