import type {
  AppNode,
  BindingNode,
  EndpointNode,
  EntityNode,
  EntityPropertyNode,
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
  // npm 依赖集合（dev/33）：页面骨架默认项 → dependency npm 声明（三方组件 import 的唯一包名来源）
  const depEntries = new Map<string, string>();
  if (hasViews) {
    // antd：页面声明（M4）默认 UI 组件库，提供样式；dayjs：DatePicker 值转换（antd 生态标准）
    depEntries.set('react-router-dom', '^6.30.0');
    depEntries.set('antd', '^5.0.0');
    depEntries.set('dayjs', '^1.11.0');
  }
  for (const d of app.dependencies) {
    if (d.eco === 'npm') depEntries.set(d.name, d.version ?? '*');
  }
  const npmDeps = [...depEntries].map(([n, v]) => `,\n    "${n}": "${v}"`).join('');
  const mainContent = hasViews
    ? `import React from 'react';
import ReactDOM from 'react-dom';
import 'antd/dist/reset.css';
import { BrowserRouter } from 'react-router-dom';
${app.views.length > 0 ? "import App from './App';" : ''}

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
      ${app.views.length > 0 ? '<App />' : '<div>no pages</div>'}
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
    "react-dom": "17.0.2"${npmDeps}
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
  return fetch(${urlExpr}).then((r) => {
    if (!r.ok) return r.json().then((b) => { throw new Error((b && (b as { message?: string }).message) || ('HTTP ' + String(r.status))); });
    return r.json();
  });
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
  return fetch(${urlExpr}${reqArg}).then((r) => {
    if (!r.ok) return r.json().then((b) => { throw new Error((b && (b as { message?: string }).message) || ('HTTP ' + String(r.status))); });
    return r.json();
  });
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
import { message } from 'antd';

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
        // 接口失败必须可见：弹窗提示（静默吞错会让"查不到=没反应"）
        message.error(e instanceof Error ? e.message : String(e));
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
      message.error(e instanceof Error ? e.message : String(e));
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
  // detail 页模式：无 table 且 useQuery 参数引用 row，或按 $route.id 查单条 → row 别名 = 主查询结果，页面路由带 /:id
  // detail 页模式：无 table 且 useQuery 参数引用 row / $route.id（路由查单条）/ initial.id（抽屉查单条）→ row 别名 = 主查询结果
  const rowSrc = hasTable ? undefined : queryBindings.find((b) => b.args.some((a) => exprHasIdent(a, 'row') || exprHasRoute(a) || exprHasIdent(a, 'initial')));
  const isDialogView = v.viewKind === 'dialog';
  const hasRoute = hasRouteParam(v.elements) || routeParamPages(app).has(v.name) || (rowSrc !== undefined && !isDialogView);
  const routePath = routePathOf(v) + (hasRoute ? '/:id' : '');

  // 查询 hooks 变量名：useQuery('listOrders') → qListOrders
  const queryVars = new Map<string, string>();
  queryBindings.forEach((b, i) => queryVars.set(b.target, `q${cap(logicNameOf(b.target))}`));

  // 页面级 state 名清单（input field + form 字段），供 button 的 mutation 实参适配引用
  const pageStates = [...collectInputFields(v), ...collectFormStateLines(app, v).map((l) => l.match(/\[(\w+),/)?.[1] ?? '')].filter(Boolean);

  const imports: string[] = [];
  // hooks 按需导入（useQuery/useMutation 分开）；外键 options hooks 也走 useQuery
  const hookNames: string[] = [];
  if (queryBindings.length > 0 || collectPageFkRefs(app, v).length > 0) hookNames.push('useQuery');
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
  // row 别名的类型也要 import（detail 页主查询 / 顶栏按钮行模式的实体类型）
  let aliasEntName: string | null = null;
  if (rowSrc) {
    const rt = logicOf(app, rowSrc.target)?.returns[0]?.type;
    if (rt?.kind === 'reference') aliasEntName = nameFromPath(rt.path);
  } else if (hasTable && pageLevelRowUse(v)) {
    const src = queryBindings.find((b) => {
      const rt = logicOf(app, b.target)?.returns[0]?.type;
      const el = rt?.kind === 'generic' && rt.name === 'List' ? rt.args[0] : rt;
      return el?.kind === 'reference';
    });
    if (src) {
      const rt = logicOf(app, src.target)!.returns[0].type;
      const el = rt.kind === 'generic' ? rt.args[0] : rt;
      if (el?.kind === 'reference') aliasEntName = nameFromPath(el.path);
    }
  }
  if (aliasEntName && !typeNames.includes(aliasEntName)) typeNames.push(aliasEntName);
  if (typeNames.length > 0) {
    imports.push(`import type { ${typeNames.join(', ')} } from '../types';`);
  }
  // 页面用到的三方组件 → 按 dependency npm 声明的导入形态生成（dev/34）
  //   默认导出 → import ECharts from 'echarts-for-react'
  //   具名导出 → 同包聚合：import { Pie, Bar } from '@ant-design/charts'
  const usedComps = collectUsedComponents(app, v);
  for (const comp of usedComps.filter((c) => c.kind === 'default')) {
    imports.push(`import ${comp.name} from '${comp.pkg}';`);
  }
  const namedByPkg = new Map<string, string[]>();
  for (const comp of usedComps.filter((c) => c.kind === 'named')) {
    const list = namedByPkg.get(comp.pkg) ?? [];
    if (!list.includes(comp.name)) list.push(comp.name);
    namedByPkg.set(comp.pkg, list);
  }
  for (const [pkg, names] of namedByPkg) {
    imports.push(`import { ${names.join(', ')} } from '${pkg}';`);
  }
  // Card 页面容器 + antd 升级控件统一入 import；dialog 页面用 Drawer（不进路由）
  const isDialog = v.viewKind === 'dialog';
  const antdNames = [
    ...new Set([
      ...collectAntdComponents(app, v),
      ...collectFormAntd(app, v),
      ...(formHasRequired(app, v) ? ['message'] : []),
      // 搜索条外键字段 → 引用下拉（数据源 hook 与列共享，控件本身需要 Select）
      // 搜索条枚举字段 → 选项 Select（后缀同 form 的枚举升级）
      ...(collectSearchFkFields(app, v).size > 0 || collectSearchEnumFields(app, v).size > 0 ? ['Select'] : []),
      // 外键渲染点（表单下拉/明细下拉）→ antd Select 已由 collectFormAntd 逐字段精确收取；表格列 fk 显示名不产生 Select
      // 表格枚举列的彩色 Tag（genTable 隐含产物必须计入 import，否则 ReferenceError）
      ...(hasEnumTableColumn(app, v) ? ['Tag'] : []),
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
  // 明细 repeat 操作列用图标删除（非「删」按钮）→ 依赖 @ant-design/icons
  const viewHasRepeat = ((): boolean => {
    let found = false;
    const visit = (els: ViewElementNode[]): void => {
      for (const el of els) {
        if (el.type === 'form' && el.children.some((c) => c.type === 'repeat')) found = true;
        visit(el.children);
      }
    };
    visit(v.elements);
    return found;
  })();
  if (viewHasRepeat) imports.push("import { DeleteOutlined } from '@ant-design/icons';");

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
    queryBindings.filter((b) => b !== rowSrc && b.args.some((a) => exprHasIdent(a, 'row') || exprHasIdent(a, 'initial'))).map((b) => b.target),
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
  // 详情页 row 上下文：页面顶栏按钮引用 row（含 table 的详情页，rowSrc 不存在）→ 取首个 List 查询首行为 row
  if (hasTable && rowSrc === undefined && pageLevelRowUse(v)) {
    const src = queryBindings.find((b) => {
      const rt = logicOf(app, b.target)?.returns[0]?.type;
      const el = rt?.kind === 'generic' && rt.name === 'List' ? rt.args[0] : rt;
      return el?.kind === 'reference' && app.datasources.some((d) => d.entities.some((e) => e.name === nameFromPath(el.path)));
    });
    if (src) {
      const varname = queryVars.get(src.target)!;
      const rt = logicOf(app, src.target)!.returns[0].type;
      const arg0 = rt.kind === 'generic' ? rt.args[0]! : rt;
      const elType = tsType(arg0);
      hooksInit.push(
        `  // 详情页 row 上下文：以列表首行为当前行（详情页单行语义）`,
        `  const row = (${varname}.data ?? [])[0] ?? ({} as ${elType});`,
      );
    }
  }
  // 详情页路由声明了 :id 但查询链未消费 id → 去掉 useParams（noUnusedParameters 免报）
  const idHookIdx = hooksInit.findIndex((l) => l.includes('const { id } = useParams();'));
  const idConsumed = hooksInit.some((l, i) => i !== idHookIdx && l.includes('Number(id)'));
  if (idHookIdx >= 0 && !idConsumed) {
    hooksInit.splice(idHookIdx, 1);
    const routerImport = imports.indexOf("import { useParams } from 'react-router-dom';");
    if (routerImport >= 0 && !imports.some((l) => l.includes('useNavigate'))) imports.splice(routerImport, 1);
  }
  // 管理端排版：列表页 → 两行：搜索行（条件 + 「查询」贴尾）+ 操作按钮行（新增等独立成行）
  // 列表页：顶部 input/button 归搜索行/右上角动作区；卡片/抽屉页：顶层 button 归右上角动作区（正文不再重复渲染）
  const toolbarEls = hasTable ? v.elements.filter((el) => el.type === 'input' || el.type === 'button') : [];
  const restEls = hasTable
    ? v.elements.filter((el) => !toolbarEls.includes(el))
    : v.elements.filter((el) => el.type !== 'button');
  const firstQueryVar = queryBindings.length > 0 ? queryVars.get(queryBindings[0].target) : undefined;
  const formId = isDialog && viewHasForm(v) ? `f-${v.name}` : undefined;
  const body = restEls.map((el) => genElement(app, el, queryVars, pageStates, isDialog ? 'onClose' : undefined, firstQueryVar && !isDialog ? `${firstQueryVar}.refetch()` : undefined, formId)).join('\n\n');
  const toolbarInputs = toolbarEls.filter((el) => el.type === 'input');
  const toolbarButtons = toolbarEls.filter((el) => el.type === 'button');
  const queryButton =
    toolbarInputs.length > 0 && firstQueryVar && !isDialog
      ? `        <Button type="primary" style={{ width: 88 }} onClick={() => ${firstQueryVar}.refetch()}>查询</Button>`
      : '';
  const searchFks = collectSearchFkFields(app, v);
  const searchEnums = collectSearchEnumFields(app, v);
  const searchRow =
    toolbarInputs.length > 0
      ? `      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>\n${toolbarInputs
            .map((el) => {
              const f = String(el.props.field ?? '');
              const fkRef = searchFks.get(f);
              if (fkRef) return `        ${searchFkSelect(fkRef, el)}`;
              const enumName = searchEnums.get(f);
              if (enumName) return `        ${searchEnumSelect(app, enumName, el)}`;
              return `        ${genInput(el)}`;
            })
            .join('\n')}\n${queryButton}\n      </div>`
      : '';
  // 列表页搜索行（条件输入 + 「查询」贴尾）；页面级按钮统一移到卡片右上角动作区（下方 headerActions）
  const toolbar = searchRow;
  // 父页面 openDialog 接线：开关 state + Drawer 组件渲染（关闭时自动 refetch 主查询刷新列表）
  // G6 编辑闭环：每个 dialog 目标配 initial state（新增置 null / 编辑存选中行），打开时预填表单
  const dialogTargets = collectOpenDialogTargets(v);
  for (const t of dialogTargets) {
    hooksInit.push(`  const [show${cap(t)}, setShow${cap(t)}] = useState(false);`);
    hooksInit.push(`  const [${t}Initial, set${cap(t)}Initial] = useState<Record<string, unknown> | null>(null);`);
    // importer 本身在 src/pages/ 内 → 相对路径 ./X（routerFile 的 './pages/X' 只适用于 src/App.tsx）
    imports.push(`import ${cap(t)} from './${t}';`);
  }
  const dialogRenders = dialogTargets
    .map(
      (t) =>
        `    {show${cap(t)} && (<${cap(t)} open={show${cap(t)}} onClose={() => { setShow${cap(t)}(false);${firstQueryVar ? ` ${firstQueryVar}.refetch();` : ''} }} initial={${t}Initial} />)}`,
    )
    .join('\n');
  const formStateLines = collectFormStateLines(app, v);
  hooksInit.push(...formStateLines);
  // 外键 options hooks：表格列/表单/明细的引用下拉共一份数据（无参查询，GET 缺省全量）
  for (const ref of collectPageFkRefs(app, v)) {
    hooksInit.push(`  const ${ref.qvar} = useQuery(() => api.${ref.apiFn}());`);
  }
  const compSig = isDialog
    ? `export default function ${cap(v.name)}({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Record<string, unknown> | null }) {`
    : `export default function ${cap(v.name)}() {`;
  // G6 编辑闭环：dialog 打开时用 initial（编辑选中行）预填表单；新增（initial=null）清空
  const syncEffect = isDialog ? collectFormSyncEffect(app, v) : undefined;
  // dialog 顶层按钮引用 row（如「提交审批」挂表单外）→ row 即 initial（编辑进入时=选中行）
  // 注意：按 initial.id 查单条的详情抽屉已有 rowSrc 别名，此处不重复声明
  if (isDialog && rowSrc === undefined && viewRowBindingUse(v.elements)) {
    hooksInit.push(`  const row = (initial ?? {}) as Omit<Record<string, unknown>, 'id'> & { id: number };`);
  }
  if (syncEffect) {
    hooksInit.push(syncEffect);
    imports[imports.indexOf("import { useState } from 'react';")] = "import { useEffect, useState } from 'react';";
  }
  // 抽屉标题按打开模式渲染：@title('产品编辑') → 新增时「产品新增」/ 编辑时「产品编辑」；
  // 详情抽屉（含 <detail> 块或标题以「详情」结尾）固定「产品详情」；无新增/编辑/详情后缀的标题（如「商机阶段变更」）保持原样
  const titleMatch = /^(.*?)(新增|编辑|详情)$/.exec(viewTitle(v));
  const hasDetailBlock = v.elements.some((el) => el.type === 'detail');
  const drawerTitle = !isDialog
    ? ''
    : hasDetailBlock || titleMatch?.[2] === '详情'
      ? ` title="${titleMatch ? titleMatch[1] : viewTitle(v)}详情"`
      : titleMatch
        ? ` title={initial ? '${titleMatch[1]}编辑' : '${titleMatch[1]}新增'}`
        : ` title="${viewTitle(v)}"`;
  // ---- 顶部右上角动作区（统一风格）：列表页/卡片页/抽屉页的页面级按钮 + 表单提交按钮，多了折叠成「更多」 ----
  const headerBtnEls: ViewElementNode[] = hasTable
    ? toolbarButtons // 列表页：搜索行以外的页面级按钮（新增/导出…）
    : v.elements.filter((el) => el.type === 'button'); // 卡片/详情抽屉：页面级按钮
  const submitInfo = isDialog ? formSubmitInfoOf(app, v) : undefined; // 表单保存按钮移到右上角（form 属性关联）
  const headerPlan = foldButtonsPlan(headerBtnEls, 3);
  const headerInlineJsx = headerPlan.inline
    .map((b) => genElement(app, b, queryVars, pageStates, isDialog ? 'onClose' : undefined))
    .join('\n            ');
  const dropdownJsx =
    headerPlan.folded.length > 0
      ? `\n            <Dropdown menu={{ items: [${headerPlan.folded.map((b, i) => `{ key: 'h${i + 1}', label: '${String(b.props.text ?? '')}' }`).join(', ')}], onClick: ({ key }) => { const map: Record<string, () => void> = {\n${headerPlan.folded
          .map((b, i) => `              h${i + 1}: () => { ${foldButtonHandler(app, b, firstQueryVar ? `${firstQueryVar}.refetch()` : undefined)} }`)
          .join(',\n')}\n            }; map[key]?.(); } }}><Button type="link" size="small">更多</Button></Dropdown>`
      : '';
  const submitJsx = submitInfo
    ? `${headerInlineJsx ? '\n            ' : ''}<Button type="primary" htmlType="submit" form="${submitInfo.formId}">${submitInfo.label}</Button>`
    : '';
  const headerActionsJsx = headerInlineJsx + dropdownJsx + submitJsx;
  const headerActions = headerActionsJsx
    ? `\n            <Space size={4}>${headerActionsJsx}\n            </Space>`
    : '';
  const cardHeader = `<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f0f0f0', paddingBottom: 12, marginBottom: 16 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#1f1f1f' }}>${viewTitle(v)}</h2>${headerActions}
    </div>`;
  const wrapperOpen = isDialog
    ? `    <Drawer${drawerTitle}${headerActionsJsx ? ` extra={<Space size={4}>${headerActionsJsx}\n    </Space>}` : ''} open={open} onClose={onClose} width={Math.min(window.innerWidth * 0.6, 760)} destroyOnClose>`
    : `    <Card style={{ margin: '0 auto', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,21,41,0.06)' }}>\n      ${cardHeader}`;
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

