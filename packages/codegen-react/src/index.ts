import type {
  AppNode,
  BindingNode,
  ComponentNode,
  EndpointNode,
  EntityNode,
  Expr,
  GeneratedFile,
  InterfaceNode,
  LogicNode,
  ParamNode,
  StructureNode,
  TypeRef,
  ViewElementNode,
  ViewNode,
} from '@tdsl/core';

/** 首字母大写 */
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** 引用类型名（nodePath 最后一段） */
function nameFromPath(path: string): string {
  return path.split('.').pop() ?? path;
}

/** TypeRef → TS 类型 */
function tsType(tr: TypeRef): string {
  switch (tr.kind) {
    case 'primitive':
      switch (tr.builtin) {
        case 'Boolean':
          return 'boolean';
        case 'Integer':
        case 'Decimal':
          return 'number';
        case 'String':
        case 'Date':
        case 'Time':
        case 'DateTime':
          return 'string';
      }
      break;
    case 'reference':
      // Object：Map<Object> 泛型兜底 → Record<string, unknown>（类型内建，不进 types 导出）
      if (nameFromPath(tr.path) === 'Object') return 'Record<string, unknown>';
      return nameFromPath(tr.path);
    case 'generic':
      if (tr.name === 'Map') {
        return `Record<string, ${tsType(tr.args[0] ?? { kind: 'primitive', builtin: 'String' })}>`;
      }
      if (tr.name === 'Page') {
        return `{ content: Array<${tsType(tr.args[0] ?? { kind: 'primitive', builtin: 'String' })}>; totalElements: number }`;
      }
      return `Array<${tsType(tr.args[0] ?? { kind: 'primitive', builtin: 'String' })}>`;
    case 'db':
      return 'number';
  }
  const _never: never = tr;
  return _never;
}

/** 生成完整 Vite + React 工程文件列表 */
export function generateReact(app: AppNode): GeneratedFile[] {
  const files = [...projectFiles(app)];
  // 条件：有实体（rows/types）或有页面（views）——纯 FFI API 应用也要能建 react 工程
  if (app.datasources.some((ds) => ds.entities.length > 0) || app.views.length > 0) {
    files.push(typesFile(app));
    if (app.views.length > 0) {
      // M4：page 声明式生成（多页面 + 路由 + 数据绑定）
      files.push(...viewAppFiles(app));
    } else {
      // 无 page：退化现有固定模板（兼容旧 demo）
      const entity = app.datasources[0]?.entities[0];
      const itf = app.interfaces[0];
      if (entity) files.push(appFile(app, entity, itf));
    }
  }
  return files;
}

// ---------- 工程脚手架 ----------

function projectFiles(app: AppNode): GeneratedFile[] {
  const name = `${app.name}-react`;
  const hasViews = app.views.length > 0;
  const routerDep = hasViews ? `,\n    "react-router-dom": "^6.30.0"` : '';
  // antd：页面声明（M4）默认 UI 组件库，提供样式；dayjs：DatePicker 值转换（antd 生态标准）
  const antdDep = hasViews ? `,\n    "antd": "^5.0.0",\n    "dayjs": "^1.11.0"` : '';
  // 第三方组件依赖（component 注册的 pkg）
  const compDeps = app.components
    .map((c) => `,\n    "${c.pkg}": "*"`)
    .join('');
  const mainContent = hasViews
    ? `import React from 'react';
import ReactDOM from 'react-dom';
import 'antd/dist/reset.css';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

declare const __REPORT_URL__: string;
// 运行时错误回流 agent（M10）：vite dev 注入上报地址；自动采集未捕获异常/拒绝与 HTTP ≥400
const REPORT_URL = typeof __REPORT_URL__ === 'string' ? __REPORT_URL__ : '';
function report(payload: Record<string, unknown>): void {
  if (!REPORT_URL) return;
  window.fetch(REPORT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {});
}
window.addEventListener('error', (e) => report({ kind: 'error', message: String(e.message) }));
window.addEventListener('unhandledrejection', (e) => report({ kind: 'rejection', message: String(e.reason) }));
const origFetch = window.fetch.bind(window);
window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
  const res = await origFetch(...args);
  if (res.status >= 400) report({ kind: 'http', message: \`HTTP \${res.status} \${String(args[0])}\` });
  return res;
};

ReactDOM.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
  document.getElementById('root'),
);
`
    : `import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root'),
);
`;
  return [
    {
      path: '.npmrc',
      content: `# 生成工程默认走公网 registry，不受使用机器的 npm 配置影响
registry=https://registry.npmjs.org/`,
    },
    {
      path: 'package.json',
      content: `{
  "name": "${name}",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "17.0.2",
    "react-dom": "17.0.2"${antdDep}${routerDep}${compDeps}
  },
  "devDependencies": {
    "@types/react": "^17.0.10",
    "@types/react-dom": "^17.0.10",
    "@vitejs/plugin-react": "^5.0.4",
    "typescript": "^5.6.0",
    "vite": "^7.3.6"
  }
}
`,
    },
    {
      path: 'vite.config.ts',
      content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// M10 运行回路：/api 代理到同会话后端（BACKEND_PORT 由 runner 注入）；
// __REPORT_URL__ 由 runner 注入（前端运行时错误回流 agent 服务）
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: \`http://localhost:\${process.env.BACKEND_PORT ?? 8080}\`,
        changeOrigin: true,
      },
    },
  },
  define: {
    __REPORT_URL__: JSON.stringify(process.env.TDSL_REPORT_URL ?? ''),
  },
});
`,
    },
    {
      path: 'tsconfig.json',
      content: `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
`,
    },
    {
      path: 'index.html',
      content: `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${app.name} App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    },
    {
      path: 'src/main.tsx',
      content: mainContent,
    },
  ];
}

// ---------- Entity/Structure → TS 类型 ----------

function typesFile(app: AppNode): GeneratedFile {
  const blocks: string[] = [];
  // 枚举：TS 联合类型 + 同名常量对象（两者都要，页面可能只 import type 也可能用值）
  for (const en of app.enums) {
    const items = en.items.map((i) => i.name);
    blocks.push(
      `export type ${en.name} = ${items.map((s) => `'${s}'`).join(' | ')};\n` +
        `export const ${en.name} = { ${items.map((i) => `${i}: '${i}'`).join(', ')} } as const;`,
    );
  }
  for (const ds of app.datasources) {
    for (const ent of ds.entities) {
      const fields = ent.properties.map((p) => `  ${p.name}: ${tsType(p.type)};`).join('\n');
      // type 而非 interface：type 别名带隐式索引签名，可赋给 Record<string, unknown>（dialog 编辑预填 initial 传参）
      blocks.push(`export type ${ent.name} = {
${fields}
};`);
    }
  }
  for (const s of app.structures) {
    const fields = s.properties.map((p) => `  ${p.name}: ${tsType(p.type)};`).join('\n');
    blocks.push(`export type ${s.name} = {
${fields}
};`);
  }
  return { path: 'src/types/index.ts', content: blocks.join('\n\n') + '\n' };
}

// ---------- App.tsx：真实 CRUD（Interface 驱动） ----------

/** 按 method 取 endpoint 路径 */
function pathForMethod(itf: InterfaceNode | undefined, method: EndpointNode['method']): string {
  return itf?.endpoints.find((e) => e.method === method)?.path ?? '';
}

/** 主键字段名 */
function pkOf(ent: EntityNode): string {
  return ent.properties.find((p) => p.primary)?.name ?? 'id';
}

/** 某结构字段是否为 List<X>，返回元素类型名 */
function listElemOf(s: StructureNode): string | null {
  const f = s.properties.find((p) => p.type.kind === 'generic' && p.type.name === 'List');
  if (f && f.type.kind === 'generic') return tsType(f.type.args[0] ?? { kind: 'primitive', builtin: 'String' });
  return null;
}

function appFile(app: AppNode, ent: EntityNode, itf?: InterfaceNode): GeneratedFile {
  const id = pkOf(ent);
  const listPath = pathForMethod(itf, 'GET');
  const postPath = pathForMethod(itf, 'POST');
  const delPath = pathForMethod(itf, 'DELETE');

  // POST 逻辑的入参结构（如 OrderInput）+ 其 List 元素结构（如 OrderItemInput）
  const postLogic = itf?.endpoints
    .find((e) => e.method === 'POST')
    ?.logicRef?.split('.').pop();
  const inputStruct = app.structures.find(
    (s) => postLogic && app.logics.find((l) => l.name === postLogic)?.params.some((p) => p.type.kind === 'reference' && nameFromPath(p.type.path) === s.name),
  );
  const itemStructName = inputStruct ? listElemOf(inputStruct) : null;
  const itemStruct = itemStructName
    ? app.structures.find((s) => s.name === itemStructName)
    : null;
  const inputNonListFields = inputStruct
    ? inputStruct.properties.filter((p) => !(p.type.kind === 'generic' && p.type.name === 'List'))
    : ent.properties.filter((p) => p.name !== id);

  // 列表展示字段：实体非主键字段（如 customer/total）
  const listFields = ent.properties.filter((p) => p.name !== id);

  const content = `import { useEffect, useState } from 'react';
import { ${ent.name}, ${inputStruct?.name ?? ent.name + 'Input'}${
    itemStruct ? `, ${itemStruct.name}` : ''
  } } from './types';

// API base：走 vite dev 代理（/api → 同会话后端端口，M10 运行回路），相对路径免跨域
const API = '';

export default function App() {
  const [items, setItems] = useState<${ent.name}[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<${inputStruct ? 'any' : ent.name} | null>(null);
${inputNonListFields
  .map((f) => `  const [${f.name}, set${cap(f.name)}] = useState(${f.type.kind === 'primitive' && f.type.builtin === 'String' ? "''" : '0'});`)
  .join('\n')}
${itemStruct ? `  const [rows, setRows] = useState<${itemStruct.name}[]>([{ ${itemStruct.properties
  .map((f) => `${f.name}: ${f.type.kind === 'primitive' && (f.type.builtin === 'String') ? "''" : '0'}`)
  .join(', ')} }]);` : ''}

  const load = () => {
    fetch(API + '${listPath}')
      .then((r) => r.json())
      .then(setItems);
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async () => {
    const body: ${inputStruct?.name ?? `${ent.name}Input`} = ${
      itemStruct
        ? `{ ${inputNonListFields.map((f) => f.name).join(', ')}, ${inputStruct?.properties.find((p) => p.type.kind === 'generic' && p.type.name === 'List')?.name ?? 'items'}: rows }`
        : `{ ${inputNonListFields.map((f) => `${f.name}: ${f.name}`).join(', ')} }`
    };
    await fetch(API + '${postPath}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setShowForm(false);
${inputNonListFields.map((f) => `    set${cap(f.name)}(${f.type.kind === 'primitive' && f.type.builtin === 'String' ? "''" : '0'});`).join('\n')}
    load();
  };

  const openDetail = async (${id}: number) => {
    const r = await fetch(API + '${listPath}/{id}'.replace('{id}', String(${id})));
    setDetail(await r.json());
  };

  const remove = async (${id}: number) => {
    await fetch(API + '${delPath}'.replace('{id}', String(${id})), { method: 'DELETE' });
    load();
  };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1>${cap(ent.name)} 管理</h1>

      <button onClick={() => setShowForm(!showForm)} style={{ padding: '8px 16px', marginBottom: 16, borderRadius: 6, border: 'none', background: '#4472C4', color: '#fff' }}>
        {showForm ? '取消' : '新增 ${ent.name}'}
      </button>

      {showForm && (
        <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16 }}>
${inputNonListFields
  .map(
    (f) => `          <label style={{ display: 'block', marginBottom: 8 }}>
            ${f.name}:
            <input
              value={${f.name}}
              onChange={(e) => set${cap(f.name)}(${f.type.kind === 'primitive' && (f.type.builtin === 'String') ? 'e.target.value' : 'Number(e.target.value)'})}
              style={{ marginLeft: 8, padding: 6, borderRadius: 4, border: '1px solid #ccc' }}
            />
          </label>`,
  )
  .join('\n')}
${itemStruct ? `          <h4 style={{ margin: '12px 0 8px' }}>明细行</h4>
          {rows.map((row, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
${itemStruct.properties
  .map(
    (f) => `              <input
                placeholder="${f.name}"
                value={row.${f.name}}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...next[i], ${f.name}: ${f.type.kind === 'primitive' && (f.type.builtin === 'String') ? "e.target.value" : "Number(e.target.value)"} };
                  setRows(next);
                }}
                style={{ flex: 1, padding: 6, borderRadius: 4, border: '1px solid #ccc' }}
              />`,
  )
  .join('\n')}
              <button onClick={() => setRows(rows.filter((_, j) => j !== i))} style={{ padding: '6px 10px' }}>删</button>
            </div>
          ))}
          <button onClick={() => setRows([...rows, { ${itemStruct.properties
            .map((f) => `${f.name}: ${f.type.kind === 'primitive' && f.type.builtin === 'String' ? "''" : '0'}`)
            .join(', ')} }])} style={{ padding: '6px 12px' }}>
            + 添加明细
          </button>` : ''}
          <div style={{ marginTop: 12 }}>
            <button onClick={submit} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#2E7D32', color: '#fff' }}>
              提交
            </button>
          </div>
        </div>
      )}

      {detail ? (
        <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <h3>详情</h3>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 12, borderRadius: 6 }}>{JSON.stringify(detail, null, 2)}</pre>
          <button onClick={() => setDetail(null)} style={{ padding: '6px 12px', marginTop: 8 }}>返回</button>
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
${[...listFields.map((f) => `              <th style={{ border: '1px solid #ddd', padding: 8, textAlign: 'left' }}>${f.name}</th>`), '              <th style={{ border: \'1px solid #ddd\', padding: 8 }}>操作</th>'].join('\n')}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.${id}}>
${listFields.map((f) => `                <td style={{ border: '1px solid #ddd', padding: 8 }}>{String(item.${f.name})}</td>`).join('\n')}
                <td style={{ border: '1px solid #ddd', padding: 8 }}>
                  <button onClick={() => openDetail(item.${id})} style={{ marginRight: 8, cursor: 'pointer' }}>详情</button>
                  <button onClick={() => remove(item.${id})} style={{ cursor: 'pointer' }}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {items.length === 0 && !detail && <p style={{ color: '#888' }}>暂无数据</p>}
    </div>
  );
}
`;
  return { path: 'src/App.tsx', content };
}

// ---------- M4：page 声明式生成（多页面 + 路由 + 数据绑定） ----------

/** 页面名 → 路由路径（OrderList → /orders、OrderDetail → /orders/:id） */
function routePathOf(v: { name: string; viewKind: string; elements: ViewElementNode[] }): string {
  const base = v.name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return `/${base}`;
}

/** 详情页是否有 id 参数（含 $route 引用）→ 路径加 :id */
function hasRouteParam(elements: ViewElementNode[]): boolean {
  for (const el of elements) {
    for (const b of el.bindings) {
      if (b.args.some((a) => exprHasRoute(a))) return true;
    }
    if (hasRouteParam(el.children)) return true;
  }
  return false;
}

function exprHasRoute(e: Expr): boolean {
  switch (e.kind) {
    case 'Member':
      return e.prop === 'id' && e.obj.kind === 'Ident' && e.obj.name === '$route';
    case 'Ident':
      return e.name === '$route';
    case 'Call':
      return e.args.some(exprHasRoute);
    case 'Binary':
      return exprHasRoute(e.left) || exprHasRoute(e.right);
    case 'Group':
      return exprHasRoute(e.expr);
    default:
      return false;
  }
}

/** M4：生成多页面 React 应用（api + hooks + pages + 路由） */
function viewAppFiles(app: AppNode): GeneratedFile[] {
  return [
    apiFile(app),
    hooksFile(),
    ...app.views.map((v) => pageFile(app, v)),
    routerFile(app),
  ];
}

// ---------- api.ts：从 interface endpoints 生成 fetch 封装 ----------

function apiFile(app: AppNode): GeneratedFile {
  const funcs: string[] = [];
  const usedTypesSet = new Set<string>();
  for (const itf of app.interfaces) {
    for (const ep of itf.endpoints) {
      const fn = apiFunction(app, itf, ep);
      funcs.push(fn);
      // 收集函数签名用到的实体/结构类型
      const logicName = ep.logicRef?.split('.').pop() ?? ep.name;
      const logic = app.logics.find((l) => l.name === logicName);
      for (const p of logic?.params ?? []) collectTypeNames(p.type, usedTypesSet);
      for (const r of logic?.returns ?? []) collectTypeNames(r.type, usedTypesSet);
    }
  }
  const typeImport =
    usedTypesSet.size > 0 ? `import type { ${[...usedTypesSet].join(', ')} } from './types';\n` : '';
  const content = `// 自动生成：接口 → fetch 封装（TDSL interface）
