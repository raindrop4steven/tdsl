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