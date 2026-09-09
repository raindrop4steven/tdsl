import {
  buildTypeSymbolTable,
  createNode,
  isAmbiguousEntity,
  resolveQualified,
  resolveShort,
  type AppNode,
  type BindingNode,
  type DataSourceNode,
  type EntityNode,
  type EntityPropertyNode,
  type EnumItemNode,
  type EnumNode,
  type Expr,
  type EndpointNode,
  type InterfaceNode,
  type LogicNode,
  type ParamNode,
  type ReturnNode,
  type ServiceNode,
  type ServiceOperationNode,
  type ComponentNode,
  type Statement,
  type StructureNode,
  type StructurePropertyNode,
  type TypeRef,
  type TypeSymbolTable,
  type ViewElementNode,
  type ViewNode,
} from '@tdsl/core';
import { tokenize, type Token } from './lexer';

export class TdslSyntaxError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly col: number,
  ) {
    super(`${message} (line ${line}, col ${col})`);
    this.name = 'TdslSyntaxError';
  }
}

/** TDSL（TS 书写面子集）→ Typed AST；引用名在 link 阶段绑定为 nodePath */
export function parse(input: string): AppNode {
  const tokens = tokenize(input);
  const parser = new Parser(tokens);
  const app = parser.parseApp();
  linkApp(app);
  return app;
}

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const t = this.tokens[this.pos];
    if (t.type !== 'eof') this.pos++;
    return t;
  }

  private expect(value: string): Token {
    const t = this.peek();
    if (t.value !== value) this.fail(`expected '${value}' but got '${t.value}'`);
    return this.next();
  }

  private expectIdent(): string {
    const t = this.peek();
    if (t.type !== 'ident') this.fail(`expected identifier but got '${t.value}'`);
    return this.next().value;
  }

  private expectString(): string {
    const t = this.peek();
    if (t.type !== 'string') this.fail(`expected string literal but got '${t.value}'`);
    return this.next().value;
  }

  private expectNumber(): string {
    const t = this.peek();
    if (t.type !== 'number') this.fail(`expected number but got '${t.value}'`);
    return this.next().value;
  }

  private fail(msg: string): never {
    const t = this.peek();
    throw new TdslSyntaxError(msg, t.line, t.col);
  }

  parseApp(): AppNode {
    const app: AppNode = {
      ...createNode('App'),
      name: 'todo',
      datasources: [],
      structures: [],
      enums: [],
      logics: [],
      interfaces: [],
      views: [],
      services: [],
      components: [],
    };
    let currentDs: DataSourceNode | null = null;
    let pendingServiceConfig: Record<string, string> | null = null;

    while (this.peek().type !== 'eof') {
      // 顶层注解：@datasource('name') 声明/切换当前数据源；@service(...) 暂存配置；其余（@export 等）跳过
      if (this.peek().value === '@') {
        this.next();
        const ann = this.expectIdent();
        if (ann === 'datasource') {
          this.expect('(');
          const dsName = this.expectString();
          this.expect(')');
          // 同名数据源复用（后续 entity 追加到同一数据源）
          currentDs = app.datasources.find((d) => d.name === dsName) ?? null;
          if (!currentDs) {
            currentDs = { ...createNode('DataSource'), name: dsName, entities: [] };
            app.datasources.push(currentDs);
          }
        } else if (ann === 'service') {
          pendingServiceConfig = this.parseServiceConfig();
        }
        continue;
      }

      const kw = this.peek().value;
      if (kw === 'entity') {
        const ent = this.parseEntity();
        if (!currentDs) {
          currentDs = { ...createNode('DataSource'), name: 'defaultDS', entities: [] };
          app.datasources.push(currentDs);
        }
        currentDs.entities.push(ent);
      } else if (kw === 'struct') {
        app.structures.push(this.parseStructure());
      } else if (kw === 'enum') {
        app.enums.push(this.parseEnum());
      } else if (kw === 'logic') {
        app.logics.push(this.parseLogic());
      } else if (kw === 'interface') {
        app.interfaces.push(this.parseInterface());
      } else if (kw === 'page') {
        app.views.push(this.parsePage());
      } else if (kw === 'service') {
        const cfg = pendingServiceConfig ?? {};
        pendingServiceConfig = null;
        app.services.push(this.parseService(cfg));
      } else if (kw === 'component') {
        app.components.push(this.parseComponent());
      } else {
        this.fail(`unexpected '${kw}' at top level`);
      }
    }
    return app;
  }

  /** @service(kind = 'dubbo', group = 'x', version = '1.0.0') → Record<string,string> */
  private parseServiceConfig(): Record<string, string> {
    const cfg: Record<string, string> = {};
    this.expect('(');
    while (this.peek().value !== ')') {
      const key = this.expectIdent();
      this.expect('=');
      const t = this.peek();
      if (t.type === 'string') cfg[key] = this.next().value;
      else if (t.type === 'number') cfg[key] = this.next().value;
      else this.fail(`expected string/number value for '${key}'`);
      if (this.peek().value === ',') this.next();
    }
    this.expect(')');
    return cfg;
  }

  /** service Name { op; op; } —— dubbo/bean/http 三种 kind 共用签名体 */
  private parseService(config: Record<string, string>): ServiceNode {
    this.expect('service');
    const name = this.expectIdent();
    const kind = config['kind'] as ServiceNode['kind_'] | undefined;
    if (!kind || (kind !== 'dubbo' && kind !== 'bean' && kind !== 'http')) {
      this.fail(`service '${name}' requires @service(kind = 'dubbo'|'bean'|'http')`);
    }
    this.expect('{');
    const operations: ServiceOperationNode[] = [];
    while (this.peek().value !== '}') {
      operations.push(this.parseServiceOperation(kind));
    }
    this.expect('}');
    return { ...createNode('Service'), name, kind_: kind, config, operations };
  }

  /** 操作体：http 形态 METHOD 'path' -> name(args): ret; 其余 name(args): ret; */
  private parseServiceOperation(kind: ServiceNode['kind_']): ServiceOperationNode {
    let method: ServiceOperationNode['method'];
    let path: string | undefined;
    const t = this.peek();
    if (
      kind === 'http' &&
      t.type === 'ident' &&
      (t.value === 'GET' || t.value === 'POST' || t.value === 'PUT' || t.value === 'DELETE')
    ) {
      method = this.next().value as ServiceOperationNode['method'];
      path = this.expectString();
      this.expect('-');
      this.expect('>');
    }
    const name = this.expectIdent();
    this.expect('(');
    const params: ParamNode[] = [];
    while (this.peek().value !== ')') {
      const pname = this.expectIdent();
      this.expect(':');
      params.push({ ...createNode('Param'), name: pname, type: this.parseTypeRef() });
      if (this.peek().value === ',') this.next();
    }
    this.expect(')');
    this.expect(':');
    const retType = this.parseTypeRef();
    const returns: ReturnNode[] = [{ ...createNode('Return'), type: retType }];
    this.expect(';');
    return { ...createNode('ServiceOperation'), name, params, returns, method, path };
  }

  /** component Name { pkg: 'x'; defaultProps: {...}; events: [...] } */
  private parseComponent(): ComponentNode {
    this.expect('component');
    const name = this.expectIdent();
    this.expect('{');
    let pkg = '';
    const defaultProps: string[] = [];
    const events: string[] = [];
    while (this.peek().value !== '}') {
      const key = this.expectIdent();
      this.expect(':');
      if (key === 'pkg') {
        pkg = this.expectString();
        this.expect(';');
      } else if (key === 'defaultProps') {
        this.expect('{');
        while (this.peek().value !== '}') {
          const pname = this.expectIdent();
          this.expect(':');
          this.parseTypeRef(); // props 类型先解析占位，本切面只取字段名
          if (this.peek().value === ';') this.next();
          defaultProps.push(pname);
        }
        this.expect('}');
        if (this.peek().value === ';') this.next();
      } else if (key === 'events') {
        this.expect('[');
        while (this.peek().value !== ']') {
          events.push(this.expectString());
          if (this.peek().value === ',') this.next();
        }
        this.expect(']');
        if (this.peek().value === ';') this.next();
      } else {
        this.fail(`unknown component field '${key}'`);
      }
    }
    this.expect('}');
    if (!pkg) this.fail(`component '${name}' requires pkg`);
    return { ...createNode('Component'), name, pkg, defaultProps, events };
  }

  private parseEntity(): EntityNode {
    this.expect('entity');
    const name = this.expectIdent();
    this.expect('{');
    const properties: EntityPropertyNode[] = [];
    while (this.peek().value !== '}') {
      const pname = this.expectIdent();
      this.expect(':');
      const type = this.parseTypeRef();
      const prop: EntityPropertyNode = { ...createNode('EntityProperty'), name: pname, type };
      while (this.peek().value === '@') {
        this.next();
        const ann = this.expectIdent();
        if (ann === 'pk') prop.primary = true;
        else if (ann === 'nullable') prop.nullable = true;
        else if (ann === 'unique') prop.unique = true;
        else this.fail(`unknown annotation '@${ann}'`);
      }
      this.expect(';');
      properties.push(prop);
    }
    this.expect('}');
    return { ...createNode('Entity'), name, properties };
  }

  private parseStructure(): StructureNode {
    this.expect('struct');
    const name = this.expectIdent();
    this.expect('{');
    const properties: StructurePropertyNode[] = [];
    while (this.peek().value !== '}') {
      const pname = this.expectIdent();
      this.expect(':');
      const type = this.parseTypeRef();
      properties.push({ ...createNode('StructureProperty'), name: pname, type });
      this.expect(';');
    }
    this.expect('}');
    return { ...createNode('Structure'), name, properties };
  }

  private parseEnum(): EnumNode {
    this.expect('enum');
    const name = this.expectIdent();
    this.expect('{');
    const items: EnumItemNode[] = [];
    while (this.peek().value !== '}') {
      items.push({ ...createNode('EnumItem'), name: this.expectIdent() });
      if (this.peek().value === ',') this.next();
    }
    this.expect('}');
    return { ...createNode('Enum'), name, items };
  }

  private parseLogic(): LogicNode {
    // 可选注解 @export 等
    while (this.peek().value === '@') {
      this.next();
      this.expectIdent();
    }
    this.expect('logic');
    const name = this.expectIdent();
    this.expect('(');
    const params: ParamNode[] = [];
    while (this.peek().value !== ')') {
      const pname = this.expectIdent();
      this.expect(':');
      params.push({ ...createNode('Param'), name: pname, type: this.parseTypeRef() });
      if (this.peek().value === ',') this.next();
    }
    this.expect(')');
    this.expect(':');
    const retType = this.parseTypeRef();
    const returns: ReturnNode[] = [{ ...createNode('Return'), type: retType }];
    this.expect('{');
    const body = this.parseStatements();
    this.expect('}');
    return { ...createNode('Logic'), name, params, returns, body };
  }

  /** interface Name { METHOD 'path' -> logicName } */
  private parseInterface(): InterfaceNode {
    this.expect('interface');
    const name = this.expectIdent();
    this.expect('{');
    const endpoints: EndpointNode[] = [];
    while (this.peek().value !== '}') {
      const methodTok = this.expectIdent();
      const method = methodTok as EndpointNode['method'];
      if (method !== 'GET' && method !== 'POST' && method !== 'PUT' && method !== 'DELETE') {
        this.fail(`invalid HTTP method '${methodTok}'`);
      }
      const path = this.expectString();
      this.expect('-');
      this.expect('>');
      const logicName = this.expectIdent();
      endpoints.push({
        ...createNode('Endpoint'),
        name: logicName,
        method,
        path,
        logicRef: logicName, // 短名，link 阶段绑定为 nodePath
      });
      if (this.peek().value === ';') this.next();
    }
    this.expect('}');
    return { ...createNode('Interface'), name, endpoints };
  }

  /** page Name { <el ...>...</el> } —— JSX 子集，解析为 ViewNode */
  private parsePage(): ViewNode {
    this.expect('page');
    const name = this.expectIdent();
    this.expect('{');
    const elements: ViewElementNode[] = [];
    while (this.peek().value !== '}') {
      if (this.peek().value !== '<') {
        this.fail(`expected '<' in page body but got '${this.peek().value}'`);
      }
      elements.push(this.parseViewElement());
    }
    this.expect('}');
    return { ...createNode('View'), name, viewKind: 'page', elements };
  }

  /** JSX 子集元素：<tag attr={expr} attr="str"> children </tag> 或 <tag ... /> */
  private parseViewElement(): ViewElementNode {
    this.expect('<');
    const type = this.expectIdent();
    const props: Record<string, Expr | string> = {};
    const bindings: BindingNode[] = [];
    // 属性：attr="str" | attr={expr}
    while (this.peek().value !== '>' && this.peek().value !== '/') {
      const attrName = this.expectIdent();
      this.expect('=');
      if (this.peek().value === '{') {
        this.next();
        const e = this.parseExpr();
        this.expect('}');
        props[attrName] = e;
        // 提取 useQuery/useMutation/navigate 绑定
        const binding = extractBinding(e);
        if (binding) bindings.push(binding);
      } else {
        props[attrName] = this.expectString();
      }
    }
    const children: ViewElementNode[] = [];
    if (this.peek().value === '/') {
      this.next();
      this.expect('>');
    } else {
      this.expect('>');
      while (this.peek().value !== '<' && this.peek().value !== '<eof>') {
        // 文本节点（如按钮文字）跳过；遇到 < 进子元素
        this.next();
      }
      while (this.peek().value === '<' && this.peekAfter().value !== '/') {
        children.push(this.parseViewElement());
      }
      // 闭合标签 </tag>
      this.expect('<');
      this.expect('/');
      const closeTag = this.expectIdent();
      if (closeTag !== type) this.fail(`mismatched closing tag '${closeTag}', expected '${type}'`);
      this.expect('>');
    }
    return { ...createNode('ViewElement'), type, props, bindings, children };
  }

  private peekAfter(): Token {
    const n = this.pos + 1;
    return this.tokens[Math.min(n, this.tokens.length - 1)];
  }

  private parseStatements(): Statement[] {
    const out: Statement[] = [];
    while (this.peek().value !== '}') {
      out.push(this.parseStatement());
    }
    return out;
  }

  private parseStatement(): Statement {
    const t = this.peek();

    if (t.value === 'return') {
      this.next();
      const value = this.peek().value === ';' ? undefined : this.parseExpr();
      this.expect(';');
      return { kind: 'Return', value };
    }

    if (t.value === 'if') {
      this.next();
      this.expect('(');
      const cond = this.parseExpr();
      this.expect(')');
      this.expect('{');
      const then = this.parseStatements();
      this.expect('}');
      let else_: Statement[] | undefined;
      if (this.peek().value === 'else') {
        this.next();
        this.expect('{');
        else_ = this.parseStatements();
        this.expect('}');
      }
      return { kind: 'If', cond, then, else: else_ };
    }

    if (t.value === 'for') {
      this.next();
      this.expect('(');
      const item = this.expectIdent();
      this.expect('in');
      const container = this.parseExpr();
      this.expect(')');
      this.expect('{');
      const body = this.parseStatements();
      this.expect('}');
      return { kind: 'ForEach', item, container, body };
    }

    // 先解析一个表达式，再根据后续 token 决定语句类型
    const expr = this.parseExpr();
    if (this.peek().value === ':=') {
      this.next();
      const init = this.parseExpr();
      this.expect(';');
      if (expr.kind !== 'Ident') this.fail('left side of := must be an identifier');
      return { kind: 'VarDecl', name: expr.name, init };
    }
    if (this.peek().value === '=') {
      this.next();
      const value = this.parseExpr();
      this.expect(';');
      return { kind: 'Assign', target: expr, value };
    }
    this.expect(';');
    return { kind: 'CallStmt', call: expr };
  }

  // ---------- 表达式（优先级爬升） ----------

  private parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.peek().value === '||') {
      this.next();
      left = { kind: 'Binary', operator: '||', left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseEquality();
    while (this.peek().value === '&&') {
      this.next();
      left = { kind: 'Binary', operator: '&&', left, right: this.parseEquality() };
    }
    return left;
  }

  private parseEquality(): Expr {
    let left = this.parseRelational();
    while (this.peek().value === '===' || this.peek().value === '!==') {
      const op = this.next().value as '===' | '!==';
      left = { kind: 'Binary', operator: op, left, right: this.parseRelational() };
    }
    return left;
  }

  private parseRelational(): Expr {
    let left = this.parseAdditive();
    while (
      this.peek().value === '<' ||
      this.peek().value === '<=' ||
      this.peek().value === '>' ||
      this.peek().value === '>='
    ) {
      const op = this.next().value as '<' | '<=' | '>' | '>=';
      left = { kind: 'Binary', operator: op, left, right: this.parseAdditive() };
    }
    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (this.peek().value === '+' || this.peek().value === '-') {
      const op = this.next().value as '+' | '-';
      left = { kind: 'Binary', operator: op, left, right: this.parseMultiplicative() };
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parsePostfix();
    while (this.peek().value === '*' || this.peek().value === '/') {
      const op = this.next().value as '*' | '/';
      left = { kind: 'Binary', operator: op, left, right: this.parsePostfix() };
    }
    return left;
  }

  private parsePostfix(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      if (this.peek().value === '.') {
        this.next();
        const prop = this.expectIdent();
        e = { kind: 'Member', obj: e, prop };
      } else if (this.peek().value === '(') {
        this.next();
        const args: Expr[] = [];
        // where 查询特殊参数：Entity.where(field = value) → Binary('=', field, value)
        // where 查询特殊参数：Entity.where(field = value) / erp.Entity.where(...) → Binary('=', field, value)
        const isWhere =
          e.kind === 'Member' &&
          e.prop === 'where' &&
          (e.obj.kind === 'Ident' || (e.obj.kind === 'Member' && e.obj.obj.kind === 'Ident'));
        if (isWhere) {
          const field = this.parseExpr(); // 字段标识符
          if (this.peek().value === '=') {
            this.next();
            const value = this.parseExpr();
            args.push({ kind: 'Binary', operator: '=', left: field, right: value });
          } else {
            args.push(field);
          }
        } else {
          while (this.peek().value !== ')') {
            args.push(this.parseExpr());
            if (this.peek().value === ',') this.next();
          }
        }
        this.expect(')');
        e = { kind: 'Call', callee: e, args };
      } else {
        break;
      }
    }
    return e;
  }

  private parsePrimary(): Expr {
    const t = this.peek();

    if (t.value === '(') {
      this.next();
      const e = this.parseExpr();
      this.expect(')');
      return { kind: 'Group', expr: e };
    }

    if (t.value === 'new') {
      this.next();
      const type = this.parseTypeRef();
      if (type.kind === 'generic' && type.name === 'List') {
        this.expect('(');
        this.expect(')');
        return { kind: 'NewList', elem: type.args[0] ?? { kind: 'primitive', builtin: 'String' }, items: [] };
      }
      this.expect('(');
      const args: Expr[] = [];
      while (this.peek().value !== ')') {
        args.push(this.parseExpr());
        if (this.peek().value === ',') this.next();
      }
      this.expect(')');
      return { kind: 'New', type, args };
    }

    if (t.value === 'true') {
      this.next();
      return { kind: 'Bool', value: true };
    }
    if (t.value === 'false') {
      this.next();
      return { kind: 'Bool', value: false };
    }
    if (t.value === 'null') {
      this.next();
      return { kind: 'Null' };
    }
    if (t.type === 'string') {
      this.next();
      return { kind: 'String', value: t.value };
    }
    if (t.type === 'number') {
      this.next();
      return { kind: 'Numeric', value: Number(t.value) };
    }
    if (t.type === 'ident') {
      this.next();
      return { kind: 'Ident', name: t.value };
    }
    this.fail(`unexpected token '${t.value}' in expression`);
  }

  // ---------- 类型引用 ----------

  private parseTypeRef(): TypeRef {
    const t = this.expectIdent();

    switch (t) {
      case 'Integer':
      case 'String':
      case 'Boolean':
      case 'Date':
      case 'Time':
      case 'DateTime':
        return { kind: 'primitive', builtin: t };
      case 'Decimal': {
        if (this.peek().value === '(') {
          this.next();
          const precision = Number(this.expectNumber());
          this.expect(',');
          const scale = Number(this.expectNumber());
          this.expect(')');
          return { kind: 'db', builtin: 'decimal', args: { precision, scale } };
        }
        return { kind: 'primitive', builtin: 'Decimal' };
      }
      case 'List':
      case 'Map':
      case 'Page': {
        this.expect('<');
        const arg = this.parseTypeRef();
        this.expect('>');
        return { kind: 'generic', name: t, args: [arg] };
      }
      default:
        // 引用类型：短名（Order）或限定名（erp.Order），link 阶段绑定为 nodePath
        if (this.peek().value === '.') {
          this.next();
          const ent = this.expectIdent();
          return { kind: 'reference', path: `${t}.${ent}` };
        }
        return { kind: 'reference', path: t };
    }
  }
}