${typeImport}const API = '';

${funcs.join('\n')}
`;
  return { path: 'src/api.ts', content };
}

/** 收集 TypeRef 引用的实体/结构名（Object 内建，跳过） */
function collectTypeNames(tr: TypeRef, out: Set<string>): void {
  if (tr.kind === 'reference') {
    const n = nameFromPath(tr.path);
    if (n !== 'Object') out.add(n);
  } else if (tr.kind === 'generic') tr.args.forEach((a) => collectTypeNames(a, out));
}

function apiFunction(app: AppNode, itf: InterfaceNode, ep: EndpointNode): string {
  const logicName = ep.logicRef?.split('.').pop() ?? ep.name;
  const logic = app.logics.find((l) => l.name === logicName);
  const retType = logic?.returns[0] ? tsType(logic.returns[0].type) : 'void';
  // path 变量（{id}）→ URL 参数；其余 logic 参数 → GET 走 query string，POST/PUT 走 body
  const pathVars = ep.path.match(/\{(\w+)\}/g)?.map((m) => m.slice(1, -1)) ?? [];
  const queryParams = (logic?.params ?? []).filter((p) => !pathVars.includes(p.name));
  const method = ep.method;
  // GET 的 query 参数可选化：调用方可少传（如只传搜索关键词），未传的参数不拼 query string
  const params: string[] = [
    ...pathVars.map((n) => {
      const p = logic?.params.find((pp) => pp.name === n);
      return `${n}: ${p ? tsType(p.type) : 'number'}`;
    }),
    ...(method === 'GET'
      ? queryParams.map((p) => `${p.name}?: ${tsType(p.type)}`)
      : queryParams.map((p) => `${p.name}: ${tsType(p.type)}`)),
  ];
  // URL：/api/orders/{id} → API + '/api/orders/' + id；GET 追加 query string（undefined 参数跳过）
  let urlExpr = buildUrlExpr(ep.path, pathVars);
  if (method === 'GET' && queryParams.length > 0) {
    const qsLines = queryParams
      .map((p) => `  if (${p.name} !== undefined) qs.push('${p.name}=' + encodeURIComponent(String(${p.name})));`)
    .join('\n');
    urlExpr = `${urlExpr} + (qs.length ? '?' + qs.join('&') : '')`;
    return `export function ${logicName}(${params.join(', ')}): Promise<${retType}> {
  const qs: string[] = [];
${qsLines}
  return fetch(${urlExpr}).then((r) => r.json());
}`;
  }
  const hasBody = method === 'POST' || method === 'PUT';
  // body 打包：单参数直接序列化该参数（结构体/标量皆可）；多参数打包为对象（此前逐参数命名 body 会重复标识符）
  const bodyExpr = !hasBody
    ? undefined
    : queryParams.length === 0
      ? undefined
      : queryParams.length === 1
        ? queryParams[0].name
        : `{ ${queryParams.map((p) => p.name).join(', ')} }`;
  const reqObj = `{
      method: '${method}',
      headers: { 'Content-Type': 'application/json' },
${bodyExpr ? `      body: JSON.stringify(${bodyExpr}),` : ''}    }`;
  const reqArg = method === 'GET' ? '' : `, ${reqObj}`;
  return `export function ${logicName}(${params.join(', ')}): Promise<${retType}> {
  return fetch(${urlExpr}${reqArg}).then((r) => r.json());
}`;
}

function buildUrlExpr(path: string, pathVars: string[]): string {
  let expr = "API + '";
  const segments = path.split('/').filter((s) => s.length > 0);
  for (const seg of segments) {
    const isVar = seg.startsWith('{') && seg.endsWith('}');
    if (isVar) {
      const name = seg.slice(1, -1);
      expr += `/' + ${name} + '`;
    } else {
      expr += `/${seg}`;
    }
  }
  expr += "'";
  return expr;
}

// ---------- hooks.ts：useQuery / useMutation ----------

function hooksFile(): GeneratedFile {
  const content = `// 自动生成：数据绑定 hooks（TDSL useQuery/useMutation）
import { useEffect, useRef, useState } from 'react';

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  refetch: () => void;
}

export function useQuery<T>(fn: () => Promise<T>, deps: unknown[] = []): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  // 卸载保护：异步回填不再触碰已卸载组件（控制台 React 状态更新警告）
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    fn()
      .then((d) => {
        if (alive.current) setData(d);
        setError(null);
      })
      .catch((e) => {
        if (alive.current) setError(e);
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
    };
  }, [...deps, tick]);

  const refetch = () => setTick((t) => t + 1);
  return { data, loading, error, refetch };
}