/** 顶部动作区折叠计划：≤maxInline 全内联；超出 → 前 2 个内联 + 余下进「更多」下拉（与行内按钮同款交互） */
function foldButtonsPlan(buttons: ViewElementNode[], maxInline: number): { inline: ViewElementNode[]; folded: ViewElementNode[] } {
  if (buttons.length <= maxInline) return { inline: buttons, folded: [] };
  return { inline: buttons.slice(0, 2), folded: buttons.slice(2) };
}

/** 抽屉表单的提交按钮信息（保存按钮移到右上角动作区，用 form 属性关联表单） */
function formSubmitInfoOf(app: AppNode, v: ViewNode): { label: string; formId: string } | undefined {
  let form: ViewElementNode | undefined;
  const walk = (els: ViewElementNode[]): void => {
    for (const el of els) {
      if (el.type === 'form' && !form) form = el;
      walk(el.children);
    }
  };
  walk(v.elements);
  if (!form) return undefined;
  const innerBtn = form.children.find((c) => c.type === 'button');
  return { label: innerBtn ? String(innerBtn.props.text ?? '保存') : '保存', formId: `f-${v.name}` };
}

/** 页面显式引用的 TS 类型名：mutation 参数/返回 + repeat 元素结构（query 类型靠推断，不 import） */function usedTypes(app: AppNode, v: ViewNode): string[] {
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
  // repeat 明细结构里的枚举字段：单元格 onChange 会 cast 枚举（as Enum）/列值引用 → 须 import
  const repeatEnumFields = new Set<string>();
  const visitRepeats = (els: ViewElementNode[], parentForm?: ViewElementNode): void => {
    for (const el of els) {
      if (el.type === 'repeat' && parentForm) {
        const is = repeatItemStruct(app, parentForm, el);
        if (is) {
          for (const p of is.properties) {
            if (p.type.kind !== 'reference') continue;
            const n = nameFromPath(p.type.path);
            if (app.enums.some((e) => e.name === n)) repeatEnumFields.add(p.name);
          }
        }
      }
      visitRepeats(el.children, el.type === 'form' ? el : parentForm);
    }
  };
  visitRepeats(v.elements);
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
        if ((!stateSet.has(p.name) && !repeatEnumFields.has(p.name)) || !app.enums.some((e) => e.name === n)) continue;
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
      // 抽屉内 initial.id（详情抽屉按选中行查单条）
      if (e.obj.kind === 'Ident' && e.obj.name === 'initial' && e.prop === 'id') return 'Number(initial?.id ?? 0)';
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
/** 枚举成员引用 → 字符串字面量（实体列按枚举名存储，前端值即名字符串）；非枚举成员返回 null */
function enumMemberLiteralOf(app: AppNode, e: Expr): string | null {
  if (e.kind !== 'Member') return null;
  const obj = e.obj;
  if (obj.kind !== 'Ident') return null;
  if (!app.enums.some((en) => en.name === obj.name)) return null;
  return `'${e.prop}'`;
}

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
      const lit = enumMemberLiteralOf(app, e);
      if (lit !== null) return lit;
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
function genElement(app: AppNode, el: ViewElementNode, queryVars: Map<string, string>, states: string[] = [], onCloseExpr?: string, refetchExpr?: string, formId?: string): string {
  switch (el.type) {
    case 'table':
      return genTable(app, el, queryVars, states, refetchExpr);
    case 'button':
      return genButton(app, el, queryVars, { row: false, states, refetch: refetchExpr, inDialog: Boolean(onCloseExpr) });
    case 'form':
      return genForm(app, el, queryVars, onCloseExpr, refetchExpr, formId);
    case 'input':
      return genInput(el);
    case 'repeat':
      return genQueryRepeat(el, queryVars);
    case 'text':
      return genText(el);
    case 'detail':
      return genDetail(app, el, queryVars);
    case 'item':
      // item 由父元素（carousel/list）渲染，独立出现时无意义
      return `{/* item */}`;
    // dev/48 门户看板：栅格 / 轮播 / 只读列表
    case 'row':
      return `<Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
${el.children.map((c) => genElement(app, c, queryVars, states, onCloseExpr, refetchExpr, formId)).join('\n')}
</Row>`;
    case 'col': {
      const sp = el.props.span;
      const raw =
        typeof sp === 'string'
          ? Number(sp)
          : sp !== undefined && sp !== null && typeof sp === 'object' && 'value' in sp
            ? Number((sp as { value?: unknown }).value)
            : 12;
      const spanNum = Number.isFinite(raw) && raw > 0 ? raw : 12;
      return `<Col span={${spanNum}} style={{ display: 'flex', flexDirection: 'column' }}>
${el.children.map((c) => genElement(app, c, queryVars, states, onCloseExpr, refetchExpr, formId)).join('\n')}
</Col>`;
    }
    case 'carousel': {
      // 门户 Banner：按序取品牌渐变色 + 白色大标题/副文案（左对齐 + 右侧装饰圆）
      const palette = ['#1677ff', '#52c41a', '#fa8c16', '#722ed1'];
      const slides = el.children
        .filter((c) => c.type === 'item')
        .map((it, i) => {
          const c = accentColorOf(it.props['color'] ?? palette[i % palette.length]);
          const title = jsxText(String(it.props.title ?? ''));
          const text = jsxText(String(it.props.text ?? ''));
          return `  <div>
    <div style={{ height: 160, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 40px', borderRadius: 8, color: '#fff', background: 'linear-gradient(135deg, ${c} 0%, ${c}bb 100%)', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', right: -40, top: -40, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.14)' }} />
      <h3 style={{ margin: 0, marginBottom: 10, fontSize: 22, fontWeight: 600, color: '#fff' }}>${title}</h3>
      <div style={{ fontSize: 14, opacity: 0.9 }}>${text}</div>
    </div>
  </div>`;
        })
        .join('\n');
      const auto = el.props['autoplay'];
      const autoOn = typeof auto === 'string' ? auto === 'true' : typeof auto === 'object' && auto !== null && (auto as { value?: unknown }).value !== false;
      const autoplay = auto !== undefined && autoOn ? ' autoplay' : '';
      return `<Carousel${autoplay} style={{ marginBottom: 16 }}>
${slides}
</Carousel>`;
    }
    case 'list': {
      // 门户列表卡片：首个 item = 主标题，extra={true} 项 = 右侧强调值，其余 = 次要信息行
      const qB = el.bindings.find((b) => b.name === 'useQuery');
      const dataVar = qB ? queryVars.get(qB.target) ?? `q${cap(logicNameOf(qB.target))}` : 'data';
      const ownerName = qB ? ownerEntityNameOfQuery(app, qB.target) : undefined;
      const owner = ownerName ? app.datasources.flatMap((d) => d.entities).find((e) => e.name === ownerName) : undefined;
      const items = el.children.filter((c) => c.type === 'item');
      const isTrue = (v: unknown): boolean =>
        v === true || v === 'true' || (typeof v === 'object' && v !== null && (v as { value?: unknown }).value === true);
      const primaryItem = items.find((it) => isTrue(it.props['primary'])) ?? items[0];
      const extraItem = items.find((it) => it !== primaryItem && isTrue(it.props['extra']));
      const descItems = items.filter((it) => it !== primaryItem && it !== extraItem);
      const valOf = (it: ViewElementNode): string => listItemValueJsx(app, owner, String(it.props.field ?? ''), 'it');
      const titleJsx = primaryItem ? `<span style={{ fontWeight: 600 }}>${valOf(primaryItem)}</span>` : `''`;
      const descJsx = descItems
        .map((it) => {
          const label = jsxText(String(it.props.title ?? it.props.field ?? ''));
          return `<span style={{ marginRight: 12 }}>${label}：${valOf(it)}</span>`;
        })
        .join('');
      const extraJsx = extraItem
        ? `\n      <span style={{ color: '${accentColorOf(extraItem.props['color'])}', fontWeight: 600 }}>${valOf(extraItem)}</span>`
        : '';
      const titleAttr = el.props.title !== undefined ? ` title="${jsxText(String(el.props.title))}"` : '';
      const meta = descJsx
        ? `<List.Item.Meta title={${titleJsx}} description={<span style={{ color: '#8c8c8c', fontSize: 13 }}>${descJsx}</span>} />`
        : `<List.Item.Meta title={${titleJsx}} />`;
      return `<Card size="small"${titleAttr} style={{ flex: 1, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
  <List size="small" split pagination={{ pageSize: 5, size: 'small' }} dataSource={${dataVar}.data ?? []} renderItem={(it: Record<string, unknown>) => (<List.Item>
      ${meta}${extraJsx}</List.Item>)} />
</Card>`;
    }
    default: {
      // 管理端常用组件（tag/statistic/tabs/checkbox/switch/radio/avatar/badge/card）
      const common = genCommonElement(app, el, queryVars, states);
      if (common !== undefined) return common;
      // 三方组件（dev/33）：dependency npm 匹配 → <ECharts data={...} option={...} />（未匹配交 typecheck 报错）
      if (npmImportOfComponent(app, el.type)) return genComponentElement(app, el, queryVars);
      return `{/* ${el.type} */}`;
    }
  }
}

/** 三方组件元素（dev/33）：组件名即生成标签名；dataSource 绑定 → data={q.data}；其余 prop 透传 */
function genComponentElement(
  app: AppNode,
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
  return `<${el.type} ${propParts.join(' ')} />`;
}

/** 页面用到的三方组件（dev/34）：组件名 + npm 导入解析（pkg + 默认/具名） */
function collectUsedComponents(app: AppNode, v: ViewNode): Array<{ name: string; pkg: string; kind: 'default' | 'named' }> {
  const found = new Map<string, { pkg: string; kind: 'default' | 'named' }>();
  const visit = (els: ViewElementNode[]): void => {
    for (const el of els) {
      if (!KNOWN_VIEW_TYPES_LOCAL.has(el.type)) {
        const imp = npmImportOfComponent(app, el.type);
        if (imp) found.set(el.type, imp);
      }
      visit(el.children);
    }
  };
  visit(v.elements);
  return [...found].map(([name, imp]) => ({ name, pkg: imp.pkg, kind: imp.kind }));
}

/** 组件名 → dependency npm 包名（与 typecheck 同规则）：as <ns> 显式命名优先，包名尾段 norm 兜底 */
/** 组件名 → npm 依赖导入解析（dev/34）：返回 { pkg, kind: 'default'|'named' }
 *  ① import { A } 具名列表命中（alias 优先）② import X 默认导出命中
 *  ③ 兜底：无显式导入的声明，包名尾段 norm 比对 → 按默认导出生成 */
function npmImportOfComponent(app: AppNode, typeName: string): { pkg: string; kind: 'default' | 'named' } | undefined {
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const d of app.dependencies) {
    if (d.eco !== 'npm') continue;
    if (d.imports?.some((i) => (i.alias ?? i.name) === typeName)) return { pkg: d.name, kind: 'named' };
    if (d.importDefault === typeName) return { pkg: d.name, kind: 'default' };
  }
  const dep = app.dependencies.find((d) => {
    if (d.eco !== 'npm' || d.imports || d.importDefault) return false;
    const tail = d.name.split('/').pop() ?? d.name;
    return norm(tail) === norm(typeName);
  });
  return dep ? { pkg: dep.name, kind: 'default' } : undefined;
}

