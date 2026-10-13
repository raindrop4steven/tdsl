import { BRAND } from '../brand';

export function Footer() {
  return (
    <footer className="foot">
      <div className="foot-brand">
        <span className="wordmark">
          {BRAND.name}
          <sup>{BRAND.fullName}</sup>
        </span>
      </div>
      <div className="foot-links">
        <a href="#playground">在线试用</a>
        <a href="#start">快速开始</a>
        <a href={BRAND.docs} target="_blank" rel="noreferrer">
          文档
        </a>
        <a href={BRAND.github} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </div>
    </footer>
  );
}
