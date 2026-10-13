import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'zh' | 'en';

/** 富文本片段：字符串原样渲染，{ code } 渲染为 <code> */
export type Rich = Array<string | { code: string }>;

export type CodeLang = 'tsx' | 'typescript' | 'json' | 'java' | 'bash';

export interface BuildStep {
  n: string;
  title: string;
  meta: string;
  desc: string;
  points: string[];
  lang?: CodeLang;
  code?: string;
  react?: string;
  java?: string;
}

export interface Dict {
  meta: { title: string; description: string };
  nav: { quickStart: string; docs: string; github: string };
  hero: {
    eyebrow: string;
    h1Line1: string;
    h1Line2Pre: string;
    h1Line2Post: string;
    sub: string;
    ctaStart: string;
    ctaStar: string;
  };
  getStarted: {
    eyebrow: string;
    heading: string;
    intro: string;
    installHead: string;
    installNote: Rich;
    agentHead: string;
    copy: string;
    copied: string;
    agentPrompt: string;
    runlineHead: string;
    steps: Array<{ cmd: string; desc: string }>;
    specNote: Rich;
  };
  build: { eyebrow: string; heading: string; intro: string; steps: BuildStep[] };
  features: {
    eyebrow: string;
    heading: string;
    intro: string;
    items: Array<{ title: string; desc: string }>;
  };
  footer: { trial: string; quickStart: string; docs: string; github: string };
  playground: {
    hint: string;
    tabs: { diag: string; ast: string; java: string; react: string };
    statusOk: string;
    statusSyntaxError: string;
    statusTypeError: string;
    emptyJava: string;
    emptyReact: string;
  };
  diag: { parseErrorLink: string; parseErrorSyntax: string; ok: string; count: string; badge: string };
  ast: { empty: string; items: string };
  files: { root: string; copy: string; copied: string; pickHint: string };
  samples: { todo: string; prefix: string; domains: Record<string, string> };
}

