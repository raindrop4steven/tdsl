import {
  depCoordinate,
  depMatches,
  nodePathOf,
  resolve,
  type AppNode,
  type BaseNode,
  type BindingNode,
  type EffectiveCatalog,
  type EntityNode,
  type EntityPropertyNode,
  type StructurePropertyNode,
  type Expr,
  type LoadedCatalog,
  type ServiceNode,
  type Statement,
  type TypeRef,
  type ViewElementNode,
} from '@tdsl/core';
import { createCatalog, ffiByAlias, type FfiParamType, type LogicNode } from '@tdsl/core';
import { checkExpressions } from './check-expressions';

export interface Diagnostic {
  path: string;
  line?: number;
  col?: number;
  /** 所在文件（多文件工程 M7：由诊断 path 反查顶层声明节点得；单文件为 '<stdin>'，可忽略） */
  file?: string;
  message: string;
  severity: 'error' | 'warning';
  /** 结构化错误码（dev/36 F1）：出牌层表见 DIAG_LAYERS，新核对面必须携带 */
  code: string;
  /** 结构化修复指引（dev/36 F1）：不藏在 message 文案里 */
  suggestion?: string;
  /** 级联归属键（dev/36 F2）：`${根因code}#${根因path}`；根因诊断自身不填 */
  root?: string;
}

/** 诊断分层（dev/37 §2.2）：SYNTAX 仅 parse 阶段直收；排序与 llm 出牌共用此表 */
export const DIAG_LAYERS = { TYPE: 1, API: 2, DEP: 3 } as const;
export type DiagLayer = keyof typeof DIAG_LAYERS;

/** code → 层（未登记的旧 code 兜底进 DEP 层；声明序内层保序） */
export function diagLayerOf(code: string): number {
  switch (code) {
    case 'DANGLE-REF':
    case 'ASSIGN-TYPE':
    case 'CALL-ARITY':
    case 'MEMBER-UNKNOWN':
    case 'RETURN-TYPE':
      return DIAG_LAYERS.TYPE;
    case 'FOREACH-CONTAINER':
    case 'INTERFACE-LOGICREF':
    case 'ENTITY-METHOD':
    case 'ENTITY-WHERE':
    case 'ENTITY-CHAIN':
    case 'SERVICE-MEMBER':
    case 'LIST-SHAPE':
    case 'VIEW-COMPONENT':
    case 'VIEW-BINDING':
    case 'FORM-SEMANTICS':
    case 'FFI-MEMBER':
    case 'FFI-STATIC':
      return DIAG_LAYERS.API;
    case 'SERVICE-KIND':
    case 'SERVICE-HTTP-OPER':
    case 'DEP-1':
    case 'DEP-2':
    case 'DEP-3':
    case 'DEP-4':
      return DIAG_LAYERS.DEP;
    default:
      return DIAG_LAYERS.DEP;
  }
}

export interface CheckResult {
  ok: boolean;
  diagnostics: Diagnostic[];
}

