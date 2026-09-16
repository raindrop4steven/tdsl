import type { AppNode, BaseNode, EffectiveCatalog, Expr, LogicNode, Statement, TypeRef } from '@tdsl/core';
import { resolve } from '@tdsl/core';
import type { Diagnostic } from './index';
import { assignable, exprType } from './expr-type';
import { type VarScope, scopeOfLogic, contribute, containerElemType, receiverReferenceOf } from './scope';

/**
 * 表达式核对（dev/36 F3 / dev/38 §5）：五核对点全走"声明可查才拦"的宽松兜底——
 * exprType 判不出（null）一律放行。不下钻 Call 的 callee（实体/FFI 调用面既有 pass 已覆盖，避免重复报）。
 */
export function checkExpressions(
  app: AppNode,
  cat: EffectiveCatalog,
  l: LogicNode,
  diagnostics: Diagnostic[],
  ownerPath: (n: BaseNode) => string,
): void {
  const scope: VarScope = scopeOfLogic(l.params);
  const typeOf = (e: Expr): TypeRef | null => exprType(app, e, cat, scope);

  /** 成员链基座是否可能为空（X.get 可空源） */
  const mayBeNull = (e: Expr): boolean => {
    if (e.kind === 'Ident') return scope.get(e.name)?.mayNull ?? false;
    if (e.kind === 'Member') return mayBeNull(e.obj);
    if (e.kind === 'Call' && e.callee.kind === 'Member' && e.callee.prop === 'get') return !!entityOfReceiver(app, e.callee.obj);
    return false;
  };

  /** CALL-ARITY：Ident → logic 短名（app.logics 内唯一同名才判，否则宽松放行） */
  const checkLogicCall = (e: Expr): void => {
    if (e.kind !== 'Call') return;
    const callee = e.callee;
    if (callee.kind !== 'Ident') return;
    const hits = app.logics.filter((x) => x.name === callee.name);
    if (hits.length !== 1) return;
    const lg = hits[0];
    const sig = `${lg.name}(${lg.params.map((p) => `${p.name}: ${typeText(p.type)}`).join(', ')})`;
    if (lg.params.length !== e.args.length) {
      diagnostics.push({
        path: ownerPath(l),
        message: `logic ${lg.name}() 需要 ${lg.params.length} 个参数，实际 ${e.args.length}`,
        severity: 'error',
        code: 'CALL-ARITY',
        suggestion: `对齐签名 ${sig}`,
      });
      return;
    }
    for (let i = 0; i < lg.params.length; i++) {
      if (assignable(lg.params[i].type, typeOf(e.args[i])) === false) {
        diagnostics.push({
          path: ownerPath(l),
          message: `logic ${lg.name}() 第 ${i + 1} 个参数应为 ${typeText(lg.params[i].type)}，实际 ${typeText(typeOf(e.args[i])) ?? '未知型'}`,
          severity: 'error',
          code: 'CALL-ARITY',
          suggestion: `对齐签名 ${sig}`,
        });
        return; // 一处调用只报一条，避免连坐
      }
    }
  };

  /** MEMBER-UNKNOWN + NULLABLE-HINT */
  const checkMember = (e: Expr): void => {
    if (e.kind !== 'Member') return;
    const objT = typeOf(e.obj);
    if (objT && objT.kind === 'reference' && objT.path !== 'Object') {
      const node = receiverReferenceOf(objT, app);
      if (node && !node.props.includes(e.prop)) {
        diagnostics.push({
          path: ownerPath(l),
          message: `${node.name} 无成员 ${e.prop}（可用: ${node.props.join('、')}）`,
          severity: 'error',
          code: 'MEMBER-UNKNOWN',
          suggestion: `改用存在的字段，或补声明字段`,
        });
      }
    }
    if (mayBeNull(e.obj)) {
      diagnostics.push({
        path: ownerPath(l),
        message: `成员访问的可能为空源: ${exprText(e.obj)}（X.get 可能为 null）`,
        severity: 'warning',
        code: 'NULLABLE-HINT',
        suggestion: `先非空判断再取成员`,
      });
    }
    walkExpr(e.obj);
  };

  const walkExpr = (e: Expr): void => {
    switch (e.kind) {
      case 'Member':
        checkMember(e);
        break;
      case 'Call':
        checkLogicCall(e);
        e.args.forEach(walkExpr);
        break;
      case 'New':
        e.args.forEach(walkExpr);
        break;
      case 'NewList':
        e.items.forEach(walkExpr);
        break;
      case 'Binary':
        walkExpr(e.left);
        walkExpr(e.right);
        break;
      case 'Group':
        walkExpr(e.expr);
        break;
      case 'Ident':
      case 'Bool':
      case 'Numeric':
      case 'String':
      case 'Null':
        break;
    }
  };

  const checkStmt = (st: Statement): void => {
    // 先贡献作用域（decl/forof），后核对——声明先于使用可见
    contribute(st, typeOf, scope);
    switch (st.kind) {
      case 'VarDecl':
        if (st.init) {
          walkExpr(st.init);
          // dev/36 F3a：声明初始化类型核对（const x: T = value）
          if (assignable(st.type ?? null, typeOf(st.init)) === false) {
            diagnostics.push({
              path: ownerPath(l),
              message: `声明类型不匹配: ${st.name} 声明 ${typeText(st.type) ?? '?'}，初值 ${typeText(typeOf(st.init)) ?? '未知型'}`,
              severity: 'error',
              code: 'ASSIGN-TYPE',
              suggestion: `改声明为 ${typeText(typeOf(st.init)) ?? '实际类型'} 或修正初值`,
            });
          }
        }
        break;
      case 'Assign': {
        walkExpr(st.target);
        walkExpr(st.value);
        if (assignable(typeOf(st.target), typeOf(st.value)) === false) {
          const t = typeOf(st.target);
          const v = typeOf(st.value);
          diagnostics.push({
            path: ownerPath(l),
            message: `赋值类型不匹配: ${typeText(t) ?? t?.kind ?? '表达式'} ← ${typeText(v) ?? '未知型'}`,
            severity: 'error',
            code: 'ASSIGN-TYPE',
            suggestion: `目标为 ${typeText(t) ?? '未知型'}，检查右侧值类型`,
          });
        }
        break;
      }
      case 'Return': {
        if (!st.value) break;
        walkExpr(st.value);
        const declared = l.returns[0]?.type ?? null;
        const got = typeOf(st.value);
        if (assignable(declared, got) === false) {
          diagnostics.push({
            path: ownerPath(l),
            message: `返回类型不匹配: 声明 ${typeText(declared) ?? '?'}，实际 ${typeText(got) ?? '未知型'}`,
            severity: 'error',
            code: 'RETURN-TYPE',
            suggestion: `返回改为 ${typeText(declared) ?? '声明类型'} 的值，或调整函数声明`,
          });
        }
        break;
      }
      case 'If':
        walkExpr(st.cond);
        break;
      case 'ForEach':
        walkExpr(st.container);
        break;
      case 'CallStmt':
        walkExpr(st.call);
        break;
      case 'Throw':
        walkExpr(st.message);
        break;
    }
  };

  walk(l.body, checkStmt);
}