const zh: Dict = {
  meta: {
    title: 'TDSL · 面向 AI 的企业级低代码语言',
    description:
      'TDSL 是面向 AI 代码生成的企业级低代码 DSL：用 TypeScript 风格写一次定义，即可编译出 Spring Boot + React 双端工程；结构化诊断可被 AI 自行修复。浏览器内即可在线试用 Playground。',
  },
  nav: { quickStart: '快速开始', docs: '文档', github: 'GitHub' },
  hero: {
    eyebrow: 'BUILT ON TYPESCRIPT · DESIGNED FOR LLM CODE GENERATION',
    h1Line1: '一份源码，',
    h1Line2Pre: '编译出 ',
    h1Line2Post: ' 双端',
    sub: 'TypeScript 是大模型训练最充分、书写最直觉的语言。TDSL 在此之上引入企业领域关键字、裁减易错语法，并给出 LLM 友好的结构化诊断，使代码生成可靠、可校验、可收敛。',
    ctaStart: '快速开始 →',
    ctaStar: 'Star on GitHub',
  },
  getStarted: {
    eyebrow: 'GET STARTED',
    heading: '快速开始',
    intro: '安装一次 CLI，即可交由 coding agent 编写 TDSL；编译器负责校验与产出。',
    installHead: '01 / 一键安装',
    installNote: [
      '全局安装后任意目录可用（对标 javac / tsc）。仅 ',
      { code: 'generate' },
      ' / ',
      { code: 'build' },
      ' 需要 Java 17 + Maven 3.8+。',
    ],
    agentHead: '02 / 交给 coding agent',
    copy: '复制',
    copied: '已复制 ✓',
    agentPrompt:
      '请用 TDSL 开发这个应用：一门能编译出 React + Java 双端的低代码 DSL。\n\n' +
      '1. 安装 CLI：npm i -g {cli}\n' +
      '2. 读 agent 知识包 tdsl-skill/README.md（语法 / fewshot 示例 / 错误码 / 真工程参照）。\n' +
      '3. 写 .tdsl 分片；每次改动后跑 `tdsl check <目录>`，按提示修到 0 error。\n' +
      '4. 需要产出工程：`tdsl generate <目录> --name app -o generated`；`tdsl build` 跑双端构建。',
    runlineHead: '标准动线',
    steps: [
      { cmd: 'tdsl check tdsl/', desc: '编译 + 诊断，写完 .tdsl 修到 0 error' },
      { cmd: 'tdsl generate tdsl/ --name app -o generated', desc: '生成 Spring Boot + React 双端工程' },
      { cmd: 'tdsl build tdsl/', desc: 'generate + mvn compile + vite build' },
    ],
    specNote: [
      'Spec 驱动（可选但推荐）：先写 ',
      { code: 'spec.yaml' },
      ' 结构化需求 → 写 .tdsl → ',
      { code: 'tdsl check-spec' },
      ' 对照补缺口到 100%。agent 知识包入口见仓库 ',
      { code: 'tdsl-skill/' },
      '。',
    ],
  },
  build: {
    eyebrow: 'WHAT HAPPENS WHEN TDSL BUILDS A PROGRAM',
    heading: '从一份源码到两端工程',
    intro: '编译流程面向模型编写设计：源语言贴合 TypeScript 先验，诊断面向机器可读，产出为可运行的双端工程。',
    steps: [
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
    ],
  },
  features: {
    eyebrow: 'DESIGN PRINCIPLES',
    heading: '设计原则',
    intro: '底层取舍只有一条：让模型在可靠的前提下，把企业应用写对。',
    items: [
      { title: '以 TypeScript 为先验', desc: '选取大模型训练最充分、书写最直觉的语言作为书写面，生成能力最大化。' },
      { title: '领域关键字建模', desc: '仅在企业建模所需之处引入精简关键字（entity / interface / page），其余保持 TypeScript。' },
      { title: '裁减易错语法', desc: '移除易产生歧义的写法，压缩模型的出错空间。' },
      { title: '编译器仲裁', desc: '结构化诊断配以可套用的修复建议，模型自校验、自收敛。' },
      { title: '一份源码两端', desc: '同时产出 Spring Boot 与 React 工程，前后端口径一致。' },
      { title: '企业级表达力', desc: '建模、查询、页面、鉴权、外部系统对接，收敛于同一门语言。' },
      {
        title: '外部能力一等公民',
        desc: '第三方 jar 与 npm 组件均以依赖声明直接使用，无需封装层，产物自动装配依赖。',
      },
    ],
  },
  footer: { trial: '在线试用', quickStart: '快速开始', docs: '文档', github: 'GitHub' },
  playground: {
    hint: '左侧编辑，300ms 自动编译 → 右侧看诊断 / AST / 双端生成代码',
    tabs: { diag: '诊断', ast: 'AST', java: 'Java 生成', react: 'React 生成' },
    statusOk: '✓ 编译通过 · Java {java} 文件 · React {react} 文件 · {ms}ms',
    statusSyntaxError: '✗ 编译未通过（语法/绑定错误，第 {line} 行）· {ms}ms',
    statusTypeError: '✗ 编译未通过（{n} 个类型检查问题）· {ms}ms',
    emptyJava: '编译未通过，无 Java 产物（先看诊断）',
    emptyReact: '编译未通过，无 React 产物（先看诊断）',
  },
  diag: {
    parseErrorLink: '引用绑定失败：{msg}',
    parseErrorSyntax: '语法错误（第 {line} 行 第 {col} 列）：{msg}',
    ok: '✓ 无诊断，编译通过',
    count: '共 {n} 个问题',
    badge: '错误',
  },
  ast: { empty: '编译未通过，无 AST', items: '{n} 项' },
  files: { root: '（根目录）', copy: '复制', copied: '已复制 ✓', pickHint: '← 点击左侧文件预览生成代码' },
  samples: {
    todo: '订单场景全量（todo.tdsl）',
    prefix: '示例【{domain}】',
    domains: {},
  },
};

