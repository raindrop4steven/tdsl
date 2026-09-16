import {
  buildTypeSymbolTable,
  createNode,
  isAmbiguousEntity,
  resolveQualified,
  resolveShort,
  type AppNode,
  type BindingNode,
  type BaseNode,
  type DataSourceNode,
  type DependencyNode,
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
    /** 所在文件（parseProject 多文件场景由外层填充；单文件为 '<stdin>'） */
    public file?: string,
  ) {
    super(`${message} (line ${line}, col ${col})`);
    this.name = 'TdslSyntaxError';
  }
}

/** 单文件入口：语义等价于 parseProject 单元素（保持 P0~M6 兼容） */
export function parse(input: string): AppNode {
  return parseProject([{ path: '<stdin>', content: input }]);
}

export interface TdslSourceFile {
  path: string;
  content: string;
}

/**
 * 多文件工程（M7）：目录即 app，每个 .tdsl 文件是一个分片。
 * 逐文件 parse → 合并为一个 AppNode → link（短名→nodePath 统一绑定，文件顺序无关）。
 * 跨文件引用靠 app 级全局命名空间（NASL 式），无 import 语句。
 */
export function parseProject(files: TdslSourceFile[], appName = 'todo'): AppNode {
  const fragments = files.map((f) => {
    try {
      const tokens = tokenize(f.content);
      const parser = new Parser(tokens);
      return parser.parseAppInto(f.path);
    } catch (e) {
      if (e instanceof TdslSyntaxError && e.file === undefined) e.file = f.path;
      throw e;
    }
  });
  const app = mergeApp(appName, fragments);
  linkApp(app);
  return app;
}

