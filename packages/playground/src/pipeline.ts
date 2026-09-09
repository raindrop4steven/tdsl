/**
 * 浏览器端编译管线（纯函数，与 slice.ts 同路径，不写盘不触发 build）：
 *   tdsl → parse → typecheck → generateJava + generateReact
 * 失败即短路：parse 失败给 parseError（带行列，供编辑器标红）；check 失败产物为空，诊断给原因。
 */
import { parse, TdslSyntaxError } from '@tdsl/parser';
import { check } from '@tdsl/typecheck';
import type { AppNode, GeneratedFile } from '@tdsl/core';
import type { Diagnostic } from '@tdsl/typecheck';
import { generateJava } from '@tdsl/codegen-java';
import { generateReact } from '@tdsl/codegen-react';

export interface ParseErrorInfo {
  line: number;
  col: number;
  message: string;
  /** true = link 阶段错误（line/col 无意义，行列是 0） */
  linkStage: boolean;
}

export interface CompileResult {
  ok: boolean;
  app?: AppNode;
  parseError?: ParseErrorInfo;
  /** typecheck 诊断（仅 parse 通过后产生） */
  diagnostics: Diagnostic[];
  java: GeneratedFile[];
  react: GeneratedFile[];
  /** 耗时（状态栏展示） */
  ms: number;
}

export function compile(tdsl: string): CompileResult {
  const start = performance.now();

  // 1. parse
  let app: AppNode;
  try {
    app = parse(tdsl);
  } catch (e) {
    if (e instanceof TdslSyntaxError) {
      const linkStage = e.line === 0 && e.col === 0;
      const message = linkStage ? `${e.message}（引用绑定期失败：请检查实体/结构/逻辑/页面引用是否都已声明）` : e.message;
      return {
        ok: false,
        parseError: { line: e.line, col: e.col, message, linkStage },
        diagnostics: [],
        java: [],
        react: [],
        ms: elapsed(start),
      };
    }
    throw e;
  }

  // 2. typecheck
  const checkResult = check(app);
  if (!checkResult.ok) {
    return {
      ok: false,
      app,
      diagnostics: checkResult.diagnostics,
      java: [],
      react: [],
      ms: elapsed(start),
    };
  }

  // 3. 双端 codegen
  return {
    ok: true,
    app,
    diagnostics: [],
    java: generateJava(app),
    react: generateReact(app),
    ms: elapsed(start),
  };
}

function elapsed(start: number): number {
  return Math.max(1, Math.round(performance.now() - start));
}
