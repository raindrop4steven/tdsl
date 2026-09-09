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
  interfaces: InterfaceNode[];
  views: ViewNode[];
  services: ServiceNode[];
  components: ComponentNode[];
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

/** 接口：REST 契约，聚合端点 */
export interface InterfaceNode extends BaseNode {
  kind: 'Interface';
  name: string;
  endpoints: EndpointNode[];
}

/** 端点：一个 REST 方法，绑定到某个 Logic */
export interface EndpointNode extends BaseNode {
  kind: 'Endpoint';
  name: string;                       // 方法名（可由 logicRef 派生）
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;                       // 如 /api/todos、/api/todos/{id}
  logicRef?: string;                  // 绑定的 Logic nodePath
}

/** 页面/视图：前端页面声明（page 关键字 → ViewNode） */
export interface ViewNode extends BaseNode {
  kind: 'View';
  name: string;
  viewKind: 'page' | 'dialog' | 'block';   // 本切面先支持 page
  elements: ViewElementNode[];
}

/** 页面元素：组件树节点 */
export interface ViewElementNode extends BaseNode {
  kind: 'ViewElement';
  type: string;                            // 'table'|'column'|'button'|'form'|'input'|'repeat'|'text'|'detail'
  props: Record<string, Expr | string>;    // field/value/action/submit/dataSource 等
  bindings: BindingNode[];                 // useQuery/useMutation/navigate 提取后的绑定
  children: ViewElementNode[];
}

/** 数据绑定：页面元素与 logic/页面 的连接 */
export interface BindingNode extends BaseNode {
  kind: 'Binding';
  name: string;                            // 'useQuery'|'useMutation'|'navigate'
  target: string;                          // logic 短名（link 后 nodePath）/ 页面名
  args: Expr[];
}

/** 外部服务：dubbo/bean/http 三种 kind，logic 内可像本地方法调用 */
export interface ServiceNode extends BaseNode {
  kind: 'Service';
  name: string;
  kind_: 'dubbo' | 'bean' | 'http';
  /** dubbo: group/version；bean: bean/jar；http: baseUrl/timeout */
  config: Record<string, string>;
  operations: ServiceOperationNode[];
}

/** 外部服务操作：与 Logic 签名同构；http 形态带 method + path */
export interface ServiceOperationNode extends BaseNode {
  kind: 'ServiceOperation';
  name: string;
  params: ParamNode[];
  returns: ReturnNode[];
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path?: string;
}

/** 第三方前端组件注册：pkg npm 包名，ViewElement.type 引用 */
export interface ComponentNode extends BaseNode {
  kind: 'Component';
  name: string;
  pkg: string;
  defaultProps: string[];
  events: string[];
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
  | ReturnNode
  | InterfaceNode
  | EndpointNode
  | ViewNode
  | ViewElementNode
  | BindingNode
  | ServiceNode
  | ServiceOperationNode
  | ComponentNode;

export type NodeKind = AnyNode['kind'];

/** codegen 统一产出 */
export interface GeneratedFile {
  path: string;
  content: string;
}

export type { Expr, LiteralExpr } from './expr';
export type { Statement } from './statement';
export type { TypeRef, BuiltinType } from './typeref';