/** 分片合并：datasource 同名合并实体，其余段顺序拼接；重名冲突由 linkApp 检测（报错含文件） */
function mergeApp(name: string, fragments: AppNode[]): AppNode {
  const app: AppNode = {
    ...createNode('App'),
    name,
    datasources: [],
    structures: [],
    enums: [],
    logics: [],
    interfaces: [],
    views: [],
    services: [],
    dependencies: [],
  };
  const seenDeps = new Set<string>();
  for (const frag of fragments) {
    for (const ds of frag.datasources) {
      const existing = app.datasources.find((d) => d.name === ds.name);
      if (existing) existing.entities.push(...ds.entities);
      else app.datasources.push(ds);
    }
    app.structures.push(...frag.structures);
    app.enums.push(...frag.enums);
    app.logics.push(...frag.logics);
    app.interfaces.push(...frag.interfaces);
    app.views.push(...frag.views);
    app.services.push(...frag.services);
    for (const d of frag.dependencies) {
      const key = `${d.eco}|${d.name}|${d.version ?? ""}|${d.ns ?? ""}|${d.importDefault ?? ""}|${JSON.stringify(d.imports ?? [])}`;
      if (seenDeps.has(key)) continue;
      seenDeps.add(key);
      app.dependencies.push(d);
    }
  }
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

  parseAppInto(file: string): AppNode {
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
        dependencies: [],
    };
    let currentDs: DataSourceNode | null = null;
    // @title('中文') / @menu('模块') → 紧随其后的 page/dialog 显示名与菜单分组（中文化 + 折叠菜单）
    let pendingServiceConfig: Record<string, string> | null = null;
    const pendingViewAnnos = new Map<string, string>();

    while (this.peek().type !== 'eof') {
      // 顶层注解：@datasource('name') 声明/切换当前数据源；@service(...) 暂存配置；@title('x') 暂存视图标题；其余（@export 等）跳过
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
        } else if (ann === 'title' || ann === 'menu') {
          this.expect('(');
          pendingViewAnnos.set(ann, this.expectString());
          this.expect(')');
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
      } else if (kw === 'function') {
        app.logics.push(this.parseLogic());
      } else if (kw === 'interface') {
        app.interfaces.push(this.parseInterface());
      } else if (kw === 'page' || kw === 'dialog') {
        const view = this.parseView();
        if (pendingViewAnnos.size > 0) {
          view.annotations = [...pendingViewAnnos.entries()].map(([name, value]) => ({
            kind: 'Annotation',
            name,
            args: { value },
          }));
          pendingViewAnnos.clear();
        }
        app.views.push(view);
      } else if (kw === 'service') {
        const cfg = pendingServiceConfig ?? {};
        pendingServiceConfig = null;
        app.services.push(this.parseService(cfg));
      } else if (kw === 'dependency') {
        app.dependencies.push(this.parseDependency());
      } else if (kw === 'component') {
        this.fail("'component' 注册层已删除（dev/33）：npm 一等公民——页面直接写三方组件标签，import 由 dependency npm 声明解析");
      } else {
        this.fail(`unexpected '${kw}' at top level`);
      }
    }
    stampFile(app, file);
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
    if (!kind || (kind !== 'dubbo' && kind !== 'http')) {
      this.fail(`service '${name}' requires @service(kind = 'dubbo'|'http')（本地 jar 类请用 dependency java + libs 产物直调，dev/33）`);
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

  /** dependency java/npm "坐标" [as ns] [import X | import { A, B as C }]（dev/34 统一形态） */
  private parseDependency(): DependencyNode {
    this.expect('dependency');
    const ecoTok = this.expectIdent();
    if (ecoTok !== 'java' && ecoTok !== 'npm') {
      this.fail(`dependency eco must be 'java' or 'npm', got '${ecoTok}'`);
    }
    const coord = this.expectString();
    let ns: string | undefined;
    if (this.peek().value === 'as') {
      this.next();
      ns = this.expectIdent();
    }
    let importDefault: string | undefined;
    let imports: Array<{ name: string; alias?: string }> | undefined;
    if (this.peek().value === 'import') {
      this.next();
      if (this.peek().value === '{') {
        // 具名导入：import { A, B as C }
        this.next();
        imports = [];
        while (this.peek().value !== '}') {
          const n = this.expectIdent();
          let alias: string | undefined;
          if (this.peek().value === 'as') {
            this.next();
            alias = this.expectIdent();
          }
          imports.push(alias ? { name: n, alias } : { name: n });
          if (this.peek().value === ',') this.next();
        }
        this.expect('}');
      } else {
        // 默认导入：import X
        importDefault = this.expectIdent();
      }
    }
    this.expect(';');
    let name: string;
    let version: string | undefined;
    if (ecoTok === 'java') {
      const parts = coord.split(':');
      if (parts.length === 3) {
        name = `${parts[0]}:${parts[1]}`;
        version = parts[2];
      } else if (parts.length === 2) {
        name = coord;
      } else {
        this.fail(`dependency java 坐标须为 'groupId:artifactId[:version]'，got '${coord}'`);
      }
    } else {
      const at = coord.lastIndexOf('@');
      if (at > 0) {
        name = coord.slice(0, at);
        version = coord.slice(at + 1);
      } else {
        name = coord;
      }
    }
    return { ...createNode('Dependency'), eco: ecoTok as 'java' | 'npm', name, version, ns, imports, importDefault };
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
        else if (ann === 'ref') {
          // M10 外键显式声明：@ref(实体[, display: '字段'])（display 缺省 'name'，typecheck 兜底校验）
          // 实体短名或限定名 er.Supplier（分层作用域与类型引用一致）
          this.expect('(');
          let target = this.expectIdent();
          while (this.peek().value === '.') {
            this.next();
            target = `${target}.${this.expectIdent()}`;
          }
          let display = 'name';
          if (this.peek().value === ',') {
            this.next();
            const kv = this.expectIdent();
            this.expect(':');
            if (kv !== 'display') this.fail(`unknown ref option '${kv}'`);
            display = this.expectString();
          }
          this.expect(')');
          prop.ref = { ...createNode('EntityRef'), entityPath: target, display };
        }
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
      const itemName = this.expectIdent();
      // 可选显示标签 KEY('暂存')（G1：业务字典中文）
      let label: string | undefined;
      if (this.peek().value === '(') {
        this.next();
        label = this.expectString();
        this.expect(')');
      }
      items.push({ ...createNode('EnumItem'), name: itemName, label });
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
    this.expect('function');
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
  /** page → 路由页面；dialog → 抽屉/弹窗组件（不进路由，由页面 openDialog 打开） */
  private parseView(): ViewNode {
    const viewKind = this.peek().value === 'dialog' ? 'dialog' : 'page';
    this.next();
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
    return { ...createNode('View'), name, viewKind, elements };
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

    if (t.value === 'throw') {
      // dev/30 A1：抛出（后端事务语义；消息复用共享表达式）
      this.next();
      const message = this.parseExpr();
      this.expect(';');
      return { kind: 'Throw', message };
    }

    if (t.value === 'const' || t.value === 'let') {
      // TS 词法面：const x = / const x: T =（唯一形态；legacy `:=` 已删除）
      this.next();
      const name = this.expectIdent();
      let type: TypeRef | undefined;
      if (this.peek().value === ':') {
        this.next();
        type = this.parseTypeRef();
      }
      this.expect('=');
      const init = this.parseExpr();
      this.expect(';');
      return { kind: 'VarDecl', name, init, type };
    }

    if (t.value === 'for') {
      this.next();
      this.expect('(');
      // TS 词法面：for (const x of y)（唯一形态；legacy `for-in` 已删除）
      const isConst = this.peek().value === 'const' || this.peek().value === 'let';
      if (isConst) this.next();
      else this.fail("for 循环须为 for (const x of y) 形态（'const' 缺失）");
      const item = this.expectIdent();
      const conn = this.next().value;
      if (conn !== 'of') this.fail(`expected 'of' in for statement, got '${conn}'（legacy 'for-in' 已废弃）`);
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
      this.fail("':=' 已废弃：变量声明请用 const x = expr");
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
        const args = this.parseCallArgs(e);
        this.expect(')');
        e = { kind: 'Call', callee: e, args };
      } else {
        break;
      }
    }
    return e;
  }

  /** 依赖调用点形态分派实参解析：where 复合条件 / 链式方法 / 普通表达式 */
  private parseCallArgs(e: Expr): Expr[] {
    // Entity.where(...) / erp.Entity.where(...) → where 复合条件参数
    if (e.kind === 'Member' && e.prop === 'where' && this.isEntityReceiver(e.obj)) {
      return this.parseWhereArgs();
    }
    // 链式方法：.orderBy(field asc|desc, ...) / .page(n, size) / .limit(n) / .groupBy(field, ...)
    if (e.kind === 'Member' && this.isQueryChainMethod(e.prop) && this.isQueryChain(e.obj)) {
      return this.parseChainMethodArgs(e.prop);
    }
    // 普通参数
    const args: Expr[] = [];
    while (this.peek().value !== ')') {
      args.push(this.parseExpr());
      if (this.peek().value === ',') this.next();
    }
    return args;
  }

  /** 实体静态接收者：Order / erp.Order */
  private isEntityReceiver(o: Expr): boolean {
    return o.kind === 'Ident' || (o.kind === 'Member' && o.obj.kind === 'Ident');
  }

  /** 链式查询方法名 */
  private isQueryChainMethod(prop: string): boolean {
    return prop === 'orderBy' || prop === 'page' || prop === 'limit' || prop === 'groupBy';
  }

  /** 是否为实体查询链（本方法之前已产生实体查询调用）：Order.where(…)/erp.Order.where(…)/后续链 */
  private isQueryChain(o: Expr): boolean {
    if (o.kind === 'Call' && o.callee.kind === 'Member') {
      const m = o.callee;
      if (m.prop === 'where' && this.isEntityReceiver(m.obj)) return true;
      if (this.isQueryChainMethod(m.prop) && this.isQueryChain(m.obj)) return true;
    }
    return false;
  }

  /** where 复合条件参数：逗号分隔多个条件（AND），支持 &&/|| 组合；条件 = field op value */
  private parseWhereArgs(): Expr[] {
    const args: Expr[] = [];
    while (this.peek().value !== ')') {
      args.push(this.parseWhereCond());
      if (this.peek().value === ',') this.next();
    }
    if (args.length === 0) this.fail('where() 至少需要一个条件');
    return args;
  }

  /** 单个 where 条件：布尔组合 of 基本条件（field op value） */
  private parseWhereCond(): Expr {
    let left = this.parseWherePrimary();
    while (this.peek().value === '&&' || this.peek().value === '||') {
      const op = this.next().value as '&&' | '||';
      const right = this.parseWherePrimary();
      left = { kind: 'Binary', operator: op, left, right };
    }
    return left;
  }

  /** 基本条件：field op value；op ∈ =/>=/<=/>/</like/in；field 必须是标识符（不让 parseExpr 吞掉比较符） */
  private parseWherePrimary(): Expr {
    const field: Expr = { kind: 'Ident', name: this.expectIdent() };
    const peeked = this.peek();
    let operator: string | null = null;
    // 标点运算符
    if (peeked.value === '=' || peeked.value === '>=' || peeked.value === '<=' || peeked.value === '>' || peeked.value === '<') {
      operator = this.next().value;
    } else if (peeked.type === 'ident' && (peeked.value === 'like' || peeked.value === 'in')) {
      // like / in 是标识符形态的运算符
      operator = this.next().value;
    }
    if (!operator) {
      this.fail(`where 条件必须是 field op value 形式（op: = >= <= > < like in），遇到 '${peeked.value}'`);
    }
    const value = this.parseValueExpr();
    return { kind: 'Binary', operator: operator as '=' | '>=' | '<=' | '>' | '<' | 'like' | 'in', left: field, right: value };
  }

  /** 条件右值：表达式，但不能吞掉 &&/||/逗号/右括号（用 add 层，不含比较/逻辑） */
  private parseValueExpr(): Expr {
    return this.parseAdditive();
  }

  /** 链式方法参数：orderBy → [field, 'asc'|'desc', ...]；page/limit → 数值；groupBy → 字段列表 */
  private parseChainMethodArgs(prop: string): Expr[] {
    const args: Expr[] = [];
    if (prop === 'orderBy') {
      while (this.peek().value !== ')') {
        const field = this.parseExpr(); // 字段标识符
        const dir = this.peek();
        if (dir.type === 'ident') {
          if (dir.value === 'asc' || dir.value === 'desc') {
            this.next();
            args.push(field, { kind: 'String', value: dir.value });
          } else {
            // field 后跟标识符但非 asc/desc → 语法错误（orderBy 方向只允许 asc|desc）
            this.fail(`orderBy 方向必须是 asc 或 desc，遇到 '${dir.value}'`);
          }
        } else {
          args.push(field); // 默认 asc，方向留 typecheck/codegen 补
        }
        if (this.peek().value === ',') this.next();
      }
    } else {
      while (this.peek().value !== ')') {
        args.push(this.parseExpr());
        if (this.peek().value === ',') this.next();
      }
    }
    return args;
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
    // 数组字面量 [...]（M2：用于 in 条件右值）→ NewList，元素类型按首项推断
    if (t.value === '[') {
      this.next();
      const items: Expr[] = [];
      while (this.peek().value !== ']') {
        items.push(this.parseValueExpr());
        if (this.peek().value === ',') this.next();
      }
      this.expect(']');
      const elem: TypeRef =
        items.length > 0 ? literalTypeOf(items[0]) : { kind: 'primitive', builtin: 'String' };
      return { kind: 'NewList', elem, items };
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

/** 冲突报错附注：两个声明所在文件（多文件场景；单文件 '<stdin>' 时省略） */
function whereTwo(a: string | undefined, b: string | undefined): string {
  const fa = a && a !== '<stdin>' ? a : undefined;
  const fb = b && b !== '<stdin>' ? b : undefined;
  if (!fa && !fb) return '';
  if (!fa && fb) return ` (${fb})`;
  return ` (${fa} and ${fb ?? '?'})`;
}

/** 多文件工程（M7）：给分片内所有顶层声明节点打来源文件标（诊断反查用） */
function stampFile(app: AppNode, file: string): void {
  const mark = (n: BaseNode): void => {
    if (n.file === undefined) n.file = file;
  };
  app.datasources.forEach((ds) => {
    mark(ds);
    ds.entities.forEach(mark);
  });
  app.structures.forEach(mark);
  app.enums.forEach(mark);
  app.logics.forEach(mark);
  app.interfaces.forEach(mark);
  app.views.forEach(mark);
  app.services.forEach(mark);
}

function linkApp(app: AppNode): void {
  const table = buildTypeSymbolTable(app);

  // 同数据源内重名检查（buildTypeSymbolTable 已保证跨源同名进各自 scope）
  for (const [dsName, scope] of table.dataSources) {
    // scope 是每数据源独立 Map，天然同源唯一（重复声明会覆盖，需检测）
    const seen = new Map<string, string>();
    for (const ent of app.datasources.find((d) => d.name === dsName)?.entities ?? []) {
      const from = seen.get(ent.name);
      if (from !== undefined) {
        throw new TdslSyntaxError(
          `duplicate entity '${ent.name}' in datasource '${dsName}'` + whereTwo(from, ent.file),
          0,
          0,
        );
      }
      seen.set(ent.name, ent.file ?? '<stdin>');
    }
  }

  // 全局概念重名检查（structure/enum/logic/interface 短名全局唯一；且不得与全局唯一实体冲突）
  const globalSeen = new Map<string, string>();
  const globalFiles = new Map<string, string>();
  const declareGlobal = (name: string, path: string, node: BaseNode): void => {
    const existing = globalSeen.get(name);
    if (existing !== undefined && existing !== path) {
      throw new TdslSyntaxError(
        `duplicate type name '${name}': ${existing} vs ${path}` +
          whereTwo(globalFiles.get(name), node.file),
        0,
        0,
      );
    }
    if (existing !== undefined) {
      // 同段同名（path 相同）：单文件同段重名 / 跨文件重名同报（M7 收紧，原实现漏报）
      throw new TdslSyntaxError(
        `duplicate name '${name}': declared twice in '${path}'` +
          whereTwo(globalFiles.get(name), node.file),
        0,
        0,
      );
    }
    globalSeen.set(name, path);
    globalFiles.set(name, node.file ?? '<stdin>');
  };
  // 全局唯一实体已占用 global 名（跨源同名实体不在 global，无冲突）
  for (const [name, path] of table.global) {
    if (path.startsWith('app.datasources.')) {
      globalSeen.set(name, path);
      const dsName = path.split('.')[2];
      const ent = app.datasources
        .find((d) => d.name === dsName)
        ?.entities.find((e) => e.name === name);
      globalFiles.set(name, ent?.file ?? '<stdin>');
    }
  }
  for (const s of app.structures) declareGlobal(s.name, `app.structures.${s.name}`, s);
  for (const en of app.enums) declareGlobal(en.name, `app.enums.${en.name}`, en);
  for (const l of app.logics) declareGlobal(l.name, `app.logics.${l.name}`, l);
  for (const itf of app.interfaces) declareGlobal(itf.name, `app.interfaces.${itf.name}`, itf);
  for (const s of app.services) declareGlobal(s.name, `app.services.${s.name}`, s);

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
      // Object：Map<Object> 泛型兜底类型，内建放行（映射 Java java.lang.Object）
      if (tr.path === 'Object') return;
      const full = resolveTypeRef(table, tr.path, ctxDs);
      tr.path = full;
    } else if (tr.kind === 'generic') {
      tr.args.forEach((a) => linkTypeRef(a, ctxDs));
    }
  };

  for (const ds of app.datasources) {
    for (const ent of ds.entities) {
      ent.properties.forEach((p) => linkTypeRef(p.type, ds.name));
      // M10 @ref 绑定：实体引用短名 → nodePath（同 ctxDs 优先，失败抛错文案与 logicRef 同风格）
      for (const p of ent.properties) {
        if (!p.ref) continue;
        p.ref.entityPath = resolveTypeRef(table, p.ref.entityPath, ds.name);
      }
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

/** 从表达式提取 useQuery/useMutation/navigate/openDialog 绑定（props 里的 {useQuery('logic')} 形态） */
function extractBinding(e: Expr): BindingNode | null {
  if (
    e.kind === 'Call' &&
    e.callee.kind === 'Ident' &&
    (e.callee.name === 'useQuery' ||
      e.callee.name === 'useMutation' ||
      e.callee.name === 'navigate' ||
      e.callee.name === 'openDialog')
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
/** 数组字面量元素类型推断：按首项字面量形态 → primitive TypeRef；其他表达式 → String 兜底（真实类型由 typecheck 纠正） */
function literalTypeOf(e: Expr): TypeRef {
  if (e.kind === 'Numeric') return { kind: 'primitive', builtin: 'Integer' };
  if (e.kind === 'String') return { kind: 'primitive', builtin: 'String' };
  if (e.kind === 'Bool') return { kind: 'primitive', builtin: 'Boolean' };
  return { kind: 'primitive', builtin: 'String' };
}