// ---------- link：短名 → nodePath（分层作用域：实体→数据源，结构/枚举/逻辑/接口→全局） ----------

function linkApp(app: AppNode): void {
  const table = buildTypeSymbolTable(app);

  // 同数据源内重名检查（buildTypeSymbolTable 已保证跨源同名进各自 scope）
  for (const [dsName, scope] of table.dataSources) {
    // scope 是每数据源独立 Map，天然同源唯一（重复声明会覆盖，需检测）
    const seen = new Set<string>();
    for (const ent of app.datasources.find((d) => d.name === dsName)?.entities ?? []) {
      if (seen.has(ent.name)) {
        throw new TdslSyntaxError(
          `duplicate entity '${ent.name}' in datasource '${dsName}'`,
          0,
          0,
        );
      }
      seen.add(ent.name);
    }
  }

  // 全局概念重名检查（structure/enum/logic/interface 短名全局唯一；且不得与全局唯一实体冲突）
  const globalSeen = new Map<string, string>();
  const declareGlobal = (name: string, path: string): void => {
    const existing = globalSeen.get(name);
    if (existing !== undefined && existing !== path) {
      throw new TdslSyntaxError(
        `duplicate type name '${name}': ${existing} vs ${path}`,
        0,
        0,
      );
    }
    globalSeen.set(name, path);
  };
  // 全局唯一实体已占用 global 名（跨源同名实体不在 global，无冲突）
  for (const [name, path] of table.global) {
    if (path.startsWith('app.datasources.')) globalSeen.set(name, path);
  }
  for (const s of app.structures) declareGlobal(s.name, `app.structures.${s.name}`);
  for (const en of app.enums) declareGlobal(en.name, `app.enums.${en.name}`);
  for (const l of app.logics) declareGlobal(l.name, `app.logics.${l.name}`);
  for (const itf of app.interfaces) declareGlobal(itf.name, `app.interfaces.${itf.name}`);
  for (const s of app.services) declareGlobal(s.name, `app.services.${s.name}`);
  for (const c of app.components) declareGlobal(c.name, `app.components.${c.name}`);
  for (const c of app.components) {
    if (!c.pkg) {
      throw new TdslSyntaxError(`component '${c.name}' requires pkg`, 0, 0);
    }
  }

  // 接口端点：绑定 logicRef 短名 → Logic nodePath
  for (const itf of app.interfaces) {
    for (const ep of itf.endpoints) {
      const full = table.global.get(ep.logicRef ?? '');
      if (!full || !full.startsWith('app.logics.')) {
        throw new TdslSyntaxError(`cannot resolve logic '${ep.logicRef}'`, 0, 0);
      }
      ep.logicRef = full;
    }
  }

  // ctxDs：当前数据源上下文（实体属性遍历时传入，供短名优先解析到本数据源）
  const linkTypeRef = (tr: TypeRef, ctxDs?: string): void => {
    if (tr.kind === 'reference') {
      const full = resolveTypeRef(table, tr.path, ctxDs);
      tr.path = full;
    } else if (tr.kind === 'generic') {
      tr.args.forEach((a) => linkTypeRef(a, ctxDs));
    }
  };

  for (const ds of app.datasources) {
    for (const ent of ds.entities) {
      ent.properties.forEach((p) => linkTypeRef(p.type, ds.name));
    }
  }
  for (const s of app.structures) {
    s.properties.forEach((p) => linkTypeRef(p.type));
  }
  for (const s of app.services) {
    for (const op of s.operations) {
      op.params.forEach((p) => linkTypeRef(p.type));
      op.returns.forEach((r) => linkTypeRef(r.type));
    }
  }
  for (const l of app.logics) {
    l.params.forEach((p) => linkTypeRef(p.type));
    l.returns.forEach((r) => linkTypeRef(r.type));
    linkStatements(l.body);
  }

  // 页面 binding：useQuery/useMutation → logic nodePath；navigate → 页面名校验
  linkViews(app, table);

  function linkStatements(stmts: Statement[]): void {
    for (const st of stmts) {
      switch (st.kind) {
        case 'VarDecl':
          if (st.type) linkTypeRef(st.type);
          if (st.init) linkExpr(st.init);
          break;
        case 'Assign':
          linkExpr(st.target);
          linkExpr(st.value);
          break;
        case 'Return':
          if (st.value) linkExpr(st.value);
          break;
        case 'If':
          linkExpr(st.cond);
          linkStatements(st.then);
          if (st.else) linkStatements(st.else);
          break;
        case 'ForEach':
          linkExpr(st.container);
          linkStatements(st.body);
          break;
        case 'CallStmt':
          linkExpr(st.call);
          break;
      }
    }
  }

  function linkExpr(e: Expr): void {
    switch (e.kind) {
      case 'Ident':
      case 'Bool':
      case 'Numeric':
      case 'String':
      case 'Null':
        break;
      case 'Member':
        linkExpr(e.obj);
        break;
      case 'Call':
        linkExpr(e.callee);
        e.args.forEach(linkExpr);
        break;
      case 'New':
        linkTypeRef(e.type);
        e.args.forEach(linkExpr);
        break;
      case 'NewList':
        linkTypeRef(e.elem);
        e.items.forEach(linkExpr);
        break;
      case 'Binary':
        linkExpr(e.left);
        linkExpr(e.right);
        break;
      case 'Group':
        linkExpr(e.expr);
        break;
    }
  }
}