/** 内置元素类型 → antd 组件名（table/button/form/input/detail → 对应 UI 组件） */
/** 内置页面元素类型集（ANTD_OF 键；三方组件之外的合法标签） */
const KNOWN_VIEW_TYPES_LOCAL = new Set<string>(Object.keys({
  table: '', button: '', input: '', detail: '', text: '', form: '', repeat: '', column: '',
  tag: '', statistic: '', tabs: '', pane: '', checkbox: '', radio: '', switch: '', avatar: '', badge: '', card: '',
  // dev/48 门户看板：栅格 / 轮播 / 只读列表（item 由父元素渲染，不单独映射组件）
  row: '', col: '', carousel: '', list: '', item: '', progress: '', alert: '',
}));

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
  // dev/48 门户看板
  row: 'Row',
  col: 'Col',
  carousel: 'Carousel',
  list: 'List',
  progress: 'Progress',
  alert: 'Alert',
};

/** 页面里是否有表格列会渲染枚举彩色 Tag（genTable 枚举列的隐含产物必须进 import） */
function hasEnumTableColumn(app: AppNode, v: ViewNode): boolean {
  let found = false;
  const visit = (els: ViewElementNode[]): void => {
    for (const el of els) {
      if (el.type === 'table') {
        const qB = el.bindings.find((b) => b.name === 'useQuery');
        const lg = qB ? logicOf(app, qB.target) : undefined;
        const rtRaw = lg?.returns[0]?.type;
        const rt = rtRaw?.kind === 'generic' && (rtRaw.name === 'List' || rtRaw.name === 'Page') ? rtRaw.args[0] : rtRaw;
        const ent = rt?.kind === 'reference' ? app.datasources.flatMap((d) => d.entities).find((e) => e.name === nameFromPath(rt.path)) : undefined;
        for (const c of el.children.filter((x) => x.type === 'column')) {
          const f = String(c.props.field ?? '');
          const t = ent?.properties.find((p) => p.name === f)?.type;
          const en = t?.kind === 'reference' ? app.enums.find((e) => e.name === nameFromPath(t.path)) : undefined;
          if (en) found = true;
        }
      }
      visit(el.children);
    }
  };
  visit(v.elements);
  return found;
}

