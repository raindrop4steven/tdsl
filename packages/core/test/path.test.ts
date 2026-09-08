import { describe, expect, it } from 'vitest';
import { createNode } from '../src/id';
import { collectPaths, nodePathOf, resolve } from '../src/path';
import type {
  AppNode,
  DataSourceNode,
  EntityNode,
  EntityPropertyNode,
  LogicNode,
  StructureNode,
  StructurePropertyNode,
} from '../src/types';

function sampleApp(): AppNode {
  const entity: EntityNode = {
    ...createNode('Entity'),
    name: 'Todo',
    properties: [
      {
        ...createNode('EntityProperty'),
        name: 'id',
        type: { kind: 'primitive', builtin: 'Integer' },
        primary: true,
      },
      {
        ...createNode('EntityProperty'),
        name: 'title',
        type: { kind: 'primitive', builtin: 'String' },
      },
    ],
  };
  const ds: DataSourceNode = { ...createNode('DataSource'), name: 'defaultDS', entities: [entity] };
  const struct: StructureNode = {
    ...createNode('Structure'),
    name: 'TodoInput',
    properties: [
      { ...createNode('StructureProperty'), name: 'title', type: { kind: 'primitive', builtin: 'String' } },
    ],
  };
  const logic: LogicNode = {
    ...createNode('Logic'),
    name: 'findTodos',
    params: [],
    returns: [
      {
        ...createNode('Return'),
        type: {
          kind: 'generic',
          name: 'List',
          args: [{ kind: 'reference', path: 'app.datasources.defaultDS.entities.Todo' }],
        },
      },
    ],
    body: [],
  };
  return {
    ...createNode('App'),
    name: 'todo',
    datasources: [ds],
    structures: [struct],
    enums: [],
    logics: [logic],
    interfaces: [],
  };
}

describe('core/path', () => {
  it('collects entity nodePaths', () => {
    const app = sampleApp();
    const paths = collectPaths(app).map((e) => e.path);
    expect(paths).toContain('app');
    expect(paths).toContain('app.datasources.defaultDS');
    expect(paths).toContain('app.datasources.defaultDS.entities.Todo');
    expect(paths).toContain('app.datasources.defaultDS.entities.Todo.properties.id');
    expect(paths).toContain('app.structures.TodoInput');
    expect(paths).toContain('app.logics.findTodos');
    expect(paths).toContain('app.logics.findTodos.returns[0]');
  });

  it('resolve finds entity by nodePath', () => {
    const app = sampleApp();
    const ent = resolve<EntityNode>(app, 'app.datasources.defaultDS.entities.Todo');
    expect(ent?.name).toBe('Todo');
  });

  it('resolve returns null for dangling path', () => {
    const app = sampleApp();
    expect(resolve(app, 'app.datasources.defaultDS.entities.Nope')).toBeNull();
  });

  it('nodePathOf round-trips', () => {
    const app = sampleApp();
    const ent = resolve<EntityNode>(app, 'app.datasources.defaultDS.entities.Todo')!;
    expect(nodePathOf(app, ent)).toBe('app.datasources.defaultDS.entities.Todo');
  });

  it('nodePathOf returns null for foreign node', () => {
    const app = sampleApp();
    const foreign = { ...createNode('Entity'), name: 'X', properties: [] } as EntityNode;
    expect(nodePathOf(app, foreign)).toBeNull();
  });
});