/** 解析 TypeRef 引用为完整 nodePath（支持短名 / ds.Entity 限定名 / 已是 nodePath） */
function resolveTypeRef(table: TypeSymbolTable, ref: string, ctxDs?: string): string {
  // 已是完整 nodePath（程序化构建的 AST 再 link）→ 直接通过
  if (ref.startsWith('app.')) return ref;

  // 限定名 dsName.EntityName
  if (ref.includes('.')) {
    const dot = ref.indexOf('.');
    const dsName = ref.slice(0, dot);
    const entName = ref.slice(dot + 1);
    const full = resolveQualified(table, dsName, entName);
    if (!full) {
      throw new TdslSyntaxError(`cannot resolve type '${ref}'`, 0, 0);
    }
    return full;
  }

  // 短名：优先当前数据源，其次全局
  const full = resolveShort(table, ref, ctxDs);
  if (!full) {
    // 跨源歧义（多个数据源同名实体）但未限定 → 提示用限定名
    if (isAmbiguousEntity(table, ref)) {
      throw new TdslSyntaxError(
        `ambiguous type '${ref}': exists in multiple datasources, use 'dsName.${ref}'`,
        0,
        0,
      );
    }
    throw new TdslSyntaxError(`cannot resolve type '${ref}'`, 0, 0);
  }
  return full;
}

