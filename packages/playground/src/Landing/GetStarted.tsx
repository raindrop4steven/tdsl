import { useState } from 'react';
import { BRAND } from '../brand';
import { Code } from './Code';
import { fmt, RichText, useI18n } from '../i18n';

export function GetStarted() {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const prompt = fmt(t.getStarted.agentPrompt, { cli: BRAND.cliPackage });

  const copyPrompt = () => {
    void navigator.clipboard.writeText(prompt).then(() => setCopied(true));
  };

  return (
    <section className="band" id="start">
      <div className="band-head">
        <span className="eyebrow">{t.getStarted.eyebrow}</span>
        <h2>{t.getStarted.heading}</h2>
        <p>{t.getStarted.intro}</p>
      </div>

      <div className="start-grid">
        <div className="start-col">
          <div className="col-head">{t.getStarted.installHead}</div>
          <Code code={`npm i -g ${BRAND.cliPackage}`} lang="bash" className="cmd" />
          <p className="note">
            <RichText parts={t.getStarted.installNote} />
          </p>
        </div>

        <div className="start-col">
          <div className="col-head">
            {t.getStarted.agentHead}
            <button className="copy-btn" onClick={copyPrompt}>
              {copied ? t.getStarted.copied : t.getStarted.copy}
            </button>
          </div>
          <pre className="prompt">{prompt}</pre>
        </div>
      </div>

      <div className="runline">
        <div className="col-head">{t.getStarted.runlineHead}</div>
        <ol className="cmd-list">
          {t.getStarted.steps.map((s) => (
            <li key={s.cmd}>
              <code>{s.cmd}</code>
              <span>{s.desc}</span>
            </li>
          ))}
        </ol>
        <p className="note">
          <RichText parts={t.getStarted.specNote} />
        </p>
      </div>
    </section>
  );
}