/** 页面用到哪些 antd 组件（去重、保持稳定顺序） */
function collectAntdComponents(app: AppNode, v: ViewNode): string[] {
  const found = new Set<string>();
  // 搜索条 input：外键/枚举字段升级为 Select（searchFkSelect/searchEnumSelect）→ 不再收 Input
  const searchUpgradeFields = new Set([...collectSearchFkFields(app, v).keys(), ...collectSearchEnumFields(app, v).keys()]);
  const visit = (els: ViewElementNode[], inForm: boolean): void => {
    for (const el of els) {
      if (el.type === 'input' && !inForm && !searchUpgradeFields.has(String(el.props.field ?? ''))) found.add(ANTD_OF[el.type]);
      else if (el.type !== 'input') {
        const name = ANTD_OF[el.type];
        if (name) found.add(name);
      }
      visit(el.children, inForm || el.type === 'form');
    }
  };
  visit(v.elements, false);
  // table 行内操作列：≥1 个按钮 → Space 包裹的操作列；有折叠按钮 → Dropdown「更多」
  for (const el of v.elements) {
    if (el.type === 'table') {
      const rowButtons = el.children.filter((c) => c.type === 'button');
      if (rowButtons.length >= 1) found.add('Space');
      if (foldRowButtonPlan(rowButtons).folded.length > 0) found.add('Dropdown');
    }
  }
  // 删除类按钮 → Popconfirm 二次确认（genButton 隐含产物必须计入 import）
  const hasDelete = (() => {
    let hit = false;
    const walk = (els: ViewElementNode[]): void => {
      for (const el of els) {
        if (el.type === 'button' && String(el.props['text'] ?? '').includes('删')) hit = true;
        walk(el.children);
      }
    };
    walk(v.elements);
    return hit;
  })();
  if (hasDelete) found.add('Popconfirm');
  // 门户看板：statistic/list/carousel 生成物统一包 Card（隐含产物须计入 import）
  const hasDashboardWidget = (() => {
    let hit = false;
    const walk = (els: ViewElementNode[]): void => {
      for (const el of els) {
        if (el.type === 'statistic' || el.type === 'list' || el.type === 'carousel' || el.type === 'progress') hit = true;
        walk(el.children);
      }
    };
    walk(v.elements);
    return hit;
  })();
  if (hasDashboardWidget) found.add('Card');
  // 门户列表 item 命中枚举字段 → Tag（渲染中文标签，避免裸枚举名）
  const listHasEnumItem = (() => {
    let hit = false;
    const walk = (els: ViewElementNode[]): void => {
      for (const el of els) {
        if (el.type === 'list') {
          const qb = el.bindings.find((b) => b.name === 'useQuery');
          const ownerName = qb ? ownerEntityNameOfQuery(app, qb.target) : undefined;
          const owner = ownerName ? app.datasources.flatMap((d) => d.entities).find((e) => e.name === ownerName) : undefined;
          for (const it of el.children.filter((c) => c.type === 'item')) {
            const t = owner?.properties.find((p) => p.name === String(it.props.field ?? ''))?.type;
            if (t?.kind === 'reference' && app.enums.some((e) => e.name === nameFromPath(t.path))) hit = true;
          }
        }
        walk(el.children);
      }
    };
    walk(v.elements);
    return hit;
  })();
  if (listHasEnumItem) found.add('Tag');
  // 顶部右上角动作区：页面级按钮/表单提交按钮 → Space；动作数超出折叠阈值 → Dropdown「更多」
  const topButtons = v.elements.filter((el) => el.type === 'button');
  if (topButtons.length > 0 || collectFormStateLines(app, v).length > 0) found.add('Space');
  if (foldButtonsPlan(topButtons, 3).folded.length > 0) found.add('Dropdown');
  // 详情只读子表（detail 内 repeat）→ Table（genDetail 隐含产物）
  const hasDetailRepeat = (() => {
    let hit = false;
    const walk = (els: ViewElementNode[]): void => {
      for (const el of els) {
        if (el.type === 'detail' && el.children.some((c) => c.type === 'repeat')) hit = true;
        walk(el.children);
      }
    };
    walk(v.elements);
    return hit;
  })();
  if (hasDetailRepeat) found.add('Table');
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
    // 数值参数：空串/非数字 → undefined（用户误输文本不再把 NaN 拍成 'NaN' 打进后端）
    return `Number(${p.name}).toString() === 'NaN' || ${p.name} === '' ? undefined : Number(${p.name})`;
  }
  return p.name;
}

function genInput(el: ViewElementNode): string {
  const field = String(el.props.field ?? '');
  // label 属性 → addonBefore（搜索条件名 + 输入框成对出现）；无 label 时保留 placeholder（向后兼容）
  const label = el.props.label ? String(el.props.label) : '';
  if (label) {
    // antd 5 弃用 addonBefore → placeholder（语义相同，不再触发 deprecation 警告）
    return `<Input placeholder="${label}" allowClear style={{ width: 240 }} value={${field}} onChange={(e) => set${cap(field)}(e.target.value)} />`;
  }
  const placeholder = el.props.placeholder ? ` placeholder="${String(el.props.placeholder)}"` : '';
  return `<Input${placeholder} value={${field}} onChange={(e) => set${cap(field)}(e.target.value)} />`;
}

