import type { AppNode } from '@tdsl/core';
import type { Diagnostic } from '@tdsl/typecheck';
import { humanizePath } from '@tdsl/llm';
import type { ParseErrorInfo } from '../pipeline';

interface Props {
  ok: boolean;
  app?: AppNode;
  parseError?: ParseErrorInfo;
  diagnostics: Diagnostic[];
}

/** 诊断面板：parse 错误（行列）+ typecheck 诊断（nodePath 人话化） */
export function DiagnosticsTab({ ok, app, parseError, diagnostics }: Props) {
  const items: Array<{ level: 'error'; title: string; detail?: string }> = [];
  if (parseError) {
    items.push({
      level: 'error',
      title: parseError.linkStage
        ? `引用绑定失败：${parseError.message}`
        : `语法错误（第 ${parseError.line} 行 第 ${parseError.col} 列）：${parseError.message}`,
    });
  }
  for (const d of diagnostics) {
    const where = app && d.path ? `［${humanizePath(app, d.path)}］` : '';
    items.push({ level: 'error', title: `${where} ${d.message}`.trim() });
  }

  if (ok) {
    return <div className="tab-body ok">✓ 无诊断，编译通过</div>;
  }
  return (
    <div className="tab-body">
      <div className="diag-count">共 {items.length} 个问题</div>
      {items.map((it, i) => (
        <div key={i} className="diag-item">
          <span className="diag-badge">错误</span>
          <span>{it.title}</span>
        </div>
      ))}
    </div>
  );
}
