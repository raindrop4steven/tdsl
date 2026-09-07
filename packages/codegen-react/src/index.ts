import type { AppNode, EntityNode, GeneratedFile, TypeRef } from '@tdsl/core';

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

/** 字段示例值（用于 MOCK_DATA） */
function sampleValue(tr: TypeRef): string {
  switch (tr.kind) {
    case 'primitive':
      switch (tr.builtin) {
        case 'Boolean':
          return 'false';
        case 'Integer':
        case 'Decimal':
          return '0';
        case 'String':
        case 'Date':
        case 'Time':
        case 'DateTime':
          return "'sample'";
      }
      break;
    case 'reference':
      return 'null';
    case 'generic':
      return '[]';
    case 'db':
      return '0';
  }
  const _never: never = tr;
  return _never;
}

/** 生成完整 Vite + React 工程文件列表 */
export function generateReact(app: AppNode): GeneratedFile[] {
  const entity = app.datasources[0]?.entities[0];
  return [...projectFiles(app), ...(entity ? [typesFile(entity), appFile(app, entity)] : [])];
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

// ---------- Entity → TS 类型 ----------

function typesFile(ent: EntityNode): GeneratedFile {
  const fields = ent.properties
    .map((p) => `  ${p.name}: ${tsType(p.type)};`)
    .join('\n');
  const content = `export interface ${ent.name} {
${fields}
}
`;
  return { path: `src/types/${ent.name.toLowerCase()}.ts`, content };
}

// ---------- 固定模板 App.tsx（注入实体字段） ----------

function appFile(app: AppNode, ent: EntityNode): GeneratedFile {
  const sampleFields = ent.properties.map((p) => `    ${p.name}: ${sampleValue(p.type)}`).join(',\n');
  const content = `import { useEffect, useState } from 'react';
import { ${ent.name} } from './types/${ent.name.toLowerCase()}';

// 模拟数据：P1 将替换为真实 API 调用（useQuery / axios）
const MOCK_DATA: ${ent.name}[] = [
  {
${sampleFields},
  },
];

export default function App() {
  const [items, setItems] = useState<${ent.name}[]>([]);

  useEffect(() => {
    setItems(MOCK_DATA);
  }, []);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '0 auto', padding: 24 }}>
      <h1>${cap(ent.name)} List</h1>
      <ul>
        {items.map((item, i) => (
          <li key={i}>{JSON.stringify(item)}</li>
        ))}
      </ul>
    </div>
  );
}
`;
  return { path: 'src/App.tsx', content };
}