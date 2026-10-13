const FEATURES: Array<{ title: string; desc: string }> = [
  { title: '以 TypeScript 为先验', desc: '选取大模型训练最充分、书写最直觉的语言作为书写面，生成能力最大化。' },
  { title: '领域关键字建模', desc: '仅在企业建模所需之处引入精简关键字（entity / interface / page），其余保持 TypeScript。' },
  { title: '裁减易错语法', desc: '移除易产生歧义的写法，压缩模型的出错空间。' },
  { title: '编译器仲裁', desc: '结构化诊断配以可套用的修复建议，模型自校验、自收敛。' },
  { title: '一份源码两端', desc: '同时产出 Spring Boot 与 React 工程，前后端口径一致。' },
  { title: '企业级表达力', desc: '建模、查询、页面、鉴权、外部系统对接，收敛于同一门语言。' },
  { title: '外部能力一等公民', desc: '第三方 jar 与 npm 组件均以依赖声明直接使用，无需封装层，产物自动装配依赖。' },
];

export function Features() {
  return (
    <section className="band" id="features">
      <div className="band-head">
        <span className="eyebrow">DESIGN PRINCIPLES</span>
        <h2>设计原则</h2>
        <p>底层取舍只有一条：让模型在可靠的前提下，把企业应用写对。</p>
      </div>
      <div className="feature-list">
        {FEATURES.map((f, i) => (
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
