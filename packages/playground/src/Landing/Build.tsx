import { useState } from 'react';
import { Code, type Lang } from './Code';
import { useI18n } from '../i18n';

export function Build() {
  const { t } = useI18n();
  const steps = t.build.steps;
  const [active, setActive] = useState(0);
  const step = steps[active];

  return (
    <section className="band" id="build">
      <div className="band-head">
        <span className="eyebrow">{t.build.eyebrow}</span>
        <h2>{t.build.heading}</h2>
        <p>{t.build.intro}</p>
      </div>

      <div className="steps" role="tablist">
        {steps.map((s, i) => (
          <button
            key={s.n}
            role="tab"
            aria-selected={i === active}
            className={`step-tab ${i === active ? 'active' : ''}`}
            onClick={() => setActive(i)}
          >
            <span className="n">{s.n}</span>
            <span className="t">{s.title}</span>
            <span className="m">{s.meta}</span>
            {i < steps.length - 1 && <span className="arrow">→</span>}
          </button>
        ))}
      </div>

      <div className="stage">
        <div className="stage-info">
          <h3>
            {step.n} · {step.title}
          </h3>
          <p>{step.desc}</p>
          <ul>
            {step.points.map((pt) => (
              <li key={pt}>{pt}</li>
            ))}
          </ul>
        </div>
        <div className="stage-code">
          {step.react && step.java ? (
            <div className="dual">
              <div className="panel react">
                <div className="panel-head">
                  <span className="dot" />
                  React · Vite
                </div>
                <Code code={step.react} lang="tsx" />
              </div>
              <div className="panel java">
                <div className="panel-head">
                  <span className="dot" />
                  Java · Spring Boot
                </div>
                <Code code={step.java} lang="java" />
              </div>
            </div>
          ) : (
            <Code code={step.code ?? ''} lang={(step.lang ?? 'typescript') as Lang} className="solo" />
          )}
        </div>
      </div>
    </section>
  );
}
