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

/** 从实体挑选：主键、首个 String 字段（作为输入）、首个 Boolean 字段（作为勾选） */
function pickFields(ent: EntityNode): { id: string; title: string; done: string } {
  const pk = ent.properties.find((p) => p.primary);
  const title = ent.properties.find(
    (p) => p.type.kind === 'primitive' && p.type.builtin === 'String',
  );
  const done = ent.properties.find(
    (p) => p.type.kind === 'primitive' && p.type.builtin === 'Boolean',
  );
  return {
    id: pk?.name ?? 'id',
    title: title?.name ?? ent.properties[0]?.name ?? 'title',
    done: done?.name ?? 'done',
  };
}

function appFile(app: AppNode, ent: EntityNode, itf?: InterfaceNode): GeneratedFile {
  const { id, title, done } = pickFields(ent);
  const listPath = pathForMethod(itf, 'GET');
  const postPath = pathForMethod(itf, 'POST');
  const putPath = pathForMethod(itf, 'PUT');
  const delPath = pathForMethod(itf, 'DELETE');

  const content = `import { useEffect, useState } from 'react';
import { ${ent.name}, ${ent.name}Input } from './types';

const API = 'http://localhost:8080';

export default function App() {
  const [items, setItems] = useState<${ent.name}[]>([]);
  const [${title}, set${cap(title)}] = useState('');

  const load = () => {
    fetch(API + '${listPath}')
      .then((r) => r.json())
      .then(setItems);
  };

  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    if (!${title}) return;
    await fetch(API + '${postPath}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ${title}, ${done}: false } as ${ent.name}Input),
    });
    set${cap(title)}('');
    load();
  };

  const toggle = async (item: ${ent.name}) => {
    await fetch(API + '${putPath}'.replace('{id}', String(item.${id})), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ${title}: item.${title}, ${done}: !item.${done} } as ${ent.name}Input),
    });
    load();
  };

  const remove = async (${id}: number) => {
    await fetch(API + '${delPath}'.replace('{id}', String(${id})), { method: 'DELETE' });
    load();
  };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '0 auto', padding: 24 }}>
      <h1>${cap(ent.name)} List</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          value={${title}}
          onChange={(e) => set${cap(title)}(e.target.value)}
          placeholder="新增..."
          style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #ccc' }}
        />
        <button onClick={add} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#4472C4', color: '#fff' }}>
          新增
        </button>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {items.map((item) => (
          <li
            key={item.${id}}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 12px', margin: '4px 0', border: '1px solid #ddd', borderRadius: 6,
              textDecoration: item.${done} ? 'line-through' : 'none', opacity: item.${done} ? 0.6 : 1,
            }}
          >
            <span onClick={() => toggle(item)} style={{ cursor: 'pointer' }}>{item.${title}}</span>
            <span>
              <button onClick={() => toggle(item)} style={{ marginRight: 8, cursor: 'pointer' }}>
                {item.${done} ? '✅ 已完成' : '⬜ 未完成'}
              </button>
              <button onClick={() => remove(item.${id})} style={{ cursor: 'pointer' }}>删除</button>
            </span>
          </li>
        ))}
      </ul>
      {items.length === 0 && <p style={{ color: '#888' }}>暂无数据</p>}
    </div>
  );
}
`;
  return { path: 'src/App.tsx', content };
}