/** 搜索条外键字段 → 引用下拉（options 与列/表单共用 qFk hook；state 仍是字符串 id，查询参数空→undefined） */
function searchFkSelect(ref: FkRef, el: ViewElementNode): string {
  const field = ref.qvar.slice(3).charAt(0).toLowerCase() + ref.qvar.slice(4);
  const label = String(el.props.label ?? field);
  return `<Select allowClear placeholder="${label}" style={{ width: 240 }} options={(${ref.qvar}.data ?? []).map((o) => ({ value: o.id, label: String(o.${ref.labelField}) }))} value={${field} === '' ? null : Number(${field})} onChange={(v) => set${cap(field)}(v == null ? '' : String(v))} />`;
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

// ---------- 外键渲染：xxxId → 引用实体（列表列显示名称、表单/明细行下拉选择） ----------

interface FkRef {
  /** options hook 变量名 */
  qvar: string;
  /** options 查询逻辑名（api.xxx） */
  apiFn: string;
  /** 被引实体的显示字段 */
  labelField: string;
}

/** 数值类字段（Integer/Long/Decimal）才可能是外键 */
function fkNumeric(t: TypeRef): boolean {
  return t.kind === 'primitive' && (t.builtin === 'Integer' || t.builtin === 'Decimal');
}
/** 实体的域 token：从它的 options 查询逻辑名提取（queryErpProduct → 'Erp'；queryCrmBusiness → 'Crm'）；无查询逻辑 → null */
function domainTokenOf(app: AppNode, entName: string): string | null {
  const elt = (t: TypeRef): TypeRef => (t.kind === 'generic' && (t.name === 'List' || t.name === 'Page') ? t.args[0] : t);
  for (const l of app.logics) {
    if (!l.name.startsWith('query') || !l.name.endsWith(entName)) continue;
    if (l.returns.some((r) => {
      const el = elt(r.type);
      return el.kind === 'reference' && nameFromPath(el.path) === entName;
    })) {
      return l.name.slice('query'.length, l.name.length - entName.length) || null;
    }
  }
  return null;
}

/** 外键显示字段：优先 name，其次 title，退化为第一个字符串字段 */
function fkLabelFieldOf(ent: EntityNode): string | null {
  for (const want of ['name', 'title']) {
    if (ent.properties.some((p) => p.name === want)) return want;
  }
  return ent.properties.find((p) => p.type.kind === 'primitive' && p.type.builtin === 'String')?.name ?? null;
}

/** 页面顶层按钮是否引用 row（详情页顶栏动作行需要 row 上下文；表格操作列内的按钮不走此路径） */
function pageLevelRowUse(v: ViewNode): boolean {
  for (const el of v.elements) {
    if (el.type === 'button') {
      for (const b of el.bindings) {
        if (b.args.some((a) => exprHasIdent(a, 'row'))) return true;
      }
    }
  }
  return false;
}

/** 视图（递归）内任一 binding 实参引用 row */
function viewRowBindingUse(els: ViewElementNode[]): boolean {
  for (const el of els) {
    for (const b of el.bindings) {
      if (b.args.some((a) => exprHasIdent(a, 'row'))) return true;
    }
    if (viewRowBindingUse(el.children)) return true;
  }
  return false;
}

/** nodePath → 实体（M10 ref 按语义核约定以 nodePath 表达） */
function entityByNodePath(app: AppNode, path: string): EntityNode | null {
  const m = /^app\.datasources\.([^.]+)\.entities\.(.+)$/.exec(path);
  if (!m) return null;
  return app.datasources.find((d) => d.name === m[1])?.entities.find((e) => e.name === m[2]) ?? null;
}

/** 被引实体的 options 查询逻辑：query{Ds}{Ent} / query{Ent} / 任意返回 List<Ent> 的 query* */
function optionsApiFnOf(app: AppNode, entName: string): string | undefined {
  const elt = (t: TypeRef): TypeRef => (t.kind === 'generic' && (t.name === 'List' || t.name === 'Page') ? t.args[0] : t);
  const ds = app.datasources.find((d) => d.entities.some((e) => e.name === entName));
  const cands = ds ? [`query${cap(ds.name)}${cap(entName)}`, `query${cap(entName)}`] : [`query${cap(entName)}`];
  const direct = cands.find((n) => app.logics.some((l) => l.name === n));
  if (direct) return direct;
  return app.logics.find(
    (l) =>
      l.name.startsWith('query') &&
      l.returns.some((r) => {
        const el = elt(r.type);
        return el.kind === 'reference' && nameFromPath(el.path) === entName;
      }),
  )?.name;
}

/** M10 显式链：holder 实体同名字段携带 @ref 注解 → FkRef（推断完全失效的字典字段/命名不规范引用全靠它） */
function explicitFkRefOf(app: AppNode, holderEntName: string | null | undefined, field: string): FkRef | null {
  if (!holderEntName || !field) return null;
  const holder = app.datasources.flatMap((d) => d.entities).find((e) => e.name === holderEntName);
  const prop = holder?.properties.find((p) => p.name === field);
  if (!prop?.ref) return null;
  const ent = entityByNodePath(app, prop.ref.entityPath);
  if (!ent) return null;
  const apiFn = optionsApiFnOf(app, ent.name);
  if (!apiFn) return null;
  const display = ent.properties.some((p) => p.name === prop.ref!.display) ? prop.ref!.display : fkLabelFieldOf(ent);
  if (!display) return null;
  return { qvar: `qFk${cap(field)}`, apiFn, labelField: display };
}

/** 表单字段可否升级为外键 Select（显式 @ref 优先、推断兜底；页面 import 收集与 genForm 渲染共用同一判定） */
function formFkSelectOf(app: AppNode, struct: StructureNode | null | undefined, field: string): FkRef | null {
  if (!struct) return null;
  const prop = struct.properties.find((pp) => pp.name === field);
  if (!prop || !fkNumeric(prop.type)) return null;
  return explicitFkRefOf(app, structOwnerEntity(app, struct), field) ?? fkRefOf(app, structOwnerEntity(app, struct), field);
}

/** 外键 → options 查询 + 引用实体（三级消歧：域 token 一致 → owner 公共前缀最长 → 最短候选；缺 options 查询逻辑则保持数字） */
function fkRefOf(app: AppNode, ownerEntName: string | null, field: string): FkRef | null {
  if (field.length <= 2 || !field.endsWith('Id')) return null;
  const stem = field.slice(0, -2).toLowerCase();
  if (stem === '') return null;
  const elt = (t: TypeRef): TypeRef => (t.kind === 'generic' && (t.name === 'List' || t.name === 'Page') ? t.args[0] : t);
  const apiFnOf = (ent: EntityNode): string | undefined => {
    const ds = app.datasources.find((d) => d.entities.some((e) => e.name === ent.name));
    const cands = ds ? [`query${cap(ds.name)}${cap(ent.name)}`, `query${cap(ent.name)}`] : [`query${cap(ent.name)}`];
    const direct = cands.find((n) => app.logics.some((l) => l.name === n));
    if (direct) return direct;
    return app.logics.find(
      (l) =>
        l.name.startsWith('query') &&
        l.returns.some((r) => {
          const el = elt(r.type);
          return el.kind === 'reference' && nameFromPath(el.path) === ent.name;
        }),
    )?.name;
  };
  // 候选：stem 同名/后缀命中（parent 特例 = owner 自身），且必须能出 options 下拉
  const cands: Array<{ ent: EntityNode; apiFn: string; labelField: string }> = [];
  for (const ds of app.datasources) {
    for (const ent of ds.entities) {
      const nm = ent.name.toLowerCase();
      const hit =
        stem === 'parent' && ownerEntName
          ? nm === ownerEntName.toLowerCase()
          : nm === stem || nm.endsWith(stem);
      if (!hit) continue;
      const apiFn = apiFnOf(ent);
      const labelField = fkLabelFieldOf(ent);
      if (apiFn && labelField) cands.push({ ent, apiFn, labelField });
    }
  }
  if (cands.length === 1) return { qvar: `qFk${cap(field)}`, apiFn: cands[0].apiFn, labelField: cands[0].labelField };
  if (cands.length === 0) return null;
  // ① owner 同域：域 token（queryCrmBusiness→'Crm'）一致者胜
  if (ownerEntName) {
    const ownTok = domainTokenOf(app, ownerEntName);
    if (ownTok) {
      const inDom = cands.filter((c) => domainTokenOf(app, c.ent.name) === ownTok);
      if (inDom.length === 1) return { qvar: `qFk${cap(field)}`, apiFn: inDom[0].apiFn, labelField: inDom[0].labelField };
    }
  }
  // ② owner 公共前缀最长者（同 token 内 PurchaseIn→PurchaseOrder）
  if (ownerEntName) {
    const own = ownerEntName.toLowerCase();
    const scored = cands.map((c) => {
      const nm = c.ent.name.toLowerCase();
      let s = 0;
      while (s < nm.length && s < own.length && nm[s] === own[s]) s++;
      return { c, s };
    });
    const max = Math.max(...scored.map((x) => x.s));
    if (max > 0) {
      const top = scored.filter((x) => x.s === max);
      if (top.length === 1) return { qvar: `qFk${cap(field)}`, apiFn: top[0].c.apiFn, labelField: top[0].c.labelField };
      // 平级取最短名（PurchaseOrder vs PurchaseOrderItem）
      const shortest = top.reduce((a, b) => (b.c.ent.name.length < a.c.ent.name.length ? b : a));
      const alsoShort = top.filter((t) => t.c.ent.name.length === shortest.c.ent.name.length);
      if (alsoShort.length === 1) return { qvar: `qFk${cap(field)}`, apiFn: alsoShort[0].c.apiFn, labelField: alsoShort[0].c.labelField };
    }
  }
  // ③ 最短候选唯一（Product vs CrmProductCategory，且 owner 无法提供前缀证据时）
  const shortest = cands.reduce((a, b) => (b.ent.name.length < a.ent.name.length ? b : a));
  const shortestTie = cands.filter((c) => c.ent.name.length === shortest.ent.name.length);
  return shortestTie.length === 1 ? { qvar: `qFk${cap(field)}`, apiFn: shortest.apiFn, labelField: shortest.labelField } : null;
}

/** 结构体（XxxInput）→ 推导所属实体（用它的数据源做同源消歧） */
function structOwnerEntity(app: AppNode, struct: StructureNode | null | undefined): string | null {
  const base = struct?.name.replace(/Input$/, '') ?? '';
  if (!base) return null;
  return app.datasources.flatMap((d) => d.entities).find((e) => e.name === base)?.name ?? null;
}

/** 页面里全部外键渲染点 → options hooks（表格列 / 表单字段 / 明细单元格都指向同一份 refer 数据） */
function collectPageFkRefs(app: AppNode, v: ViewNode): FkRef[] {
  const out = new Map<string, FkRef>();
  const push = (ownerEntName: string | null, field: string): void => {
    const ref = explicitFkRefOf(app, ownerEntName, field) ?? fkRefOf(app, ownerEntName, field);
    if (ref) out.set(`${ref.qvar}|${ref.apiFn}`, ref);
  };
  const onStructField = (struct: StructureNode | null | undefined, f: string, ownerEntName: string | null): void => {
    const p = struct?.properties.find((pp) => pp.name === f);
    if (p && fkNumeric(p.type)) push(ownerEntName, f);
  };
  const visit = (els: ViewElementNode[], parentForm?: ViewElementNode, pageOwner?: string | null): void => {
    for (const el of els) {
      // 页面顶层搜索条 input：外键字段也走引用下拉（options 数据源与列/表单共用）
      if (el.type === 'input' && !parentForm && pageOwner) push(pageOwner, String(el.props.field ?? ''));
      if (el.type === 'table') {
        const qB = el.bindings.find((b) => b.name === 'useQuery');
        const lg = qB ? logicOf(app, qB.target) : undefined;
        const rtRaw = lg?.returns[0]?.type;
        const rt = rtRaw?.kind === 'generic' && rtRaw.name === 'List' ? rtRaw.args[0] : rtRaw;
        const owner = rt?.kind === 'reference' ? nameFromPath(rt.path) : null;
        for (const c of el.children.filter((x) => x.type === 'column')) push(owner, String(c.props.field ?? ''));
      }
      if (el.type === 'form') {
        const mutB = el.bindings.find((b) => b.name === 'useMutation');
        const logic = mutB ? logicOf(app, mutB.target) : undefined;
        const p0 = logic?.params[0]?.type;
        const bodyStruct = p0?.kind === 'reference' ? app.structures.find((s) => s.name === nameFromPath(p0.path)) : undefined;
        const owner = structOwnerEntity(app, bodyStruct);
        for (const c of el.children.filter((x) => x.type === 'input')) onStructField(bodyStruct, String(c.props.field ?? ''), owner);
      }
      if (el.type === 'repeat' && parentForm) {
        const itemStruct = repeatItemStruct(app, parentForm, el);
        const owner = structOwnerEntity(app, itemStruct);
        for (const c of el.children.filter((x) => x.type === 'input')) onStructField(itemStruct, String(c.props.field ?? ''), owner);
      }
      // 详情只读子表：列上的引用字段也要 options 数据源（与列表列同源）
      if (el.type === 'detail') {
        const qb = el.bindings.find((b) => b.name === 'useQuery');
        for (const rep of el.children.filter((c) => c.type === 'repeat')) {
          const itemEnt = detailItemEntityOf(app, qb?.target, String(rep.props.field ?? 'items'));
          for (const c of rep.children.filter((x) => x.type === 'column')) {
            push(itemEnt?.name ?? null, String(c.props.field ?? ''));
          }
        }
      }
      // 门户只读列表：item 字段的引用值也要 options 数据源；枚举项渲染中文 Tag（收集器另判）
      if (el.type === 'list') {
        const qb = el.bindings.find((b) => b.name === 'useQuery');
        const ownerName = qb ? ownerEntityNameOfQuery(app, qb.target) : undefined;
        for (const it of el.children.filter((c) => c.type === 'item')) {
          push(ownerName ?? null, String(it.props.field ?? ''));
        }
      }
      visit(el.children, el.type === 'form' ? el : parentForm, pageOwner);
    }
  };
  visit(v.elements, undefined, pageMainEntityOf(app, v));
  return [...out.values()];
}

/** 页面主列表实体（首个 table 数据源；搜索条外壳输入的 @ref 归属用它判定） */function pageMainEntityOf(app: AppNode, v: ViewNode): string | null {
  for (const el of v.elements) {
    if (el.type === 'table') {
      const qb = el.bindings.find((b) => b.name === 'useQuery');
      const rtRaw = qb ? logicOf(app, qb.target)?.returns[0]?.type : undefined;
      const rt = rtRaw?.kind === 'generic' && rtRaw.name === 'List' ? rtRaw.args[0] : rtRaw;
      return rt?.kind === 'reference' ? nameFromPath(rt.path) : null;
    }
  }
  return null;
}

/** 搜索条 FK 字段清单：field → FkRef（页面顶层 input，按主列表实体归属做显式/推断） */
function collectSearchFkFields(app: AppNode, v: ViewNode): Map<string, FkRef> {
  const owner = pageMainEntityOf(app, v);
  if (!owner) return new Map();
  const out = new Map<string, FkRef>();
  for (const f of collectInputFields(v)) {
    const ref = explicitFkRefOf(app, owner, f) ?? fkRefOf(app, owner, f);
    if (ref) out.set(f, ref);
  }
  return out;
}

/** 搜索条枚举字段：field → 枚举名（页面顶层 input，属主实体的枚举属性） */
function collectSearchEnumFields(app: AppNode, v: ViewNode): Map<string, string> {
  const ownerName = pageMainEntityOf(app, v);
  const owner = ownerName ? app.datasources.flatMap((d) => d.entities).find((e) => e.name === ownerName) : undefined;
  if (!owner) return new Map();
  const out = new Map<string, string>();
  for (const f of collectInputFields(v)) {
    const t = owner.properties.find((p) => p.name === f)?.type;
    const en = t?.kind === 'reference' ? app.enums.find((e) => e.name === nameFromPath(t.path)) : undefined;
    if (en) out.set(f, en.name);
  }
  return out;
}

/** 搜索条枚举字段 → 选项 Select（选项来自 TDSL enum 的 key('中文') label；值存枚举名，后端空串→null 不过滤） */
function searchEnumSelect(app: AppNode, enumName: string, el: ViewElementNode): string {
  const field = String(el.props.field ?? '');
  const label = String(el.props.label ?? field);
  const en = app.enums.find((e) => e.name === enumName);
  const opts = (en?.items ?? []).map((i) => `{ value: '${i.name}', label: '${i.label ?? i.name}' }`).join(', ');
  return `<Select allowClear placeholder="${label}" style={{ width: 240 }} options={[${opts}]} value={${field} === '' ? null : ${field}} onChange={(v) => set${cap(field)}(v == null ? '' : String(v))} />`;
}

/**
 * 列定义（列表表格 / 详情只读子表共用）：枚举 → 彩色 Tag、外键 → 引用名、其余原值。
 * 返回 antd columns 的 JSX 行数组（调用方 join(',\n')）。
 */
function columnDefsOf(app: AppNode, ent: EntityNode | undefined, columns: ViewElementNode[]): string[] {
  return columns.map((c) => {
    const field = String(c.props.field ?? '');
    const title = jsxText(String(c.props.title ?? field));
    const enumType = ent?.properties.find((p) => p.name === field)?.type;
    const en = enumType?.kind === 'reference' ? app.enums.find((e) => e.name === nameFromPath(enumType.path)) : undefined;
    if (en) {
      // 枚举项→颜色/中文标签映射在生成期确定，运行期按 row 值取色取标签（生成代码不含未知符号）
      const colorMap = `{ ${en.items.map((i) => `'${i.name}': '${tagColorFor(i.name)}'`).join(', ')} }`;
      const labelMap = `{ ${en.items.map((i) => `'${i.name}': '${i.label ?? i.name}'`).join(', ')} }`;
      return `    { title: '${title}', dataIndex: '${field}', render: (_, row) => { const colors: Record<string, string> = ${colorMap}; const labels: Record<string, string> = ${labelMap}; return <Tag color={colors[String(row.${field})] ?? 'blue'}>{labels[String(row.${field})] ?? String(row.${field})}</Tag>; } }`;
    }
    // 外键列：显式 @ref 优先，其次推断；引用实体 options 就位 → 显示引用名，不再是裸 id
    const fk = explicitFkRefOf(app, ent?.name ?? null, field) ?? fkRefOf(app, ent?.name ?? null, field);
    if (fk) {
      return `    { title: '${title}', dataIndex: '${field}', render: (_, row) => { const opt = (${fk.qvar}.data ?? []).find((o) => o.id === row.${field}); return opt == null ? String(row.${field}) : String(opt.${fk.labelField}); } }`;
    }
    return `    { title: '${title}', dataIndex: '${field}' }`;
  });
}

/** table dataSource={useQuery('x')} → antd Table + 数据驱动 columns（Page<T> 返回自动取 .content；column navigate → onRow 跳转） */
function genTable(app: AppNode, el: ViewElementNode, queryVars: Map<string, string>, states: string[] = [], refetchExpr?: string): string {  const qBinding = el.bindings.find((b) => b.name === 'useQuery');
  const dataVar = qBinding ? queryVars.get(qBinding.target)! : 'data';
  const mainRefetch = refetchExpr ?? (qBinding ? `${dataVar}.refetch()` : undefined);
  // 枚举列自动彩色 Tag：从查询返回实体解析字段类型（状态列不再裸文本）
  const logic = qBinding ? logicOf(app, qBinding.target) : undefined;
  const rtRaw = logic?.returns[0]?.type;
  const rt = rtRaw?.kind === 'generic' && rtRaw.name === 'List' ? rtRaw.args[0] : rtRaw;
  const entName = rt?.kind === 'reference' ? nameFromPath(rt.path) : null;
  const ent = entName
    ? app.datasources.flatMap((ds) => ds.entities).find((e) => e.name === entName)
    : undefined;
  const columns = el.children.filter((c) => c.type === 'column');
  const colDefs = columnDefsOf(app, ent, columns);
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
      const opParams = /\brow\b/.test(inlineJsx + dropdownJsx) ? '(_, row)' : '(_, _row)';
      opCol = `,\n    { title: '操作', key: 'op', render: ${opParams} => (<Space size={2}>${inlineJsx}${dropdownJsx}</Space>) }`;
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
  // rowKey 必须是唯一键：取实体主键（第一列可能是 productId 这类不唯一的外键 → 重复 key 会让分页残留旧行）
  const rowKey = ent?.properties.find((p) => p.primary)?.name ?? String(columns[0]?.props.field ?? 'id');
  return `<Table
  dataSource={${dataSource}}
  rowKey="${rowKey}"
  size="middle"
  bordered
  pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50], showTotal: (t: number) => '共 ' + t + ' 条' }}
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
  const label = el.props['text'] ? jsxText(String(el.props['text'])) : '确定';
  const isRow = opts?.row ?? false;
  const states = opts?.states ?? [];
  // 动作可用性（dev/45 §1.2）：visible → 条件渲染；disabled → 置灰。条件在行上下文编译（row.<字段> 比较 + 枚举成员 + 逻辑组合）
  const visProp = el.props['visible'];
  const disProp = el.props['disabled'];
  const visCond = typeof visProp === 'object' && visProp !== null ? exprToJs(app, visProp as Expr, undefined) : null;
  const disAttr = typeof disProp === 'object' && disProp !== null ? ` disabled={${exprToJs(app, disProp as Expr, undefined)}}` : '';
  const wrap = (jsx: string): string => (visCond ? `{${visCond} && (${jsx})}` : jsx);
  // 行内操作列用链接式按钮（管理端观感，实心按钮在每行太扎眼）；页面级按钮保持 primary
  const rowLink = isRow ? ' type="link" size="small"' : '';
  const primaryAttr = isRow ? rowLink : ' type="primary"';
  // 行内按钮点击时不触发 table 的 onRow 跳转
  const onClick = (expr: string): string =>
    isRow ? `(e) => { e.stopPropagation(); ${expr}; }` : expr.includes(';') ? `() => { ${expr} }` : `() => ${expr}`;
  const navB = el.bindings.find((b) => b.name === 'navigate');
  if (navB) {
    if (navB.args.length > 0) {
      const argExpr = genBindingArg(navB.args[0], false);
      return wrap(`<Button${primaryAttr}${disAttr} onClick={${onClick(`nav('/${routeBaseOf(navB.target)}/' + String(${argExpr}))`)}}>${label}</Button>`);
    }
    return wrap(`<Button${primaryAttr}${disAttr} onClick={${onClick(`nav('/${routeBaseOf(navB.target)}')`)}}>${label}</Button>`);
  }
  const mutB = el.bindings.find((b) => b.name === 'useMutation');
  if (mutB) {
    const varname = `m${cap(logicNameOf(mutB.target))}`;
    // 实参按 logic 形参逐个适配（缺参补字面量；结构体参数 + Ident 实参 → 对象字面量）
    const logic = logicOf(app, mutB.target);
    const callArgs = logic
      ? logic.params.map((p, i) => coerceArg(app, mutB.args[i], p, states, opts?.inDialog ?? false)).join(', ')
      : mutB.args.map((a) => genBindingArg(a, false)).join(', ');
    const ref = opts?.refetch ? `.then(() => ${opts.refetch})` : '';
    // 删除类动作 → Popconfirm 二次确认（防误删；行内按钮点击不下沉触发行跳转）
    if (label.includes('删')) {
      const btnAttrs = isRow ? ' danger type="link" size="small" onClick={(e) => e.stopPropagation()}' : ' danger type="primary"';
      return wrap(`<Popconfirm title="确认删除？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => { ${varname}.mutate(${callArgs})${ref}; }}><Button${btnAttrs}${disAttr}>${label}</Button></Popconfirm>`);
    }
    return wrap(`<Button${rowLink}${disAttr} onClick={${onClick(`${varname}.mutate(${callArgs})${ref}`)}}>${label}</Button>`);
  }
  // onClick={useQuery('x', args)} → 点击触发查询刷新（fn 闭包捕获最新 state，refetch 即用新值重查）
  const qB = el.bindings.find((b) => b.name === 'useQuery');
  if (qB) {
    const varname = queryVars.get(qB.target) ?? `q${cap(logicNameOf(qB.target))}`;
    return wrap(`<Button${rowLink}${disAttr} onClick={${onClick(`${varname}.refetch()`)}}>${label}</Button>`);
  }
  // onClick={openDialog('X')} → 打开右侧抽屉（X 为 dialog 页面，父页面持有开关 state）
  // openDialog('X', row) 带参 → 编辑语义：先把选中行写入 initial state，dialog 打开时预填表单
  const odB = el.bindings.find((b) => b.name === 'openDialog');
  if (odB) {
    const initSet = odB.args.length > 0 ? `set${cap(odB.target)}Initial(${genBindingArg(odB.args[0], false)}); ` : `set${cap(odB.target)}Initial(null); `;
    return wrap(`<Button${primaryAttr}${disAttr} onClick={${onClick(`${initSet}setShow${cap(odB.target)}(true)`)}}>${label}</Button>`);
  }
  return wrap(`<Button${rowLink}${disAttr}>${label}</Button>`);
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
        // 与 genForm 渲染逐字段对齐：derive/字符串 → Input；外键/枚举 → Select；数值 → InputNumber；Boolean → Switch；日期 → DatePicker
        for (const i of el.children.filter((c) => c.type === 'input')) {
          const f = String(i.props.field ?? '');
          if (i.props['derive'] !== undefined) {
            out.add('Input');
            continue;
          }
          const fkRef = formFkSelectOf(app, struct, f);
          if (fkRef) {
            out.add('Select');
            continue;
          }
          const p = struct?.properties.find((pp) => pp.name === f)?.type;
          if (p?.kind === 'reference' && app.enums.some((e) => e.name === nameFromPath(p.path))) out.add('Select');
          else if (p?.kind === 'primitive') {
            if (p.builtin === 'Integer' || p.builtin === 'Decimal') out.add('InputNumber');
            if (p.builtin === 'Boolean') out.add('Switch');
            if (p.builtin === 'Date' || p.builtin === 'DateTime') out.add('DatePicker');
            if (p.builtin === 'Time') out.add('TimePicker');
            if (p.builtin === 'String') out.add('Input');
          } else out.add('Input');
        }
        const itemStructs: Array<StructureNode | null> = [];
        for (const r of el.children.filter((c) => c.type === 'repeat')) {
          itemStructs.push(repeatItemStruct(app, el, r));
          for (const i of r.children.filter((c) => c.type === 'input')) {
            const f = String(i.props.field ?? '');
            const is = itemStructs[itemStructs.length - 1];
            if (formFkSelectOf(app, is, f)) out.add('Select');
            else {
              const pp = is?.properties.find((x) => x.name === f)?.type;
              out.add(pp?.kind === 'primitive' && pp.builtin === 'String' ? 'Input' : 'InputNumber');
            }
          }
        }
        for (const is of itemStructs) {
          if (is ?? false) {
            out.add('Table');
            break;
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
function genForm(app: AppNode, el: ViewElementNode, queryVars: Map<string, string>, onCloseExpr?: string, refetchExpr?: string, formId?: string): string {
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
        return `      <Col span={12}><div style={{ marginBottom: 16 }}><div style={{ marginBottom: 4, fontSize: 13, fontWeight: 500, color: '#262626' }}>${String(i.props.label ?? f)}</div><div style={{ width: '100%' }}><Input readOnly style={{ width: '100%' }} value={String(${dExpr})} /></div></div></Col>`;
      }
      let jsx = formInputJsx(app, bodyStruct, f);
      // 外键字段 → 引用实体下拉（可解析时就地出 Select，不再让人填数字）
      const fkRef = formFkSelectOf(app, bodyStruct, f);
      if (fkRef) {
        jsx = `<Select placeholder="${String(i.props.label ?? f)}" style={{ width: '100%' }} options={(${fkRef.qvar}.data ?? []).map((o) => ({ value: o.id, label: String(o.${fkRef.labelField}) }))} value={${f} === '' ? null : Number(${f})} onChange={(v) => set${cap(f)}(v == null ? '' : String(v))} />`;
      }
      const carry = String(i.props['carryBy'] ?? '');
      if (carry) {
        // G2：carryBy——载体输入变化 → 拉后端档案 → 填回它的 carry 子字段
        const fills = (i.children.filter((c) => c.type === 'input'))
          .map((c) => `            set${cap(String(c.props['field'] ?? ''))}(String(r?.${String(c.props['field'] ?? '')} ?? ''));`)
          .join('\n');
          jsx = jsx.includes(`onChange={(e) => set${cap(f)}(e.target.value)}`)
            ? jsx.replace(
                `onChange={(e) => set${cap(f)}(e.target.value)}`,
                `onChange={async (e) => { const v = e.target.value; set${cap(f)}(v); try { const r = await api.${carry}(Number(v)); ${fills} } catch { /* 拉档失败静默，保留手输 */ } }}`,
              )
            : jsx.replace(
                `onChange={(v) => set${cap(f)}(v == null ? '' : String(v))}`,
                `onChange={async (v) => { const raw = v == null ? '' : String(v); set${cap(f)}(raw); try { const r = await api.${carry}(Number(raw)); ${fills} } catch { /* 拉档失败静默，保留手输 */ } }}`,
              );
      }
      return `      <Col span={12}><div style={{ marginBottom: 16 }}><div style={{ marginBottom: 4, fontSize: 13, fontWeight: 500, color: '#262626' }}>${String(i.props.label ?? f)}${starFor(i, f)}</div><div style={{ width: '100%' }}>${jsx}</div></div></Col>`;
    })
    .join('\n');
  const repeatEls = repeats
    .map((r) => {
      const field = String(r.props.field ?? 'items');
      const subInputs = r.children.filter((c) => c.type === 'input');
      const itemStruct = repeatItemStruct(app, el, r);
      const cellDefs = subInputs
        .map((i) => {
          const f = String(i.props.field ?? '');
          const title = String(i.props.label ?? f);
          // 外键单元格 → 引用实体下拉（明细行不再填数字 id）；render 第二参 row 未被引用时改为 _row（noUnusedParameters 免报）
          const fkProp = itemStruct?.properties.find((p) => p.name === f);
          const cellParams = (body: string): string => (body.includes('row.') ? '(_, row, i)' : '(_, _row, i)');
          // 枚举单元格 → 选项 Select（值存枚举名，提交体类型一致）
          const en = (() => {
            const t = fkProp?.type;
            return t?.kind === 'reference' ? app.enums.find((e) => e.name === nameFromPath(t.path)) : undefined;
          })();
          if (en) {
            const opts = en.items.map((it) => `{ value: '${it.name}', label: '${it.label ?? it.name}' }`).join(', ');
            const body = `(<Select size="small" placeholder="${title}" style={{ width: '100%' }} options={[${opts}]} value={row.${f} === null ? null : row.${f}} onChange={(v) => { const next = [...${field}]; next[i] = { ...next[i], ${f}: String(v ?? '') as ${en.name} }; set${cap(field)}(next); }} />)`;
            return `      { title: '${title}', dataIndex: '${f}', render: ${cellParams(body)} => ${body} }`;
          }
          const fkRef = formFkSelectOf(app, itemStruct, f);
          if (fkRef) {
            const body = `(<Select size="small" placeholder="${title}" style={{ width: '100%' }} options={(${fkRef.qvar}.data ?? []).map((o) => ({ value: o.id, label: String(o.${fkRef.labelField}) }))} value={row.${f} === 0 ? null : row.${f}} onChange={(v) => { const next = [...${field}]; next[i] = { ...next[i], ${f}: Number(v ?? 0) }; set${cap(field)}(next); }} />)`;
            return `      { title: '${title}', dataIndex: '${f}', render: ${cellParams(body)} => ${body} }`;
          }
          const num = fkProp?.type.kind === 'primitive' &&
            (fkProp?.type as { builtin?: string })?.builtin !== 'String';
          if (num) {
            const body = `(<InputNumber size="small" style={{ width: '100%' }} placeholder="${title}" value={row.${f} === 0 ? null : row.${f}} onChange={(v) => { const next = [...${field}]; next[i] = { ...next[i], ${f}: Number(v ?? 0) }; set${cap(field)}(next); }} />)`;
            return `      { title: '${title}', dataIndex: '${f}', render: ${cellParams(body)} => ${body} }`;
          }
          const body = `(<Input size="small" placeholder="${title}" value={row.${f}} onChange={(e) => { const next = [...${field}]; next[i] = { ...next[i], ${f}: e.target.value }; set${cap(field)}(next); }} />)`;
          return `      { title: '${title}', dataIndex: '${f}', render: ${cellParams(body)} => ${body} }`;
        })
        .join(',\n');
      const itemFields = itemStruct?.properties?.length
        ? itemStruct.properties
        : subInputs.map((i) => ({ name: String(i.props.field ?? '') }) as unknown as EntityPropertyNode);
      const defaultObj = itemFields
        .map((p) => {
          const f = p.name;
          const t = p.type;
          if (t?.kind === 'reference' && app.enums.some((e) => e.name === nameFromPath(t.path))) {
            const enName = nameFromPath(t.path);
            return `${f}: '' as ${enName}`;
          }
          const isStr = t?.kind === 'primitive' && t.builtin === 'String';
          return `${f}: ${isStr ? "''" : '0'}`;
        })
        .join(', ');
      return `<div style={{ marginBottom: 8 }}>
  <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600, color: '#262626' }}>明细</div>
  <Table
    size="small"
    bordered
    pagination={false}
    rowKey={(_, index) => String(index)}
    dataSource={${field}}
    columns={[
${cellDefs},
      { title: '操作', key: 'op', width: 60, render: (_, _row, i) => (<Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => set${cap(field)}(${field}.filter((_, j) => j !== i))} />) }
    ]}
  />
  <Button size="small" style={{ marginTop: 8 }} onClick={() => set${cap(field)}([...${field}, { ${defaultObj} }])}>+ 添加明细</Button>
</div>`;
    })
    .join('\n');
  // 明细合计（dev/45 §1.3）：form 内 <summary field expr/of label> → 实时归约文本
  const summaryEls = el.children
    .filter((c) => c.type === 'summary')
    .map((s) => {
      const field = String(s.props.field ?? '');
      const label = String(s.props.label ?? '合计');
      const rep = repeats.find((r) => String(r.props.field ?? 'items') === field);
      const itemStruct = rep ? repeatItemStruct(app, el, rep) : null;
      const exprProp = s.props['expr'];
      const expr = typeof exprProp === 'object' && exprProp !== null ? (exprProp as Expr) : null;
      const of = s.props['of'] !== undefined ? String(s.props['of']) : null;
      const reduce = expr
        ? `(${field}.reduce((s, it) => s + (${summaryExprToJs(app, expr, itemStruct)}), 0)).toFixed(2)`
        : `(${field}.reduce((s, it) => s + Number(it.${of ?? ''}), 0)).toFixed(2)`;
      return `  <div style={{ textAlign: 'right', marginTop: 8, fontWeight: 600 }}>${label}：{${reduce}}</div>`;
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
  // 抽屉表单：id 供右上角动作区的提交按钮用 form 属性关联；页脚不再重复放保存按钮
  const formOpenTag = formId ? `<form id="${formId}" onSubmit=` : `<form onSubmit=`;
  const footer = formId
    ? ''
    : `\n  <div style={{ textAlign: 'right', marginTop: 8 }}>
    <Button type="primary" htmlType="submit">${autoLabel}</Button>
  </div>`;
  return `${formOpenTag}{(e) => { e.preventDefault(); ${reqCheck} ${varname}.mutate(${bodyObj})${afterMutate}; }}>
  <Row gutter={16}>\n${inputEls}\n  </Row>
  ${repeatEls}${summaryEls ? '\n' + summaryEls : ''}${footer}
</form>`;
}

/** summary 归约表达式编译（明细行上下文）：字段标识 → it.<name>（数值包 Number）；支持 + - * / 与括号 */
function summaryExprToJs(app: AppNode, e: Expr, itemStruct: StructureNode | null): string {
  const walk = (x: Expr): string => {
    switch (x.kind) {
      case 'Ident': {
        const p = itemStruct?.properties.find((pp) => pp.name === x.name);
        const isNum = p?.type.kind === 'primitive' && p.type.builtin !== 'String';
        return isNum ? `Number(it.${x.name})` : `it.${x.name}`;
      }
      case 'Binary':
        return `(${walk(x.left)} ${x.operator === '===' ? '===' : x.operator} ${walk(x.right)})`;
      case 'Group':
        return `(${walk(x.expr)})`;
      case 'Numeric':
        return String(x.value);
      default:
        return exprToJs(app, x, itemStruct ?? undefined);
    }
  };
  return walk(e);
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
function repeatDefaultsOf(app: AppNode, itemStruct: StructureNode | null, subInputs: ViewElementNode[]): string {
  const fields = itemStruct?.properties?.length
    ? itemStruct.properties
    : subInputs.filter((i) => String(i.props.field ?? '') !== '').map((i) => ({ name: String(i.props.field ?? '') }) as unknown as EntityPropertyNode);
  return fields
    .map((p) => {
      const f = p.name;
      const t = p.type;
      if (t?.kind === 'reference' && app.enums.some((e) => e.name === nameFromPath(t.path))) return `${f}: '' as ${nameFromPath(t.path)}`;
      const isStr = t?.kind === 'primitive' && t.builtin === 'String';
      return `${f}: ${isStr ? "''" : '0'}`;
    })
    .join(', ');
}

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
          const defaults = repeatDefaultsOf(app, itemStruct, subInputs);
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
          const defaults = repeatDefaultsOf(app, repeatItemStruct(app, el, r), subInputs);
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
      // dev/48：dataSource 绑聚合查询（标量）；指标卡：左侧色条 + 浅色渐变底 + 大号彩色数字
      const qB = el.bindings.find((b) => b.name === 'useQuery');
      const title = jsxText(String(el.props.title ?? ''));
      const valueJsx = qB
        ? `Number(${queryVars.get(qB.target) ?? `q${cap(logicNameOf(qB.target))}`}.data ?? 0)`
        : `${el.props.value !== undefined ? genBindingArg(el.props.value as Expr, false) : 'null'}`;
      const accent = accentColorOf(el.props['color']);
      const suffix = el.props['suffix'] !== undefined ? ` suffix="${String(el.props['suffix'])}"` : '';
      return `<Card size="small" bordered={false} style={{ flex: 1, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', background: 'linear-gradient(135deg, ${accent}14 0%, #ffffff 72%)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 4, height: 38, borderRadius: 2, background: '${accent}' }} />
      <Statistic title="${title}" value={${valueJsx}}${suffix} valueStyle={{ fontSize: 26, fontWeight: 600, color: '${accent}' }} />
    </div>
  </Card>`;
    }
    case 'progress': {
      // 进度/完成率（门户目标达成）
      const pct = el.props['percent'] !== undefined ? genBindingArg(el.props['percent'] as Expr, false) : '0';
      const label = el.props['title'] !== undefined ? jsxText(String(el.props['title'])) : '';
      const stroke = accentColorOf(el.props['color']);
      const status = el.props['status'] !== undefined ? ` status="${String(el.props['status'])}"` : '';
      const bar = `<Progress percent={${pct}} strokeColor="${stroke}"${status} />`;
      return label
        ? `<Card size="small" style={{ flex: 1, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
    <div style={{ marginBottom: 8, color: '#595959', fontSize: 13 }}>${label}</div>
    ${bar}
  </Card>`
        : bar;
    }
    case 'alert': {
      // 公告/提示条（门户通知）
      const msg = jsxText(String(el.props['title'] ?? ''));
      const desc = el.props['text'] !== undefined ? ` description="${jsxText(String(el.props['text']))}"` : '';
      const type = el.props['type'] !== undefined ? String(el.props['type']) : 'info';
      return `<Alert style={{ marginBottom: 16, borderRadius: 8 }} type="${type}" message="${msg}"${desc} showIcon />`;
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
      const label = t.props['title'] !== undefined ? String(t.props['title']) : f;
      // 字段路径安全化：order.customer → data?.order?.customer（每段都加 ?.）
      const safePath = f.split('.').map((seg) => `?.${seg}`).join('');
      return `    <Descriptions.Item label="${label}">{${dataVar}.data${safePath}}</Descriptions.Item>`;
    })
    .join('\n');
  // 详情只读子表（dev/45 §1.4）：<repeat field> → 查询返回结构体的 List 字段（明细行实体，只读列）
  const repEls = el.children
    .filter((c) => c.type === 'repeat')
    .map((r) => {
      const field = String(r.props.field ?? 'items');
      const itemEnt = detailItemEntityOf(app, qBinding?.target, field);
      const cols = r.children.filter((c) => c.type === 'column');
      const colDefs = columnDefsOf(app, itemEnt, cols);
      const title = String(r.props['title'] ?? '明细');
      return `<div style={{ marginTop: 12, marginBottom: 4, fontSize: 13, fontWeight: 600, color: '#262626' }}>${title}</div>
<Table dataSource={${dataVar}.data?.${field} ?? []} rowKey="id" size="small" bordered pagination={false} columns={[${colDefs.join(',\n')}]} />`;
    })
    .join('\n');
  const detailBlock = `<Descriptions bordered size="small" column={1}>
${itemEls}
</Descriptions>`;
  return repEls ? `${detailBlock}\n${repEls}` : detailBlock;
}

