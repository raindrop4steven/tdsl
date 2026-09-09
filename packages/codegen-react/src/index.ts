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
  if (app.datasources.some((ds) => ds.entities.length > 0)) {
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
  // 第三方组件依赖（component 注册的 pkg）
  const compDeps = app.components
    .map((c) => `,\n    "${c.pkg}": "*"`)
    .join('');
  const mainContent = hasViews
    ? `import React from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

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
    "react-dom": "17.0.2"${routerDep}${compDeps}
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

export default defineConfig({
  plugins: [react()],
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
  for (const ds of app.datasources) {
    for (const ent of ds.entities) {
      const fields = ent.properties.map((p) => `  ${p.name}: ${tsType(p.type)};`).join('\n');
      blocks.push(`export interface ${ent.name} {
${fields}
}`);
    }
  }
  for (const s of app.structures) {
    const fields = s.properties.map((p) => `  ${p.name}: ${tsType(p.type)};`).join('\n');
    blocks.push(`export interface ${s.name} {
${fields}
}`);
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

const API = 'http://localhost:8080';

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
${typeImport}const API = 'http://localhost:8080';

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
  const params: string[] = [
    ...pathVars.map((n) => {
      const p = logic?.params.find((pp) => pp.name === n);
      return `${n}: ${p ? tsType(p.type) : 'number'}`;
    }),
    ...(method === 'GET'
      ? queryParams.map((p) => `${p.name}: ${tsType(p.type)}`)
      : queryParams.length > 0
        ? queryParams.map((p) => `body: ${tsType(p.type)}`)
        : []),
  ];
  // URL：/api/orders/{id} → API + '/api/orders/' + id；GET 追加 query string
  let urlExpr = buildUrlExpr(ep.path, pathVars);
  if (method === 'GET' && queryParams.length > 0) {
    const qs = queryParams.map((p, i) => {
      const sep = i === 0 ? '?' : '&';
      return ` + '${sep}${p.name}=' + encodeURIComponent(String(${p.name}))`;
    });
    urlExpr = urlExpr + qs.join('');
  }
  const hasBody = method === 'POST' || method === 'PUT';
  const bodyExpr = hasBody && queryParams.length > 0 ? 'body' : undefined;
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
      expr += `' + ${name} + '`;
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
import { useEffect, useState } from 'react';

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

  useEffect(() => {
    setLoading(true);
    fn()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e))
      .finally(() => setLoading(false));
  }, [...deps, tick]);

  const refetch = () => setTick((t) => t + 1);
  return { data, loading, error, refetch };
}

export function useMutation<T extends unknown[], R>(fn: (...args: T) => Promise<R>) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const mutate = async (...args: T): Promise<R | undefined> => {
    try {
      setLoading(true);
      setError(null);
      return await fn(...args);
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setLoading(false);
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
  const hasRoute = hasRouteParam(v.elements);
  const routePath = routePathOf(v) + (hasRoute ? '/:id' : '');

  // 查询 hooks 变量名：useQuery('listOrders') → qListOrders
  const queryVars = new Map<string, string>();
  queryBindings.forEach((b, i) => queryVars.set(b.target, `q${cap(logicNameOf(b.target))}`));

  const body = v.elements.map((el) => genElement(app, el, queryVars)).join('\n\n');

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
  // form/repeat 需要 useState
  if (viewHasForm(v)) {
    imports.push("import { useState } from 'react';");
  }
  const typeNames = usedTypes(app, v);
  if (typeNames.length > 0) {
    imports.push(`import type { ${typeNames.join(', ')} } from '../types';`);
  }
  // 页面用到的第三方组件 → import ECharts from 'echarts-for-react'
  for (const comp of collectUsedComponents(app, v)) {
    imports.push(`import ${comp.name} from '${comp.pkg}';`);
  }

  const hooksInit: string[] = [];
  // 先声明路由/导航（query 参数可能引用 $route.id → Number(id)）
  if (hasRoute) {
    hooksInit.push(`  const { id } = useParams();`);
  }
  if (navBindings.length > 0) {
    hooksInit.push(`  const nav = useNavigate();`);
  }
  for (const b of queryBindings) {
    const varname = queryVars.get(b.target)!;
    const fn = `() => api.${logicNameOf(b.target)}(${bindingArgs(app, b, hasRoute)})`;
    hooksInit.push(`  const ${varname} = useQuery(${fn});`);
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
  // form 字段状态（hooks 提升到函数体顶部，避免内联 import）
  const formStateLines = collectFormStateLines(app, v);
  hooksInit.push(...formStateLines);

  const content = `${imports.join('\n')}

export default function ${v.name}() {
${hooksInit.join('\n')}
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 760, margin: '0 auto', padding: 24 }}>
${body}
    </div>
  );
}
`;
  return { path: `src/pages/${v.name}.tsx`, content };
}

/** 页面显式引用的 TS 类型名：mutation 参数/返回 + repeat 元素结构（query 类型靠推断，不 import） */
function usedTypes(app: AppNode, v: ViewNode): string[] {
  const names = new Set<string>();
  const visit = (els: ViewElementNode[], parentForm?: ViewElementNode): void => {
    for (const el of els) {
      // mutation 绑定：hook 签名显式引用参数/返回类型
      for (const b of el.bindings) {
        if (b.name === 'useMutation') {
          const logic = logicOf(app, b.target);
          for (const p of logic?.params ?? []) collectTypeNames(p.type, names);
          for (const r of logic?.returns ?? []) collectTypeNames(r.type, names);
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
  return [...names];
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
function genElement(app: AppNode, el: ViewElementNode, queryVars: Map<string, string>): string {
  switch (el.type) {
    case 'table':
      return genTable(app, el, queryVars);
    case 'button':
      return genButton(app, el, queryVars);
    case 'form':
      return genForm(app, el, queryVars);
    case 'text':
      return genText(el);
    case 'detail':
      return genDetail(app, el, queryVars);
    default: {
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

/** table dataSource={useQuery('x')} → 表格 + 列 */
function genTable(app: AppNode, el: ViewElementNode, queryVars: Map<string, string>): string {
  const qBinding = el.bindings.find((b) => b.name === 'useQuery');
  const dataVar = qBinding ? queryVars.get(qBinding.target)! : 'data';
  const columns = el.children.filter((c) => c.type === 'column');
  const colHeaders = columns.map((c) => `<th>${String(c.props.field ?? '')}</th>`).join('\n');
  const colCells = columns.map((c) => `<td>{row.${String(c.props.field ?? '')}}</td>`).join('\n');
  // 行内按钮（table 直接子 button）
  const rowButtons = el.children.filter((c) => c.type === 'button');
  const rowBtnTd =
    rowButtons.length > 0
      ? `<td>${rowButtons.map((b) => genButton(app, b, queryVars)).join(' ')}</td>`
      : '';
  return `<div style={{ marginBottom: 16 }}>
  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
    <thead><tr>${colHeaders}${rowButtons.length > 0 ? '<th>操作</th>' : ''}</tr></thead>
    <tbody>
      {${dataVar}.data?.map((row) => (
        <tr key={row.${String(el.children.find((c) => c.type === 'column')?.props.field ?? 'id')}}>
          ${colCells}${rowBtnTd}
        </tr>
      ))}
    </tbody>
  </table>
