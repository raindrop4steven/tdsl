import { describe, expect, it } from 'vitest';
import { parse } from '@tdsl/parser';
import { generateReact } from '../src/index';

const SAMPLE = `
@datasource('defaultDS')
entity Todo {
  id: Integer @pk;
  title: String;
  done: Boolean;
}
struct TodoInput { title: String; done: Boolean; }

@export
logic findTodos(): List<Todo> { return Todo.all; }
@export
logic createTodo(input: TodoInput): Todo { return new Todo(); }
@export
logic updateTodo(id: Integer, input: TodoInput): Todo { return new Todo(); }
@export
logic deleteTodo(id: Integer): Boolean { return true; }

interface TodoApi {
  GET    '/api/todos'       -> findTodos
  POST   '/api/todos'       -> createTodo
  PUT    '/api/todos/{id}'  -> updateTodo
  DELETE '/api/todos/{id}'  -> deleteTodo
}
`;

describe('codegen-react', () => {
  it('scaffolds vite project files', () => {
    const files = generateReact(parse(SAMPLE));
    const names = files.map((f) => f.path);
    expect(names).toContain('package.json');
    expect(names).toContain('vite.config.ts');
    expect(names).toContain('tsconfig.json');
    expect(names).toContain('index.html');
    expect(names).toContain('src/main.tsx');
    expect(names).toContain('src/App.tsx');
  });

  it('generates TS types from entity and structure', () => {
    const files = generateReact(parse(SAMPLE));
    const types = files.find((f) => f.path.endsWith('types/index.ts'))!.content;
    expect(types).toContain('export interface Todo');
    expect(types).toContain('id: number;');
    expect(types).toContain('title: string;');
    expect(types).toContain('done: boolean;');
    expect(types).toContain('export interface TodoInput');
  });

  it('generates App.tsx with real CRUD fetch (data-driven)', () => {
    const files = generateReact(parse(SAMPLE));
    const app = files.find((f) => f.path === 'src/App.tsx')!.content;
    expect(app).toContain('http://localhost:8080');
    expect(app).toContain("fetch(API + '/api/todos')");
    expect(app).toContain("method: 'POST'");
    expect(app).toContain("method: 'DELETE'");
    // 列表表单：非主键字段 title/done 生成输入控件
    expect(app).toContain('title');
    expect(app).toContain('done');
  });

  it('generates React17-style main.tsx', () => {
    const files = generateReact(parse(SAMPLE));
    const main = files.find((f) => f.path === 'src/main.tsx')!.content;
    expect(main).toContain("import ReactDOM from 'react-dom';");
    expect(main).toContain('ReactDOM.render');
    expect(main).not.toContain('react-dom/client');
  });

  it('is deterministic', () => {
    const a = generateReact(parse(SAMPLE)).map((f) => f.content).join('\n');
    const b = generateReact(parse(SAMPLE)).map((f) => f.content).join('\n');
    expect(a).toBe(b);
  });
});