/** 从表达式提取 useQuery/useMutation/navigate 绑定（props 里的 {useQuery('logic')} 形态） */
function extractBinding(e: Expr): BindingNode | null {
  if (
    e.kind === 'Call' &&
    e.callee.kind === 'Ident' &&
    (e.callee.name === 'useQuery' || e.callee.name === 'useMutation' || e.callee.name === 'navigate')
  ) {
    const target = e.args[0]?.kind === 'String' ? e.args[0].value : '';
    return { ...createNode('Binding'), name: e.callee.name, target, args: e.args.slice(1) };
  }
  return null;
}

/** 链接页面 binding：useQuery/useMutation → logic nodePath；navigate → 页面名校验 */
function linkViews(app: AppNode, table: TypeSymbolTable): void {
  const linkElement = (el: ViewElementNode): void => {
    for (const b of el.bindings) {
      if (b.name === 'useQuery' || b.name === 'useMutation') {
        const full = table.global.get(b.target);
        if (!full || !full.startsWith('app.logics.')) {
          throw new TdslSyntaxError(`cannot resolve logic '${b.target}' in view binding`, 0, 0);
        }
        b.target = full;
      } else if (b.name === 'navigate') {
        const page = app.views.find((v) => v.name === b.target);
        if (!page) {
          throw new TdslSyntaxError(`cannot resolve page '${b.target}' in navigate`, 0, 0);
        }
      }
    }
    el.children.forEach(linkElement);
  };
  for (const v of app.views) v.elements.forEach(linkElement);
}