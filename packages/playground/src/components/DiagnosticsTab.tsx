import type { AppNode } from '@tdsl/core';
import type { Diagnostic } from '@tdsl/typecheck';
import { humanizePath } from '@tdsl/llm';
import type { ParseErrorInfo } from '../pipeline';
import { fmt, useI18n } from '../i18n';

interface Props {
  ok: boolean;
  app?: AppNode;
  parseError?: ParseErrorInfo;
  diagnostics: Diagnostic[];
}

/** 诊断面板：parse 错误（行列）+ typecheck 诊断（nodePath 人话化） */
export function DiagnosticsTab({ ok, app, parseError, diagnostics }: Props) {
  const { t } = useI18n();
  const items: Array<{ level: 'error'; title: string; detail?: string }> = [];
  if (parseError) {
    items.push({
      level: 'error',
      title: parseError.linkStage
        ? fmt(t.diag.parseErrorLink, { msg: parseError.message })
        : fmt(t.diag.parseErrorSyntax, {
            line: parseError.line,
            col: parseError.col,
            msg: parseError.message,
          }),
    });
  }
  for (const d of diagnostics) {
    const where = app && d.path ? `［${humanizePath(app, d.path)}］` : '';
    items.push({ level: 'error', title: `${where} ${d.message}`.trim() });
  }

  if (ok) {
    return <div className="tab-body ok">{t.diag.ok}</div>;
  }
  return (
    <div className="tab-body">
      <div className="diag-count">{fmt(t.diag.count, { n: items.length })}</div>
      {items.map((it, i) => (
        <div key={i} className="diag-item">
          <span className="diag-badge">{t.diag.badge}</span>
          <span>{it.title}</span>
        </div>
      ))}
    </div>
  );
}
