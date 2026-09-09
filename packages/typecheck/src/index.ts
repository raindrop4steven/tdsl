import {
  nodePathOf,
  resolve,
  type AppNode,
  type BaseNode,
  type BindingNode,
  type EntityNode,
  type Expr,
  type ServiceNode,
  type Statement,
  type TypeRef,
  type ViewElementNode,
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
  for (const s of app.services) {
    for (const op of s.operations) {
      op.params.forEach((p) => visit(p.type, p));
      op.returns.forEach((r) => visit(r.type, r));
    }
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

  // 2. ForEach 容器必须是可迭代的 List：实体查询（X.all / X.where(...)）、
//    已声明变量/参数（含成员访问如 input.items）、或明显非 List 字面量才报错
  for (const l of app.logics) {
    // 作用域内可见的变量名：参数 + 语句中 := 声明
    const knownVars = new Set(l.params.map((p) => p.name));
    forEachStatement(l.body, (st) => {
      if (st.kind === 'ForEach') {
        const c = st.container;
        const baseName = baseIdentOf(c);
        const isEntityQuery = entityQueryOf(app, c) !== null;
        const isKnownVar = baseName !== null && knownVars.has(baseName);
        const isPlausibleList =
          isEntityQuery ||
          isKnownVar ||
          c.kind === 'Call' ||
          c.kind === 'Ident';
        if (!isPlausibleList) {
          diagnostics.push({
            path: ownerPath(l),
            message: `ForEach 容器必须是 List（实体查询 / 已知变量 / 成员）`,
            severity: 'error',
          });
        }
      }
      // 收集 := 声明的变量（ForEach 之后可见）
      if (st.kind === 'VarDecl') knownVars.add(st.name);
    });
  }

  // 3. Interface：每个 Endpoint 的 logicRef 必须可 resolve
  for (const itf of app.interfaces) {
    itf.endpoints.forEach((ep) => {
      if (!ep.logicRef || !resolve(app, ep.logicRef)) {
        diagnostics.push({
          path: ownerPath(itf),
          message: `接口端点悬空引用 logic: ${ep.logicRef}`,
          severity: 'error',
        });
      }
    });
  }

  // 4. 实体方法：识别 Todo.get / entity.save / entity.delete 的接收者类型
  for (const l of app.logics) {
    forEachStatement(l.body, (st) => {
      checkEntityCalls(app, st, l, diagnostics, ownerPath);
    });
  }

  // 4.5. 外部服务：kind 合法；http 操作必须带 method + path；调用方校验在 checkEntityCalls 内
  for (const s of app.services) {
    if (!s.kind_ || (s.kind_ !== 'dubbo' && s.kind_ !== 'bean' && s.kind_ !== 'http')) {
      diagnostics.push({
        path: ownerPath(s),
        message: `外部服务 ${s.name} 的 kind 必须为 dubbo|bean|http`,
        severity: 'error',
      });
    }
    if (s.kind_ === 'http') {
      for (const op of s.operations) {
        if (!op.method || !op.path) {
          diagnostics.push({
            path: ownerPath(op),
            message: `http 服务 ${s.name} 的操作 ${op.name} 必须声明 METHOD 'path'`,
            severity: 'error',
          });
        }
      }
    }
  }
  // 4.6. 第三方组件：pkg 非空
  for (const c of app.components) {
    if (!c.pkg) {
      diagnostics.push({
        path: ownerPath(c),
        message: `组件 ${c.name} 必须声明 pkg`,
        severity: 'error',
      });
    }
  }

  // 5. View：组件类型 + binding 解析
  for (const v of app.views) {
    checkView(app, v.elements, diagnostics, ownerPath);
  }

  return { ok: diagnostics.length === 0, diagnostics };
}

/** 已知 ViewElement 组件类型 */
const KNOWN_VIEW_TYPES = new Set([
  'table', 'column', 'button', 'form', 'input', 'repeat', 'text', 'detail',
]);

/** View 校验：组件类型已知 + useQuery/useMutation 逻辑存在 + navigate 页面存在 */
function checkView(
  app: AppNode,
  elements: ViewElementNode[],
  diagnostics: Diagnostic[],
  ownerPath: (n: BaseNode) => string,
): void {
  for (const el of elements) {
    const isBuiltin = KNOWN_VIEW_TYPES.has(el.type);
    const isComponent = app.components.some((c) => c.name === el.type);
    if (!isBuiltin && !isComponent) {
      diagnostics.push({
        path: ownerPath(el),
        message: `未知页面组件类型 '${el.type}'`,
        severity: 'error',
      });
    }
    for (const b of el.bindings) {
      checkBinding(app, b, diagnostics, ownerPath);
    }
    if (el.children.length > 0) checkView(app, el.children, diagnostics, ownerPath);
  }
}

/** binding 校验：useQuery/useMutation → logic 存在；navigate → 页面存在 */
function checkBinding(
  app: AppNode,
  b: BindingNode,
  diagnostics: Diagnostic[],
  ownerPath: (n: BaseNode) => string,
): void {
  if (b.name === 'useQuery' || b.name === 'useMutation') {
    if (!resolve(app, b.target)) {
      diagnostics.push({
        path: ownerPath(b),
        message: `页面绑定 ${b.name} 悬空逻辑引用: ${b.target}`,
        severity: 'error',
      });
    }
  } else if (b.name === 'navigate') {
    if (!app.views.some((v) => v.name === b.target)) {
      diagnostics.push({
        path: ownerPath(b),
        message: `页面绑定 navigate 悬空页面: ${b.target}`,
        severity: 'error',
      });
    }
  }
}

/** 实体方法调用校验：Todo.get(id)、entity.save()、entity.delete() */
function checkEntityCalls(
  app: AppNode,
  st: Statement,
  owner: BaseNode,
  diagnostics: Diagnostic[],
  ownerPath: (n: BaseNode) => string,
): void {
  const checkExpr = (e: Expr): void => {
    switch (e.kind) {
      case 'Call': {
        const callee = e.callee;
        // 外部服务调用：userService.getUser(id) → 接收者小驼峰命中已声明 service
        if (callee.kind === 'Member') {
          const svc = serviceByVarName(app, callee.obj);
          if (svc) {
            const op = svc.operations.find((o) => o.name === callee.prop);
            if (!op) {
              diagnostics.push({
                path: ownerPath(owner),
                message: `外部服务 ${svc.name} 无方法 ${callee.prop}`,
                severity: 'error',
              });
            } else if (op.params.length !== e.args.length) {
              diagnostics.push({
                path: ownerPath(owner),
                message: `外部服务 ${svc.name}.${callee.prop}() 需要 ${op.params.length} 个参数，实际 ${e.args.length}`,
                severity: 'error',
              });
            }
          }
        }
        // 静态实体方法：Todo.get / Todo.all / Todo.where / erp.Order.all
        if (callee.kind === 'Member') {
          const recvName = receiverOf(callee.obj);
          const method = callee.prop;
          const entity = recvName ? resolveEntity(app, recvName) : null;
          if (entity) {
            if (method === 'get' && e.args.length !== 1) {
              diagnostics.push({
                path: ownerPath(owner),
                message: `实体 ${recvName}.get() 需要 1 个参数（主键）`,
                severity: 'error',
              });
            } else if (method === 'where') {
              // Entity.where(field = value)：校验字段存在 + 值是字段可赋类型
              const cond = e.args[0];
              if (cond?.kind !== 'Binary' || cond.operator !== '=') {
                diagnostics.push({
                  path: ownerPath(owner),
                  message: `${recvName}.where() 参数必须是 field = value 形式`,
                  severity: 'error',
                });
              } else if (cond.left.kind === 'Ident') {
                const fieldName = cond.left.name;
                const field = entity.properties.find((p) => p.name === fieldName);
                if (!field) {
                  diagnostics.push({
                    path: ownerPath(owner),
                    message: `实体 ${recvName} 无字段 ${fieldName}`,
                    severity: 'error',
                  });
                }
              }
            } else if (method !== 'get' && method !== 'all' && method !== 'where') {
              diagnostics.push({
                path: ownerPath(owner),
                message: `实体 ${recvName} 无方法 ${method}`,
                severity: 'error',
              });
            }
          }
        }
        // 实例方法：entity.save() / entity.delete()；list.add(x)（接收者非实体名时）
        if (callee.kind === 'Member') {
          const method = callee.prop;
          if (method === 'save' || method === 'delete') {
            if (e.args.length !== 0) {
              diagnostics.push({
                path: ownerPath(owner),
                message: `${method}() 不接受参数`,
                severity: 'error',
              });
            }
          } else if (method === 'add') {
            // list.add(x)：接收者应是 List
            if (!isListExpr(app, callee.obj)) {
              diagnostics.push({
                path: ownerPath(owner),
                message: `.add() 接收者必须是 List`,
                severity: 'error',
              });
            }
          }
        }
        checkExpr(callee);
        e.args.forEach(checkExpr);
        break;
      }
      case 'Member':
        // list.count：接收者应是 List
        if (e.prop === 'count' && !isListExpr(app, e.obj)) {
          diagnostics.push({
            path: ownerPath(owner),
            message: `.count 接收者必须是 List`,
            severity: 'error',
          });
        }
        checkExpr(e.obj);
        break;
      case 'New':
        e.args.forEach(checkExpr);
        break;
      case 'NewList':
        e.items.forEach(checkExpr);
        break;
      case 'Binary':
        checkExpr(e.left);
        checkExpr(e.right);
        break;
      case 'Group':
        checkExpr(e.expr);
        break;
      case 'Ident':
      case 'Bool':
      case 'Numeric':
      case 'String':
      case 'Null':
        break;
    }
  };

  // 遍历语句内所有表达式
  switch (st.kind) {
    case 'VarDecl':
      if (st.init) checkExpr(st.init);
      break;
    case 'Assign':
      checkExpr(st.target);
      checkExpr(st.value);
      break;
    case 'Return':
      if (st.value) checkExpr(st.value);
      break;
    case 'If':
      checkExpr(st.cond);
      break;
    case 'ForEach':
      checkExpr(st.container);
      break;
    case 'CallStmt':
      checkExpr(st.call);
      break;
  }
}

function resolveEntity(app: AppNode, name: string): EntityNode | null {
  // 限定名 dsName.EntityName（erp.Order）
  if (name.includes('.')) {
    const dot = name.indexOf('.');
    const dsName = name.slice(0, dot);
    const entName = name.slice(dot + 1);
    const ds = app.datasources.find((d) => d.name === dsName);
    return ds?.entities.find((e) => e.name === entName) ?? null;
  }
  // 短名：全局唯一才可解析（跨源同名需限定名）
  const hits = app.datasources.flatMap((ds) => ds.entities).filter((e) => e.name === name);
  return hits.length === 1 ? hits[0] : null;
}

/** 表达式接收者（Ident 或数据源限定名 Member）→ service 短名小驼峰变量名匹配（UserService → userService） */
function serviceByVarName(app: AppNode, e: Expr): ServiceNode | null {
  if (e.kind !== 'Ident') return null;
  const varName = e.name;
  return app.services.find((s) => {
    const lower = s.name.charAt(0).toLowerCase() + s.name.slice(1);
    return lower === varName;
  }) ?? null;
}

/** 从表达式取实体查询的接收者名：Order.all → 'Order'；erp.Order.all → 'erp.Order'；非实体查询返回 null */
function entityQueryOf(app: AppNode, e: Expr): string | null {
  // erp.Order.all → Member(Member(Ident('erp'),'Order'),'all')
  if (e.kind === 'Member' && e.prop === 'all') {
    const recv = receiverOf(e.obj);
    if (recv && resolveEntity(app, recv)) return recv;
    return null;
  }
  // Order.where(...) / erp.Order.where(...) → Call(Member(recv,'where'),[...])
  if (e.kind === 'Call' && e.callee.kind === 'Member' && e.callee.prop === 'where') {
    const recv = receiverOf(e.callee.obj);
    if (recv && resolveEntity(app, recv)) return recv;
    return null;
  }
  return null;
}

/** 实体查询接收者名：Ident → 短名；Member(Ident,prop) 且 Ident 是数据源 → 限定名；否则 null */
function receiverOf(e: Expr): string | null {
  if (e.kind === 'Ident') return e.name;
  if (
    e.kind === 'Member' &&
    e.obj.kind === 'Ident' &&
    isDataSourceName(e.obj.name)
  ) {
    return `${e.obj.name}.${e.prop}`;
  }
  return null;
}

/** 是否数据源名 */
function isDataSourceName(name: string): boolean {
  return true; // 无法静态判定，交给 resolveEntity 限定名解析兜底
}

/** 取表达式最底层的标识符名（x / x.y / x.y.z → 'x'），非标识符基座返回 null */
function baseIdentOf(e: Expr): string | null {
  if (e.kind === 'Ident') return e.name;
  if (e.kind === 'Member') return baseIdentOf(e.obj);
  return null;
}

/** 判断表达式是否为 List：实体查询 / 变量 / 成员访问。宽松放行（完整推导在 P1-typecheck 切面），仅对明确非 List 报错 */
function isListExpr(app: AppNode, e: Expr): boolean {
  if (entityQueryOf(app, e)) return true;
  // 变量 / 成员（如 input.items、list）无法在此精确推导 → 放行，避免误报
  if (e.kind === 'Ident' || e.kind === 'Member') return true;
  return false; // 字面量等明确非 List
}