export interface CheckOptions {
  /** 工程侧 FFI 扫描产物（libs/*.json，dev/32）：与 dependency 声明坐标匹配合并进有效目录 */
  libs?: LoadedCatalog[];
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
export function check(app: AppNode, opts: CheckOptions = {}): CheckResult {
  const diagnostics: Diagnostic[] = [];
  const ownerPath = (owner: BaseNode): string => nodePathOf(app, owner) ?? 'app';
  const cat = createCatalog(opts.libs ?? [], app.dependencies);
  const usedCoords = new Set<string>();

  // 1. 悬空引用：所有 reference 必须能 resolve（Object 内建兜底放行）
  forEachTypeRef(app, (tr, owner) => {
    if (tr.kind === 'reference' && tr.path !== 'Object' && !resolve(app, tr.path)) {
      diagnostics.push({
        path: ownerPath(owner),
        message: `悬空引用: ${tr.path}`,
        severity: 'error',
        code: 'DANGLE-REF',
        suggestion: `补声明类型 ${tr.path.split('.').pop()}（entity/struct/enum），或引用已声明类型`,
      });
    }
  });

  // 1.5 @ref 外键显式声明（M10）：目标为实体 + display 为 String + 目标可出 options。
  //     实体与结构体字段同规则——外键必须显式声明，禁止 xxxId 命名推断（生成器零猜测）。
  const checkRefProp = (holderPath: string, p: EntityPropertyNode | StructurePropertyNode): void => {
    if (!p.ref) return;
    const ownerId = holderPath;
    const target = resolve(app, p.ref.entityPath);
    const targetEnt = target?.kind === 'Entity' ? (target as EntityNode) : undefined;
    if (!targetEnt) {
      diagnostics.push({
        path: `${ownerId}.${p.name}`,
        message: `@ref 目标 '${p.ref.entityPath}' 不是实体`,
        severity: 'error',
        code: 'FK-REF-ENTITY',
        suggestion: '应引用 entity 声明（datasource 内 entity <Name>）',
      });
      return;
    }
    const disp = targetEnt.properties.find((pp) => pp.name === p.ref!.display);
    if (!disp || disp.type.kind !== 'primitive' || disp.type.builtin !== 'String') {
      diagnostics.push({
        path: `${ownerId}.${p.name}`,
        message: `@ref 实体 '${targetEnt.name}' 的显示字段 '${p.ref.display}' 不存在或不是 String`,
        severity: 'error',
        code: 'FK-REF-DISPLAY',
        suggestion: `display 改为其字符串字段之一：${targetEnt.properties.filter((pp) => pp.type.kind === 'primitive' && pp.type.builtin === 'String').map((pp) => pp.name).join(', ') || '（该实体没有字符串字段，无法作为下拉显示）'}`,
      });
      return;
    }
    // options 数据源：该实体需有 query 逻辑（query* 返回 List<该实体>，参数全可缺省）
    const unwrap = (t: TypeRef): TypeRef => (t.kind === 'generic' && (t.name === 'List' || t.name === 'Page') ? t.args[0] : t);
    const hasQuery = app.logics.some(
      (lg) =>
        lg.name.startsWith('query') &&
        lg.returns.some((r) => {
          const el = unwrap(r.type);
          return el.kind === 'reference' && el.path === p.ref!.entityPath;
        }),
    );
    if (!hasQuery) {
      diagnostics.push({
        path: `${ownerId}.${p.name}`,
        message: `@ref 实体 '${targetEnt.name}' 缺少查询逻辑，前端下拉缺数据源`,
        severity: 'warning',
        code: 'FK-REF-NO-QUERY',
        suggestion: `补一个 function query${targetEnt.name}(...): List<${targetEnt.name}>`,
      });
    }
  };
  for (const ds of app.datasources) {
    for (const ent of ds.entities) {
      for (const p of ent.properties) checkRefProp(ownerPath(ent), p);
    }
  }
  for (const st of app.structures) {
    for (const p of st.properties) checkRefProp(ownerPath(st), p);
  }

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
            code: 'FOREACH-CONTAINER',
            suggestion: '容器改为实体查询（X.all / X.where）或已声明的列表变量',
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
          code: 'INTERFACE-LOGICREF',
          suggestion: `声明 function ${ep.logicRef?.split('.').pop() ?? ''} 或改正端点指向的 logic 名`,
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

  // 4.6. FFI 目录（dev/27）：receiver 类型已知的成员调用查目录；未知类型放行
  for (const l of app.logics) {
    checkFfi(cat, app, l, diagnostics, ownerPath, usedCoords);
  }

  // 4.8 表达式核对（dev/36 F3）：赋值/互调 arity/成员/return 核对 + nullable 提示；判不出一律放行
  for (const l of app.logics) {
    checkExpressions(app, cat, l, diagnostics, ownerPath);
  }

  // 4.7 依赖声明与目录一致性（dev/32）：D-dep-1/2/3/4
  checkDependencies(app, cat, opts.libs ?? [], usedCoords, diagnostics, ownerPath);

  // 4.5. 外部服务：kind 合法；http 操作必须带 method + path；调用方校验在 checkEntityCalls 内
  for (const s of app.services) {
    if (!s.kind_ || (s.kind_ !== 'dubbo' && s.kind_ !== 'http')) {
      diagnostics.push({
        path: ownerPath(s),
        message: `外部服务 ${s.name} 的 kind 必须为 dubbo|bean|http`,
        severity: 'error',
        code: 'SERVICE-KIND',
        suggestion: `@service(kind = 'dubbo') 或 @service(kind = 'http')（本地 jar 类用 dependency java 直调）`,
      });
    }
    if (s.kind_ === 'http') {
      for (const op of s.operations) {
        if (!op.method || !op.path) {
          diagnostics.push({
            path: ownerPath(op),
            message: `http 服务 ${s.name} 的操作 ${op.name} 必须声明 METHOD 'path'`,
            severity: 'error',
            code: 'SERVICE-HTTP-OPER',
            suggestion: `操作体写 GET '/api/xxx' -> ${op.name}`,
          });
        }
      }
    }
  }

  // 5. View：组件类型 + binding 解析 + 端点暴露检查
  const exposedLogics = new Set(
    app.interfaces
      .flatMap((itf) => itf.endpoints.map((ep) => ep.logicRef?.split('.').pop() ?? ''))
      .filter(Boolean),
  );
  for (const v of app.views) {
    checkView(app, v.elements, diagnostics, ownerPath, exposedLogics);
  }

  // 6. 文件定位（M7 多文件工程）：按诊断 path 反查所属顶层声明节点的来源文件
  const files = fileMapOf(app);
  for (const d of diagnostics) {
    const f = fileOfPath(files, d.path);
    if (f) d.file = f;
  }

  // 7. 定序（dev/36 F2）：全量齐报不截断；error → warning，层内按依赖（根因层前）
  //    稳定排序保证同层内保持声明序，输出确定性
  diagnostics.sort((a, b) => {
    const sev = (d: Diagnostic) => (d.severity === 'error' ? 0 : 1);
    return sev(a) - sev(b) || diagLayerOf(a.code) - diagLayerOf(b.code);
  });

  // ok 语义（dev/36 F2 / ch06 口径）：只要存在任一 error 就失败；warning（D-dep-2/3、NULLABLE-HINT）只是提醒不阻断
  return {
    ok: !diagnostics.some((d) => d.severity === 'error'),
    diagnostics,
  };
}

/** nodePath → 所在文件（顶层声明节点的 file 标） */
function fileMapOf(app: AppNode): Map<string, string> {
  const map = new Map<string, string>();
  const put = (p: string, node: BaseNode): void => {
    if (node.file) map.set(p, node.file);
  };
  app.datasources.forEach((ds) => {
    put(`app.datasources.${ds.name}`, ds);
    ds.entities.forEach((e) => put(`app.datasources.${ds.name}.entities.${e.name}`, e));
  });
  app.structures.forEach((s) => put(`app.structures.${s.name}`, s));
  app.enums.forEach((e) => put(`app.enums.${e.name}`, e));
  app.logics.forEach((l) => put(`app.logics.${l.name}`, l));
  app.interfaces.forEach((i) => put(`app.interfaces.${i.name}`, i));
  app.views.forEach((v) => put(`app.views.${v.name}`, v));
  app.services.forEach((s) => put(`app.services.${s.name}`, s));
  return map;
}

/** path 向上回溯找最近带 file 的顶层声明（如 ...Order.properties.total → Order.file） */
function fileOfPath(map: Map<string, string>, path: string): string | undefined {
  let p = path;
  for (;;) {
    const hit = map.get(p);
    if (hit) return hit;
    const i = p.lastIndexOf('.');
    if (i < 0) return undefined;
    p = p.slice(0, i);
  }
}

/** 已知 ViewElement 组件类型（管理系统常用集） */
const KNOWN_VIEW_TYPES = new Set([
  'table', 'column', 'button', 'form', 'input', 'repeat', 'text', 'detail', 'summary',
  // dev/48 门户看板
  'row', 'col', 'carousel', 'list', 'item', 'progress', 'alert',
  // 管理端常用：标签/统计/标签页/布尔与选项控件/头像/徽标/分格
  'tag', 'statistic', 'tabs', 'pane', 'checkbox', 'radio', 'switch', 'avatar', 'badge', 'card',
]);

/** View 校验：组件类型已知 + useQuery/useMutation 逻辑存在 + navigate 页面存在 */
function checkView(
  app: AppNode,
  elements: ViewElementNode[],
  diagnostics: Diagnostic[],
  ownerPath: (n: BaseNode) => string,
  exposedLogics: Set<string>,
): void {
  for (const el of elements) {
    const isBuiltin = KNOWN_VIEW_TYPES.has(el.type);
    // 三方组件（dev/33）：非内置标签 → dependency npm 声明匹配（camelCase 组件名 ↔ 包名尾段）
    if (!isBuiltin && !npmDepCoversComponent(app, el.type)) {
      diagnostics.push({
        path: ownerPath(el),
        message: `三方组件 '${el.type}' 未匹配到 dependency npm 声明——请补 dependency npm "<包名>"（import 包名由声明解析）`,
        severity: 'error',
        code: 'VIEW-COMPONENT',
        suggestion: `dependency npm "<包名>" import { ${el.type} }`,
      });
    }
    for (const b of el.bindings) {
      checkBinding(app, b, diagnostics, ownerPath, exposedLogics);
    }
    // G2（dev/29）：form 表达式域语义（derive / carryBy / 校验属性）
    if (el.type === 'form' || el.type === 'repeat') {
      checkFormSemantics(app, el, diagnostics, ownerPath, exposedLogics);
    }
    // dev/45：明细合计结构校验（field 须匹配同表单 repeat；of/expr 至少一个）
    if (el.type === 'summary') {
      checkSummary(el, elements, diagnostics, ownerPath);
    }
    if (el.children.length > 0) checkView(app, el.children, diagnostics, ownerPath, exposedLogics);
  }
}

/** summary 结构校验（dev/45 §2）：field 指向同表单 repeat；of 与 expr 至少一个 */
function checkSummary(
  el: ViewElementNode,
  siblings: ViewElementNode[],
  diagnostics: Diagnostic[],
  ownerPath: (n: BaseNode) => string,
): void {
  const field = String(el.props['field'] ?? '');
  const hasRepeat = siblings.some((s) => s.type === 'repeat' && String(s.props['field'] ?? 'items') === field);
  if (!hasRepeat) {
    diagnostics.push({
      path: ownerPath(el),
      message: `summary 的 field '${field}' 未匹配到同一表单内的 repeat`,
      severity: 'error',
      code: 'SUMMARY-TARGET',
      suggestion: `确认 <repeat field="${field}"> 与 <summary field="${field}"> 在同一 form 下`,
    });
  }
  if (el.props['of'] === undefined && el.props['expr'] === undefined) {
    diagnostics.push({
      path: ownerPath(el),
      message: 'summary 需提供 of（单字段求和）或 expr（表达式求和）之一',
      severity: 'error',
      code: 'SUMMARY-EXPR',
      suggestion: 'of="count" 或 expr={count * productPrice}',
    });
  }
}

/** 组件名是否被某个 dependency npm 声明覆盖（dev/33）：
 *  ① as <ns> 显式命名 = 组件名（首选，无歧义）
 *  ② 兜底：包名尾段去分隔符小写 == 组件名小写（ECharts ↔ echartsforreact 不成立时不误报——宽松放行策略下交由 codegen import 实测） */
/** 组件名是否被某个 dependency npm 声明覆盖（dev/34）：
 *  ① import { A } 具名列表命中（alias 优先）② import X 默认导出命中
 *  ③ 兜底：无显式导入的声明，包名尾段去分隔符小写比对（宽松放行） */
function npmDepCoversComponent(app: AppNode, typeName: string): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return app.dependencies.some((d) => {
    if (d.eco !== 'npm') return false;
    if (d.imports?.some((i) => (i.alias ?? i.name) === typeName)) return true;
    if (d.importDefault === typeName) return true;
    if (d.imports || d.importDefault) return false; // 已显式声明导入 → 不再兜底
    const tail = d.name.split('/').pop() ?? d.name;
    return norm(tail) === norm(typeName);
  });
}

