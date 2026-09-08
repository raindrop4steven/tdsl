import type { AppNode, BaseNode } from './types';

export interface PathEntry {
  path: string;
  node: BaseNode;
}

/** 收集 app 树下所有节点的 nodePath（参考 NASL 命名空间风格） */
export function collectPaths(app: AppNode): PathEntry[] {
  const entries: PathEntry[] = [{ path: 'app', node: app }];
  for (const ds of app.datasources) {
    entries.push({ path: `app.datasources.${ds.name}`, node: ds });
    for (const ent of ds.entities) {
      entries.push({
        path: `app.datasources.${ds.name}.entities.${ent.name}`,
        node: ent,
      });
      for (const prop of ent.properties) {
        entries.push({
          path: `app.datasources.${ds.name}.entities.${ent.name}.properties.${prop.name}`,
          node: prop,
        });
      }
    }
  }
  for (const s of app.structures) {
    entries.push({ path: `app.structures.${s.name}`, node: s });
    for (const p of s.properties) {
      entries.push({ path: `app.structures.${s.name}.properties.${p.name}`, node: p });
    }
  }
  for (const en of app.enums) {
    entries.push({ path: `app.enums.${en.name}`, node: en });
    for (const item of en.items) {
      entries.push({ path: `app.enums.${en.name}.items.${item.name}`, node: item });
    }
  }
  for (const l of app.logics) {
    entries.push({ path: `app.logics.${l.name}`, node: l });
    for (const p of l.params) {
      entries.push({ path: `app.logics.${l.name}.params.${p.name}`, node: p });
    }
    l.returns.forEach((r, i) => {
      entries.push({ path: `app.logics.${l.name}.returns[${i}]`, node: r });
    });
  }
  for (const itf of app.interfaces) {
    entries.push({ path: `app.interfaces.${itf.name}`, node: itf });
    itf.endpoints.forEach((ep, i) => {
      entries.push({ path: `app.interfaces.${itf.name}.endpoints[${i}]`, node: ep });
    });
  }
  return entries;
}

/** 节点 → nodePath（找不到返回 null） */
export function nodePathOf(app: AppNode, target: BaseNode): string | null {
  return collectPaths(app).find((e) => e.node.id === target.id)?.path ?? null;
}

/** nodePath → 节点（悬空返回 null） */
export function resolve<T extends BaseNode>(app: AppNode, path: string): T | null {
  const hit = collectPaths(app).find((e) => e.path === path);
  return (hit?.node as T | undefined) ?? null;
}