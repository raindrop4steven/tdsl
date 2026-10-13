import { BRAND } from '../brand';

export function Hero() {
  return (
    <header className="masthead">
      <nav className="nav">
        <span className="wordmark">
          {BRAND.name}
          <sup>{BRAND.fullName}</sup>
        </span>
        <div className="nav-links">
          <a href="#start">快速开始</a>
          <a href={BRAND.docs} target="_blank" rel="noreferrer">
            文档
          </a>
          <a href={BRAND.github} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
      </nav>

      <div className="hero-lead">
        <span className="eyebrow">BUILT ON TYPESCRIPT · DESIGNED FOR LLM CODE GENERATION</span>
        <h1>
          一份源码，
          <br />
          编译出 <em className="react">React</em> + <em className="java">Java</em> 双端
        </h1>
        <p className="hero-sub">{BRAND.sub}</p>
        <div className="hero-cta">
          <a className="btn solid" href="#start">
            快速开始 →
          </a>
          <a className="btn ghost" href={BRAND.github} target="_blank" rel="noreferrer">
            Star on GitHub
          </a>
        </div>
      </div>
    </header>
  );
}
