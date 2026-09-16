import type { EntityNode, Expr, Statement, StructureNode, TypeRef } from '@tdsl/core';
import { resolve } from '@tdsl/core';

/** 变量类型信息（dev/38 §3）：type=null 表示静态判定不出 → 调用方一律放行 */
export interface VarInfo {
  type: TypeRef | null;
  /** 可能为 null 的源（X.get 等查询点）——供 NULLABLE-HINT 提示 */
  mayNull: boolean;
  source: 'param' | 'decl' | 'forof' | 'unknown';
}

/** 函数内变量作用域：顺序收集、覆盖式更新（重声明后值生效；宽松策略不查 shadow） */
export type VarScope = Map<string, VarInfo>;

/** 逻辑调用点建作用域：参数入表（声明类型都是显式的） */
export function scopeOfLogic(params: Array<{ name: string; type: TypeRef }>): VarScope {
  const scope: VarScope = new Map();
  for (const p of params) {
    scope.set(p.name, { type: p.type, mayNull: false, source: 'param' });
  }
  return scope;
}

/** 单条语句对作用域的贡献（与检查同遍历，先 contribute 后 check；内部 If/For 嵌套由遍历器保证顺序） */
export function contribute(st: Statement, exprTypeOf: (e: Expr) => TypeRef | null, scope: VarScope): void {
  if (st.kind === 'VarDecl') {
    const t = st.type ?? (st.init ? exprTypeOf(st.init) : null);
    scope.set(st.name, { type: t, mayNull: initMayNull(st, exprTypeOf), source: t ? 'decl' : 'unknown' });
    return;
  }
  if (st.kind === 'ForEach') {
    const c = containerElemType(st.container, exprTypeOf);
    scope.set(st.item, { type: c, mayNull: false, source: c ? 'forof' : 'unknown' });
  }
}

/** X.get(id) 是可空源（dev/38 §5 NULLABLE-HINT）；其余赋值恒非空 */
function initMayNull(st: Statement, _exprTypeOf: (e: Expr) => TypeRef | null): boolean {
  if (st.kind !== 'VarDecl' || !st.init) return false;
  const e = st.init;
  if (e.kind === 'Call' && e.callee.kind === 'Member' && e.callee.prop === 'get') return true;
  return false;
}

/** 展开 List<T>/Page<T> 的 T；判不出返回 null（调用方标 unknown → 放行） */
export function containerElemType(container: Expr, exprTypeOf: (e: Expr) => TypeRef | null): TypeRef | null {
  const t = exprTypeOf(container);
  if (!t) return null;
  if (t.kind === 'generic' && (t.name === 'List' || t.name === 'Page') && t.args.length === 1) return t.args[0];
  return null;
}

/** receiver 类型解析为实体/结构（供 Member 字段存在性核对）；非可解析引用返回 null → 放行 */
export function receiverReferenceOf(refType: TypeRef, app: import('@tdsl/core').AppNode): { name: string; props: string[] } | null {
  if (refType.kind !== 'reference') return null;
  const node = resolve(app, refType.path);
  if (node?.kind === 'Entity' || node?.kind === 'Structure') {
    const n = node as EntityNode | StructureNode;
    return { name: n.name, props: n.properties.map((p) => p.name) };
  }
  return null;
}
