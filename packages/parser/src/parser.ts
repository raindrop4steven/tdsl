import {
  createNode,
  type AppNode,
  type DataSourceNode,
  type EntityNode,
  type EntityPropertyNode,
  type EnumItemNode,
  type EnumNode,
  type Expr,
  type LogicNode,
  type ParamNode,
  type ReturnNode,
  type Statement,
  type StructureNode,
  type StructurePropertyNode,
  type TypeRef,
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
    };
    let currentDs: DataSourceNode | null = null;

    while (this.peek().type !== 'eof') {
      // 顶层注解：@datasource('name') 声明/切换当前数据源；其余（@export 等）跳过
      if (this.peek().value === '@') {
        this.next();
        const ann = this.expectIdent();
        if (ann === 'datasource') {
          this.expect('(');
          const dsName = this.expectString();
          this.expect(')');
          currentDs = { ...createNode('DataSource'), name: dsName, entities: [] };
          app.datasources.push(currentDs);
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
      } else {
        this.fail(`unexpected '${kw}' at top level`);
      }
    }
    return app;
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
    while (this.peek().value === '<' || this.peek().value === '<=') {
      const op = this.next().value as '<' | '<=';
      left = { kind: 'Binary', operator: op, left, right: this.parseAdditive() };
    }
    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parsePostfix();
    while (this.peek().value === '+') {
      this.next();
      left = { kind: 'Binary', operator: '+', left, right: this.parsePostfix() };
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
        while (this.peek().value !== ')') {
          args.push(this.parseExpr());
          if (this.peek().value === ',') this.next();
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
        // 引用类型：此处为短名，link 阶段绑定为 nodePath
        return { kind: 'reference', path: t };
    }
  }
}

// ---------- link：短名 → nodePath ----------

function linkApp(app: AppNode): void {
  const nameToPath = new Map<string, string>();
  for (const ds of app.datasources) {
    for (const ent of ds.entities) {
      nameToPath.set(ent.name, `app.datasources.${ds.name}.entities.${ent.name}`);
    }
  }
  for (const s of app.structures) {
    nameToPath.set(s.name, `app.structures.${s.name}`);
  }
  for (const en of app.enums) {
    nameToPath.set(en.name, `app.enums.${en.name}`);
  }

  const linkTypeRef = (tr: TypeRef): void => {
    if (tr.kind === 'reference') {
      const full = nameToPath.get(tr.path);
      if (!full) {
        throw new TdslSyntaxError(`cannot resolve type '${tr.path}'`, 0, 0);
      }
      tr.path = full;
    } else if (tr.kind === 'generic') {
      tr.args.forEach(linkTypeRef);
    }
  };

  for (const ds of app.datasources) {
    for (const ent of ds.entities) {
      ent.properties.forEach((p) => linkTypeRef(p.type));
    }
  }
  for (const s of app.structures) {
    s.properties.forEach((p) => linkTypeRef(p.type));
  }
  for (const l of app.logics) {
    l.params.forEach((p) => linkTypeRef(p.type));
    l.returns.forEach((r) => linkTypeRef(r.type));
    linkStatements(l.body);
  }

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