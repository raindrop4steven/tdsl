import { BRAND } from '../brand';
import { LangToggle, useI18n } from '../i18n';

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="foot">
      <div className="foot-brand">
        <span className="wordmark">
          {BRAND.name}
          <sup>{BRAND.fullName}</sup>
        </span>
      </div>
      <div className="foot-links">
        <a href="#playground">{t.footer.trial}</a>
        <a href="#start">{t.footer.quickStart}</a>
        <a href={BRAND.docs} target="_blank" rel="noreferrer">
          {t.footer.docs}
        </a>
        <a href={BRAND.github} target="_blank" rel="noreferrer">
          {t.footer.github}
        </a>
        <LangToggle />
      </div>
    </footer>
  );
}
