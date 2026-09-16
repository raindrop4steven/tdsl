import type {
  AppNode,
  BuiltinType,
  EffectiveCatalog,
  EntityNode,
  Expr,
  FfiParamType,
  LogicNode,
  StructureNode,
  TypeRef,
} from '@tdsl/core';
import { resolve } from '@tdsl/core';

/**
 * 表达式类型判定（dev/36 F3 / dev/38 §4）。
 * 判不出返回 null —— 调用方一律放行（宽松策略兜底，index.ts 既定）。
 */

const PRIM = (b: BuiltinType): TypeRef => ({ kind: 'primitive', builtin: b });

const FFI_RET_TO_BUILTIN: Partial<Record<FfiParamType, BuiltinType>> = {
  String: 'String',
  Integer: 'Integer',
  Decimal: 'Decimal',
  Boolean: 'Boolean',
  Date: 'Date',
  Time: 'Time',
  DateTime: 'DateTime',
};

/** 实体查询结果类型：X.all / X.where(...) 及链式 .orderBy/.limit/.page；判不出 → null */
function queryResultType(app: AppNode, e: Expr): TypeRef | null {
  // X.all
  if (e.kind === 'Member' && e.prop === 'all') {
    const ent = entityOfReceiver(app, e.obj);
    return ent ? listOf({ kind: 'reference', path: ent.nodePath }) : null;
  }
  if (e.kind !== 'Call') return null;
  const c = e.callee;
  if (c.kind !== 'Member') return null;
  // X.all() / X.where(...)
  if (c.prop === 'all') {
    const ent = entityOfReceiver(app, c.obj);
    return ent ? listOf({ kind: 'reference', path: ent.nodePath }) : null;
  }
  if (c.prop === 'where') {
    const ent = entityOfReceiver(app, c.obj);
    return ent ? listOf({ kind: 'reference', path: ent.nodePath }) : null;
  }
  // 链式：orderBy/limit 保留内层型；page → Page；groupBy/aggregate 判不出
  if (c.prop === 'orderBy' || c.prop === 'limit') return queryResultType(app, c.obj);
  if (c.prop === 'page') {
    const inner = queryResultType(app, c.obj);
    if (inner && inner.kind === 'generic' && inner.name === 'List' && inner.args.length === 1) {
      return { kind: 'generic', name: 'Page', args: inner.args };
    }
    return null;
  }
  return null;
}

/** 接收者（Order / erp.Order）→ 实体 + 规范 nodePath */
function entityOfReceiver(app: AppNode, recv: Expr): { nodePath: string; name: string } | null {
  function look(name: string): { nodePath: string; name: string } | null {
    if (name.includes('.')) {
      const dot = name.indexOf('.');
      const ds = app.datasources.find((d) => d.name === name.slice(0, dot));
      const ent = ds?.entities.find((x) => x.name === name.slice(dot + 1));
      return ds && ent ? { nodePath: `app.datasources.${ds.name}.entities.${ent.name}`, name: ent.name } : null;
    }
    const hits = app.datasources.filter((d) => d.entities.some((x) => x.name === name));
    if (hits.length !== 1) return null;
    return { nodePath: `app.datasources.${hits[0].name}.entities.${name}`, name };
  }
  if (recv.kind === 'Ident') return look(recv.name);
  if (recv.kind === 'Member' && recv.obj.kind === 'Ident') return look(`${recv.obj.name}.${recv.prop}`);
  return null;
}

function listOf(t: TypeRef): TypeRef {
  return { kind: 'generic', name: 'List', args: [t] };
}

/** logic 调用：短名（app.logics 内唯一同名）→ 返回类型 */
function logicReturnType(app: AppNode, name: string): { type: TypeRef | null; logic: LogicNode | null } {
  const hits = app.logics.filter((l) => l.name === name);
  if (hits.length !== 1) return { type: null, logic: null };
  return { type: hits[0].returns[0]?.type ?? null, logic: hits[0] };
}

/** FFI 目录成员返回 → TypeRef（无法映射 → null） */
function ffiReturnType(cat: EffectiveCatalog, clsAlias: string, prop: string): TypeRef | null {
  const cls = cat.byAlias(clsAlias);
  if (!cls) return null;
  const m = cat.member(cls, prop);
  if (!m) return null;
  const b = FFI_RET_TO_BUILTIN[m.ret as FfiParamType];
  if (b) return PRIM(b);
  if (m.ret === 'List') return { kind: 'generic', name: 'List', args: [] };
  return null;
}

