import { useState } from 'react';
import { fmt, useI18n } from '../i18n';

/** JSON 折叠树（自写递归，不引第三方库） */
export function AstTab({ app }: { app?: Record<string, unknown> }) {
  const { t } = useI18n();
  if (!app) return <div className="tab-body muted">{t.ast.empty}</div>;
  return (
    <div className="tab-body ast">
      <JsonNode name="app" value={app} depth={0} />
    </div>
  );
}

function JsonNode({ name, value, depth }: { name: string; value: unknown; depth: number }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(depth < 2);

  if (value === null || typeof value !== 'object') {
    const display = typeof value === 'string' ? `"${value}"` : String(value);
    return (
      <div className="json-line" style={{ paddingLeft: depth * 14 }}>
        <span className="json-key">{name}</span>
        <span className={typeof value === 'string' ? 'json-str' : 'json-num'}>: {display}</span>
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const brace = Array.isArray(value) ? ['[', ']'] : ['{', '}'];

  return (
    <div>
      <div
        className="json-line clickable"
        style={{ paddingLeft: depth * 14 }}
        onClick={() => setOpen(!open)}
      >
        <span className="json-arrow">{open ? '▼' : '▶'}</span>
        <span className="json-key">{name}</span>
        <span className="json-muted">
          : {brace[0]} {fmt(t.ast.items, { n: entries.length })} {brace[1]}
        </span>
      </div>
      {open &&
        entries.map(([k, v]) => <JsonNode key={k} name={k} value={v} depth={depth + 1} />)}
      {open && (
        <div className="json-line json-muted" style={{ paddingLeft: depth * 14 }}>
          {brace[1]}
        </div>
      )}
    </div>
  );
}
