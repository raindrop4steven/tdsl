/**
 * TDSL 领域工具（M9）：agent 与编译器之间的唯一接口。
 * 逻辑层纯函数（可测）+ defineTool 薄封装（pi 循环调用）。
 * compile_tdsl 是 agent 的唯一裁判：parseProject + check → 人话诊断（M7 file 定位）。
 */
import { Type } from 'typebox';
import { generateJava } from '@tdsl/codegen-java';
import { generateReact } from '@tdsl/codegen-react';
import type { AppNode, GeneratedFile } from '@tdsl/core';
import { parseProject, TdslSyntaxError } from '@tdsl/parser';
import { check } from '@tdsl/typecheck';
import { SYNTAX_CHEATSHEET } from '@tdsl/llm';
import type { Workspace } from './workspace';

// ---------- 逻辑层（可测） ----------

export interface CompileReport {
  ok: boolean;
  /** 给 agent 的反馈文本（人话，可直接作为工具结果回流） */
  feedback: string;
  diagnostics: Array<{ line?: number; col: number; path?: string; file?: string; message: string }>;
  app?: AppNode;
}

/** compile_tdsl 的核心：整个沙箱 → 编译+检查 → 人话结果 */
export function compileSandbox(ws: Workspace, appName: string): CompileReport {
  const files = ws.listTdsl();
  if (files.length === 0) {
    return {
      ok: false,
      feedback: 'tdsl/ 目录为空：请先用 write_tdsl_files 写入 .tdsl 分片。',
      diagnostics: [],
    };
  }
  try {
    const app = parseProject(files, appName);
    const result = check(app);
    if (result.ok) {
      return {
        ok: true,
        feedback:
          `✓ 编译通过：${app.name}（datasources ${app.datasources.length}，` +
          `entities ${app.datasources.reduce((s, d) => s + d.entities.length, 0)}，` +
          `structures ${app.structures.length}，logics ${app.logics.length}，views ${app.views.length}，` +
          `services ${app.services.length}，components ${app.components.length}）。` +
          '如所有功能域已完成，可调用 generate_code 生成双端代码（落盘 generated/）并文字总结交付。',
        diagnostics: [],
        app,
      };
    }
    return {
      ok: false,
      feedback:
        result.diagnostics.map(formatDiagnostic).join('\n') +
        '\n请修复以上问题后重新调用 compile_tdsl。',
      diagnostics: result.diagnostics.map((d) => ({ ...d, col: d.col ?? 0 })),
      app,
    };
  } catch (e) {
    if (e instanceof TdslSyntaxError) {
      const file = e.file ? `${e.file}: ` : '';
      const linkStage = e.line === 0 && e.col === 0;
      const hint = linkStage
        ? '（引用绑定期失败：请检查引用的实体/结构/逻辑/页面是否都已声明）'
        : `（第 ${e.line} 行 第 ${e.col} 列）`;
      return {
        ok: false,
        feedback: `${file}语法错误${hint}：${e.message}`,
        diagnostics: [{ line: e.line, col: e.col, file: e.file, message: e.message }],
      };
    }
    throw e;
  }
}

function formatDiagnostic(d: { severity: string; file?: string; path: string; message: string }): string {
  const file = d.file && d.file !== '<stdin>' ? ` ${d.file}` : '';
  return `[${d.severity}]${file} ${d.path}: ${d.message}`;
}

