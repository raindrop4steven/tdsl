import { useEffect, useState } from 'react';
import { EditorPane } from './components/EditorPane';
import { DiagnosticsTab } from './components/DiagnosticsTab';
import { AstTab } from './components/AstTab';
import { FilesTab } from './components/FilesTab';
import { compile, type CompileResult } from './pipeline';
import { SAMPLES } from './samples';

type Tab = 'diag' | 'ast' | 'java' | 'react';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'diag', label: '诊断' },
  { id: 'ast', label: 'AST' },
  { id: 'java', label: 'Java 生成' },
  { id: 'react', label: 'React 生成' },
];

export default function App() {
  const [tdsl, setTdsl] = useState(SAMPLES[0].tdsl);
  // 初始立即编译一次，避免首屏空白；之后 300ms 防抖
  const [result, setResult] = useState<CompileResult>(() => compile(SAMPLES[0].tdsl));
  const [tab, setTab] = useState<Tab>('diag');
  const [sampleName, setSampleName] = useState(SAMPLES[0].name);

  // 防抖自动编译
  useEffect(() => {
    const t = setTimeout(() => setResult(compile(tdsl)), 300);
    return () => clearTimeout(t);
  }, [tdsl]);

  const loadSample = (name: string) => {
    const s = SAMPLES.find((x) => x.name === name);
    if (!s) return;
    setSampleName(name);
    setTdsl(s.tdsl);
    setTab('diag');
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">TDSL Playground</span>
        <select value={sampleName} onChange={(e) => loadSample(e.target.value)}>
          {SAMPLES.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="topbar-hint">左侧编辑，300ms 自动编译 → 右侧看诊断 / AST / 双端生成代码</span>
      </header>

      <main className="main">
        <section className="editor-pane">
          <EditorPane value={tdsl} onChange={setTdsl} parseError={result.parseError} />
        </section>

        <section className="right-pane">
          <nav className="tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`tab-btn ${tab === t.id ? 'active' : ''} ${t.id === 'diag' && !result.ok ? 'error' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.id === 'diag' && !result.ok ? ' ●' : ''}
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
            {tab === 'java' && (
              <FilesTab files={result.java} emptyHint="编译未通过，无 Java 产物（先看诊断）" />
            )}
            {tab === 'react' && (
              <FilesTab files={result.react} emptyHint="编译未通过，无 React 产物（先看诊断）" />
            )}
          </div>
        </section>
      </main>

      <footer className="statusbar">
        {result.ok ? (
          <span className="ok">
            ✓ 编译通过 · Java {result.java.length} 文件 · React {result.react.length} 文件 ·{' '}
            {result.ms}ms
          </span>
        ) : (
          <span className="error">
            ✗ 编译未通过（
            {result.parseError
              ? `语法/绑定错误，第 ${result.parseError.line} 行`
              : `${result.diagnostics.length} 个类型检查问题`}
            ）· {result.ms}ms
          </span>
        )}
      </footer>
    </div>
  );
}
