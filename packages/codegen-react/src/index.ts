import type {
  AppNode,
  EndpointNode,
  EntityNode,
  GeneratedFile,
  InterfaceNode,
  StructureNode,
  TypeRef,
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
      return nameFromPath(tr.path);
    case 'generic':
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
    const entity = app.datasources[0]?.entities[0];
    const itf = app.interfaces[0];
    if (entity) files.push(appFile(app, entity, itf));
  }
  return files;
}

// ---------- 工程脚手架 ----------

function projectFiles(app: AppNode): GeneratedFile[] {
  const name = `${app.name}-react`;
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
    "react-dom": "17.0.2"
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
      content: `import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root'),
);
`,
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