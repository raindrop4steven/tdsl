import { useEffect, useState } from 'react';
import { EditorPane } from './components/EditorPane';
import { DiagnosticsTab } from './components/DiagnosticsTab';
import { AstTab } from './components/AstTab';
import { FilesTab } from './components/FilesTab';
import { compile, type CompileResult } from './pipeline';
import { SAMPLES, sampleName } from './samples';
import { BRAND } from './brand';
import { fmt, LangToggle, useI18n } from './i18n';

type Tab = 'diag' | 'ast' | 'java' | 'react';

export function Playground() {
  const { t } = useI18n();
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'diag', label: t.playground.tabs.diag },
    { id: 'ast', label: t.playground.tabs.ast },
    { id: 'java', label: t.playground.tabs.java },
    { id: 'react', label: t.playground.tabs.react },
  ];

  const [tdsl, setTdsl] = useState(SAMPLES[0].tdsl);
  const [result, setResult] = useState<CompileResult>(() => compile(SAMPLES[0].tdsl));
  const [tab, setTab] = useState<Tab>('diag');
  const [sampleKey, setSampleKey] = useState(SAMPLES[0].key);

  useEffect(() => {
    const timer = setTimeout(() => setResult(compile(tdsl)), 300);
    return () => clearTimeout(timer);
  }, [tdsl]);

  const loadSample = (key: string) => {
    const s = SAMPLES.find((x) => x.key === key);
    if (!s) return;
    setSampleKey(key);
    setTdsl(s.tdsl);
    setTab('diag');
  };

  return (
    <div className="app" id="playground">
      <header className="topbar">
        <span className="logo">{BRAND.name} Playground</span>
        <select value={sampleKey} onChange={(e) => loadSample(e.target.value)}>
          {SAMPLES.map((s) => (
            <option key={s.key} value={s.key}>
              {sampleName(t, s)}
            </option>
          ))}
        </select>
        <span className="topbar-hint">{t.playground.hint}</span>
        <LangToggle />
      </header>

      <main className="main">
        <section className="editor-pane">
          <EditorPane value={tdsl} onChange={setTdsl} parseError={result.parseError} />
        </section>

        <section className="right-pane">
          <nav className="tabs">
            {tabs.map((tb) => (
              <button
                key={tb.id}
                className={`tab-btn ${tab === tb.id ? 'active' : ''} ${tb.id === 'diag' && !result.ok ? 'error' : ''}`}
                onClick={() => setTab(tb.id)}
              >
                {tb.label}
                {tb.id === 'diag' && !result.ok ? ' ●' : ''}
              </button>
            ))}
          </nav>
          <div className="tab-content">
            {tab === 'diag' && (
              <DiagnosticsTab
                ok={result.ok}
                app={result.app}
                parseError={result.parseError}
                diagnostics={result.diagnostics}
              />
            )}
            {tab === 'ast' && <AstTab app={result.app as unknown as Record<string, unknown>} />}
            {tab === 'java' && <FilesTab files={result.java} emptyHint={t.playground.emptyJava} />}
            {tab === 'react' && <FilesTab files={result.react} emptyHint={t.playground.emptyReact} />}
          </div>
        </section>
      </main>

      <footer className="statusbar">
        {result.ok ? (
          <span className="ok">
            {fmt(t.playground.statusOk, {
              java: result.java.length,
              react: result.react.length,
              ms: result.ms,
            })}
          </span>
        ) : (
          <span className="error">
            {result.parseError
              ? fmt(t.playground.statusSyntaxError, { line: result.parseError.line, ms: result.ms })
              : fmt(t.playground.statusTypeError, { n: result.diagnostics.length, ms: result.ms })}
          </span>
        )}
      </footer>
    </div>
  );
}
