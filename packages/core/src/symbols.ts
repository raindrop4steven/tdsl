import type { AppNode } from './types';

/**
 * 类型命名空间（M1）：
 * - 实体短名归数据源作用域（跨数据源同名合法，限定名 `dsName.EntityName` 显式引用）。
 * - 结构/枚举/逻辑/接口归 app 全局（短名唯一）。
 * - 全局唯一的实体短名同时进 global（供无 ds 上下文的短名引用）。
 */
export interface TypeSymbolTable {
  /** 全局：短名 → nodePath（structure/enum/logic/interface + 全局唯一的 entity） */
  global: Map<string, string>;
  /** 数据源作用域：dsName → (短名 → nodePath)（entity） */
  dataSources: Map<string, Map<string, string>>;
}

/**
 * 变量作用域（logic 方法体，对齐 Java 语义）：
 * - 块（if/for）push 新 VarScope，块结束 pop。
 * - 同名变量沿链向上查找：找到则复用（无遮蔽，Java 语义）；未找到则声明新变量。
 */
export interface VarScope {
  parent: VarScope | null;
  vars: Map<string, string>;
}

/** 构建类型符号表：实体进数据源作用域（+全局唯一实体进 global），其余进 global */
export function buildTypeSymbolTable(app: AppNode): TypeSymbolTable {
  const global = new Map<string, string>();
  const dataSources = new Map<string, Map<string, string>>();

  // 先收集每个实体短名在哪些数据源出现
  const nameToDsCount = new Map<string, number>();
  for (const ds of app.datasources) {
    for (const ent of ds.entities) {
      nameToDsCount.set(ent.name, (nameToDsCount.get(ent.name) ?? 0) + 1);
    }
  }

  for (const ds of app.datasources) {
    const scope = new Map<string, string>();
    for (const ent of ds.entities) {
      const path = `app.datasources.${ds.name}.entities.${ent.name}`;
      scope.set(ent.name, path);
      // 短名全局唯一（只出现在一个数据源）→ 进 global 供短名引用
      if ((nameToDsCount.get(ent.name) ?? 0) === 1) {
        if (!global.has(ent.name)) global.set(ent.name, path);
      }
    }
    dataSources.set(ds.name, scope);
  }

  for (const s of app.structures) if (!global.has(s.name)) global.set(s.name, `app.structures.${s.name}`);
  for (const en of app.enums) if (!global.has(en.name)) global.set(en.name, `app.enums.${en.name}`);
  for (const l of app.logics) if (!global.has(l.name)) global.set(l.name, `app.logics.${l.name}`);
  for (const itf of app.interfaces) if (!global.has(itf.name)) global.set(itf.name, `app.interfaces.${itf.name}`);

  return { global, dataSources };
}

/** 短名 → nodePath（优先当前数据源作用域，其次全局）。未命中返回 null。 */
export function resolveShort(
  table: TypeSymbolTable,
  name: string,
  ctxDs?: string,
): string | null {
  if (ctxDs) {
    const hit = table.dataSources.get(ctxDs)?.get(name);
    if (hit) return hit;
  }
  return table.global.get(name) ?? null;
}

/** 限定名 dsName.EntityName → nodePath。未命中返回 null。 */
export function resolveQualified(table: TypeSymbolTable, dsName: string, entName: string): string | null {
  return table.dataSources.get(dsName)?.get(entName) ?? null;
}

/** 判断短名是否跨数据源歧义（多个数据源都有同名实体） */
export function isAmbiguousEntity(table: TypeSymbolTable, name: string): boolean {
  let count = 0;
  for (const scope of table.dataSources.values()) {
    if (scope.has(name)) count++;
  }
  return count > 1;
}

/** 创建变量作用域（顶层：parent = null） */
export function createVarScope(parent: VarScope | null = null): VarScope {
  return { parent, vars: new Map() };
}

/** 变量查找：沿作用域链向上，返回 { scope, javaType }。未找到返回 null。 */
export function lookupVar(scope: VarScope, name: string): { scope: VarScope; javaType: string } | null {
  let cur: VarScope | null = scope;
  while (cur) {
    const t = cur.vars.get(name);
    if (t !== undefined) return { scope: cur, javaType: t };
    cur = cur.parent;
  }
  return null;
}