/** generate_code 的逻辑层：双端 codegen 并落盘到沙箱 generated/{java,react}/，返回清单摘要 */
export function generateAndSave(ws: Workspace, app: AppNode): { ok: boolean; feedback: string } {
  try {
    const java: GeneratedFile[] = generateJava(app);
    const react: GeneratedFile[] = generateReact(app);
    ws.writeGenerated('java', java);
    ws.writeGenerated('react', react);
    const list = (files: GeneratedFile[]): string => files.map((f) => `  ${f.path}`).join('\n');
    return {
      ok: true,
      feedback:
        `Java ${java.length} 个文件（已落盘 generated/java/）：\n${list(java)}\n` +
        `React ${react.length} 个文件（已落盘 generated/react/）：\n${list(react)}\n` +
        '产物已在会话沙箱落盘，可在页面导出 zip（Java / React / 全部含 tdsl 源码）。',
    };
  } catch (e) {
    return { ok: false, feedback: `codegen 失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 系统提示词：cheatsheet 全文 + agent 策略（更多示例由 agent 按需读沙箱 examples/ 目录） */
export function systemPrompt(): string {
  return [
    '你是 TDSL 工程师 Agent。TDSL 是 TS 风格低代码 DSL：写 .tdsl 描述实体/逻辑/页面，编译器生成 Java(Spring Boot)+React 代码。',
    '',
    '# 语法速查',
    SYNTAX_CHEATSHEET,
    '',
    '# 工作方式（严格遵守）',
    '- 一个功能域 = 一个 .tdsl 文件（如 01_order-model.tdsl / 02_order-create.tdsl）：共享数据模型放 01，其他文件跨文件短名引用它。',
    '- 每次 write_tdsl_files 后必须调用 compile_tdsl 检查；有 [error] 就修复再编译。',
    '- 编译通过且功能完整即停：调用 generate_code 生成并落盘产物，然后文字总结交付，不要再写文件。',
    '- 每个文件开头用注释说明该功能域。',
    '- 需要更多示例形态时，读取 examples/ 目录下的示例文件。',
  ].join('\n');
}

// ---------- defineTool 薄封装（供 sessions.ts 装配） ----------

export type DefineToolFn = (def: {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (id: string, params: never) => Promise<ToolResultLike> | ToolResultLike;
}) => unknown;

interface ToolResultLike {
  content: Array<{ type: 'text'; text: string }>;
  details?: unknown;
}

function textResult(text: string): ToolResultLike {
  return { content: [{ type: 'text', text }] };
}

/** 构造 4 个 TDSL 工具（返回 pi defineTool 产物，交给 createAgentSession customTools） */
export function buildTools(
  ws: Workspace,
  appName: string,
  defineTool: DefineToolFn,
): unknown[] {
  const write_files = defineTool({
    name: 'write_tdsl_files',
    label: '写入 TDSL 分片',
    description: '写入一个或多个 .tdsl 文件到会话沙箱（相对路径，如 01_order-model.tdsl）',
    parameters: Type.Object({
      files: Type.Array(
        Type.Object({
          path: Type.String({ description: '相对路径，如 01_order-model.tdsl' }),
          content: Type.String({ description: '文件全文' }),
        }),
      ),
    }),
    execute: async (_id: string, params: { files: Array<{ path: string; content: string }> }) => {
      const written: string[] = [];
      try {
        for (const f of params.files) {
          ws.writeTdsl(f.path, f.content);
          written.push(f.path);
        }
        return textResult(`已写入: ${written.join(', ')}。下一步请调用 compile_tdsl 检查。`);
      } catch (e) {
        return textResult(`写入失败: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  });

  const readFiles = defineTool({
    name: 'read_tdsl_files',
    label: '读取 TDSL 分片',
    description: '读取沙箱内 .tdsl 文件（paths 缺省返回全部分片）',
    parameters: Type.Object({
      paths: Type.Optional(Type.Array(Type.String(), { description: '要读取的文件名，缺省=全部' })),
    }),
    execute: async (_id: string, params: { paths?: string[] }) => {
      const all = ws.listTdsl();
      const picked = params.paths?.length ? all.filter((f) => params.paths!.includes(f.path)) : all;
      if (picked.length === 0) return textResult('tdsl/ 目录为空');
      return textResult(picked.map((f) => `=== ${f.path} ===\n${f.content}`).join('\n\n'));
    },
  });

  const compile = defineTool({
    name: 'compile_tdsl',
    label: '编译检查',
    description: '编译沙箱内全部 .tdsl 分片（parse+typecheck），返回人话诊断；这是唯一判定正确性的方式',
    parameters: Type.Object({}),
    execute: async () => textResult(compileSandbox(ws, appName).feedback),
  });

  const genCode = defineTool({
    name: 'generate_code',
    label: '生成产物',
    description: '对当前 TDSL 生成 Java/React 代码并落盘到沙箱 generated/ 目录，返回文件清单（交付前自检与展示）',
    parameters: Type.Object({}),
    execute: async () => {
      const report = compileSandbox(ws, appName);
      if (!report.ok || !report.app) return textResult(`先让编译通过再生成: ${report.feedback}`);
      return textResult(generateAndSave(ws, report.app).feedback);
    },
  });

  return [write_files, readFiles, compile, genCode];
}