/* ---------- 局部工具 ---------- */

function walk(stmts: Statement[], fn: (st: Statement) => void): void {
  for (const st of stmts) {
    fn(st);
    if (st.kind === 'If') {
      walk(st.then, fn);
      if (st.else) walk(st.else, fn);
    } else if (st.kind === 'ForEach') {
      walk(st.body, fn);
    }
  }
}

function entityOfReceiver(app: AppNode, recv: Expr): boolean {
  let name: string | null = null;
  if (recv.kind === 'Ident') name = recv.name;
  if (recv.kind === 'Member' && recv.obj.kind === 'Ident') name = `${recv.obj.name}.${recv.prop}`;
  if (!name) return false;
  if (name.includes('.')) {
    const dot = name.indexOf('.');
    const ds = app.datasources.find((d) => d.name === name!.slice(0, dot));
    return !!ds?.entities.some((x) => x.name === name!.slice(dot + 1));
  }
  return app.datasources.flatMap((d) => d.entities).filter((x) => x.name === name).length === 1;
}

/** 类型文本（诊断可读用） */
function typeText(t: TypeRef | null | undefined): string | null {
  if (!t) return null;
  if (t.kind === 'primitive') return t.builtin;
  if (t.kind === 'reference') return `${t.path}`.split('.').pop() ?? t.path;
  if (t.kind === 'generic') return `${t.name}<${t.args.map((a) => typeText(a)).join(',')}>`;
  return null;
}

function exprText(e: Expr): string {
  if (e.kind === 'Ident') return e.name;
  if (e.kind === 'Member') return `${exprText(e.obj)}.${e.prop}`;
  if (e.kind === 'Call' && e.callee.kind === 'Member') {
    return `${e.callee.prop}(...)`;
  }
  if (e.kind === 'Call' && e.callee.kind === 'Ident') return `${e.callee.name}(...)`;
  return e.kind;
}
