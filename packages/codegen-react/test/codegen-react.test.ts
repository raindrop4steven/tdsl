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

@export
logic findTodos(): List<Todo> {
  result := new List<Todo>();
  for (todo in Todo.all) {
    if (todo.done === false) {
      result.add(todo);
    }
  }
  return result;
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

  it('generates TS types from entity', () => {
    const files = generateReact(parse(SAMPLE));
    const types = files.find((f) => f.path.endsWith('types/todo.ts'))!.content;
    expect(types).toContain('export interface Todo');
    expect(types).toContain('id: number;');
    expect(types).toContain('title: string;');
    expect(types).toContain('done: boolean;');
  });

  it('generates App.tsx with entity fields injected', () => {
    const files = generateReact(parse(SAMPLE));
    const app = files.find((f) => f.path === 'src/App.tsx')!.content;
    expect(app).toContain('Todo List');
    expect(app).toContain('useEffect');
    expect(app).toContain('JSON.stringify(item)');
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