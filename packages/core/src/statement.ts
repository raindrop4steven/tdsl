import type { Expr } from './expr';
import type { TypeRef } from './typeref';

/** 小语言语句（书写面 parse 之后的语义节点） */
export type Statement =
  | { kind: 'VarDecl'; name: string; type?: TypeRef; init?: Expr }
  | { kind: 'Assign'; target: Expr; value: Expr }
  | { kind: 'Return'; value?: Expr }
  | { kind: 'If'; cond: Expr; then: Statement[]; else?: Statement[] }
  | { kind: 'ForEach'; item: string; container: Expr; body: Statement[] }
  | { kind: 'CallStmt'; call: Expr };