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
import type { AppRunner } from './runner';
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
    // 诊断封顶 10 条：连锁错误会随修复消失，先修已列出的即可（大项目不撑爆上下文）
    const shown = result.diagnostics.slice(0, 10);
    const rest = result.diagnostics.length - shown.length;
    const diagText =
      shown.map(formatDiagnostic).join('\n') +
      (rest > 0 ? `\n…另有 ${rest} 条（先修以上错误，连锁错误会消失）` : '');
    return {
      ok: false,
      feedback: diagText + '\n请修复以上问题后重新调用 compile_tdsl。',
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

/** generate_code 的逻辑层：双端 codegen 并落盘到沙箱 generated/{java,react}/，反馈按目录聚合（大项目不拉全清单） */
export function generateAndSave(
  ws: Workspace,
  app: AppNode,
  opts?: { list?: boolean },
): { ok: boolean; feedback: string } {
  try {
    const java: GeneratedFile[] = generateJava(app);
    const react: GeneratedFile[] = generateReact(app);
    // 先清空旧产物再写入：TDSL 迭代删除的页面/文件不留孤儿（孤儿会让 vite build/tsc 失败）
    ws.clearGenerated('java');
    ws.clearGenerated('react');
    ws.writeGenerated('java', java);
    ws.writeGenerated('react', react);
    // 按目录聚合（规模感知）；逐文件清单仅在显式要求时给出
    const byDir = (files: GeneratedFile[]): string => {
      const m = new Map<string, number>();
      for (const f of files) {
        const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '(根目录)';
        m.set(dir, (m.get(dir) ?? 0) + 1);
      }
      const summary = [...m.entries()].sort().map(([d, n]) => `  ${d}/ (${n} 个文件)`).join('\n');
      return opts?.list ? `${summary}\n全部路径：\n${files.map((f) => `  ${f.path}`).join('\n')}` : summary;
    };
    return {
      ok: true,
      feedback:
        `Java ${java.length} 个文件（已落盘 generated/java/）：\n${byDir(java)}\n` +
        `React ${react.length} 个文件（已落盘 generated/react/）：\n${byDir(react)}\n` +
        '产物已落盘，页面可导出 zip（Java / React / 全部含 tdsl 源码）。' +
        '\n建议调用 run_app restart 让改动生效（vite 页面热更，后端需重启）。',
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
    '- 表单必须绑定提交：<form submit={useMutation(\'逻辑名\')}>；提交按钮由生成器自动产生，不要再写单独的提交按钮。',
    '- 新增/编辑类表单用 dialog 声明（不进路由、不占菜单），列表页用 openDialog(\'DialogName\') 打开；dialog 内 form 提交成功后自动关闭。',
    '- 常用组件已内置：tag（状态标签，颜色可用 color= 指定）、statistic（统计卡）、tabs>pane（标签页）、switch/checkbox/radio、avatar/badge/card。枚举表格列自动彩色标签，Boolean 字段自动开关。',
    '- 字段控件由生成器按类型升级（枚举→下拉、日期→日期选择器、数字→数字输入），agent 只写普通 <input field>，不要自造下拉。',
    '- 日期/时间字段用 Date/DateTime 类型；表单字段名必须与首参结构体的属性名一致。',
    '- 编译通过不是交付标准：改完必须 run_app restart 并读 logs 确认无 ERROR 后再总结。',
    '- 用户提供运行反馈（如“保存报 500”“页面白屏”）→ 先 run_app logs 定位，再改 DSL，编译→生成→restart→日志验证。',
    '- 首次编译通过后主动 run_app up，并告知用户前端页面地址。',
    '- 上下文节约：分片多时先 read_tdsl_files 看清单再按需读具体文件；诊断超过 10 条先修已列出的；generate_code 默认只看目录摘要，需要路径才带 list=true。',
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
  runner?: AppRunner,
  onState?: () => void,
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
    description: '读取沙箱内 .tdsl 文件；不带 paths 先返回清单（含行数），带 paths 读具体内容——大项目按需读取，别一次读全部',
    parameters: Type.Object({
      paths: Type.Optional(Type.Array(Type.String(), { description: '要读取的文件名；缺省只返回清单' })),
    }),
    execute: async (_id: string, params: { paths?: string[] }) => {
      const all = ws.listTdsl();
      if (all.length === 0) return textResult('tdsl/ 目录为空');
      // 缺省只给清单（行数），agent 按需选读（pi grep/read 哲学：模型决定拉什么）
      if (!params.paths?.length) {
        const list = all.map((f) => `  ${f.path} (${f.content.split('\n').length} 行)`).join('\n');
        return textResult(`共 ${all.length} 个分片：\n${list}\n需要内容时用 paths 参数按文件读取。`);
      }
      const want = params.paths ?? [];
      const picked = all.filter((f) => want.includes(f.path));
      if (picked.length === 0) return textResult(`未找到：${want.join(', ')}（可用清单对照文件名）`);
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
    description: '对当前 TDSL 生成 Java/React 代码并落盘到沙箱 generated/ 目录，返回按目录聚合的摘要；list=true 时附带逐文件路径',
    parameters: Type.Object({
      list: Type.Optional(Type.Boolean({ description: '是否附带逐文件路径清单（默认按目录聚合）' })),
    }),
    execute: async (_id: string, params: { list?: boolean }) => {
      const report = compileSandbox(ws, appName);
      if (!report.ok || !report.app) return textResult(`先让编译通过再生成: ${report.feedback}`);
      const r = generateAndSave(ws, report.app, { list: params.list });
      if (r.ok) {
        return textResult(`${r.feedback}\n生成完成后建议调用 run_app restart 让改动生效（vite 页面会热更新，后端需重启）。`);
      }
      return textResult(r.feedback);
    },
  });

  // M10 运行回路：编排固定命令（非 bash），agent 自主起停前后端、读运行日志
  const runApp = defineTool({
    name: 'run_app',
    label: '运行应用',
    description: '编译产物的前后端运行编排：up 启动（vite dev + mvn spring-boot:run，H2 内存库）、down 停止、restart 重启（改动生效）、status 查看状态、logs 读运行日志（含前端报错自动回流）',
    parameters: Type.Object({
      action: Type.Union([Type.Literal('up'), Type.Literal('down'), Type.Literal('restart'), Type.Literal('status'), Type.Literal('logs')], {
        description: 'up=启动 down=停止 restart=重启 status=状态 logs=日志',
      }),
      which: Type.Optional(Type.Union([Type.Literal('backend'), Type.Literal('frontend'), Type.Literal('client')], { description: 'logs 时的日志源，缺省=全部' })),
    }),
    execute: async (_id: string, params: { action: 'up' | 'down' | 'restart' | 'status' | 'logs'; which?: 'backend' | 'frontend' | 'client' }) => {
      if (!runner) return textResult('运行器不可用（会话未装配 runner）');
      const st = (): string => {
        const s = runner.status();
        return `后端 ${s.backend}（:${s.backendPort}） 前端 ${s.frontend}（:${s.frontendPort}） 前端页面 ${s.urls.frontend}`;
      };
      switch (params.action) {
        case 'up':
          return textResult(`${runner.up(onState)}\n当前：${st()}`);
        case 'down':
          return textResult(`${runner.down(onState)}\n当前：${st()}`);
        case 'restart':
          return textResult(`${await runner.restart(onState)}\n当前：${st()}`);
        case 'status':
          return textResult(st());
        case 'logs':
          return textResult(runner.logs(params.which));
      }
    },
  });

  return [write_files, readFiles, compile, genCode, runApp];
}
