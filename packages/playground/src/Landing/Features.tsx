import { useI18n } from '../i18n';

export function Features() {
  const { t } = useI18n();
  return (
    <section className="band" id="features">
      <div className="band-head">
        <span className="eyebrow">{t.features.eyebrow}</span>
        <h2>{t.features.heading}</h2>
        <p>{t.features.intro}</p>
      </div>
      <div className="feature-list">
        {t.features.items.map((f, i) => (
          <div key={f.title} className="feature-row">
            <span className="idx">{String(i + 1).padStart(2, '0')}</span>
            <h3>{f.title}</h3>
            <p>{f.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