const en: Dict = {
  meta: {
    title: 'TDSL · An enterprise low-code language for AI',
    description:
      'TDSL is an enterprise-grade low-code DSL for AI code generation: write TypeScript-flavored definitions once and compile to a Spring Boot + React stack, with structured diagnostics an agent can fix itself. A live Playground runs in your browser.',
  },
  nav: { quickStart: 'Quick start', docs: 'Docs', github: 'GitHub' },
  hero: {
    eyebrow: 'BUILT ON TYPESCRIPT · DESIGNED FOR LLM CODE GENERATION',
    h1Line1: 'One codebase,',
    h1Line2Pre: 'compiles to ',
    h1Line2Post: '',
    sub: 'TypeScript is the language LLMs are trained on most and write most intuitively. TDSL layers enterprise domain keywords on top, trims error-prone syntax, and returns LLM-friendly structured diagnostics — so generated code is reliable, checkable, and convergent.',
    ctaStart: 'Quick start →',
    ctaStar: 'Star on GitHub',
  },
  getStarted: {
    eyebrow: 'GET STARTED',
    heading: 'Quick start',
    intro: 'Install the CLI once, then hand TDSL authoring to a coding agent; the compiler checks and emits.',
    installHead: '01 / One-line install',
    installNote: [
      'Installs globally and works from any directory (like javac / tsc). Only ',
      { code: 'generate' },
      ' / ',
      { code: 'build' },
      ' need Java 17 + Maven 3.8+.',
    ],
    agentHead: '02 / Hand it to a coding agent',
    copy: 'Copy',
    copied: 'Copied ✓',
    agentPrompt:
      'Build this app with TDSL: a low-code DSL that compiles to React + Java.\n\n' +
      '1. Install the CLI: npm i -g {cli}\n' +
      '2. Read the agent knowledge pack tdsl-skill/README.en.md (syntax / few-shot examples / error codes / a real project reference).\n' +
      '3. Write .tdsl shards; after each change run `tdsl check <dir>` and fix until 0 errors.\n' +
      '4. To emit projects: `tdsl generate <dir> --name app -o generated`; `tdsl build` runs the two-target build.',
    runlineHead: 'The standard flow',
    steps: [
      { cmd: 'tdsl check tdsl/', desc: 'compile + diagnose; fix .tdsl until 0 errors' },
      { cmd: 'tdsl generate tdsl/ --name app -o generated', desc: 'generate a Spring Boot + React stack' },
      { cmd: 'tdsl build tdsl/', desc: 'generate + mvn compile + vite build' },
    ],
    specNote: [
      'Spec-driven (optional but recommended): write ',
      { code: 'spec.yaml' },
      ' structured requirements → write .tdsl → ',
      { code: 'tdsl check-spec' },
      ' reconciles gaps to 100%. The agent knowledge pack lives in ',
      { code: 'tdsl-skill/' },
      '.',
    ],
  },
  build: {
    eyebrow: 'WHAT HAPPENS WHEN TDSL BUILDS A PROGRAM',
    heading: 'From one source to two projects',
    intro:
      'The pipeline is designed for machine authoring: a source language aligned with TypeScript priors, machine-readable diagnostics, and a runnable two-target output.',
    steps: [
      {
        n: '01',
        title: 'Write TDSL',
        meta: 'TypeScript priors + domain keywords',
        desc: 'The surface is built on TypeScript — the language LLMs are trained on most and write most intuitively. Only a few domain keywords (entity / interface / page) are added for modeling, so the learning cost is near zero.',
        points: [
          'The surface is TypeScript: function / const / for-of — model priors apply directly',
          'Domain keywords only for modeling: entity / interface / page',
          'Error-prone forms trimmed to shrink ambiguity',
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
        meta: 'Deterministic parse · compile-time binding',
        desc: 'No new grammar rules: source is parsed deterministically, TypeScript-style, repeatable and unambiguous. Cross-file, cross-declaration references are bound uniformly here (linkApp), and dangling references are caught at compile time — never left to runtime.',
        points: [
          'Recursive-descent parsing: deterministic, repeatable, unambiguous',
          'Short names bound to nodePath — works across files too',
          'Dangling references reported at compile time',
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
        title: 'LLM-friendly diagnostics',
        meta: 'Structured · machine-readable · with fixes',
        desc: 'Diagnostics are returned as structured signals, not prose for humans only: stable error codes, nodePath, line/column, and an immediately applicable fix suggestion. The model corrects in one pass — the shortest path to convergence.',
        points: [
          'Stable error codes (SYNTAX / TYPE / API / DEP)',
          'nodePath + line/col, pinpointing the node',
          'suggestion applies directly — no human inference',
        ],
        lang: 'json',
        code: `{
  "code": "TYPE-1",
  "path": "app.datasources.erp.entities.Order",
  "line": 4,
  "col": 11,
  "message": "entity Order has no field totl",
  "suggestion": "did you mean total?"
}`,
      },
      {
        n: '04',
        title: 'codegen · two targets',
        meta: 'Pure functions · deterministic',
        desc: 'Once checks pass, generate two complete projects — Spring Boot and React — in one shot. Output is pure and deterministic: the same source always yields the same artifacts, ready for CI.',
        points: [
          'Emits both projects at once (Java + React)',
          'Pure, deterministic output — reproducible',
          'Dependency declarations drive artifact assembly (jar / npm)',
          'Disk writes happen only in the CLI’s final step',
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
    ],
  },
  features: {
    eyebrow: 'DESIGN PRINCIPLES',
    heading: 'Design principles',
    intro: 'Every trade-off serves one goal: let a model write enterprise apps correctly, reliably.',
    items: [
      { title: 'TypeScript-first priors', desc: 'Use the language LLMs are trained on most and write most intuitively as the surface, maximizing generation ability.' },
      { title: 'Domain-keyword modeling', desc: 'Add only the minimal keywords enterprise modeling needs (entity / interface / page); keep the rest TypeScript.' },
      { title: 'Trim error-prone syntax', desc: 'Remove constructs that invite ambiguity, shrinking the model’s room to err.' },
      { title: 'Compiler as arbiter', desc: 'Structured diagnostics with applicable fixes; the model self-checks and converges.' },
      { title: 'One source, two targets', desc: 'Produce Spring Boot and React projects together, with front and back end aligned.' },
      { title: 'Enterprise-grade expressiveness', desc: 'Modeling, queries, pages, auth, and external-system integration all converge in one language.' },
      { title: 'External capabilities first-class', desc: 'Third-party jars and npm components are used directly via dependency declarations — no wrapper layer, dependencies auto-assembled.' },
    ],
  },
  footer: { trial: 'Live demo', quickStart: 'Quick start', docs: 'Docs', github: 'GitHub' },
  playground: {
    hint: 'Edit on the left — auto-compiles in 300ms → see diagnostics / AST / generated code on the right',
    tabs: { diag: 'Diagnostics', ast: 'AST', java: 'Java output', react: 'React output' },
    statusOk: '✓ Compiled · Java {java} files · React {react} files · {ms}ms',
    statusSyntaxError: '✗ Failed (syntax/binding error, line {line}) · {ms}ms',
    statusTypeError: '✗ Failed ({n} type-check issues) · {ms}ms',
    emptyJava: 'Compilation failed — no Java output (check diagnostics first)',
    emptyReact: 'Compilation failed — no React output (check diagnostics first)',
  },
  diag: {
    parseErrorLink: 'Reference binding failed: {msg}',
    parseErrorSyntax: 'Syntax error (line {line}, col {col}): {msg}',
    ok: '✓ No diagnostics — compiled',
    count: '{n} issue(s)',
    badge: 'error',
  },
  ast: { empty: 'Compilation failed — no AST', items: '{n} items' },
  files: { root: '(root)', copy: 'Copy', copied: 'Copied ✓', pickHint: '← Click a file on the left to preview generated code' },
  samples: {
    todo: 'Full order scenario (todo.tdsl)',
    prefix: 'Example [{domain}]',
    domains: {
      'crud-single-table': 'CRUD, single table',
      'master-detail-order': 'Master-detail / foreign keys',
      'query-report': 'Query / report',
      'external-service': 'External service / 3rd-party',
      'multi-datasource': 'Multi-datasource / namespace',
    },
  },
};

const DICTS: Record<Lang, Dict> = { zh, en };

export const LANG_STORAGE_KEY = 'tdsl.lang';

function detectLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  const q = new URLSearchParams(window.location.search).get('lang');
  if (q === 'en' || q === 'zh') return q;
  try {
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    /* ignore (private mode / disabled storage) */
  }
  return 'en';
}

interface Ctx {
  lang: Lang;
  t: Dict;
  setLang: (lang: Lang) => void;
  toggle: () => void;
}

const LangContext = createContext<Ctx | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(detectLang);
  const t = DICTS[lang];

  useEffect(() => {
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = t.meta.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', t.meta.description);
  }, [lang, t]);

  return (
    <LangContext.Provider value={{ lang, t, setLang, toggle: () => setLang(lang === 'zh' ? 'en' : 'zh') }}>
      {children}
    </LangContext.Provider>
  );
}

export function useI18n(): Ctx {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useI18n must be used within LangProvider');
  return ctx;
}

/** {name} 占位替换 */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function RichText({ parts }: { parts: Rich }) {
  return (
    <>
      {parts.map((p, i) => (typeof p === 'string' ? <span key={i}>{p}</span> : <code key={i}>{p.code}</code>))}
    </>
  );
}

/** 语言切换：显示当前语言 + 目标语言 */
export function LangToggle({ className }: { className?: string }) {
  const { lang, toggle } = useI18n();
  const label = lang === 'zh' ? '中文 / EN' : 'EN / 中文';
  return (
    <button
      type="button"
      className={className ?? 'lang-toggle'}
      onClick={toggle}
      title={lang === 'zh' ? 'Switch to English' : '切换到中文'}
    >
      {label}
    </button>
  );
}
