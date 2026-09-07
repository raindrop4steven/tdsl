import type { Expr } from './expr';
import type { Statement } from './statement';
import type { TypeRef } from './typeref';

/** 所有语义节点的基类：kind 判别标签 + 全局唯一 id */
export interface BaseNode {
  kind: string;
  id: string;
  annotations?: Annotation[];
}

/** 语义性注解（区别于编辑器 UI 元信息） */
export interface Annotation {
  kind: 'Annotation';
  name: string;
  args?: Record<string, unknown>;
}

/** 应用根：语义树聚合点 */
export interface AppNode extends BaseNode {
  kind: 'App';
  name: string;
  datasources: DataSourceNode[];
  structures: StructureNode[];
  enums: EnumNode[];
  logics: LogicNode[];
}

/** 数据源：聚合实体 */
export interface DataSourceNode extends BaseNode {
  kind: 'DataSource';
  name: string;
  entities: EntityNode[];
}

/** 实体：后端持久化模型 */
export interface EntityNode extends BaseNode {
  kind: 'Entity';
  name: string;
  table?: string;
  properties: EntityPropertyNode[];
}

export interface EntityPropertyNode extends BaseNode {
  kind: 'EntityProperty';
  name: string;
  label?: string;
  type: TypeRef;
  primary?: boolean;
  nullable?: boolean;
  unique?: boolean;
}

/** 结构：DTO / 嵌套结构 */
export interface StructureNode extends BaseNode {
  kind: 'Structure';
  name: string;
  properties: StructurePropertyNode[];
}

export interface StructurePropertyNode extends BaseNode {
  kind: 'StructureProperty';
  name: string;
  type: TypeRef;
}

/** 枚举 */
export interface EnumNode extends BaseNode {
  kind: 'Enum';
  name: string;
  items: EnumItemNode[];
}

export interface EnumItemNode extends BaseNode {
  kind: 'EnumItem';
  name: string;
}

/** 逻辑：后端业务方法（body 为小语言语句序列） */
export interface LogicNode extends BaseNode {
  kind: 'Logic';
  name: string;
  params: ParamNode[];
  returns: ReturnNode[];
  body: Statement[];
}

export interface ParamNode extends BaseNode {
  kind: 'Param';
  name: string;
  type: TypeRef;
}

export interface ReturnNode extends BaseNode {
  kind: 'Return';
  name?: string;
  type: TypeRef;
}

export type AnyNode =
  | AppNode
  | DataSourceNode
  | EntityNode
  | EntityPropertyNode
  | StructureNode
  | StructurePropertyNode
  | EnumNode
  | EnumItemNode
  | LogicNode
  | ParamNode
  | ReturnNode;

export type NodeKind = AnyNode['kind'];

/** codegen 统一产出 */
export interface GeneratedFile {
  path: string;
  content: string;
}

export type { Expr, LiteralExpr } from './expr';
export type { Statement } from './statement';
export type { TypeRef, BuiltinType } from './typeref';