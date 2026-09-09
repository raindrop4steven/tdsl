/**
 * 校验修复闭环（Prompt Pack P3：parser-in-the-loop，dev/19 §6）。
 * parser（行列错误）与 typecheck（nodePath 诊断）作为确定性裁判，格式化后回流给 LLM 定向重试。
 */
import { parse, TdslSyntaxError } from '@tdsl/parser';
import type { AppNode } from '@tdsl/core';
import { check, type Diagnostic } from '@tdsl/typecheck';

export interface ValidationResult {
  ok: boolean;
  /** 仅 ok 时返回已绑定 nodePath 的 AST */
  app?: AppNode;
  /** 仅 !ok 时返回：给 LLM 的错误反馈（可直接拼进修复 prompt） */
  feedback?: string;
  /** 结构化诊断（调用方自用；LLM 面向的是 feedback 字符串） */
  diagnostics?: Array<{ line?: number; col?: number; path?: string; message: string }>;
}

/** nodePath → LLM/人话（dev/19 §8：语义级提示比行列更好懂） */
export function humanizePath(app: AppNode, path: string): string {
  const seg = path.split('.');
  const find = (kind: string, list: Array<{ name?: string }>): string | null => {
    for (let i = seg.length - 1; i >= 0; i--) {
      const hit = list.find((n) => n.name === seg[i]);
      if (hit && seg[i - 1] === kind) return seg[i];
    }
    return null;
  };
  const entity = find('entities', app.datasources.flatMap((d) => d.entities)) ?? null;
  const logic = find('logics', app.logics);
  const view = find('views', app.views);
  const structure = find('structures', app.structures);
  const service = find('services', app.services);
  const component = find('components', app.components);
  if (entity !== null) {
    const dsIdx = seg.indexOf('datasources');
    const ds = dsIdx >= 0 && seg[dsIdx + 1] ? `（数据源 ${seg[dsIdx + 1]}）` : '';
    return `实体 ${entity}${ds}`;
  }
  if (logic) return `逻辑 ${logic}`;
  if (view) return `页面 ${view}`;
  if (structure) return `结构 ${structure}`;
  if (service) return `服务 ${service}`;
  if (component) return `组件 ${component}`;
  return path;
}

/** 校验 TDSL 文本：parse → typecheck，任一失败返回可回流 LLM 的 feedback */
export function validateTdsl(input: string): ValidationResult {
  let app: AppNode;
  try {
    app = parse(input);
  } catch (e) {
    if (e instanceof TdslSyntaxError) {
      const located = e.line > 0 || e.col > 0;
      const at = located ? `（第 ${e.line} 行 第 ${e.col} 列）` : '（link 阶段：请检查引用的实体/结构/逻辑/页面是否都已声明）';
      return {
        ok: false,
        feedback: `语法错误${at}：${e.message}\n请修复该错误及受影响的上下文。`,
        diagnostics: [{ line: e.line, col: e.col, message: e.message }],
      };
    }
    throw e;
  }
  const result = check(app);
  if (!result.ok) {
    const lines = result.diagnostics.map((d: Diagnostic) => {
      const where = d.path ? ` [${humanizePath(app, d.path)}]` : '';
      return `- ${d.severity}${where}: ${d.message}`;
    });
    return {
      ok: false,
      feedback: `类型检查未通过（共 ${result.diagnostics.length} 个问题）：\n${lines.join('\n')}`,
      diagnostics: result.diagnostics.map((d) => ({
        path: d.path,
        line: d.line,
        col: d.col,
        message: d.message,
      })),
    };
  }
  return { ok: true, app };
}

/** 修复 prompt：给出原稿 + 反馈，要求输出完整修正稿（不做 diff，避免 LLM 改错位置） */
export function repairPrompt(original: string, feedback: string): string {
  return `你上一轮输出的 TDSL 编译失败。以下是原稿与编译器反馈：

===== 编译器反馈 =====
${feedback}

===== 你的上一轮输出（原稿）=====
${original}

===== 修复要求 =====
根据反馈逐条修复，输出**修正后的完整 TDSL 源文件**（不是 diff、不是片段）。
- 语法错误按行列定位修复
- 类型检查错误按 [实体/逻辑/页面] 提示修复（悬空引用通常意味着引用了未声明的类型/逻辑）
- 除反馈涉及的问题外，其余内容保持原样
只输出修正后的 TDSL，不要代码块包裹，不要解释。`;
}

/** 多轮修复驱动的小工具：把 validate/repair 拼成调用方循环（调用方自己发 LLM 请求） */
export function repairLoopPlan(
  draft: string,
  maxRounds: number,
  validate: (input: string) => ValidationResult = validateTdsl,
): { rounds: Array<{ feedback: string; prompt: string }>; finalOk: boolean; app?: AppNode } {
  const rounds: Array<{ feedback: string; prompt: string }> = [];
  let current = draft;
  let result = validate(current);
  for (let i = 0; i < maxRounds && !result.ok; i++) {
    const prompt = repairPrompt(current, result.feedback ?? '');
    rounds.push({ feedback: result.feedback ?? '', prompt });
    // 占位：真实循环由调用方用 LLM 响应替换 current；此处供测试/演示驱动
    current = draft;
    result = validate(current);
  }
  return { rounds, finalOk: result.ok, app: result.ok ? result.app : undefined };
}

export type { Diagnostic } from '@tdsl/typecheck';