/** JSX 文本安全化：< > { } & 转义（用户文案可能含「<5%」这类字符，否则截断标签） */
function jsxText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
}

/** 门户强调色（statistic/list/carousel 的 color 属性）：颜色名 → 品牌色；#hex 原样；缺省蓝 */
function accentColorOf(v: unknown): string {
  const raw = typeof v === 'string' ? v : typeof v === 'object' && v !== null && 'value' in v ? String((v as { value?: unknown }).value ?? '') : '';
  if (raw === '') return '#1677ff';
  if (raw.startsWith('#')) return raw;
  const map: Record<string, string> = {
    blue: '#1677ff',
    green: '#52c41a',
    orange: '#fa8c16',
    red: '#f5222d',
    purple: '#722ed1',
    cyan: '#13c2c2',
    magenta: '#eb2f96',
    gold: '#faad14',
  };
  return map[raw] ?? '#1677ff';
}

/** 查询逻辑返回的实体名（list 行渲染的外键判定用；结构体/标量返回 null） */
function ownerEntityNameOfQuery(app: AppNode, target: string): string | undefined {
  const rtRaw = logicOf(app, target)?.returns[0]?.type;
  const rt = rtRaw?.kind === 'generic' && (rtRaw.name === 'List' || rtRaw.name === 'Page') ? rtRaw.args[0] : rtRaw;
  return rt?.kind === 'reference' ? nameFromPath(rt.path) : undefined;
}

