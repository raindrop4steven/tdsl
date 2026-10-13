import { useState } from 'react';
import { BRAND } from '../brand';
import { Code } from './Code';

const AGENT_PROMPT = `请用 TDSL 开发这个应用：一门能编译出 React + Java 双端的低代码 DSL。

1. 安装 CLI：npm i -g ${BRAND.cliPackage}
2. 读 agent 知识包 tdsl-skill/README.md（语法 / fewshot 示例 / 错误码 / 真工程参照）。
3. 写 .tdsl 分片；每次改动后跑 \`tdsl check <目录>\`，按提示修到 0 error。
4. 需要产出工程：\`tdsl generate <目录> --name app -o generated\`；\`tdsl build\` 跑双端构建。`;

const STEPS: Array<{ cmd: string; desc: string }> = [
  { cmd: 'tdsl check tdsl/', desc: '编译 + 诊断，写完 .tdsl 修到 0 error' },
  { cmd: 'tdsl generate tdsl/ --name app -o generated', desc: '生成 Spring Boot + React 双端工程' },
  { cmd: 'tdsl build tdsl/', desc: 'generate + mvn compile + vite build' },
];

export function GetStarted() {
  const [copied, setCopied] = useState(false);

  const copyPrompt = () => {
    void navigator.clipboard.writeText(AGENT_PROMPT).then(() => setCopied(true));
  };

  return (
    <section className="band" id="start">
      <div className="band-head">
        <span className="eyebrow">GET STARTED</span>
        <h2>快速开始</h2>
        <p>安装一次 CLI，即可交由 coding agent 编写 TDSL；编译器负责校验与产出。</p>
      </div>

      <div className="start-grid">
        <div className="start-col">
          <div className="col-head">01 / 一键安装</div>
          <Code code={`npm i -g ${BRAND.cliPackage}`} lang="bash" className="cmd" />
          <p className="note">
            全局安装后任意目录可用（对标 javac / tsc）。仅 <code>generate</code> / <code>build</code> 需要 Java 17 +
            Maven 3.8+。
          </p>
        </div>

        <div className="start-col">
          <div className="col-head">
            02 / 交给 coding agent
            <button className="copy-btn" onClick={copyPrompt}>
              {copied ? '已复制 ✓' : '复制'}
            </button>
          </div>
          <pre className="prompt">{AGENT_PROMPT}</pre>
        </div>
      </div>

      <div className="runline">
        <div className="col-head">标准动线</div>
        <ol className="cmd-list">
          {STEPS.map((s) => (
            <li key={s.cmd}>
              <code>{s.cmd}</code>
              <span>{s.desc}</span>
            </li>
          ))}
        </ol>
        <p className="note">
          Spec 驱动（可选但推荐）：先写 <code>spec.yaml</code> 结构化需求 → 写 .tdsl →
          <code>tdsl check-spec</code> 对照补缺口到 100%。agent 知识包入口见仓库 <code>tdsl-skill/</code>。
        </p>
      </div>
    </section>
  );
}