export function useMutation<T extends unknown[], R>(fn: (...args: T) => Promise<R>) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);

  const mutate = async (...args: T): Promise<R | undefined> => {
    try {
      setLoading(true);
      setError(null);
      const r = await fn(...args);
      return r;
    } catch (e) {
      if (alive.current) setError(e);
      return undefined;
    } finally {
      if (alive.current) setLoading(false);
    }
  };

  return { mutate, loading, error };
}
`;
  return { path: 'src/hooks.ts', content };
}

// ---------- pages/<Page>.tsx：每个 page → 组件 ----------

function pageFile(app: AppNode, v: ViewNode): GeneratedFile {
  const queryBindings = collectQueryBindings(v);
  const mutationBindings = collectMutationBindings(v);
  const navBindings = collectNavBindings(v);
  const hasTable = viewHasTable(v);
  // detail 页模式：无 table 且 useQuery args 引用 row → row 别名 = 主查询结果，页面路由带 /:id
  const rowSrc = hasTable ? undefined : queryBindings.find((b) => b.args.some((a) => exprHasIdent(a, 'row')));
  const hasRoute = hasRouteParam(v.elements) || routeParamPages(app).has(v.name) || rowSrc !== undefined;
  const routePath = routePathOf(v) + (hasRoute ? '/:id' : '');

  // 查询 hooks 变量名：useQuery('listOrders') → qListOrders
  const queryVars = new Map<string, string>();
  queryBindings.forEach((b, i) => queryVars.set(b.target, `q${cap(logicNameOf(b.target))}`));

  // 页面级 state 名清单（input field + form 字段），供 button 的 mutation 实参适配引用
  const pageStates = [...collectInputFields(v), ...collectFormStateLines(app, v).map((l) => l.match(/\[(\w+),/)?.[1] ?? '')].filter(Boolean);

  const imports: string[] = [];
  // hooks 按需导入（useQuery/useMutation 分开）
  const hookNames: string[] = [];
  if (queryBindings.length > 0) hookNames.push('useQuery');
  if (mutationBindings.length > 0) hookNames.push('useMutation');
  if (hookNames.length > 0) {
    imports.push(`import { ${hookNames.join(', ')} } from '../hooks';`);
    imports.push("import * as api from '../api';");
  }
  if (navBindings.length > 0) {
    imports.push("import { useNavigate } from 'react-router-dom';");
  }
  if (hasRoute) {
    imports.push("import { useParams } from 'react-router-dom';");
  }
  // form/repeat/input/openDialog 开关 需要 useState
  if (viewHasForm(v) || collectInputFields(v).length > 0 || collectOpenDialogTargets(v).length > 0) {
    imports.push("import { useState } from 'react';");
  }
  const typeNames = usedTypes(app, v);
  // row 别名的类型也要 import（如 detail 页主查询返回 Contract）
  if (rowSrc) {
    const rt = logicOf(app, rowSrc.target)?.returns[0]?.type;
    if (rt?.kind === 'reference') {
      const n = nameFromPath(rt.path);
      if (!typeNames.includes(n)) typeNames.push(n);
    }
  }
  if (typeNames.length > 0) {
    imports.push(`import type { ${typeNames.join(', ')} } from '../types';`);
  }
  // 页面用到的第三方组件 → import ECharts from 'echarts-for-react'
  for (const comp of collectUsedComponents(app, v)) {
    imports.push(`import ${comp.name} from '${comp.pkg}';`);
  }
  // Card 页面容器 + antd 升级控件统一入 import；dialog 页面用 Drawer（不进路由）
  const isDialog = v.viewKind === 'dialog';
  const antdNames = [
    ...new Set([
      ...collectAntdComponents(v),
      ...collectFormAntd(app, v),
      ...(formHasRequired(app, v) ? ['message'] : []),
      // 列表页有搜索条件 → 模板自动生成「查询」按钮（隐含产物必须计入 import，否则 ReferenceError）
      ...(hasTable && collectInputFields(v).length > 0 ? ['Button'] : []),
      isDialog ? 'Drawer' : 'Card',
    ]),
  ];
  if (antdNames.length > 0) {
    imports.push(`import { ${antdNames.join(', ')} } from 'antd';`);
  }
  if (needsDayjs(app, v)) {
    imports.push("import dayjs from 'dayjs';");
  }

  const hooksInit: string[] = [];
  // 先声明路由/导航（query 参数可能引用 $route.id → Number(id)）
  if (hasRoute) {
    hooksInit.push(`  const { id } = useParams();`);
  }
  if (navBindings.length > 0) {
    hooksInit.push(`  const nav = useNavigate();`);
  }
  // 页面级 input（如搜索框）：每个 field 一个 state（声明在 query hook 之前，闭包引用更清晰）
  const inputStates = collectInputFields(v);
  for (const f of inputStates) {
    hooksInit.push(`  const [${f}, set${cap(f)}] = useState('');`);
  }
  // 同一逻辑多个 useQuery binding（如按钮触发 + 表格数据源）→ 只声明一个 hook；args 取非空者（带参 binding 优先）
  const hookArgs = new Map<string, string>();
  for (const b of queryBindings) {
    const args = bindingArgs(app, b, hasRoute);
    if (!hookArgs.has(b.target) || args.length > 0) hookArgs.set(b.target, args);
  }
  const rowArgsHook = new Set(
    queryBindings.filter((b) => b !== rowSrc && b.args.some((a) => exprHasIdent(a, 'row'))).map((b) => b.target),
  );
  for (const target of new Set(queryBindings.map((b) => b.target))) {
    const varname = queryVars.get(target)!;
    const isRowSrc = rowSrc !== undefined && target === rowSrc.target;
    if (isRowSrc) {
      // 主查询：row.id → 路由参数 Number(id)
      const args = rowSrc.args.map((a) => (exprHasIdent(a, 'row') ? 'Number(id)' : genBindingArg(a, hasRoute))).join(', ');
      hooksInit.push(`  const ${varname} = useQuery(() => api.${logicNameOf(target)}(${args}));`);
      const retType = logicOf(app, target)?.returns[0]?.type;
      hooksInit.push(
        `  // 页面级 row：主查询结果（detail 页模式，后续 row.* 引用它）`,
        `  const row = ${varname}.data ?? ({} as ${retType ? tsType(retType) : 'Record<string, unknown>'});`,
      );
      continue;
    }
    // 其余引用 row 的查询（如明细 repeat）：row 变化后重查（JSON 序列化作依赖，引用稳定不循环）
    // 搜索接线（G3）：列表页主查询按搜索 state 逐参传入（字符串直传、枚举 as 类型、数值空→undefined）
    const deps = rowArgsHook.has(target) ? ', [JSON.stringify(row)]' : '';
    let searchArgs: string | undefined;
    if (hookArgs.get(target) === undefined || hookArgs.get(target) === '') {
      const tlogic = logicOf(app, target);
      const stateSet = new Set(pageStates);
      searchArgs = tlogic?.params
        ?.filter((p) => stateSet.has(p.name))
        .map((p) => searchStateArg(p))
        .join(', ');
    }
    hooksInit.push(`  const ${varname} = useQuery(() => api.${logicNameOf(target)}(${searchArgs ?? hookArgs.get(target) ?? ''})${deps});`);
  }
  for (const b of mutationBindings) {
    const logic = logicOf(app, b.target);
    const ret = logic?.returns[0] ? tsType(logic.returns[0].type) : 'void';
    const args = logic?.params ?? [];
    const argSig = args.map((p) => `${p.name}: ${tsType(p.type)}`).join(', ');
    const varname = `m${cap(logicNameOf(b.target))}`;
    hooksInit.push(
      `  const ${varname} = useMutation(async (${argSig}): Promise<${ret}> => api.${logicNameOf(b.target)}(${args.map((p) => p.name).join(', ')}));`,
    );
  }
  // 管理端排版：列表页 → 两行：搜索行（条件 + 「查询」贴尾）+ 操作按钮行（新增等独立成行）
  const toolbarEls = hasTable ? v.elements.filter((el) => el.type === 'input' || el.type === 'button') : [];
  const restEls = v.elements.filter((el) => !toolbarEls.includes(el));
  const firstQueryVar = queryBindings.length > 0 ? queryVars.get(queryBindings[0].target) : undefined;
  const body = restEls.map((el) => genElement(app, el, queryVars, pageStates, isDialog ? 'onClose' : undefined, firstQueryVar && !isDialog ? `${firstQueryVar}.refetch()` : undefined)).join('\n\n');
  const toolbarInputs = toolbarEls.filter((el) => el.type === 'input');
  const toolbarButtons = toolbarEls.filter((el) => el.type === 'button');
  const queryButton =
    toolbarInputs.length > 0 && firstQueryVar && !isDialog
      ? `        <Button type="primary" style={{ width: 88 }} onClick={() => ${firstQueryVar}.refetch()}>查询</Button>`
      : '';
  const searchRow =
    toolbarInputs.length > 0
      ? `      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>\n${toolbarInputs
            .map((el) => `        ${genInput(el)}`)
            .join('\n')}\n${queryButton}\n      </div>`
      : '';
  const buttonRow =
    toolbarButtons.length > 0
      ? `      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>\n${toolbarButtons
            .map((el) => `        ${genElement(app, el, queryVars, pageStates)}`)
            .join('\n')}\n      </div>`
      : '';
  const toolbar = [searchRow, buttonRow].filter((s) => s !== '').join('\n');
  // 父页面 openDialog 接线：开关 state + Drawer 组件渲染（关闭时自动 refetch 主查询刷新列表）
  // G6 编辑闭环：每个 dialog 目标配 initial state（新增置 null / 编辑存选中行），打开时预填表单
  const dialogTargets = collectOpenDialogTargets(v);
  for (const t of dialogTargets) {
    hooksInit.push(`  const [show${cap(t)}, setShow${cap(t)}] = useState(false);`);
    hooksInit.push(`  const [${t}Initial, set${cap(t)}Initial] = useState<Record<string, unknown> | null>(null);`);
    // importer 本身在 src/pages/ 内 → 相对路径 ./X（routerFile 的 './pages/X' 只适用于 src/App.tsx）
    imports.push(`import ${t} from './${t}';`);
  }
  const dialogRenders = dialogTargets
    .map(
      (t) =>
        `    <${t} open={show${cap(t)}} onClose={() => { setShow${cap(t)}(false);${firstQueryVar ? ` ${firstQueryVar}.refetch();` : ''} }} initial={${t}Initial} />`,
    )
    .join('\n');
  const formStateLines = collectFormStateLines(app, v);
  hooksInit.push(...formStateLines);
  const compSig = isDialog
    ? `export default function ${v.name}({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Record<string, unknown> | null }) {`
    : `export default function ${v.name}() {`;
  // G6 编辑闭环：dialog 打开时用 initial（编辑选中行）预填表单；新增（initial=null）清空
  const syncEffect = isDialog ? collectFormSyncEffect(app, v) : undefined;
  if (syncEffect) {
    hooksInit.push(syncEffect);
    imports[imports.indexOf("import { useState } from 'react';")] = "import { useEffect, useState } from 'react';";
  }
  const wrapperOpen = isDialog
    ? `    <Drawer title="${viewTitle(v)}" open={open} onClose={onClose} width={Math.min(window.innerWidth * 0.6, 760)} destroyOnClose>`
    : `    <Card style={{ margin: '0 auto' }}>\n      <h2 style={{ marginTop: 0 }}>${viewTitle(v)}</h2>`;
  const wrapperClose = isDialog ? `    </Drawer>` : `    </Card>`;

  // 页面渲染挂载了 dialog 组件时，Card 与 Drawer 是兄弟 JSX → 用 Fragment 包裹
  const returnInner = dialogRenders
    ? `      <>\n${wrapperOpen}\n${toolbar}${body}\n${wrapperClose}\n${dialogRenders}\n      </>`
    : `${wrapperOpen}\n${toolbar}${body}\n${wrapperClose}`;

  const content = `${imports.join('\n')}

${compSig}
${hooksInit.join('\n')}
  return (
${returnInner}
  );
}
`;
  return { path: `src/pages/${v.name}.tsx`, content };
}

