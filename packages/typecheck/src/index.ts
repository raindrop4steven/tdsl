import {
  nodePathOf,
  resolve,
  type AppNode,
  type BaseNode,
  type Expr,
  type Statement,
  type TypeRef,
} from '@tdsl/core';

export interface Diagnostic {
  path: string;
  line?: number;
  col?: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface CheckResult {
  ok: boolean;
  diagnostics: Diagnostic[];
}

/** 遍历 app 内所有 TypeRef（含泛型参数），owner 为持有该类型的节点 */
function forEachTypeRef(app: AppNode, fn: (tr: TypeRef, owner: BaseNode) => void): void {
  const visit = (tr: TypeRef, owner: BaseNode): void => {
    fn(tr, owner);
    if (tr.kind === 'generic') {
      tr.args.forEach((a) => visit(a, owner));
    }
  };
  for (const ds of app.datasources) {
    for (const ent of ds.entities) {
      ent.properties.forEach((p) => visit(p.type, p));
    }
  }
  for (const s of app.structures) {
    s.properties.forEach((p) => visit(p.type, p));
  }
  for (const l of app.logics) {
    l.params.forEach((p) => visit(p.type, p));
    l.returns.forEach((r) => visit(r.type, r));
    forEachStatement(l.body, (st) => {
      if (st.kind === 'VarDecl' && st.type) visit(st.type, l);
      if (st.kind === 'VarDecl' && st.init) visitExprTypes(st.init, l);
      if (st.kind === 'Assign') {
        visitExprTypes(st.target, l);
        visitExprTypes(st.value, l);
      }
      if (st.kind === 'Return' && st.value) visitExprTypes(st.value, l);
      if (st.kind === 'If') visitExprTypes(st.cond, l);
      if (st.kind === 'ForEach') visitExprTypes(st.container, l);
      if (st.kind === 'CallStmt') visitExprTypes(st.call, l);
    });
  }

  function visitExprTypes(e: Expr, owner: BaseNode): void {
    switch (e.kind) {
      case 'New':
        visit(e.type, owner);
        e.args.forEach((a) => visitExprTypes(a, owner));
        break;
      case 'NewList':
        visit(e.elem, owner);
        e.items.forEach((a) => visitExprTypes(a, owner));
        break;
      case 'Call':
        visitExprTypes(e.callee, owner);
        e.args.forEach((a) => visitExprTypes(a, owner));
        break;
      case 'Member':
        visitExprTypes(e.obj, owner);
        break;
      case 'Binary':
        visitExprTypes(e.left, owner);
        visitExprTypes(e.right, owner);
        break;
      case 'Group':
        visitExprTypes(e.expr, owner);
        break;
      case 'Ident':
      case 'Bool':
      case 'Numeric':
      case 'String':
      case 'Null':
        break;
    }
  }
}

function forEachStatement(stmts: Statement[], fn: (st: Statement) => void): void {
  for (const st of stmts) {
    fn(st);
    switch (st.kind) {
      case 'If':
        forEachStatement(st.then, fn);
        if (st.else) forEachStatement(st.else, fn);
        break;
      case 'ForEach':
        forEachStatement(st.body, fn);
        break;
      default:
        break;
    }
  }
}

/** 最小类型检查：引用绑定（悬空引用诊断）+ ForEach 容器必须为 X.all（X 为实体） */
export function check(app: AppNode): CheckResult {
  const diagnostics: Diagnostic[] = [];
  const ownerPath = (owner: BaseNode): string => nodePathOf(app, owner) ?? 'app';

  // 1. 悬空引用：所有 reference 必须能 resolve
  forEachTypeRef(app, (tr, owner) => {
    if (tr.kind === 'reference' && !resolve(app, tr.path)) {
      diagnostics.push({
        path: ownerPath(owner),
        message: `悬空引用: ${tr.path}`,
        severity: 'error',
      });
    }
  });

  // 2. ForEach 容器必须为 X.all（X 为已声明实体）
  for (const l of app.logics) {
    forEachStatement(l.body, (st) => {
      if (st.kind === 'ForEach') {
        const c = st.container;
        const isEntityAll =
          c.kind === 'Member' &&
          c.obj.kind === 'Ident' &&
          c.prop === 'all' &&
          resolveEntity(app, c.obj.name) !== null;
        if (!isEntityAll) {
          diagnostics.push({
            path: ownerPath(l),
            message: `ForEach 容器必须是已声明实体的 .all 静态引用`,
            severity: 'error',
          });
        }
      }
    });
  }

  return { ok: diagnostics.length === 0, diagnostics };
}

function resolveEntity(app: AppNode, name: string): BaseNode | null {
  for (const ds of app.datasources) {
    for (const ent of ds.entities) {
      if (ent.name === name) return ent;
    }
  }
  return null;
}