/** list 行字段取值 JSX：外键 → 引用名（options 已就绪时）；枚举/其余 → 原值字符串 */
function listItemValueJsx(app: AppNode, owner: EntityNode | undefined, field: string, rowVar: string): string {
  // 枚举 → 中文 Tag（与列表列同款，避免门户里出现 UNFOLLOWED 这类裸枚举名）
  const enumType = owner?.properties.find((p) => p.name === field)?.type;
  const en = enumType?.kind === 'reference' ? app.enums.find((e) => e.name === nameFromPath(enumType.path)) : undefined;
  if (en) {
    const colorMap = `{ ${en.items.map((i) => `'${i.name}': '${tagColorFor(i.name)}'`).join(', ')} }`;
    const labelMap = `{ ${en.items.map((i) => `'${i.name}': '${i.label ?? i.name}'`).join(', ')} }`;
    const v = `String(${rowVar}.${field} ?? '')`;
    return `{(() => { const colors: Record<string, string> = ${colorMap}; const labels: Record<string, string> = ${labelMap}; const v = ${v}; return <Tag color={colors[v] ?? 'blue'}>{labels[v] ?? v}</Tag>; })()}`;
  }
  const fk = explicitFkRefOf(app, owner?.name ?? null, field) ?? fkRefOf(app, owner?.name ?? null, field);
  if (fk) {
    return `{String((${fk.qvar}.data ?? []).find((o) => o.id === ${rowVar}.${field})?.${fk.labelField} ?? ${rowVar}.${field})}`;
  }
  return `{String(${rowVar}.${field} ?? '')}`;
}