</div>`;
}

/** button action={useMutation(...)} / action={navigate(...)} */
function genButton(app: AppNode, el: ViewElementNode, queryVars: Map<string, string>): string {
  const label = el.props['text'] ? String(el.props['text']) : '确定';
  const navB = el.bindings.find((b) => b.name === 'navigate');
  if (navB) {
    const routeBase = navB.target.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    if (navB.args.length > 0) {
      const argExpr = genBindingArg(navB.args[0], false);
      return `<button onClick={() => nav('/${routeBase}/' + ${argExpr})}>${label}</button>`;
    }
    return `<button onClick={() => nav('/${routeBase}')}>${label}</button>`;
  }
  const mutB = el.bindings.find((b) => b.name === 'useMutation');
  if (mutB) {
    const varname = `m${cap(logicNameOf(mutB.target))}`;
    const callArgs = mutB.args.length > 0 ? mutB.args.map((a) => genBindingArg(a, false)).join(', ') : '';
    return `<button onClick={() => ${varname}.mutate(${callArgs})}>${label}</button>`;
  }
  return `<button>${label}</button>`;
}

/** form submit={useMutation('x')} → 表单 + 输入（state 已在 pageFile 顶部提升，此处只出 JSX） */
function genForm(app: AppNode, el: ViewElementNode, queryVars: Map<string, string>): string {
  const mutB = el.bindings.find((b) => b.name === 'useMutation');
  const varname = mutB ? `m${cap(logicNameOf(mutB.target))}` : 'mutation';
  const inputs = el.children.filter((c) => c.type === 'input');
  const repeats = el.children.filter((c) => c.type === 'repeat');
  const inputEls = inputs
    .map((i) => {
      const f = String(i.props.field ?? '');
      return `<label>${f}: <input value={${f}} onChange={(e) => set${cap(f)}(e.target.value)} /></label>`;
    })
    .join('\n');
  // repeat 明细行
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
          return `<input placeholder="${f}" value={row.${f}} onChange={(e) => { const next = [...${field}]; next[i] = { ...next[i], ${f}: ${convert} }; set${cap(field)}(next); }} />`;
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
      <button onClick={() => set${cap(field)}(${field}.filter((_, j) => j !== i))}>删</button>
    </div>
  ))}
  <button onClick={() => set${cap(field)}([...${field}, { ${defaultObj} }])}>+ 添加明细</button>
</div>`;
    })
    .join('\n');
  // body 对象：input 字段 + repeat 字段
  const bodyFields = [...inputs.map((i) => String(i.props.field ?? '')), ...repeats.map((r) => String(r.props.field ?? 'items'))];
  const bodyObj = `{ ${bodyFields.join(', ')} }`;
  return `<form onSubmit={(e) => { e.preventDefault(); ${varname}.mutate(${bodyObj}); }}>
  ${inputEls}
  ${repeatEls}
  <button type="submit">提交</button>
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

/** text field="x" → <span>{data.x}</span> */
function genText(el: ViewElementNode): string {
  const f = String(el.props.field ?? '');
  return `<div>${f}: {data?.${f}}</div>`;
}

/** detail dataSource={useQuery('x')} → 详情块 */
function genDetail(app: AppNode, el: ViewElementNode, queryVars: Map<string, string>): string {
  const qBinding = el.bindings.find((b) => b.name === 'useQuery');
  const dataVar = qBinding ? queryVars.get(qBinding.target)! : 'data';
  const texts = el.children.filter((c) => c.type === 'text');
  const textEls = texts
    .map((t) => {
      const f = String(t.props.field ?? '');
      return `<div>${f}: {${dataVar}.data?.${f}}</div>`;
    })
    .join('\n');
  return `<div style={{ marginBottom: 16 }}>
  ${textEls}
</div>`;
}

// ---------- App.tsx：路由表 ----------

function routerFile(app: AppNode): GeneratedFile {
  const routes = app.views
    .map((v) => {
      const hasRoute = hasRouteParam(v.elements);
      const path = routePathOf(v) + (hasRoute ? '/:id' : '');
      return `  <Route path="${path}" element={<${v.name} />} />`;
    })
    .join('\n');
  const imports = app.views.map((v) => `import ${v.name} from './pages/${v.name}';`).join('\n');
  const content = `// 自动生成：页面路由（TDSL page）
import { Routes, Route } from 'react-router-dom';
${imports}

export default function App() {
  return (
    <Routes>
${routes}
    </Routes>
  );
}
`;
  return { path: 'src/App.tsx', content };
}