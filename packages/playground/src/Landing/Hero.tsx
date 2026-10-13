import { BRAND } from '../brand';
import { LangToggle, useI18n } from '../i18n';

export function Hero() {
  const { t } = useI18n();
  return (
    <header className="masthead">
      <nav className="nav">
        <span className="wordmark">
          {BRAND.name}
          <sup>{BRAND.fullName}</sup>
        </span>
        <div className="nav-links">
          <a href="#start">{t.nav.quickStart}</a>
          <a href={BRAND.docs} target="_blank" rel="noreferrer">
            {t.nav.docs}
          </a>
          <a href={BRAND.github} target="_blank" rel="noreferrer">
            {t.nav.github}
          </a>
          <LangToggle />
        </div>
      </nav>

      <div className="hero-lead">
        <span className="eyebrow">{t.hero.eyebrow}</span>
        <h1>
          {t.hero.h1Line1}
          <br />
          {t.hero.h1Line2Pre}
          <em className="react">React</em> + <em className="java">Java</em>
          {t.hero.h1Line2Post}
        </h1>
        <p className="hero-sub">{t.hero.sub}</p>
        <div className="hero-cta">
          <a className="btn solid" href="#start">
            {t.hero.ctaStart}
          </a>
          <a className="btn ghost" href={BRAND.github} target="_blank" rel="noreferrer">
            {t.hero.ctaStar}
          </a>
        </div>
      </div>
    </header>
  );
}
