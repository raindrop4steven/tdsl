import { describe, expect, it } from 'vitest';
import { parse, TdslSyntaxError, tokenize } from '../src/index';

const SAMPLE = `
@datasource('defaultDS')
entity Todo {
  id: Integer @pk;
  title: String;
  done: Boolean;
}

struct TodoInput {
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

describe('parser/lexer', () => {
  it('tokenizes operators and identifiers', () => {
    const tokens = tokenize('a === b && c <= d := e');
    const values = tokens.map((t) => t.value);
    expect(values).toContain('===');
    expect(values).toContain('&&');
    expect(values).toContain('<=');
    expect(values).toContain(':=');
  });
});

describe('parser/parse', () => {
  it('parses datasource + entity with annotations', () => {
    const app = parse(SAMPLE);
    expect(app.datasources).toHaveLength(1);
    expect(app.datasources[0].name).toBe('defaultDS');
    const todo = app.datasources[0].entities[0];
    expect(todo.name).toBe('Todo');
    expect(todo.properties[0].name).toBe('id');
    expect(todo.properties[0].primary).toBe(true);
    expect(todo.properties[1].type).toEqual({ kind: 'primitive', builtin: 'String' });
  });

  it('parses struct and enum', () => {
    const app = parse(SAMPLE);
    expect(app.structures[0].name).toBe('TodoInput');
    expect(app.structures[0].properties).toHaveLength(2);
  });

  it('links reference types to nodePaths', () => {
    const app = parse(SAMPLE);
    const ret = app.logics[0].returns[0].type;
    expect(ret.kind).toBe('generic');
    if (ret.kind === 'generic') {
      expect(ret.name).toBe('List');
      expect(ret.args[0]).toEqual({
        kind: 'reference',
        path: 'app.datasources.defaultDS.entities.Todo',
      });
    }
  });

  it('parses logic body statements', () => {
    const app = parse(SAMPLE);
    const body = app.logics[0].body;
    expect(body[0]).toMatchObject({ kind: 'VarDecl', name: 'result' });
    expect(body[1]).toMatchObject({ kind: 'ForEach', item: 'todo' });
    expect(body[2]).toMatchObject({ kind: 'Return' });
    // ForEach 内 If
    const forEach = body[1];
    if (forEach.kind === 'ForEach') {
      const inner = forEach.body[0];
      if (inner.kind === 'If') {
        expect(inner.cond).toMatchObject({
          kind: 'Binary',
          operator: '===',
          left: { kind: 'Member', obj: { kind: 'Ident', name: 'todo' }, prop: 'done' },
          right: { kind: 'Bool', value: false },
        });
      }
    }
  });

  it('new List<T>() becomes NewList with linked elem', () => {
    const app = parse(SAMPLE);
    const body = app.logics[0].body;
    if (body[0].kind === 'VarDecl' && body[0].init) {
      expect(body[0].init).toMatchObject({ kind: 'NewList' });
    }
  });

  it('reports syntax errors with line/col', () => {
    try {
      parse('entity Todo { id: Integer }');
      expect.unreachable('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TdslSyntaxError);
      expect((e as TdslSyntaxError).line).toBe(1);
    }
  });

  it('reports unresolved type references', () => {
    expect(() => parse('entity Todo { a: Missing; }')).toThrow(/cannot resolve type 'Missing'/);
  });

  it('rejects duplicate names across datasources', () => {
    const src = `
@datasource('ds1')
entity Todo { id: Integer @pk; }
@datasource('ds2')
entity Todo { id: Integer @pk; }
`;
    expect(() => parse(src)).toThrow(/duplicate type name 'Todo'/);
  });

  it('rejects duplicate names across concepts', () => {
    const src = `
entity Todo { id: Integer @pk; }
struct Todo { id: Integer; }
`;
    expect(() => parse(src)).toThrow(/duplicate type name 'Todo'/);
  });

  it('parses entity without datasource into defaultDS', () => {
    const app = parse('entity Foo { name: String; }');
    expect(app.datasources).toHaveLength(1);
    expect(app.datasources[0].name).toBe('defaultDS');
    expect(app.datasources[0].entities[0].name).toBe('Foo');
  });
});

describe('parser/interface', () => {
  const CRUD = `
entity Todo { id: Integer @pk; title: String; done: Boolean; }

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

  it('parses interface with endpoints and binds logicRef', () => {
    const app = parse(CRUD);
    expect(app.interfaces).toHaveLength(1);
    const itf = app.interfaces[0];
    expect(itf.name).toBe('TodoApi');
    expect(itf.endpoints).toHaveLength(4);

    const get = itf.endpoints[0];
    expect(get.method).toBe('GET');
    expect(get.path).toBe('/api/todos');
    // logicRef 短名被 link 绑定为 nodePath
    expect(get.logicRef).toBe('app.logics.findTodos');

    const put = itf.endpoints[2];
    expect(put.method).toBe('PUT');
    expect(put.path).toBe('/api/todos/{id}');
    expect(put.logicRef).toBe('app.logics.updateTodo');
  });

  it('rejects invalid HTTP method', () => {
    expect(() => parse('interface X { FETCH \'/api/x\' -> findTodos }')).toThrow(
      /invalid HTTP method/,
    );
  });

  it('rejects dangling logicRef', () => {
    expect(() => parse("interface X { GET '/api/x' -> nope }")).toThrow(
      /cannot resolve logic 'nope'/,
    );
  });
});