export function exprType(app: AppNode, e: Expr, cat: EffectiveCatalog, scope: Map<string, { type: TypeRef | null }>): TypeRef | null {
  switch (e.kind) {
    case 'Ident': {
      const v = scope.get(e.name);
      return v ? v.type : null;
    }
    case 'Numeric':
      return PRIM(Number.isInteger(e.value) ? 'Integer' : 'Decimal');
    case 'String':
      return PRIM('String');
    case 'Bool':
      return PRIM('Boolean');
    case 'Null':
      return null;
    case 'Group':
      return exprType(app, e.expr, cat, scope);
    case 'New':
      return e.type;
    case 'NewList':
      return listOf(e.elem);
    case 'Member': {
      // 形态 A：接收者类型可解析 → 结构/实体字段类型
      const objT = exprType(app, e.obj, cat, scope);
      if (objT) {
        if (objT.kind === 'reference') {
          const node = resolve<StructureNode | EntityNode>(app, objT.path);
          const prop = node?.properties?.find((p) => p.name === e.prop);
          if (prop) return prop.type;
          // 结构/实体已解析但无此字段 → 返回“非 null 的哨兵”交给 MEMBER-UNKNOWN 判定？
          return null; // 无字段：判不出型；存在性由 checkExpressions 报
        }
        return null;
      }
      return null;
    }
    case 'Call': {
      const c = e.callee;
      // 查询链先判（实体静态来源）
      const q = queryResultType(app, e);
      if (q) return q;
      if (c.kind === 'Ident') {
        const { type } = logicReturnType(app, c.name);
        return type;
      }
      if (c.kind === 'Member') {
        // FFI 静态/变量成员：变量表类型 or 目录静态别名
        if (c.obj.kind === 'Ident') {
          const v = scope.get(c.obj.name);
          if (v) {
            const vt = v.type;
            if (vt && vt.kind === 'primitive') return ffiRet(cat, vt.builtin, c.prop);
            return null;
          }
          if (cat.byAlias(c.obj.name)) return ffiRet(cat, c.obj.name, c.prop);
          return null;
        }
        const objT = exprType(app, c.obj, cat, scope);
        if (objT && objT.kind === 'primitive') return ffiRet(cat, objT.builtin, c.prop);
      }
      return null;
    }
    case 'Binary': {
      if (['&&', '||', '=', '>=', '<=', '>', '<', 'like', 'in', '===', '!==', '==', '!='].includes(e.operator)) {
        return PRIM('Boolean');
      }
      if (['+', '-', '*', '/'].includes(e.operator)) {
        const l = exprType(app, e.left, cat, scope);
        const r = exprType(app, e.right, cat, scope);
        if (l?.kind === 'primitive' && (l.builtin === 'String' || r?.kind === 'primitive' && r.builtin === 'String')) return PRIM('String');
        if (l?.kind === 'primitive' && r?.kind === 'primitive') {
          if (!['Integer', 'Decimal'].includes(l.builtin) || !['Integer', 'Decimal'].includes(r.builtin)) return null;
          if (l.builtin === 'Decimal' || r.builtin === 'Decimal') return PRIM('Decimal');
          return PRIM('Integer');
        }
        return null;
      }
      return null;
    }
  }
}

function ffiRet(cat: EffectiveCatalog, alias: string, prop: string): TypeRef | null {
  const cls = cat.byAlias(alias);
  const m = cls ? cat.member(cls, prop) : undefined;
  if (!m) return null;
  if (m.ret === 'Object') return null;
  const b = FFI_RET_TO_BUILTIN[m.ret as FfiParamType];
  if (b) return PRIM(b);
  if (m.ret === 'List') return { kind: 'generic', name: 'List', args: [] };
  return null;
}

/**
 * 赋值兼容性（dev/38 §4）：null 参与 → null（放行）；Object 通配放行；
 * reference 名义等价；Integer → Decimal 单向隐转；泛型同名同参递归。
 */
export function assignable(target: TypeRef | null, value: TypeRef | null): boolean | null {
  if (!target || !value) return null;
  if (target.kind === 'db' || value.kind === 'db') return null;
  // Object 通配符：任一侧是 Object 内建引用 → 放行
  const isObjectRef = (t: TypeRef): boolean => t.kind === 'reference' && t.path === 'Object';
  if (isObjectRef(target) || isObjectRef(value)) return true;
  if (target.kind === 'primitive' && value.kind === 'primitive') {
    if (target.builtin === value.builtin) return true;
    if (target.builtin === 'Decimal' && value.builtin === 'Integer') return true;
    return false;
  }
  if (target.kind === 'reference' && value.kind === 'reference') {
    return target.path === value.path;
  }
  if (target.kind === 'generic' && value.kind === 'generic') {
    if (target.name !== value.name || target.args.length !== value.args.length) return false;
    for (let i = 0; i < target.args.length; i++) {
      const a = assignable(target.args[i], value.args[i]);
      if (a === false) return false;
      if (a === null) return null;
    }
    return true;
  }
  return false;
}