/** 详情只读子表的行实体：详情查询返回结构体 → 字段 `List<Xxx>` 的实参类型（须为实体） */
function detailItemEntityOf(app: AppNode, detailLogicTarget: string | undefined, field: string): EntityNode | undefined {
  if (!detailLogicTarget) return undefined;
  const rt = logicOf(app, detailLogicTarget)?.returns[0]?.type;
  if (rt?.kind !== 'reference') return undefined;
  const struct = app.structures.find((s) => s.name === nameFromPath(rt.path));
  const t = struct?.properties.find((p) => p.name === field)?.type;
  const elem = t?.kind === 'generic' && (t.name === 'List' || t.name === 'Page') ? t.args[0] : undefined;
  if (elem?.kind !== 'reference') return undefined;
  return app.datasources.flatMap((d) => d.entities).find((e) => e.name === nameFromPath(elem.path));
}

// ---------- App.tsx：路由表 ----------

function routerFile(app: AppNode): GeneratedFile {
  // dialog 页面（右侧抽屉）不进路由/菜单：由列表页 openDialog 挂载
  const routed = app.views.filter((v) => v.viewKind !== 'dialog');
  // 详情页（路由带参数 /:id）只进路由不进菜单/首页：由列表行 navigate 进入
  const isDetail = (v: ViewNode): boolean => hasRouteParam(v.elements) || routeParamPages(app).has(v.name);
  const listViews = routed.filter((v) => !isDetail(v));
  const routes = routed
    .map((v) => {
      const hasRoute = isDetail(v);
      const path = routePathOf(v) + (hasRoute ? '/:id' : '');
      // dev/48：@role 保护（有注解的页面按角色渲染路由；无注解页面照旧）
      const roleAnn = v.annotations?.find((a) => a.name === 'role');
      const raw = roleAnn?.args?.['value'];
      const roles = typeof raw === 'string' ? raw.split(',').map((x) => x.trim()).filter((x) => x !== '') : [];
      if (roles.length === 0) return `  <Route path="${path}" element={<${cap(v.name)} />} />`;
      return `  {(${JSON.stringify(roles)} as string[]).includes(role) && <Route path="${path}" element={<${cap(v.name)} />} />}`;
    })
    .join('\n');
  // 根路径重定向到第一个列表页（dialog/详情不作为首页）
  const firstView = listViews[0];
  const firstRoute = firstView ? routePathOf(firstView) : null;
  const redirect = firstRoute ? `  <Route path="/" element={<Navigate to={HOME_ROUTE} replace />} />\n` : '';
  // 首页候选顺序（列表页声明序）：/ 重定向到当前角色第一个可见页
  const firstRoutes = listViews.map((v) => `'${routePathOf(v)}'`).join(', ');
  const imports = routed.map((v) => `import ${cap(v.name)} from './pages/${v.name}';`).join('\n');
  const navImport = firstRoute ? "import { Navigate } from 'react-router-dom';\n" : '';
  // 管理端布局：顶部 Header（应用名）+ 左侧 Sider 菜单 + 右侧内容区（路由出口）；dialog 不进菜单
  // 管理端布局：顶部 Header（应用名）+ 左侧 Sider 菜单 + 右侧内容区（路由出口）；dialog 不进菜单
  // 菜单分组（模块折叠）：@menu('采购管理') 注解视图归入 SubMenu，无注解视图为顶级项
  const menuGroups = new Map<string, ViewNode[]>();
  const topViews: ViewNode[] = [];
  for (const v of listViews) {
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

// 首页：第一个列表页（门户文件声明在前 → 默认落门户）
const FIRST_ROUTES: string[] = [${firstRoutes}];
const HOME_ROUTE = FIRST_ROUTES[0] ?? '/';

export default function App() {
  const nav = useNavigate();
  const base = '/' + (useLocation().pathname.split('/')[1] ?? '');
  return (
    <Layout style={{ height: '100vh' }}>
      <Header style={{ background: '#001529', color: '#fff', display: 'flex', alignItems: 'center', paddingInline: 24, fontWeight: 600, fontSize: 16 }}>
        ${cap(app.name)} 管理系统
      </Header>
      <Layout style={{ height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
        <Sider width={216} style={{ background: '#001529' }} collapsible collapsedWidth={64}>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[base]}
            defaultOpenKeys={[${[...menuGroups.keys()].map((k) => `'${k}'`).join(', ')}]}
            items={MENU_ITEMS}
            onClick={({ key }) => (String(key).startsWith('group-') ? undefined : nav(String(key)))}
            style={{ height: '100%', overflow: 'auto', borderInlineEnd: 'none' }}
          />
        </Sider>
        <Content style={{ height: '100%', padding: 24, background: '#f5f5f5', overflow: 'auto' }}>
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