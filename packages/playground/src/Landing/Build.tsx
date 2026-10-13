import { useState } from 'react';
import { Code, type Lang } from './Code';

interface Step {
  n: string;
  title: string;
  meta: string;
  desc: string;
  points: string[];
  lang?: Lang;
  code?: string;
  react?: string;
  java?: string;
}

const STEPS: Step[] = [
  {
    n: '01',
    title: '写 TDSL',
    meta: 'TypeScript 先验 + 领域关键字',
    desc: '书写面建立在 TypeScript 之上——大模型训练数据中最充分、书写最直觉的语言。仅在建模型处引入少量领域关键字（entity / interface / page），语言学习成本接近于零。',
    points: [
      '书写面即 TypeScript：function / const / for-of，模型先验直接可用',
      '领域关键字仅用于建模：entity / interface / page',
      '裁减易错写法，压缩生成歧义',
    ],
    lang: 'typescript',
    code: `entity Order {
  id: Integer @id
  customer: String
  amount: Decimal
  status: OrderStatus
}

interface OrderApi {
  page(q: OrderQuery): Page<Order>
  save(order: Order): Order
}

page OrderList {
  <Table dataSource={query(OrderApi.page, {})} />
}

function submit(order: Order) {
  const ok = order.amount > 0
  if (ok) { order.status = OrderStatus.AUDITED }
  OrderApi.save(order)
}`,
  },
  {
    n: '02',
    title: 'parser',
    meta: '确定性解析 · 编译期绑定',
    desc: '不引入新的文法规则：源码按 TypeScript 的方式确定性解析，结果可重复、无歧义。跨文件、跨声明的引用在此统一绑定（linkApp），悬空引用于编译期即被拦截，不遗留到运行期。',
    points: [
      '递归下降解析，确定、可重复、无歧义',
      '短名统一绑定为 nodePath，跨文件同样成立',
      '悬空引用在编译期即报',
    ],
    lang: 'json',
    code: `{
  "kind": "Entity",
  "name": "Order",
  "nodePath": "app.datasources.erp.entities.Order",
  "properties": [
    { "kind": "Property", "name": "id",
      "type": "Integer", "pk": true },
    { "kind": "Property", "name": "status",
      "type": "OrderStatus" }
  ]
}`,
  },
  {
    n: '03',
    title: 'LLM 友好诊断',
    meta: '结构化 · 可机读 · 带修复',
    desc: '诊断以结构化信号返回，而非仅供人阅读的文本：稳定错误码、nodePath、行列定位，以及可直接套用的修复建议。模型据此一次改正，收敛路径最短。',
    points: [
      '稳定错误码（SYNTAX / TYPE / API / DEP）',
      'nodePath + 行列，精确定位到节点',
      'suggestion 可直接套用，无需人工推断',
    ],
    lang: 'json',
    code: `{
  "code": "TYPE-1",
  "path": "app.datasources.erp.entities.Order",
  "line": 4,
  "col": 11,
  "message": "实体 Order 无字段 totl",
  "suggestion": "是否想写 total？"
}`,
  },
  {
    n: '04',
    title: 'codegen · 双端',
    meta: '纯函数 · 确定性',
    desc: '检查通过后，一次性生成 Spring Boot 与 React 两套完整工程。产出为纯函数、确定性的——同一份源码恒得同一份产物，可直接纳入 CI。',
    points: [
      '一次生成双端工程（Java + React）',
      '纯函数、确定性输出，结果可复现',
      '依赖声明驱动产物装配（jar / npm）',
      '落盘仅发生在 CLI 的最后一步',
    ],
    react: `// pages/OrderList.tsx
export default function OrderList() {
  const { data } = useQuery(OrderApi.page, {});
  return <Table dataSource={data?.content} />;
}`,
    java: `// OrderController.java
@RestController
@RequestMapping("/api/order")
public class OrderController {
  @PostMapping("/submit")
  public Order submit(@RequestBody Order o) {
    return orderService.submit(o);
  }
}`,
  },
];

export function Build() {
  const [active, setActive] = useState(0);
  const step = STEPS[active];

  return (
    <section className="band" id="build">
      <div className="band-head">
        <span className="eyebrow">WHAT HAPPENS WHEN TDSL BUILDS A PROGRAM</span>
        <h2>从一份源码到两端工程</h2>
        <p>编译流程面向模型编写设计：源语言贴合 TypeScript 先验，诊断面向机器可读，产出为可运行的双端工程。</p>
      </div>

      <div className="steps" role="tablist">
        {STEPS.map((s, i) => (
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
            {i < STEPS.length - 1 && <span className="arrow">→</span>}
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
            <Code code={step.code ?? ''} lang={step.lang ?? 'typescript'} className="solo" />
          )}
        </div>
      </div>
    </section>
  );
}