/** binding 校验：useQuery/useMutation → logic 存在；navigate → 页面存在 */
function checkBinding(
  app: AppNode,
  b: BindingNode,
  diagnostics: Diagnostic[],
  ownerPath: (n: BaseNode) => string,
  exposedLogics: Set<string>,
): void {
  if (b.name === 'useQuery' || b.name === 'useMutation') {
    if (!resolve(app, b.target)) {
      diagnostics.push({
        path: ownerPath(b),
        message: `页面绑定 ${b.name} 悬空逻辑引用: ${b.target}`,
        severity: 'error',
        code: 'VIEW-BINDING',
        suggestion: `声明 function ${b.target.split('.').pop()} 或改正 ${b.name}('...') 指向`,
      });
    } else if (!exposedLogics.has(b.target.split('.').pop() ?? b.target)) {
      // 逻辑存在但没有 interface 端点暴露 → api.ts 不会生成该函数 → 前端运行时 TypeError（真白屏）
      diagnostics.push({
        path: ownerPath(b),
        message: `页面绑定 ${b.name}('${b.target}') 但没有 interface 端点暴露该逻辑，api.ts 不会生成对应函数；请在 interface 中声明（如 GET '/api/...' -> ${b.target}）`,
        severity: 'error',
        code: 'VIEW-BINDING',
        suggestion: `interface XxxApi { GET '/api/...' -> ${b.target} }`,
      });
    }
  } else if (b.name === 'openDialog') {
    const target = app.views.find((v) => v.name === b.target);
    if (!target) {
      diagnostics.push({
        path: ownerPath(b),
        message: `页面绑定 openDialog 悬空页面: ${b.target}`,
        severity: 'error',
        code: 'VIEW-BINDING',
        suggestion: `先声明 dialog ${b.target}`,
      });
    } else if (target.viewKind !== 'dialog') {
      diagnostics.push({
        path: ownerPath(b),
        message: `openDialog 目标 '${b.target}' 是 page 而非 dialog；page 用 navigate 跳转，dialog 才用 openDialog`,
        severity: 'error',
        code: 'VIEW-BINDING',
        suggestion: `改写 navigate('${b.target}')`,
      });
    }
  } else if (b.name === 'navigate') {
    const target = app.views.find((v) => v.name === b.target);
    if (!target) {
      diagnostics.push({
        path: ownerPath(b),
        message: `页面绑定 navigate 悬空页面: ${b.target}`,
        severity: 'error',
        code: 'VIEW-BINDING',
        suggestion: `先声明 page ${b.target}`,
      });
    } else if (target.viewKind === 'dialog') {
      diagnostics.push({
        path: ownerPath(b),
        message: `'${b.target}' 是 dialog 页面（右侧抽屉），不进路由；请改用 openDialog('${b.target}')`,
        severity: 'error',
        code: 'VIEW-BINDING',
        suggestion: `改写 openDialog('${b.target}')`,
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
                code: 'SERVICE-MEMBER',
                suggestion: `在 service ${svc.name} 内声明 oper ${callee.prop}`,
              });
            } else if (op.params.length !== e.args.length) {
              diagnostics.push({
                path: ownerPath(owner),
                message: `外部服务 ${svc.name}.${callee.prop}() 需要 ${op.params.length} 个参数，实际 ${e.args.length}`,
                severity: 'error',
                code: 'SERVICE-MEMBER',
                suggestion: `实参数量对齐声明的 ${op.params.length} 个`,
              });
            }
          }
        }
        // 静态实体方法：Todo.get / Todo.all / Todo.where / erp.Order.all / Order.aggregate
        if (callee.kind === 'Member') {
          const recvName = receiverOf(callee.obj);
          const method = callee.prop;
          const entity = recvName ? resolveEntity(app, recvName) : null;
          if (entity && recvName) {
            if (method === 'get' && e.args.length !== 1) {
              diagnostics.push({
                path: ownerPath(owner),
                message: `实体 ${recvName}.get() 需要 1 个参数（主键）`,
                severity: 'error',
                code: 'ENTITY-METHOD',
                suggestion: `${recvName}.get(id)`,
              });
            } else if (method === 'where') {
              // Entity.where(cond, ...)：逗号 = AND；cond 叶子 = field op value，支持 && / || 组合
              if (e.args.length === 0) {
                diagnostics.push({
                  path: ownerPath(owner),
                  message: `${recvName}.where() 至少需要一个条件`,
                  severity: 'error',
                  code: 'ENTITY-METHOD',
                  suggestion: `${recvName}.where(field op value, ...)`,
                });
              }
              for (const cond of e.args) {
                checkWhereCond(entity, recvName, cond, owner, diagnostics, ownerPath);
              }
            } else if (method === 'aggregate') {
              // Entity.aggregate(sum(total)) / aggregate(count())
              if (e.args.length === 0) {
                diagnostics.push({
                  path: ownerPath(owner),
                  message: `${recvName}.aggregate() 至少需要一个聚合函数（sum/avg/max/min/count）`,
                  severity: 'error',
                  code: 'ENTITY-METHOD',
                  suggestion: `${recvName}.aggregate(sum(field))`,
                });
              }
              for (const a of e.args) {
                checkAggregateArg(entity, recvName, a, owner, diagnostics, ownerPath);
              }
            } else if (method !== 'get' && method !== 'all' && method !== 'where' && method !== 'aggregate') {
              diagnostics.push({
                path: ownerPath(owner),
              message: `实体 ${recvName} 无方法 ${method}`,
              severity: 'error',
              code: 'ENTITY-METHOD',
              suggestion: `可用方法: get / all / where / aggregate；或改走查询链 .orderBy/.page/.limit/.groupBy`,
              });
            }
          } else if (callee.obj.kind === 'Call') {
            // 实体查询链：Order.where(...).orderBy(...).page(...) / .limit(n) / .groupBy(...)
            const chainEntity = entityQueryChainOf(app, callee.obj);
            if (chainEntity) {
              const prevMethod = callee.obj.callee.kind === 'Member' ? callee.obj.callee.prop : null;
              checkChainMethod(chainEntity, receiverOfChain(app, callee.obj), method, e.args, owner, diagnostics, ownerPath, prevMethod);
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
                code: 'LIST-SHAPE',
                suggestion: `${method}() 无参`,
              });
            }
          } else if (method === 'add') {
            // list.add(x)：接收者应是 List
            if (!isListExpr(app, callee.obj)) {
              diagnostics.push({
                path: ownerPath(owner),
                message: `.add() 接收者必须是 List`,
                severity: 'error',
                code: 'LIST-SHAPE',
                suggestion: `接收者改为实体查询或已声明的列表变量`,
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
            code: 'LIST-SHAPE',
            suggestion: `接收者改为 List 表达式（实体查询/列表变量）`,
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

/** where 条件运算符白名单（叶子形态） */
const WHERE_BINARY_OPS = new Set(['=', '>=', '<=', '>', '<', 'like', 'in']);

/** 链式查询方法白名单 */
const CHAIN_METHODS = new Set(['orderBy', 'page', 'limit', 'groupBy', 'aggregate']);

/** 聚合函数白名单 */
const AGG_FNS = new Set(['sum', 'avg', 'max', 'min', 'count']);

/**
 * where 复合条件校验（递归）：
 * - 叶子：field op value，op ∈ =/>=/<=/>/</like/in
 * - 组合：&& / ||（左右递归）
 * - 校验：左侧是字段 Ident 且实体存在该字段
 */
function checkWhereCond(
  entity: EntityNode,
  recvName: string,
  cond: Expr,
  owner: BaseNode,
  diagnostics: Diagnostic[],
  ownerPath: (n: BaseNode) => string,
): void {
  if (cond.kind !== 'Binary') {
    diagnostics.push({
      path: ownerPath(owner),
      message: `${recvName}.where() 条件必须是 field op value 形式（op: = >= <= > < like in）`,
      severity: 'error',
      code: 'ENTITY-WHERE',
      suggestion: `叶子条件写 field op value`,
    });
    return;
  }
  // && / || 组合 → 左右递归
  if (cond.operator === '&&' || cond.operator === '||') {
    checkWhereCond(entity, recvName, cond.left, owner, diagnostics, ownerPath);
    checkWhereCond(entity, recvName, cond.right, owner, diagnostics, ownerPath);
    return;
  }
  if (!WHERE_BINARY_OPS.has(cond.operator)) {
    diagnostics.push({
      path: ownerPath(owner),
      message: `${recvName}.where() 不支持运算符 '${cond.operator}'（允许: = >= <= > < like in）`,
      severity: 'error',
      code: 'ENTITY-WHERE',
      suggestion: `改用允许的运算符`,
    });
    return;
  }
  if (cond.left.kind !== 'Ident') {
    diagnostics.push({
      path: ownerPath(owner),
      message: `${recvName}.where() 条件左侧必须是字段名`,
      severity: 'error',
      code: 'ENTITY-WHERE',
    });
    return;
  }
  const fieldName = cond.left.name;
  if (!entity.properties.some((p) => p.name === fieldName)) {
    diagnostics.push({
      path: ownerPath(owner),
      message: `实体 ${recvName} 无字段 ${fieldName}`,
      severity: 'error',
      code: 'ENTITY-WHERE',
      suggestion: `补实体字段或换已声明字段`,
    });
  }
}

/** 聚合参数校验：Entity.aggregate(sum(total)) / count()；fn ∈ sum/avg/max/min/count */
function checkAggregateArg(
  entity: EntityNode,
  recvName: string,
  a: Expr,
  owner: BaseNode,
  diagnostics: Diagnostic[],
  ownerPath: (n: BaseNode) => string,
): void {
  if (a.kind !== 'Call' || a.callee.kind !== 'Ident') {
    diagnostics.push({
      path: ownerPath(owner),
      message: `${recvName}.aggregate() 参数必须是 sum(f)/avg(f)/max(f)/min(f)/count(f)/count()`,
      severity: 'error',
      code: 'ENTITY-METHOD',
    });
    return;
  }
  const fn = a.callee.name;
  if (!AGG_FNS.has(fn)) {
    diagnostics.push({
      path: ownerPath(owner),
      message: `${recvName}.aggregate() 不支持聚合函数 '${fn}'（允许: sum/avg/max/min/count）`,
      severity: 'error',
      code: 'ENTITY-METHOD',
    });
    return;
  }
  // count() 可无参；带参必须字段存在
  if (a.args.length === 0) {
    if (fn !== 'count') {
      diagnostics.push({
        path: ownerPath(owner),
        message: `${recvName}.aggregate(${fn}()) 需要 1 个字段参数`,
        severity: 'error',
        code: 'ENTITY-METHOD',
      });
    }
    return;
  }
  if (a.args.length > 1) {
    diagnostics.push({
      path: ownerPath(owner),
      message: `${recvName}.aggregate(${fn}()) 最多 1 个字段参数`,
      severity: 'error',
      code: 'ENTITY-METHOD',
    });
    return;
  }
  const arg = a.args[0];
  if (arg.kind !== 'Ident') {
    diagnostics.push({
      path: ownerPath(owner),
      message: `${recvName}.aggregate(${fn}()) 参数必须是字段名`,
      severity: 'error',
      code: 'ENTITY-METHOD',
    });
    return;
  }
  if (!entity.properties.some((p) => p.name === arg.name)) {
    diagnostics.push({
      path: ownerPath(owner),
      message: `实体 ${recvName} 无字段 ${arg.name}`,
      severity: 'error',
      code: 'ENTITY-METHOD',
    });
  }
}

/**
 * 实体查询链接收者提取：Order.where(...) / Order.aggregate(...) / erp.Order.where(...) → 实体；
 * Order.where(...).orderBy(...) → 沿链向上找起点
 */
function entityQueryChainOf(app: AppNode, e: Expr): EntityNode | null {
  if (e.kind === 'Call') {
    const head = e.callee;
    if (head.kind === 'Member' && (head.prop === 'where' || head.prop === 'aggregate')) {
      const recv = receiverOf(head.obj);
      return recv ? resolveEntity(app, recv) : null;
    }
    if (head.kind === 'Member' && CHAIN_METHODS.has(head.prop)) {
      return entityQueryChainOf(app, head.obj);
    }
  }
  return null;
}

/** 链式方法接收者字符串（校验信息用）：Order / erp.Order */
function receiverOfChain(app: AppNode, e: Expr): string | null {
  if (e.kind === 'Call') {
    const head = e.callee;
    if (head.kind === 'Member' && (head.prop === 'where' || head.prop === 'aggregate')) {
      return receiverOf(head.obj);
    }
    if (head.kind === 'Member' && CHAIN_METHODS.has(head.prop)) {
      return receiverOfChain(app, head.obj);
    }
  }
  return null;
}

/** 链式方法参数校验：orderBy(field asc|desc, ...) / page(n, size) / limit(n) / groupBy(field, ...) */
function checkChainMethod(
  entity: EntityNode,
  recvName: string | null,
  method: string,
  args: Expr[],
  owner: BaseNode,
  diagnostics: Diagnostic[],
  ownerPath: (n: BaseNode) => string,
  prevMethod: string | null = null,
): void {
  const name = recvName ?? '实体';
  const fieldOf = (e: Expr): string | null => (e.kind === 'Ident' ? e.name : null);
  const hasField = (e: Expr): boolean => {
    const f = fieldOf(e);
    return f !== null && entity.properties.some((p) => p.name === f);
  };
  if (method === 'orderBy') {
    // [field, 'asc'|'desc', ...]（方向可省）
    if (args.length === 0) {
      diagnostics.push({
        path: ownerPath(owner),
        message: `${name}.orderBy() 至少需要一个字段`,
        severity: 'error',
        code: 'ENTITY-CHAIN',
        suggestion: `orderBy(field asc|desc, ...)`,
      });
    }
    for (let i = 0; i < args.length; i += 2) {
      if (!hasField(args[i])) {
        diagnostics.push({
          path: ownerPath(owner),
          message: `${name}.orderBy() 字段 '${fieldOf(args[i]) ?? args[i].kind}' 不存在`,
          severity: 'error',
          code: 'ENTITY-CHAIN',
        });
      }
      const dir = args[i + 1];
      if (dir && (dir.kind !== 'String' || (dir.value !== 'asc' && dir.value !== 'desc'))) {
        diagnostics.push({
          path: ownerPath(owner),
          message: `${name}.orderBy() 方向必须是 asc 或 desc`,
          severity: 'error',
          code: 'ENTITY-CHAIN',
        });
      }
    }
  } else if (method === 'page') {
    if (args.length !== 2) {
      diagnostics.push({
        path: ownerPath(owner),
        message: `${name}.page() 需要 2 个参数（页码, 每页条数）`,
        severity: 'error',
        code: 'ENTITY-CHAIN',
      });
    }
  } else if (method === 'limit') {
    if (args.length !== 1) {
      diagnostics.push({
        path: ownerPath(owner),
        message: `${name}.limit() 需要 1 个参数（条数）`,
        severity: 'error',
        code: 'ENTITY-CHAIN',
      });
    }
  } else if (method === 'groupBy') {
    if (args.length === 0) {
      diagnostics.push({
        path: ownerPath(owner),
        message: `${name}.groupBy() 至少需要一个字段`,
        severity: 'error',
        code: 'ENTITY-CHAIN',
        suggestion: `groupBy(field, ...)`,
      });
    }
    for (const a of args) {
      if (!hasField(a)) {
        diagnostics.push({
          path: ownerPath(owner),
          message: `${name}.groupBy() 字段 '${fieldOf(a) ?? a.kind}' 不存在`,
          severity: 'error',
          code: 'ENTITY-CHAIN',
        });
      }
    }
  } else if (method === 'aggregate') {
    // dev/48 F2b：条件聚合 Order.where(...).aggregate(count()) —— 仅允许紧跟 where(...)
    if (prevMethod !== 'where') {
      diagnostics.push({
        path: ownerPath(owner),
        message: `${name}.aggregate() 仅可用于 where(...) 之后（条件聚合）`,
        severity: 'error',
        code: 'ENTITY-CHAIN',
        suggestion: `${name}.where(...).aggregate(count()) 或 ${name}.aggregate(count())`,
      });
    }
    if (args.length === 0) {
      diagnostics.push({
        path: ownerPath(owner),
        message: `${name}.aggregate() 至少需要一个聚合函数（sum/avg/max/min/count）`,
        severity: 'error',
        code: 'ENTITY-CHAIN',
        suggestion: `${name}.where(...).aggregate(sum(field))`,
      });
    }
    for (const a of args) {
      checkAggregateArg(entity, name, a, owner, diagnostics, ownerPath);
    }
  } else {
    diagnostics.push({
      path: ownerPath(owner),
      message: `实体 ${name} 查询链无方法 ${method}`,
      severity: 'error',
      code: 'ENTITY-CHAIN',
      suggestion: `链式方法仅: orderBy / page / limit / groupBy / aggregate`,
    });
  }
}
// ---------- FFI 成员解析（dev/27）：receiver 类型已知的调用查目录；未知类型放行 ----------

/** TypeRef → FFI 别名（成员类型集合内才有映射；枚举/实体/Map 等 → undefined） */
function typeRefToFfiAlias(tr: TypeRef): FfiParamType | undefined {
  if (tr.kind === 'primitive') return tr.builtin;
  if (tr.kind === 'generic' && tr.name === 'List') return 'List';
  return undefined;
}

function exprToFfiAlias(
  cat: EffectiveCatalog,
  app: AppNode,
  e: Expr | undefined,
  vars: Map<string, FfiParamType>,
): FfiParamType | undefined {
  if (!e) return undefined;
  if (e.kind === 'Bool') return 'Boolean';
  if (e.kind === 'Numeric') return Number.isInteger(e.value) ? ('Integer' as FfiParamType) : ('Decimal' as FfiParamType);
  if (e.kind === 'String') return 'String';
  if (e.kind === 'Null') return undefined;
  if (e.kind === 'NewList') return 'List';
  if (e.kind === 'New') return typeRefToFfiAlias(e.type);
  if (e.kind === 'Call' && e.callee.kind === 'Member') {
    // 链式：recv.trim().toUpperCase() —— recv 类型已知（含递归成员链）则结果类型可传播
    const t = exprFfiAliasOfReceivers(cat, app, e.callee.obj, vars);
    if (t) {
      const c = cat.byAlias(t);
      const m = c ? cat.member(c, e.callee.prop) : undefined;
      if (m && m.ret !== 'Object') return m.ret;
      return undefined;
    }
  }
  return undefined;
}

/** 递归展开接收者链，返回可信别名（不追实体/未知段） */
function exprFfiAliasOfReceivers(
  cat: EffectiveCatalog,
  app: AppNode,
  recv: Expr,
  vars: Map<string, FfiParamType>,
): FfiParamType | undefined {
  if (recv.kind === 'Ident') return vars.get(recv.name) ?? undefined;
  return exprToFfiAlias(cat, app, recv, vars);
}

function ffiCheckExpr(
  cat: EffectiveCatalog,
  app: AppNode,
  e: Expr,
  vars: Map<string, FfiParamType>,
  owner: BaseNode,
  diagnostics: Diagnostic[],
  ownerPath: (n: BaseNode) => string,
  usedCoords: Set<string>,
): void {
  if (e.kind === 'Call' && e.callee.kind === 'Member') {
    const recvObj = e.callee.obj;
    // 接收者类型：变量表 / 目录别名（静态调用）/ ns 限定（dependency as ns）/ 链上成员 ret
    let alias: FfiParamType | undefined;
    let isStatic = false;
    let nsCls: ReturnType<EffectiveCatalog['byQualified']> | undefined;
    if (recvObj.kind === 'Ident') {
      const v = vars.get(recvObj.name);
      if (v) {
        alias = v;
      } else if (cat.byAlias(recvObj.name)) {
        alias = recvObj.name as FfiParamType;
        isStatic = true;
      }
    } else if (recvObj.kind === 'Member' && recvObj.obj.kind === 'Ident') {
      // ns.Alias.method(...) —— dependency ... as ns 的限定引用
      const c = cat.byQualified(recvObj.obj.name, recvObj.prop);
      if (c) nsCls = c;
    } else {
      const inferChain = exprToFfiAlias(cat, app, recvObj, vars);
      if (inferChain) alias = inferChain;
    }
    // 实体接收者/数据源限定名交给实体检查，避免重复报
    if (nsCls) {
      const prop = e.callee.prop;
      const m = cat.member(nsCls, prop);
      if (nsCls.maven) usedCoords.add(nsCls.maven);
      if (!m) {
        diagnostics.push({
          path: ownerPath(owner),
          message: `成员 ${nsCls.alias}.${prop} 不在依赖 ${nsCls.maven ?? ''} 的扫描产物（可用成员：${nsCls.members.map((mm) => mm.name).slice(0, 8).join('、')}…）——请重跑 dsl bundle-jar 更新产物`,
          severity: 'error',
          code: 'FFI-MEMBER',
          suggestion: `重跑 dsl bundle-jar 更新 libs/ 产物，或改用可用成员`,
        });
      } else if (m && !m.static) {
        diagnostics.push({
          path: ownerPath(owner),
          message: `${nsCls.alias}.${prop} 是实例方法，须先实例化再调用`,
          severity: 'error',
          code: 'FFI-STATIC',
          suggestion: `先 const x = new 类(…) 再 x.${prop}(…)`,
        });
      }
    } else if (alias) {
      const isEntityRecv = recvObj.kind === 'Ident' && !!resolveEntity(app, recvObj.name);
      if (!isEntityRecv) {
        const cls = cat.byAlias(alias);
        const prop = e.callee.prop;
        const m = cls ? cat.member(cls, prop) : undefined;
        if (cls?.maven) usedCoords.add(cls.maven);
        if (cls && !m) {
          diagnostics.push({
            path: ownerPath(owner),
            message: `成员 ${cls.alias}.${prop} 不在 FFI 目录（可用成员：${cls.members.map((mm) => mm.name).slice(0, 8).join('、')}…）——若为 Java 库成员，请运行 dsl bundle-jar 并入后重试`,
            severity: 'error',
            code: 'FFI-MEMBER',
            suggestion: `改用可用成员，或 bundle-jar 并入该类`,
          });
        } else if (m && isStatic && !m.static) {
          diagnostics.push({
            path: ownerPath(owner),
            message: `${cls?.alias}.${prop} 是实例方法，静态调用非法`,
            severity: 'error',
            code: 'FFI-STATIC',
            suggestion: `先 new 再实例调用`,
          });
        } else if (m && !isStatic && m.static) {
          diagnostics.push({
            path: ownerPath(owner),
            message: `${cls?.alias}.${prop} 是静态方法，需 ${cls?.alias}.${prop}(…) 形式调用`,
            severity: 'error',
            code: 'FFI-STATIC',
            suggestion: `改为静态形式 ${cls?.alias}.${prop}(…)`,
          });
        }
        // 双端目录里未标 js 的成员（backend-only）在前端生成的调用面交给 binding 层（本轮不展开——宽松）
      }
    }
  } else if (e.kind === 'Member') {
    // 递归 obj 链（如 a.b().c），保证深层调用也被看见
    ffiCheckExpr(cat, app, e.obj, vars, owner, diagnostics, ownerPath, usedCoords);
  }
  // 递归表达式子树
  if (e.kind === 'Call') {
    if (e.callee.kind === 'Member') ffiCheckExpr(cat, app, e.callee.obj, vars, owner, diagnostics, ownerPath, usedCoords);
    e.args.forEach((a) => ffiCheckExpr(cat, app, a, vars, owner, diagnostics, ownerPath, usedCoords));
  }
}

function checkFfi(
  cat: EffectiveCatalog,
  app: AppNode,
  l: LogicNode,
  diagnostics: Diagnostic[],
  ownerPath: (n: BaseNode) => string,
  usedCoords: Set<string>,
): void {
  const vars = new Map<string, FfiParamType>();
  // 参数类型入表
  for (const p of l.params) {
    const t = typeRefToFfiAlias(p.type);
    if (t) vars.set(p.name, t);
  }
  forEachStatement(l.body, (st) => {
    // VarDecl 声明进类型表（显式 type 或 init 推断）
    if (st.kind === 'VarDecl') {
      const t = st.type ? typeRefToFfiAlias(st.type) : exprToFfiAlias(cat, app, st.init, vars);
      if (t) vars.set(st.name, t);
    }
    // 收集表达式逐个校验
    const exprs: Expr[] = [];
    if (st.kind === 'VarDecl' && st.init) exprs.push(st.init);
    if (st.kind === 'Assign') exprs.push(st.target, st.value);
    if (st.kind === 'Return' && st.value) exprs.push(st.value);
    if (st.kind === 'If') exprs.push(st.cond);
    if (st.kind === 'ForEach') exprs.push(st.container);
    if (st.kind === 'CallStmt') exprs.push(st.call);
    for (const e of exprs) ffiCheckExpr(cat, app, e, vars, l, diagnostics, ownerPath, usedCoords);
  });
}

// ---------- 4.7 依赖声明与目录一致性（dev/32）----------

function checkDependencies(
  app: AppNode,
  cat: EffectiveCatalog,
  libs: LoadedCatalog[],
  usedCoords: Set<string>,
  diagnostics: Diagnostic[],
  ownerPath: (n: BaseNode) => string,
): void {
  // D-dep-4：alias 撞车（同名类跨 jar / 与内核五域冲突）
  for (const c of cat.collisions) {
    diagnostics.push({
      path: 'app',
      message: `类别名 ${c.alias} 在多个来源重名（${c.coordinates.join(' , ')}）——请在产物 JSON 中修改 alias，或用 dependency ... as <ns> 限定引用`,
      severity: 'error',
      code: 'DEP-4',
      suggestion: `产物 JSON 改 alias或 dependency ... as <ns>`,
    });
  }
  for (const d of app.dependencies) {
    if (d.eco !== 'java') continue; // npm 声明只进 package.json，无产物要求
    const matched = libs.filter((lc) => lc.eco === 'java' && depMatches(d, lc.coordinate));
    if (matched.length === 0) {
      // D-dep-2：声明无产物
      diagnostics.push({
        path: ownerPath(d),
        message: `依赖 ${depCoordinate(d)} 已声明但 libs/ 无匹配扫描产物——运行 dsl bundle-jar <jar> -o libs/<名>.json 并入`,
        severity: 'warning',
        code: 'DEP-2',
        suggestion: `dsl bundle-jar <jar> -o libs/<名>.json`,
      });
      continue;
    }
    // D-dep-3：版本漂移（按 g:a 匹配后比对版本段）
    if (d.version) {
      for (const lc of matched) {
        if (lc.coordinate !== depCoordinate(d)) {
          diagnostics.push({
            path: ownerPath(d),
            message: `依赖版本漂移：声明 ${depCoordinate(d)}，扫描产物为 ${lc.coordinate}`,
            severity: 'warning',
            code: 'DEP-3',
            suggestion: `声明与产物坐标对齐为 ${lc.coordinate}`,
          });
        }
      }
    }
  }
  // D-dep-1：用了未声明（裸 alias 命中带坐标的产物类）
  for (const coord of usedCoords) {
    if (!app.dependencies.some((d) => d.eco === 'java' && depMatches(d, coord))) {
      diagnostics.push({
        path: 'app',
        message: `使用了第三方库 ${coord} 但未声明依赖——请补 dependency java "${coord}"`,
        severity: 'error',
        code: 'DEP-1',
        suggestion: `补 dependency java "${coord}"`,
      });
    }
  }
}

// ---------- G2：form 表达式域（dev/29）----------

const IO_BINDING_NAMES = new Set(['useMutation', 'useQuery', 'openDialog']);

/** 递归取表达式叶子 Ident 名（用于上下文集合校验） */
function exprIdents(e: Expr, out: Set<string>): void {
  if (e.kind === 'Ident') {
    out.add(e.name);
    return;
  }
  if (e.kind === 'Member') {
    exprIdents(e.obj, out);
    return;
  }
  if (e.kind === 'Call') {
    exprIdents(e.callee, out);
    e.args.forEach((a) => exprIdents(a, out));
    return;
  }
  if (e.kind === 'Binary') {
    exprIdents(e.left, out);
    exprIdents(e.right, out);
    return;
  }
  if (e.kind === 'Group') {
    exprIdents(e.expr, out);
  }
}

/** derive/carryBy 语义均可见者：目录别名 / 已知目录类名（静态）/ 实体 / 上下文（前端面只看内核五域，第三方默认 backend-only） */
function knownFrontendIdent(app: AppNode, name: string): boolean {
  if (ffiByAlias(name)) return true;
  if (resolveEntity(app, name)) return true;
  if (app.enums.some((en) => en.name === name)) return true;
  return false;
}

function checkFormSemantics(
  app: AppNode,
  form: ViewElementNode,
  diagnostics: Diagnostic[],
  ownerPath: (n: BaseNode) => string,
  exposedLogics: Set<string>,
): void {
  // 收集兄弟字段名（form 顶层字段 + repeat 字段名）
  const siblings = new Set<string>();
  const collect = (els: ViewElementNode[]): void => {
    for (const el of els) {
      const f = String(el.props['field'] ?? '');
      if (f) siblings.add(f);
      collect(el.children);
    }
  };
  collect(form.children);
  siblings.add('row');
  siblings.add('initial');

  const walk = (els: ViewElementNode[]): void => {
    for (const el of els) {
      if (el.type !== 'input') {
        walk(el.children);
        continue;
      }
      const field = String(el.props['field'] ?? '');
      const derive = el.props['derive'];
      const carryBy = el.props['carryBy'];

      // ① derive：纯函数声明 —— IO 绑定禁令 + 叶子名必须 ∈ (兄弟字段 ∪ row/initial ∪ 目录/实体/枚举)
      if (derive !== undefined) {
        if (typeof derive !== 'object' || derive === null) {
          diagnostics.push({
            path: ownerPath(form),
            message: `字段 ${field} 的 derive 必须是表达式（derive={quantity * price}）`,
            severity: 'error',
            code: 'FORM-SEMANTICS',
          });
        } else {
          const de = derive as Expr;
          const dio = new Set<string>();
          exprIdents(de, dio);
          for (const id of dio) {
            if (IO_BINDING_NAMES.has(id)) {
              diagnostics.push({
                path: ownerPath(form),
                message: `字段 ${field} 的 derive 是纯函数表达式，不允许 IO 绑定（${id}）——需要后端数据请用 carryBy 或将计算放 logic`,
                severity: 'error',
                code: 'FORM-SEMANTICS',
              });
            }
          }
          for (const id of dio) {
            if (IO_BINDING_NAMES.has(id)) continue;
            if (siblings.has(id)) continue;
            if (knownFrontendIdent(app, id)) continue;
            diagnostics.push({
              path: ownerPath(form),
              message: `字段 ${field} 的 derive 引用了未声明名 '${id}'（仅可用本表单字段 / row / initial / 目录类型）`,
              severity: 'error',
              code: 'FORM-SEMANTICS',
            });
          }
        }
      }

      // ② carryBy：必须是已暴露/存在的后端 logic，返回实体必须包含嵌套带出字段
      if (carryBy !== undefined) {
        const target = String(carryBy ?? '');
        const logic = app.logics.find((x) => x.name === target);
        if (!logic) {
          diagnostics.push({
            path: ownerPath(form),
            message: `字段 ${field} 的 carryBy 指向不存在的 logic '${target}'`,
            severity: 'error',
            code: 'FORM-SEMANTICS',
          });
        } else if (!exposedLogics.has(target)) {
          diagnostics.push({
            path: ownerPath(form),
            message: `carryBy logic '${target}' 未被任何 interface 端点暴露`,
            severity: 'error',
            code: 'FORM-SEMANTICS',
          });
        } else {
          // 嵌套 children 字段必须出现在返回实体属性里（带出可达性）
          const retT = logic.returns[0]?.type;
          const retEnt = retT?.kind === 'reference'
            ? app.datasources.flatMap((ds) => ds.entities).find((e) => e.name === `${retT.path}`.split('.').pop())
            : undefined;
          for (const child of el.children) {
            if (child.type !== 'input') continue;
            const cf = String(child.props['field'] ?? '');
            if (!cf) continue;
            if (retEnt && !retEnt.properties.some((p) => p.name === cf)) {
              diagnostics.push({
                path: ownerPath(form),
                message: `carryBy '${target}' 返回实体无字段 '${cf}'（字段 ${field} 带出不可达）`,
                severity: 'error',
                code: 'FORM-SEMANTICS',
              });
            }
          }
        }
      }

      // ③ 校验属性：取值类型宽松校验
      for (const [attr, ty] of [['min', 'number'], ['max', 'number'], ['pattern', 'string']] as const) {
        const v = el.props[attr];
        if (v !== undefined && ((ty === 'number' && typeof v === 'number' && Number.isNaN(Number(v))) || (ty === 'string' && typeof v !== 'string'))) {
          diagnostics.push({
            path: ownerPath(form),
            message: `字段 ${field} 的 ${attr} 取值类型应为 ${ty}`,
            severity: 'error',
            code: 'FORM-SEMANTICS',
          });
        }
      }

      walk(el.children);
    }
  };
  walk(form.children);
}

// ---------- 表达式核对承接导出（dev/36 F3/F4：供单测/调用方复用判定核） ----------
export { exprType, assignable } from './expr-type';
export {
  containerElemType,
  contribute,
  receiverReferenceOf,
  scopeOfLogic,
  type VarInfo,
  type VarScope,
} from './scope';
