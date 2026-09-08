import type { TypeRef } from './typeref';

export type LiteralExpr =
  | { kind: 'Bool'; value: boolean }
  | { kind: 'Numeric'; value: number }
  | { kind: 'String'; value: string }
  | { kind: 'Null' };

/** 小表达式语言（书写面 parse 之后的语义节点） */
export type Expr =
  | { kind: 'Ident'; name: string }
  | { kind: 'Member'; obj: Expr; prop: string }
  | { kind: 'Call'; callee: Expr; args: Expr[] }
  | { kind: 'New'; type: TypeRef; args: Expr[] }
  | { kind: 'NewList'; elem: TypeRef; items: Expr[] }
  | LiteralExpr
  | {
      kind: 'Binary';
      operator:
        | '==='
        | '!=='
        | '&&'
        | '||'
        | '+'
        | '-'
        | '*'
        | '/'
        | '<'
        | '<='
        | '>'
        | '>='
        | '=';
      left: Expr;
      right: Expr;
    }
  | { kind: 'Group'; expr: Expr };