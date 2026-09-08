import { describe, expect, it } from 'vitest';
import { parse } from '@tdsl/parser';
import { generateJava } from '../src/index';

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

describe('codegen-java', () => {
  it('scaffolds spring boot project files', () => {
    const files = generateJava(parse(SAMPLE));
    const names = files.map((f) => f.path);
    expect(names).toContain('pom.xml');
    expect(names).toContain('src/main/java/com/todo/TodoApplication.java');
    expect(names).toContain('src/main/resources/application.yml');
  });

  it('generates JPA entity with getters/setters', () => {
    const files = generateJava(parse(SAMPLE));
    const entity = files.find((f) => f.path.endsWith('entity/Todo.java'))!.content;
    expect(entity).toContain('@Entity');
    expect(entity).toContain('@Table(name = "todo")');
    expect(entity).toContain('@Id');
    expect(entity).toContain('private Long id;');
    expect(entity).toContain('private Boolean done;');
    expect(entity).toContain('public String getTitle()');
    expect(entity).toContain('public void setTitle(String title)');
  });

  it('generates repository per entity', () => {
    const files = generateJava(parse(SAMPLE));
    const repo = files.find((f) => f.path.endsWith('repository/TodoRepository.java'))!.content;
    expect(repo).toContain('public interface TodoRepository extends JpaRepository<Todo, Long>');
  });

  it('translates logic body to service', () => {
    const files = generateJava(parse(SAMPLE));
    const svc = files.find((f) => f.path.endsWith('service/FindTodosService.java'))!.content;
    expect(svc).toContain('@Service');
    expect(svc).toContain('public class FindTodosService');
    expect(svc).toContain('private final TodoRepository todoRepository;');
    expect(svc).toContain('todoRepository.findAll()');
    expect(svc).toContain('todo.getDone() == false');
    expect(svc).toContain('result.add(todo)');
    expect(svc).toContain('return result;');
  });

  it('is deterministic: same input → same output', () => {
    const a = generateJava(parse(SAMPLE)).map((f) => f.content).join('\n');
    const b = generateJava(parse(SAMPLE)).map((f) => f.content).join('\n');
    expect(a).toBe(b);
  });
});

const CRUD = `
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
logic createTodo(input: TodoInput): Todo {
  todo := new Todo();
  todo.title = input.title;
  todo.done = input.done;
  todo.save();
  return todo;
}
@export
logic updateTodo(id: Integer, input: TodoInput): Todo {
  todo := Todo.get(id);
  todo.title = input.title;
  todo.done = input.done;
  todo.save();
  return todo;
}
@export
logic deleteTodo(id: Integer): Boolean {
  todo := Todo.get(id);
  todo.delete();
  return true;
}

interface TodoApi {
  GET    '/api/todos'       -> findTodos
  POST   '/api/todos'       -> createTodo
  PUT    '/api/todos/{id}'  -> updateTodo
  DELETE '/api/todos/{id}'  -> deleteTodo
}
`;

describe('codegen-java CRUD', () => {
  it('generates structure POJO', () => {
    const files = generateJava(parse(CRUD));
    const struct = files.find((f) => f.path.endsWith('structure/TodoInput.java'))!.content;
    expect(struct).toContain('public class TodoInput');
    expect(struct).toContain('private String title;');
    expect(struct).toContain('public String getTitle()');
  });

  it('generates service with params', () => {
    const files = generateJava(parse(CRUD));
    const svc = files.find((f) => f.path.endsWith('service/CreateTodoService.java'))!.content;
    expect(svc).toContain('public Todo createTodo(TodoInput input)');
    expect(svc).toContain('todo.setTitle(input.getTitle())');
    expect(svc).toContain('todoRepository.save(todo)');
  });

  it('maps entity methods to repository', () => {
    const files = generateJava(parse(CRUD));
    const upd = files.find((f) => f.path.endsWith('service/UpdateTodoService.java'))!.content;
    expect(upd).toContain('todoRepository.findById(id).orElseThrow()');
    const del = files.find((f) => f.path.endsWith('service/DeleteTodoService.java'))!.content;
    expect(del).toContain('todoRepository.delete(todo)');
  });

  it('generates controller with REST mappings', () => {
    const files = generateJava(parse(CRUD));
    const ctrl = files.find((f) => f.path.endsWith('controller/TodoApiController.java'))!.content;
    expect(ctrl).toContain('@RestController');
    expect(ctrl).toContain('@CrossOrigin');
    expect(ctrl).toContain('@GetMapping("/api/todos")');
    expect(ctrl).toContain('@PostMapping("/api/todos")');
    expect(ctrl).toContain('@PutMapping("/api/todos/{id}")');
    expect(ctrl).toContain('@DeleteMapping("/api/todos/{id}")');
    expect(ctrl).toContain('@PathVariable Long id');
    expect(ctrl).toContain('@RequestBody TodoInput input');
    expect(ctrl).toContain('findTodosService.findTodos()');
    expect(ctrl).toContain('createTodoService.createTodo(input)');
  });
});