/** 页面显式引用的 TS 类型名：mutation 参数/返回 + repeat 元素结构（query 类型靠推断，不 import） */
function usedTypes(app: AppNode, v: ViewNode): string[] {
  const names = new Set<string>();
  // 搜索接线（G3）：无参 useQuery 会按搜索 state 注入 `name as Enum` 转换 → 相关类型须 import
  const stateNames = new Set([...collectInputFields(v)]);
  const visit = (els: ViewElementNode[], parentForm?: ViewElementNode): void => {
    for (const el of els) {
      // mutation 绑定：hook 签名显式引用参数/返回类型
      for (const b of el.bindings) {
        if (b.name === 'useMutation') {
          const logic = logicOf(app, b.target);
          for (const p of logic?.params ?? []) collectTypeNames(p.type, names);
          for (const r of logic?.returns ?? []) collectTypeNames(r.type, names);
        }
        if (b.name === 'useQuery') {
          const st = new Set(stateNames);
          for (const p of logicOf(app, b.target)?.params ?? []) {
            if (!st.has(p.name)) continue;
            collectTypeNames(p.type, names);
          }
        }
      }
      // repeat 元素结构：useState<X[]> 显式引用（repeat 的父是 form）
      if (el.type === 'repeat' && parentForm) {
        const itemStruct = repeatItemStruct(app, parentForm, el);
        if (itemStruct) names.add(itemStruct.name);
      }
      visit(el.children, el.type === 'form' ? el : parentForm);
    }
  };
  visit(v.elements);
  // 展开：结构体同名字段的枚举会被生成 `state as Enum` 转换（stateCoerced），这些枚举要 import；
  // 未被引用的成员类型不进 import（noUnusedLocals 会报未使用）
  const stateSet = new Set([...collectInputFields(v), ...collectFormStateLines(app, v).map((l) => l.match(/\[(\w+),/)?.[1] ?? '').filter(Boolean)]);
  let grew = true;
  const seenStructs = new Set<string>();
  while (grew) {
    grew = false;
    for (const n of names) {
      if (seenStructs.has(n)) continue;
      const s = app.structures.find((x) => x.name === n);
      if (!s) continue;
      seenStructs.add(n);
      for (const p of s.properties) {
        if (p.type.kind !== 'reference') continue;
        const n = nameFromPath(p.type.path);
        if (!stateSet.has(p.name) || !app.enums.some((e) => e.name === n)) continue;
        if (!names.has(n)) { names.add(n); grew = true; }
      }
    }
  }
  return [...names];
}

/** 视图显示名：@title('中文') 注解优先，缺省用声明名 */
function viewTitle(v: ViewNode): string {
  const ann = v.annotations?.find((a) => a.name === 'title');
  const t = ann?.args?.['value'];
  return typeof t === 'string' && t !== '' ? t : v.name;
}

function logicNameOf(target: string): string {
  return target.split('.').pop() ?? target;
}

function logicOf(app: AppNode, target: string) {
  return app.logics.find((l) => l.name === logicNameOf(target));
}

function bindingArgs(app: AppNode, b: BindingNode, hasRoute: boolean): string {
  // useQuery('logic', arg) → arg 是 $route.id 等；直接透传表达式
  if (b.args.length === 0) return '';
  return b.args.map((a) => genBindingArg(a, hasRoute)).join(', ');
}

function genBindingArg(e: Expr, hasRoute: boolean): string {
  switch (e.kind) {
    case 'Ident':
      return e.name === '$route' && hasRoute ? 'Number(id)' : e.name;
    case 'Member':
      // $route.id → Number(id)；其余 → obj.prop
      if (e.obj.kind === 'Ident' && e.obj.name === '$route') return 'Number(id)';
      return exprToTs(e);
    case 'Numeric':
      return String(e.value);
    case 'String':
      return `'${e.value}'`;
    case 'Null':
      return 'null';
    default:
      return exprToTs(e);
  }
}

/** 表达式 → TS（$route.id → Number(id)；row.x → row.x） */
function exprToTs(e: Expr): string {
  switch (e.kind) {
    case 'Ident':
      return e.name;
    case 'Member': {
      const obj = exprToTs(e.obj);
      return `${obj}.${e.prop}`;
    }
    case 'Numeric':
      return String(e.value);
    case 'String':
      return `'${e.value}'`;
    case 'Bool':
      return e.value ? 'true' : 'false';
    case 'Null':
      return 'null';
    default:
      return '';
  }
}

/** derive 表达式 → JS（G2 dev/29）：字段状态数字化包装、成员/算术直转 */
function exprToJs(app: AppNode, e: Expr, bodyStruct: StructureNode | undefined): string {
  switch (e.kind) {
    case 'Ident': {
      const p = bodyStruct?.properties.find((pp) => pp.name === e.name);
      const isNum = p?.type.kind === 'primitive' && p.type.builtin !== 'String';
      // 未声明的上下文名（row/initial/类型名）原样透传
      if (!p && !isNum) return e.name;
      const isStr = p?.type.kind === 'primitive' && p.type.builtin === 'String';
      return isNum ? `Number(${e.name})` : isStr ? e.name : e.name;
    }
    case 'Member': {
      return `${exprToJs(app, e.obj, bodyStruct)}.${e.prop}`;
    }
    case 'Call':
    case 'Binary': {
      // 算术/比较/成员调用直接走 JS 词法（同构子集）；类型相容性在 typecheck 面
      const walk = (x: Expr): string => {
        switch (x.kind) {
          case 'Binary':
            return `(${exprToJs(app, x.left, bodyStruct)} ${x.operator === '===' ? '===' : x.operator} ${exprToJs(app, x.right, bodyStruct)})`;
          case 'Call': {
            const callee = x.callee.kind === 'Member'
              ? `${exprToJs(app, x.callee.obj, bodyStruct)}.${x.callee.prop}`
              : x.callee.kind === 'Ident'
                ? x.callee.name
                : '';
            return `${callee}(${x.args.map((a) => exprToJs(app, a, bodyStruct)).join(', ')})`;
          }
          case 'Group':
            return `(${exprToJs(app, x.expr, bodyStruct)})`;
          default:
            return exprToTs(x);
        }
      };
      return walk(e);
    }
    case 'Numeric':
      return String(e.value);
    case 'String':
      return `'${e.value}'`;
    case 'Bool':
      return e.value ? 'true' : 'false';
    case 'Null':
      return 'null';
  }
  return '';
}

function collectQueryBindings(v: ViewNode): BindingNode[] {
  const out: BindingNode[] = [];
  const visit = (els: ViewElementNode[]): void => {
    for (const el of els) {
      for (const b of el.bindings) if (b.name === 'useQuery') out.push(b);
      visit(el.children);
    }
  };
  visit(v.elements);
  return out;
}

function collectMutationBindings(v: ViewNode): BindingNode[] {
  const out: BindingNode[] = [];
  const visit = (els: ViewElementNode[]): void => {
    for (const el of els) {
      for (const b of el.bindings) if (b.name === 'useMutation') out.push(b);
      visit(el.children);
    }
  };
  visit(v.elements);
  return out;
}

function collectNavBindings(v: ViewNode): BindingNode[] {
  const out: BindingNode[] = [];
  const visit = (els: ViewElementNode[]): void => {
    for (const el of els) {
      for (const b of el.bindings) if (b.name === 'navigate') out.push(b);
      visit(el.children);
    }
  };
  visit(v.elements);
  return out;
}

/** ViewElement → JSX（table/column/button/form/input/repeat/text/detail + 第三方 component） */
function genElement(app: AppNode, el: ViewElementNode, queryVars: Map<string, string>, states: string[] = [], onCloseExpr?: string, refetchExpr?: string): string {
  switch (el.type) {
    case 'table':
      return genTable(app, el, queryVars, states, refetchExpr);
    case 'button':
      return genButton(app, el, queryVars, { row: false, states, refetch: refetchExpr, inDialog: Boolean(onCloseExpr) });
    case 'form':
      return genForm(app, el, queryVars, onCloseExpr, refetchExpr);
    case 'input':
      return genInput(el);
    case 'repeat':
      return genQueryRepeat(el, queryVars);
    case 'text':
      return genText(el);
    case 'detail':
      return genDetail(app, el, queryVars);
    default: {
      // 管理端常用组件（tag/statistic/tabs/checkbox/switch/radio/avatar/badge/card）
      const common = genCommonElement(app, el, queryVars, states);
      if (common !== undefined) return common;
      // 第三方组件：component 注册命中 → <ECharts data={...} option={...} />
      const comp = app.components.find((c) => c.name === el.type);
      if (comp) return genComponentElement(app, comp, el, queryVars);
      return `{/* ${el.type} */}`;
    }
  }
}

/** component 注册的第三方组件元素：dataSource 绑定 → data={q.data}；其余 prop 透传 */
function genComponentElement(
  app: AppNode,
  comp: ComponentNode,
  el: ViewElementNode,
  queryVars: Map<string, string>,
): string {
  const propParts: string[] = [];
  // dataSource={useQuery('x')} → data={qX.data}
  const qBinding = el.bindings.find((b) => b.name === 'useQuery');
  if (qBinding) {
    const dataVar = queryVars.get(qBinding.target)!;
    propParts.push(`data={${dataVar}.data}`);
  }
  // 其余 props：field={expr} / field="str"（dataSource 已作为 data 绑定，跳过）
  for (const [k, v] of Object.entries(el.props)) {
    if (k === 'dataSource') continue;
    if (typeof v === 'string') {
      propParts.push(`${k}="${v}"`);
    } else {
      propParts.push(`${k}={${genBindingArg(v, false)}}`);
    }
  }
  return `<${comp.name} ${propParts.join(' ')} />`;
}

/** 页面用到的第三方组件（component 注册命中 el.type） */
function collectUsedComponents(app: AppNode, v: ViewNode): ComponentNode[] {
  const found = new Map<string, ComponentNode>();
  const visit = (els: ViewElementNode[]): void => {
    for (const el of els) {
      const comp = app.components.find((c) => c.name === el.type);
      if (comp) found.set(comp.name, comp);
      visit(el.children);
    }
  };
  visit(v.elements);
  return [...found.values()];
}

/** 内置元素类型 → antd 组件名（table/button/form/input/detail → 对应 UI 组件） */
const ANTD_OF: Record<string, string> = {
  table: 'Table',
  button: 'Button',
  input: 'Input',
  detail: 'Descriptions',
  // 管理端常用组件集
  tag: 'Tag',
  statistic: 'Statistic',
  tabs: 'Tabs',
  pane: 'Tabs.TabPane（用 items）',
  checkbox: 'Checkbox',
  radio: 'Radio',
  switch: 'Switch',
  avatar: 'Avatar',
  badge: 'Badge',
  card: 'Card',
};

/** 页面用到哪些 antd 组件（去重、保持稳定顺序） */
function collectAntdComponents(v: ViewNode): string[] {
  const found = new Set<string>();
  const visit = (els: ViewElementNode[]): void => {
    for (const el of els) {
      const name = ANTD_OF[el.type];
      if (name) found.add(name);
      visit(el.children);
    }
  };
  visit(v.elements);
  // table 行内操作列：≥2 个按钮用 Space 排布；有折叠按钮 → Dropdown「更多」
  for (const el of v.elements) {
    if (el.type === 'table') {
      const rowButtons = el.children.filter((c) => c.type === 'button');
      if (rowButtons.length >= 2) found.add('Space');
      if (foldRowButtonPlan(rowButtons).folded.length > 0) found.add('Dropdown');
    }
  }
  // Set 遍历顺序 = 插入序，稳定
  return [...found];
}

/**
 * 行内按钮折叠计划（jxc 对拍：行按钮过多且无折叠）：
 * fold="true" 的按钮强制进「更多」下拉；未标 fold 的按钮 > 4 个时，前 2 个内联、其余折叠。
 */
function foldRowButtonPlan(rowButtons: ViewElementNode[]): { inline: ViewElementNode[]; folded: ViewElementNode[] } {
  const markedFold = rowButtons.filter((b) => String(b.props.fold ?? '') === 'true');
  const notFold = rowButtons.filter((b) => !(String(b.props.fold ?? '') === 'true'));
  let inline = notFold;
  let folded = [...markedFold];
  if (notFold.length > 4) {
    inline = notFold.slice(0, 2);
    folded = [...notFold.slice(2), ...markedFold];
  }
  return { inline, folded };
}

/** 折叠按钮的点击体：useMutation→mutate(...)；navigate→nav(...)（openDialog 行场景不折叠） */
function foldButtonHandler(app: AppNode, b: ViewElementNode, refetchExpr?: string): string {
  const mutB = b.bindings.find((x) => x.name === 'useMutation');
  if (mutB) {
    const varname = `m${cap(logicNameOf(mutB.target))}`;
    const logic = logicOf(app, mutB.target);
    const callArgs = logic
      ? logic.params.map((p, i) => coerceArg(app, mutB.args[i], p, [])).join(', ')
      : mutB.args.map((a) => genBindingArg(a, false)).join(', ');
    return `${varname}.mutate(${callArgs}).then(() => ${refetchExpr ?? 'void 0'});`;
  }
  const navB = b.bindings.find((x) => x.name === 'navigate');
  if (navB) {
    const argExpr = navB.args.length > 0 ? genBindingArg(navB.args[0], false) : 'row.id';
    return `nav('/${routeBaseOf(navB.target)}/' + String(${argExpr}));`;
  }
  const odB = b.bindings.find((x) => x.name === 'openDialog');
  if (odB) {
    const initSet = odB.args.length > 0 ? `set${cap(odB.target)}Initial(${genBindingArg(odB.args[0], false)}); ` : `set${cap(odB.target)}Initial(null); `;
    return `${initSet}setShow${cap(odB.target)}(true);`;
  }
  return '';
}

/** input field="x" → 受控 antd Input（state 在 pageFile 顶部提升） */
/** 搜索 state → api 实参适配（字符串直传；枚举 as 转换；数值/布尔空串→undefined） */
function searchStateArg(p: ParamNode): string {
  const t = p.type;
  if (t.kind === 'generic') return p.name;
  if (t.kind === 'reference') return `${p.name} as ${tsType(t)}`;
  if (t.kind === 'primitive') {
    if (t.builtin === 'String' || t.builtin === 'Date' || t.builtin === 'Time' || t.builtin === 'DateTime') return p.name;
    return `${p.name} === '' ? undefined : Number(${p.name})`;
  }
  return p.name;
}

function genInput(el: ViewElementNode): string {
  const field = String(el.props.field ?? '');
  // label 属性 → addonBefore（搜索条件名 + 输入框成对出现）；无 label 时保留 placeholder（向后兼容）
  const label = el.props.label ? String(el.props.label) : '';
  if (label) {
    return `<Input addonBefore="${label}" style={{ width: 320 }} value={${field}} onChange={(e) => set${cap(field)}(e.target.value)} />`;
  }
  const placeholder = el.props.placeholder ? ` placeholder="${String(el.props.placeholder)}"` : '';
  return `<Input${placeholder} value={${field}} onChange={(e) => set${cap(field)}(e.target.value)} />`;
}

/** 页面级 input 的 field 清单（去重保序；form 内的由 collectFormStateLines 负责，不重复收） */
function collectInputFields(v: ViewNode): string[] {
  const out: string[] = [];
  const visit = (els: ViewElementNode[], inForm: boolean): void => {
    for (const el of els) {
      if (el.type === 'input' && !inForm) {
        const f = String(el.props.field ?? '');
        if (f && !out.includes(f)) out.push(f);
      }
      visit(el.children, inForm || el.type === 'form');
    }
  };
  visit(v.elements, false);
  return out;
}

/** 页面是否含 table（决定 row 别名机制是否启用） */
function viewHasTable(v: ViewNode): boolean {
  const visit = (els: ViewElementNode[]): boolean => {
    for (const el of els) {
      if (el.type === 'table') return true;
      if (visit(el.children)) return true;
    }
    return false;
  };
  return visit(v.elements);
}

/** 表达式是否引用某标识符（row / $route 等） */
function exprHasIdent(e: Expr, name: string): boolean {
  switch (e.kind) {
    case 'Ident':
      return e.name === name;
    case 'Member':
      return e.obj.kind === 'Ident' ? e.obj.name === name : e.obj.kind === 'Member' && exprHasIdent(e.obj, name);
    default:
      return false;
  }
}

/** 全 app 中被“带参 navigate”指向的页面名（这些页面路由需要 /:id） */
function routeParamPages(app: AppNode): Set<string> {
  const names = new Set<string>();
  const visit = (els: ViewElementNode[]): void => {
    for (const el of els) {
      for (const b of el.bindings) {
        if (b.name === 'navigate' && b.args.length > 0) names.add(b.target);
      }
      visit(el.children);
    }
  };
  for (const v of app.views) visit(v.elements);
  return names;
}

/** 页面名 → 路由基路径（驼峰转连字符小写，与 routePathOf 一致） */
function routeBaseOf(target: string): string {
  return target.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** Page<T> 等 generic 返回类型 → 表格数据源取值表达式 */
function tableDataSourceOf(app: AppNode, target: string, dataVar: string): string {
  const retType = logicOf(app, target)?.returns[0]?.type;
  if (retType?.kind === 'generic' && retType.name === 'Page') return `${dataVar}.data?.content ?? []`;
  return `${dataVar}.data ?? []`;
}

/** state（string 型）→ 目标类型表达式（number/boolean/enum 转换，其余透传） */
function stateCoerced(app: AppNode, name: string, tr: TypeRef): string {
  switch (tr.kind) {
    case 'primitive':
      if (tr.builtin === 'Integer' || tr.builtin === 'Decimal') return `Number(${name})`;
      if (tr.builtin === 'Boolean') return `(${name} === 'true')`;
      return name;
    case 'reference': {
      const n = nameFromPath(tr.path);
      if (app.enums.some((e) => e.name === n)) return `${name} as ${n}`;
      return name;
    }
    default:
      return name;
  }
}

/** logic 参数缺省字面量（mutation 少传/结构体字段缺省时用） */
function defaultLiteral(app: AppNode, tr: TypeRef): string {
  switch (tr.kind) {
    case 'primitive':
      if (tr.builtin === 'Boolean') return 'false';
      if (tr.builtin === 'Integer' || tr.builtin === 'Decimal') return '0';
      return "''";
    case 'generic':
      if (tr.name === 'List' || tr.name === 'Page') return '[]';
      if (tr.name === 'Map') return '{}';
      return 'null';
    case 'reference': {
      const name = nameFromPath(tr.path);
      const en = app.enums.find((e) => e.name === name);
      if (en) return `'${en.items[0]?.name ?? ''}'`;
      return "''";
    }
    case 'db':
      return 'null';
  }
}

/** mutation 实参 → 形参适配：结构体类型 + Ident 实参 → 对象字面量（命中 state 用之，缺省补字面量） */
function coerceArg(app: AppNode, arg: Expr | undefined, param: { name: string; type: TypeRef }, states: string[], inDialog = false): string {
  if (arg === undefined) {
    // 弹窗上下文缺参（G5）：编辑/提交语义 → 从 initial 取同名字段（dialog 唯一的行上下文）；无 initial 场景退回字面量
    if (inDialog && param.type.kind === 'primitive' && (param.type.builtin === 'Integer' || param.type.builtin === 'Decimal')) {
      return `Number(initial?.${param.name} ?? 0)`;
    }
    if (inDialog && param.type.kind === 'primitive' && param.type.builtin === 'String') {
      return `String(initial?.${param.name} ?? '')`;
    }
    return defaultLiteral(app, param.type);
  }
  const structName = param.type.kind === 'reference' ? nameFromPath(param.type.path) : null;
  if (structName && arg.kind === 'Ident') {
    const s = app.structures.find((x) => x.name === structName);
    if (s) {
      const parts = s.properties.map((fp) => {
        if (fp.name === arg.name) return `${fp.name}: ${genBindingArg(arg, false)}`;
        if (states.includes(fp.name)) {
          const c = stateCoerced(app, fp.name, fp.type);
          return c === fp.name ? fp.name : `${fp.name}: ${c}`;
        }
        return `${fp.name}: ${defaultLiteral(app, fp.type)}`;
      });
      return `{ ${parts.join(', ')} }`;
    }
  }
  return genBindingArg(arg, false);
}

/** table 外的 repeat（data={useQuery('x')}）→ 列表区块（form 内 repeat 由 genForm 处理，不走这里） */
function genQueryRepeat(el: ViewElementNode, queryVars: Map<string, string>): string {
  const qB = el.bindings.find((b) => b.name === 'useQuery');
  const varname = qB ? queryVars.get(qB.target) : undefined;
  if (!varname) return '{/* repeat */}';
  const texts = el.children
    .filter((c) => c.type === 'text')
    .map((c) => {
      const f = String(c.props.field ?? '');
      const title = String(c.props.title ?? f);
      return `    <span style={{ marginRight: 24 }}>${title}: {row.${f}}</span>`;
    })
    .join('\n');
  return `{(${varname}.data ?? []).map((row, i) => (
  <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
${texts}
  </div>
))}`;
}

/** table dataSource={useQuery('x')} → antd Table + 数据驱动 columns（Page<T> 返回自动取 .content；column navigate → onRow 跳转） */
function genTable(app: AppNode, el: ViewElementNode, queryVars: Map<string, string>, states: string[] = [], refetchExpr?: string): string {
  const qBinding = el.bindings.find((b) => b.name === 'useQuery');
  const dataVar = qBinding ? queryVars.get(qBinding.target)! : 'data';
  const mainRefetch = refetchExpr ?? (qBinding ? `${dataVar}.refetch()` : undefined);
  // 枚举列自动彩色 Tag：从查询返回实体解析字段类型（状态列不再裸文本）
  const logic = qBinding ? logicOf(app, qBinding.target) : undefined;
  const retType = logic?.returns[0]?.type;
  const entName = retType?.kind === 'reference' ? nameFromPath(retType.path) : null;
  const ent = entName
    ? app.datasources.flatMap((ds) => ds.entities).find((e) => e.name === entName)
    : undefined;
  const columns = el.children.filter((c) => c.type === 'column');
  const colDefs = columns.map((c) => {
    const field = String(c.props.field ?? '');
    const title = String(c.props.title ?? field);
    const enumType = ent?.properties.find((p) => p.name === field)?.type;
    const en = enumType?.kind === 'reference' ? app.enums.find((e) => e.name === nameFromPath(enumType.path)) : undefined;
    if (en) {
      // 枚举项→颜色/中文标签映射在生成期确定，运行期按 row 值取色取标签（生成代码不含未知符号）
      const colorMap = `{ ${en.items.map((i) => `'${i.name}': '${tagColorFor(i.name)}'`).join(', ')} }`;
      const labelMap = `{ ${en.items.map((i) => `'${i.name}': '${i.label ?? i.name}'`).join(', ')} }`;
      return `    { title: '${title}', dataIndex: '${field}', render: (_, row) => { const colors: Record<string, string> = ${colorMap}; const labels: Record<string, string> = ${labelMap}; return <Tag color={colors[String(row.${field})] ?? 'blue'}>{labels[String(row.${field})] ?? String(row.${field})}</Tag>; } }`;
    }
    return `    { title: '${title}', dataIndex: '${field}' }`;
  });
  // 行内按钮（table 直接子 button）→ 操作列 render（Space 排布 + 「更多」折叠，间距与重要级两全）
  const rowButtons = el.children.filter((c) => c.type === 'button');
  const { inline: inlineBtns, folded: foldedBtns } = foldRowButtonPlan(rowButtons);
  let opCol = '';
  if (rowButtons.length > 0) {
    const inlineJsx = inlineBtns.map((b) => genButton(app, b, queryVars, { row: true, states, refetch: mainRefetch })).join('\n ');
    let dropdownJsx = '';
    if (foldedBtns.length > 0) {
      const items = foldedBtns.map((b, i) => `{ key: 'fold${i + 1}', label: '${String(b.props.text ?? '')}' }`).join(', ');
      const handlers = foldedBtns.map((b, i) => `  fold${i + 1}: () => { ${foldButtonHandler(app, b, mainRefetch)} }`).join(', ');
      dropdownJsx = ` <Dropdown menu={{ items: [${items}], onClick: ({ key }) => { const map: Record<string, () => void> = {\n${handlers}\n }; map[key]?.(); } }}><Button type="link" size="small">更多</Button></Dropdown>`;
    }
    opCol = `,\n    { title: '操作', key: 'op', render: (_, row) => (<Space size={2}>${inlineJsx}${dropdownJsx}</Space>) }`;
  }
  // 某列 navigate（row.id）→ 整行可点跳详情
  const navCol = columns.find((c) => c.bindings.some((b) => b.name === 'navigate'));
  let onRowAttr = '';
  if (navCol) {
    const nb = navCol.bindings.find((b) => b.name === 'navigate')!;
    const argExpr = nb.args.length > 0 ? genBindingArg(nb.args[0], false) : 'row.id';
    onRowAttr = `\n  onRow={(row) => ({ onClick: () => nav('/${routeBaseOf(nb.target)}/' + String(${argExpr})) })}`;
  }
  const dataSource = qBinding ? tableDataSourceOf(app, qBinding.target, dataVar) : 'data';
  const rowKey = String(columns[0]?.props.field ?? 'id');
  return `<Table
  dataSource={${dataSource}}
  rowKey="${rowKey}"
  pagination={false}
  columns={[
${colDefs.join(',\n')}${opCol}
  ]}
/>`;
}

/** button action={useMutation(...)} / onClick={useQuery(...)} / action={navigate(...)} → antd Button */
function genButton(
  app: AppNode,
  el: ViewElementNode,
  queryVars: Map<string, string>,
  opts?: { row?: boolean; states?: string[]; refetch?: string; inDialog?: boolean },
): string {
  const label = el.props['text'] ? String(el.props['text']) : '确定';
  const isRow = opts?.row ?? false;
  const states = opts?.states ?? [];
  // 行内按钮点击时不触发 table 的 onRow 跳转
  const onClick = (expr: string): string =>
    isRow ? `(e) => { e.stopPropagation(); ${expr}; }` : expr.includes(';') ? `() => { ${expr} }` : `() => ${expr}`;
  const navB = el.bindings.find((b) => b.name === 'navigate');
  if (navB) {
    if (navB.args.length > 0) {
      const argExpr = genBindingArg(navB.args[0], false);
      return `<Button type="primary" onClick={${onClick(`nav('/${routeBaseOf(navB.target)}/' + String(${argExpr}))`)}}>${label}</Button>`;
    }
    return `<Button type="primary" onClick={${onClick(`nav('/${routeBaseOf(navB.target)}')`)}}>${label}</Button>`;
  }
  const mutB = el.bindings.find((b) => b.name === 'useMutation');
  if (mutB) {
    const varname = `m${cap(logicNameOf(mutB.target))}`;
    // 实参按 logic 形参逐个适配（缺参补字面量；结构体参数 + Ident 实参 → 对象字面量）
    const logic = logicOf(app, mutB.target);
    const callArgs = logic
      ? logic.params.map((p, i) => coerceArg(app, mutB.args[i], p, states, opts?.inDialog ?? false)).join(', ')
      : mutB.args.map((a) => genBindingArg(a, false)).join(', ');
    const danger = label.includes('删') ? ' danger' : '';
    const ref = opts?.refetch ? `.then(() => ${opts.refetch})` : '';
    return `<Button${danger} onClick={${onClick(`${varname}.mutate(${callArgs})${ref}`)}}>${label}</Button>`;
  }
  // onClick={useQuery('x', args)} → 点击触发查询刷新（fn 闭包捕获最新 state，refetch 即用新值重查）
  const qB = el.bindings.find((b) => b.name === 'useQuery');
  if (qB) {
    const varname = queryVars.get(qB.target) ?? `q${cap(logicNameOf(qB.target))}`;
    return `<Button onClick={${onClick(`${varname}.refetch()`)}}>${label}</Button>`;
  }
  // onClick={openDialog('X')} → 打开右侧抽屉（X 为 dialog 页面，父页面持有开关 state）
  // openDialog('X', row) 带参 → 编辑语义：先把选中行写入 initial state，dialog 打开时预填表单
  const odB = el.bindings.find((b) => b.name === 'openDialog');
  if (odB) {
    const initSet = odB.args.length > 0 ? `set${cap(odB.target)}Initial(${genBindingArg(odB.args[0], false)}); ` : `set${cap(odB.target)}Initial(null); `;
    return `<Button type="primary" onClick={${onClick(`${initSet}setShow${cap(odB.target)}(true)`)}}>${label}</Button>`;
  }
  return `<Button>${label}</Button>`;
}

/** 父页面 openDialog 目标清单（去重保序） */
function collectOpenDialogTargets(v: ViewNode): string[] {
  const out: string[] = [];
  const visit = (els: ViewElementNode[]): void => {
    for (const el of els) {
      for (const b of el.bindings) {
        if (b.name === 'openDialog' && !out.includes(b.target)) out.push(b.target);
      }
      visit(el.children);
    }
  };
  visit(v.elements);
  return out;
}

/** openDialog 目标是否带第二参数（编辑行）：带参 → 父页面记录选中行，dialog 打开时预填 */
function openDialogTargetsInitial(v: ViewNode): Set<string> {
  const out = new Set<string>();
  const visit = (els: ViewElementNode[]): void => {
    for (const el of els) {
      for (const b of el.bindings) {
        if (b.name === 'openDialog' && b.args.length > 0) out.add(b.target);
      }
      visit(el.children);
    }
  };
  visit(v.elements);
  return out;
}

/** 表单输入控件升级：枚举→Select、日期/日期时间→DatePicker、时间→TimePicker、数字→InputNumber，其余 Input */
function formInputJsx(app: AppNode, struct: StructureNode | undefined, f: string): string {
  const p = struct?.properties.find((pp) => pp.name === f);
  const t = p?.type;
  if (t?.kind === 'reference') {
    const en = app.enums.find((e) => e.name === nameFromPath(t.path));
    if (en) {
      const opts = en.items.map((i) => `{ value: '${i.name}', label: '${i.label ?? i.name}' }`).join(', ');
      return `<Select style={{ width: '100%' }} options={[${opts}]} value={${f}} onChange={(v) => set${cap(f)}(v)} />`;
    }
  }
  if (t?.kind === 'primitive') {
    if (t.builtin === 'Integer' || t.builtin === 'Decimal') {
      return `<InputNumber style={{ width: '100%' }} value={${f} === '' ? null : Number(${f})} onChange={(v) => set${cap(f)}(v == null ? '' : String(v))} />`;
    }
    if (t.builtin === 'Boolean') {
      return `<Switch checked={${f} === 'true'} onChange={(v) => set${cap(f)}(String(v))} />`;
    }
    if (t.builtin === 'Date') {
      return `<DatePicker style={{ width: '100%' }} value={${f} ? dayjs(${f}) : null} onChange={(_, s) => set${cap(f)}(String(s ?? ''))} />`;
    }
    if (t.builtin === 'DateTime') {
      return `<DatePicker showTime style={{ width: '100%' }} value={${f} ? dayjs(${f}) : null} onChange={(_, s) => set${cap(f)}(String(s ?? ''))} />`;
    }
    if (t.builtin === 'Time') {
      return `<TimePicker style={{ width: '100%' }} value={${f} ? dayjs(${f}, 'HH:mm:ss') : null} onChange={(_, s) => set${cap(f)}(String(s ?? ''))} />`;
    }
  }
  return `<Input value={${f}} onChange={(e) => set${cap(f)}(e.target.value)} />`;
}

/** genForm 字段升级用到的额外 antd 组件名（Select/InputNumber/DatePicker/TimePicker） */
/** 表单是否存在必填字段（非空实体约束）→ 提交拦截需要 antd message */
function formHasRequired(app: AppNode, v: ViewNode): boolean {
  let found = false;
  const visit = (els: ViewElementNode[]): void => {
    for (const el of els) {
      if (el.type === 'form' && !found) {
        const mutB = el.bindings.find((b) => b.name === 'useMutation');
        const retT = mutB ? logicOf(app, mutB.target)?.returns[0]?.type : undefined;
        const ent = retT?.kind === 'reference'
          ? app.datasources.flatMap((ds) => ds.entities).find((e) => e.name === nameFromPath(retT.path))
          : undefined;
        if (ent && el.children.some((c) => c.type === 'input' && (() => {
          const f = String(c.props.field ?? '');
          const prop = ent.properties.find((pp) => pp.name === f);
          return prop !== undefined && !prop.nullable && !prop.primary;
        })())) {
          found = true;
        }
      }
      visit(el.children);
    }
  };
  visit(v.elements);
  return found;
}

/** 必填标记红星（实体属性非空约束 & 非主键） */
function RequiredStar(app: AppNode, ent: EntityNode | undefined, field: string): string {
  const prop = ent?.properties.find((p) => p.name === field);
  return prop && !prop.nullable && !prop.primary ? `<span style={{ color: '#ff4d4f' }}>*</span>` : '';
}

function collectFormAntd(app: AppNode, v: ViewNode): string[] {
  const out = new Set<string>();
  const visit = (els: ViewElementNode[]): void => {
    for (const el of els) {
      if (el.type === 'form') {
        const mutB = el.bindings.find((b) => b.name === 'useMutation');
        const logic = mutB ? logicOf(app, mutB.target) : undefined;
        const p0 = logic?.params[0]?.type;
        const struct = p0?.kind === 'reference' ? app.structures.find((x) => x.name === nameFromPath(p0.path)) : undefined;
        for (const i of el.children.filter((c) => c.type === 'input')) {
          const t = struct?.properties.find((pp) => pp.name === String(i.props.field ?? ''))?.type;
          if (t?.kind === 'reference' && app.enums.some((e) => e.name === nameFromPath(t.path))) out.add('Select');
          if (t?.kind === 'primitive') {
            if (t.builtin === 'Integer' || t.builtin === 'Decimal') out.add('InputNumber');
            if (t.builtin === 'Date' || t.builtin === 'DateTime') out.add('DatePicker');
            if (t.builtin === 'Time') out.add('TimePicker');
          }
        }
        // form 有 submit 绑定时 genForm 会自动补提交按钮（htmlType=submit）→ Button 需在 import 中；双列栅格用 Row/Col
        if (mutB) {
          out.add('Button');
          out.add('Row');
          out.add('Col');
        }
      }
      visit(el.children);
    }
  };
  visit(v.elements);
  return [...out];
}

/** form/页面字段是否含日期类字段（需 dayjs import 与依赖） */
function needsDayjs(app: AppNode, v: ViewNode): boolean {
  return collectFormAntd(app, v).some((n) => n === 'DatePicker' || n === 'TimePicker');
}

/** form submit={useMutation('x')} → 表单 + 输入（state 已在 pageFile 顶部提升，此处只出 JSX） */
function genForm(app: AppNode, el: ViewElementNode, queryVars: Map<string, string>, onCloseExpr?: string, refetchExpr?: string): string {
  const mutB = el.bindings.find((b) => b.name === 'useMutation');
  if (!mutB) {
    // form 无 submit 绑定：不生成 onSubmit（不能引用不存在的 mutation）
    const plainInputs = el.children.filter((c) => c.type === 'input')
      .map((i) => {
        const f = String(i.props.field ?? '');
        return `<div><label>${f}: <Input value={${f}} onChange={(e) => set${cap(f)}(e.target.value)} /></label></div>`;      })
      .join('\n');
    return `<form>\n  ${plainInputs}\n</form>`;
  }
  const varname = `m${cap(logicNameOf(mutB.target))}`;
  const inputs = el.children.filter((c) => c.type === 'input');
  const repeats = el.children.filter((c) => c.type === 'repeat');
  // 表单字段类型升级：枚举→Select、日期→DatePicker、数字→InputNumber（字段类型来自 submit mutation 的首参结构体）
  const logic = logicOf(app, mutB.target);
  const p0 = logic?.params[0]?.type;
  const bodyStruct = p0?.kind === 'reference' ? app.structures.find((x) => x.name === nameFromPath(p0.path)) : undefined;
  // 必填字段（jxc 对拍：后台强制字段前端不拦截）：从 submit 返回实体取非空约束 → 红星 + 提交拦截
  const retType = logic?.returns[0]?.type;
  const retEnt = retType?.kind === 'reference'
    ? app.datasources.flatMap((ds) => ds.entities).find((e) => e.name === nameFromPath(retType.path))
    : undefined;
  const reqFields = inputs
    .map((i) => {
      const f = String(i.props.field ?? '');
      const label = String(i.props.label ?? f);
      const prop = retEnt?.properties.find((pp) => pp.name === f);
      const required = Boolean(prop && !prop.nullable && !prop.primary);
      return { f, label, required };
    })
    .filter((r) => r.f !== '');
  const reqPairs = reqFields.filter((r) => r.required).map((r) => `['${r.label}', ${r.f}]`).join(', ');
  // G2（dev/29）：min/max/pattern 属性校验列入提交拦截
  const attrChecks = inputs.flatMap((i) => {
    const f = String(i.props.field ?? '');
    const label = String(i.props.label ?? f);
    const lines: string[] = [];
    const min = i.props['min'];
    const max = i.props['max'];
    const pat = i.props['pattern'];
    if (min !== undefined) lines.push(`if (${f} !== '' && Number(${f}) < ${String(min)}) { message.warning('${label} 不能小于 ${String(min)}'); return; }`);
    if (max !== undefined) lines.push(`if (${f} !== '' && Number(${f}) > ${String(max)}) { message.warning('${label} 不能大于 ${String(max)}'); return; }`);
    if (pat !== undefined) lines.push(`if (${f} !== '' && !new RegExp('${String(pat)}').test(String(${f}))) { message.warning('${label} 格式不正确'); return; }`);
    return lines;
  });
  const attrBlock = attrChecks.length > 0 ? `{ ${attrChecks.join(' ')} }` : '';
  const reqCheck = reqPairs || attrBlock
    ? `{ ${reqPairs ? `const reqPairs: Array<[string, string]> = [${reqPairs}]; const missReq = reqPairs.filter(([, v]) => !String(v ?? '').trim()); if (missReq.length > 0) { message.warning('必填项未填写：' + missReq.map(([l]) => l).join('、')); return; }` : ''} ${attrBlock} }`
    : '';
  // 双列栅格排布（管理端表单观感）
  const requiredAttrOf = (i: ViewElementNode): string => String(i.props['required'] ?? '');
  const starFor = (i: ViewElementNode, f: string): string => {
    const attr = requiredAttrOf(i);
    if (attr === 'false') return '';
    if (attr === 'true') return `<span style={{ color: '#ff4d4f' }}>*</span>`;
    return RequiredStar(app, retEnt, f);
  };
  const inputEls = inputs
    .map((i) => {
      const f = String(i.props.field ?? '');
      if (i.props['derive'] !== undefined) {
        // G2：derive 计算态——渲染层由依赖字段直接计算（readOnly；依赖集=表达式字段状态）
        const dExpr = exprToJs(app, i.props['derive'] as Expr, bodyStruct);
        return `      <Col span={12}><div style={{ marginBottom: 12 }}><label>${String(i.props.label ?? f)}: <Input readOnly style={{ width: '100%' }} value={String(${dExpr})} /></label></div></Col>`;
      }
      let jsx = formInputJsx(app, bodyStruct, f);
      const carry = String(i.props['carryBy'] ?? '');
      if (carry) {
        // G2：carryBy——载体输入变化 → 拉后端档案 → 填回它的 carry 子字段
        const fills = (i.children.filter((c) => c.type === 'input'))
          .map((c) => `            set${cap(String(c.props['field'] ?? ''))}(String(r?.${String(c.props['field'] ?? '')} ?? ''));`)
          .join('\n');
          jsx = jsx.replace(
            `onChange={(e) => set${cap(f)}(e.target.value)}`,
            `onChange={async (e) => { const v = e.target.value; set${cap(f)}(v); try { const r = await api.${carry}(Number(v)); ${fills} } catch { /* 拉档失败静默，保留手输 */ } }}`,
          );
      }
      return `      <Col span={12}><div style={{ marginBottom: 12 }}><label>${String(i.props.label ?? f)}${starFor(i, f)}: ${jsx}</label></div></Col>`;
    })
    .join('\n');
  const repeatEls = repeats
    .map((r) => {
      const field = String(r.props.field ?? 'items');
      const subInputs = r.children.filter((c) => c.type === 'input');
      const itemStruct = repeatItemStruct(app, el, r);
      const rowEls = subInputs
        .map((i) => {
          const f = String(i.props.field ?? '');
          const num = itemStruct?.properties.find((p) => p.name === f)?.type.kind === 'primitive' &&
            (itemStruct?.properties.find((p) => p.name === f)?.type as { builtin?: string })?.builtin !== 'String';
          const convert = num ? 'Number(e.target.value)' : 'e.target.value';
          return `<Input placeholder="${String(i.props.label ?? f)}" value={row.${f}} onChange={(e) => { const next = [...${field}]; next[i] = { ...next[i], ${f}: ${convert} }; set${cap(field)}(next); }} />`;
        })
        .join('\n');
      const defaultObj = subInputs
        .map((i) => {
          const f = String(i.props.field ?? '');
          const p = itemStruct?.properties.find((pp) => pp.name === f);
          const isStr = p?.type.kind === 'primitive' && p.type.builtin === 'String';
          return `${f}: ${isStr ? "''" : '0'}`;
        })
        .join(', ');
      return `<div>
  {${field}.map((row, i) => (
    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
      ${rowEls}
      <Button danger size="small" onClick={() => set${cap(field)}(${field}.filter((_, j) => j !== i))}>删</Button>
    </div>
  ))}
  <Button size="small" onClick={() => set${cap(field)}([...${field}, { ${defaultObj} }])}>+ 添加明细</Button>
</div>`;
    })
    .join('\n');
  // body 对象：input 字段 + repeat 字段；每个字段按结构体形参类型转换（state 是 string）
  // G6 编辑闭环：结构体含 id 字段 → 提交体带上 initial.id（编辑=更新，新增=0）
  const bodyFields = [...inputs.map((i) => String(i.props.field ?? '')), ...repeats.map((r) => String(r.props.field ?? 'items'))];
  const hasIdField = bodyStruct?.properties.some((p) => p.name === 'id') ?? false;
  const bodyParts = [
    ...(hasIdField ? ['id: Number(initial?.id ?? 0)'] : []),
    ...bodyFields.map((f) => {
      const p = bodyStruct?.properties.find((pp) => pp.name === f);
      if (!p) return f;
      const c = stateCoerced(app, f, p.type);
      return c === f ? f : `${f}: ${c}`;
    }),
  ];
  const bodyObj = `{ ${bodyParts.join(', ')} }`;
  // 自动提交按钮文案 = DSL form 内声明的按钮（暂存/保存），避免多出一个硬编码「提交」
  const innerBtn = el.children.find((c) => c.type === 'button');
  const autoLabel = innerBtn ? String(innerBtn.props.text ?? '提交') : '提交';
  // 提交链：必填拦截 → mutate → 弹窗关闭（父层刷新）/ 非弹窗刷新主查询
  const afterMutate = onCloseExpr ? `.then(() => ${onCloseExpr}())` : refetchExpr ? `.then(() => ${refetchExpr})` : '';
  return `<form onSubmit={(e) => { e.preventDefault(); ${reqCheck} ${varname}.mutate(${bodyObj})${afterMutate}; }}>
  <Row gutter={16}>\n${inputEls}\n  </Row>
  ${repeatEls}
  <div style={{ textAlign: 'right', marginTop: 8 }}>
    <Button type="primary" htmlType="submit">${autoLabel}</Button>
  </div>
</form>`;
}

/** form 内 repeat 的元素结构（items → OrderItemInput） */
function repeatItemStruct(app: AppNode, form: ViewElementNode, repeat: ViewElementNode): StructureNode | null {
  const mutB = form.bindings.find((b) => b.name === 'useMutation');
  if (!mutB) return null;
  const logic = logicOf(app, mutB.target);
  let structParamName: string | undefined;
  for (const p of logic?.params ?? []) {
    if (p.type.kind === 'reference') {
      const n = nameFromPath(p.type.path);
      if (app.structures.some((s) => s.name === n)) {
        structParamName = n;
        break;
      }
    }
  }
  if (!structParamName) return null;
  const struct = app.structures.find((s) => s.name === structParamName);
  if (!struct) return null;
  const field = String(repeat.props.field ?? 'items');
  const prop = struct.properties.find((p) => p.name === field && p.type.kind === 'generic' && p.type.name === 'List');
  const elem = prop?.type.kind === 'generic' ? prop.type.args[0] : undefined;
  if (elem?.kind !== 'reference') return null;
  return app.structures.find((s) => s.name === nameFromPath(elem.path)) ?? null;
}

/** 视图是否含 form（需要 useState） */
function viewHasForm(v: ViewNode): boolean {
  const visit = (els: ViewElementNode[]): boolean => {
    for (const el of els) {
      if (el.type === 'form') return true;
      if (visit(el.children)) return true;
    }
    return false;
  };
  return visit(v.elements);
}

/** 收集 form 字段的 useState 声明（input + repeat），供组件体顶部初始化 */
function collectFormStateLines(app: AppNode, v: ViewNode): string[] {
  const lines: string[] = [];
  const visit = (els: ViewElementNode[]): void => {
    for (const el of els) {
      if (el.type === 'form') {
        const inputs = el.children.filter((c) => c.type === 'input');
        for (const i of inputs) {
          const f = String(i.props.field ?? '');
          lines.push(`  const [${f}, set${cap(f)}] = useState('');`);
        }
        const repeats = el.children.filter((c) => c.type === 'repeat');
        for (const r of repeats) {
          const field = String(r.props.field ?? 'items');
          const itemStruct = repeatItemStruct(app, el, r);
          const elemType = itemStruct?.name ?? 'Record<string, unknown>';
          const subInputs = r.children.filter((c) => c.type === 'input');
          const defaults = subInputs
            .map((i) => {
              const f = String(i.props.field ?? '');
              const p = itemStruct?.properties.find((pp) => pp.name === f);
              const isStr = p?.type.kind === 'primitive' && p.type.builtin === 'String';
              return `${f}: ${isStr ? "''" : '0'}`;
            })
            .join(', ');
          lines.push(`  const [${field}, set${cap(field)}] = useState<${elemType}[]>([{ ${defaults} }]);`);
        }
      }
      visit(el.children);
    }
  };
  visit(v.elements);
  return lines;
}

/** dialog 编辑预填（G6）：open && initial → 表单 state ← 选中行；initial=null → 清空（新增） */
function collectFormSyncEffect(app: AppNode, v: ViewNode): string | undefined {
  const clearLines: string[] = [];
  const setLines: string[] = [];
  const visit = (els: ViewElementNode[]): void => {
    for (const el of els) {
      if (el.type === 'form') {
        for (const i of el.children.filter((c) => c.type === 'input')) {
          const f = String(i.props.field ?? '');
          clearLines.push(`      set${cap(f)}('');`);
          setLines.push(`      set${cap(f)}(initial?.${f} != null ? String(initial.${f}) : '');`);
        }
        for (const r of el.children.filter((c) => c.type === 'repeat')) {
          const field = String(r.props.field ?? 'items');
          const itemStruct = repeatItemStruct(app, el, r);
          const elemType = itemStruct?.name ?? 'Record<string, unknown>';
          const subInputs = r.children.filter((c) => c.type === 'input');
          const defaults = subInputs
            .map((i) => {
              const f = String(i.props.field ?? '');
              const p = itemStruct?.properties.find((pp) => pp.name === f);
              const isStr = p?.type.kind === 'primitive' && p.type.builtin === 'String';
              return `${f}: ${isStr ? "''" : '0'}`;
            })
            .join(', ');
          clearLines.push(`      set${cap(field)}([{ ${defaults} }]);`);
          setLines.push(`      set${cap(field)}((initial?.${field} as ${elemType}[] | undefined) ?? [{ ${defaults} }]);`);
        }
      }
      visit(el.children);
    }
  };
  visit(v.elements);
  if (clearLines.length === 0 && setLines.length === 0) return undefined;
  return `  useEffect(() => {\n    if (open) {\n      if (initial) {\n${setLines.join('\n')}\n      } else {\n${clearLines.join('\n')}\n      }\n    }\n  }, [open, initial]);`;
}

/** text field="x" → <span>{data.x}</span> */
function genText(el: ViewElementNode): string {
  const f = String(el.props.field ?? '');
  const safePath = f.split('.').map((seg) => `?.${seg}`).join('');
  return `<span>{data${safePath}}</span>`;
}

/** 枚举值 → Tag 颜色（语义关键词映射，未知项蓝色兜底） */
function tagColorFor(value: string): string {
  const v = value.toUpperCase();
  if (/APPROV|SUCCESS|ACTIVE|OK|ENABLE|PAID|COMPLET|DONE|NORMAL/.test(v)) return 'green';
  if (/REJECT|FAIL|ERROR|CANCEL|TERMINAT|VOID|DISABLE|OVERDUE/.test(v)) return 'red';
  if (/PENDING|WAIT|DRAFT|REVIEW|AUDIT|PROCESS|HOLD/.test(v)) return 'orange';
  if (/CLOSE|ARCHIVE|INACTIVE|EXPIRE|STOP/.test(v)) return 'default';
  return 'blue';
}

/** 管理端常用元素：tag / statistic / tabs / checkbox / switch / radio / avatar / badge / card */
function genCommonElement(
  app: AppNode,
  el: ViewElementNode,
  queryVars: Map<string, string>,
  states: string[],
): string | undefined {
  const label = String(el.props.text ?? el.props.title ?? el.props.field ?? '');
  switch (el.type) {
    case 'tag': {
      const color = String(el.props.color ?? 'blue');
      const v = el.props.value !== undefined ? genBindingArg(el.props.value as Expr, false) : `'${label}'`;
      return `<Tag color="${color}">{${v}}</Tag>`;
    }
    case 'statistic': {
      const v = el.props.value !== undefined ? genBindingArg(el.props.value as Expr, false) : 'null';
      return `<Statistic title="${String(el.props.title ?? '')}" value={${v}} />`;
    }
    case 'tabs': {
      const panes = el.children.filter((c) => c.type === 'pane');
      const items = panes
        .map(
          (p, i) =>
            `{ key: 't${i}', label: '${String(p.props.title ?? p.props.field ?? '')}', children: (
      <>${p.children.map((c) => genElement(app, c, queryVars, states)).join('\n')}</>
    ) }`,
        )
        .join(',\n');
      return `<Tabs items={[\n${items}\n]} />`;
    }
    case 'checkbox': {
      const f = String(el.props.field ?? '');
      return `<Checkbox checked={${f} === 'true'} onChange={(e) => set${cap(f)}(String(e.target.checked))}>${label}</Checkbox>`;
    }
    case 'switch': {
      const f = String(el.props.field ?? '');
      return `<Switch checked={${f} === 'true'} onChange={(v) => set${cap(f)}(String(v))} />`;
    }
    case 'radio': {
      const f = String(el.props.field ?? '');
      const options = String(el.props.options ?? '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
      const opts = options.length > 0 ? options.map((o) => `'${o}'`).join(', ') : '';
      return `<Radio.Group options={[${opts}]} value={${f}} onChange={(e) => set${cap(f)}(e.target.value)} />`;
    }
    case 'avatar': {
      const v = el.props.value !== undefined ? genBindingArg(el.props.value as Expr, false) : `'${label.slice(0, 1)}'`;
      return `<Avatar style={{ backgroundColor: '#1677ff' }}>{${v}}</Avatar>`;
    }
    case 'badge': {
      const v = el.props.count !== undefined ? genBindingArg(el.props.count as Expr, false) : `0`;
      const status = el.props.status ? ` status="${String(el.props.status)}"` : '';
      const text = label && !el.props.count ? ` text="${label}"` : '';
      return `<Badge${status} count={${v}}${text} />`;
    }
    case 'card': {
      const title = String(el.props.title ?? '');
      const inner = el.children.map((c) => genElement(app, c, queryVars, states)).join('\n');
      return `<Card title="${title}">${inner}</Card>`;
    }
  }
  return undefined;
}

/** detail dataSource={useQuery('x')} → antd Descriptions 详情块 */
function genDetail(app: AppNode, el: ViewElementNode, queryVars: Map<string, string>): string {
  const qBinding = el.bindings.find((b) => b.name === 'useQuery');
  const dataVar = qBinding ? queryVars.get(qBinding.target)! : 'data';
  const texts = el.children.filter((c) => c.type === 'text');
  const itemEls = texts
    .map((t) => {
      const f = String(t.props.field ?? '');
      // 字段路径安全化：order.customer → data?.order?.customer（每段都加 ?.）
      const safePath = f.split('.').map((seg) => `?.${seg}`).join('');
      return `    <Descriptions.Item label="${f}">{${dataVar}.data${safePath}}</Descriptions.Item>`;
    })
    .join('\n');
  return `<Descriptions bordered size="small" column={1}>
${itemEls}
</Descriptions>`;
}

// ---------- App.tsx：路由表 ----------

function routerFile(app: AppNode): GeneratedFile {
  // dialog 页面（右侧抽屉）不进路由/菜单：由列表页 openDialog 挂载
  const routed = app.views.filter((v) => v.viewKind !== 'dialog');
  const routes = routed
    .map((v) => {
      const hasRoute = hasRouteParam(v.elements) || routeParamPages(app).has(v.name);
      const path = routePathOf(v) + (hasRoute ? '/:id' : '');
      return `  <Route path="${path}" element={<${v.name} />} />`;
    })
    .join('\n');
  // 根路径重定向到第一个路由页面（dialog 不作为首页）
  const firstView = routed[0];
  const firstRoute = firstView
    ? routePathOf(firstView) + (hasRouteParam(firstView.elements) || routeParamPages(app).has(firstView.name) ? '/:id' : '')
    : null;
  const redirect = firstRoute ? `  <Route path="/" element={<Navigate to="${firstRoute}" replace />} />\n` : '';
  const imports = routed.map((v) => `import ${v.name} from './pages/${v.name}';`).join('\n');
  const navImport = firstRoute ? "import { Navigate } from 'react-router-dom';\n" : '';
  // 管理端布局：顶部 Header（应用名）+ 左侧 Sider 菜单 + 右侧内容区（路由出口）；dialog 不进菜单
  // 管理端布局：顶部 Header（应用名）+ 左侧 Sider 菜单 + 右侧内容区（路由出口）；dialog 不进菜单
  // 菜单分组（模块折叠）：@menu('采购管理') 注解视图归入 SubMenu，无注解视图为顶级项
  const menuGroups = new Map<string, ViewNode[]>();
  const topViews: ViewNode[] = [];
  for (const v of routed) {
    const ann = v.annotations?.find((a) => a.name === 'menu');
    const g = ann?.args?.['value'];
    if (typeof g === 'string' && g !== '') {
      if (!menuGroups.has(g)) menuGroups.set(g, []);
      menuGroups.get(g)!.push(v);
    } else {
      topViews.push(v);
    }
  }
  const menuItemLine = (v: ViewNode): string => `    { key: '${routePathOf(v)}', label: '${viewTitle(v)}' },`;
  const groupLines = [...menuGroups.entries()].map(
    ([g, vs]) =>
      `  {\n    key: 'group-${g}',\n    label: '${g}',\n    children: [\n${vs.map((v) => `      { key: '${routePathOf(v)}', label: '${viewTitle(v)}' },`).join('\n')}\n    ],\n  },`,
  );
  const menuItems = [...groupLines, ...topViews.map((v) => `  { key: '${routePathOf(v)}', label: '${viewTitle(v)}' },`)].join('\n');
  const content = `// 自动生成：页面路由 + 管理端布局（TDSL page）
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Layout, Menu } from 'antd';
${imports}

const { Header, Sider, Content } = Layout;

const MENU_ITEMS = [
${menuItems}
];

export default function App() {
  const nav = useNavigate();
  const base = '/' + (useLocation().pathname.split('/')[1] ?? '');
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: '#001529', color: '#fff', display: 'flex', alignItems: 'center', paddingInline: 24, fontWeight: 600, fontSize: 16 }}>
        ${cap(app.name)} 管理系统
      </Header>
      <Layout>
        <Sider width={216} style={{ background: '#001529' }} collapsible collapsedWidth={64}>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[base]}
            defaultOpenKeys={[${[...menuGroups.keys()].map((k) => `'${k}'`).join(', ')}]}
            items={MENU_ITEMS}
            onClick={({ key }) => (String(key).startsWith('group-') ? undefined : nav(String(key)))}
            style={{ height: '100%', borderInlineEnd: 'none' }}
          />
        </Sider>
        <Content style={{ padding: 24, background: '#f5f5f5' }}>
          <Routes>
${redirect}${routes}
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}
`;
  return { path: 'src/App.tsx', content };
}