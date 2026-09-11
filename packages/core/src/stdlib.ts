/**
 * Java FFI 目录（dev/27）：Java 一等公民的内核数据。
 * 机制：目录 = dump 工具（javap/反射）产物人工收窄后的精选集（版本化资产，非全量）。
 * 规则：成员模板"有 java 才能后端调、有 js 才能前端调"；双模板成员两端各译。
 * 目录缺失时的诊断必须附带补录口径（dsl bundle-jar）。
 * 消费者：typecheck 成员存在性解析（M3 resolver v1——能解则解、不解放行）。
 */
export type FfiParamType =
  | 'String' | 'Integer' | 'Decimal' | 'Boolean' | 'Date' | 'DateTime' | 'Time'
  | 'List' | 'Object';

export interface FfiMethod {
  name: string;
  static?: boolean;
  params: FfiParamType[];
  ret: FfiParamType;
  /** java 模板：{recv} {0} {1} 占位；缺省 = {recv}.{name}({args}) 直发 */
  java?: string;
  /** js 模板；缺省 = 无 js 侧（backend-only） */
  js?: string;
}

export interface FfiClass {
  /** 全限定名（codegen-java 用） */
  class: string;
  /** TDSL 语义核别名（原始类型名或 List） */
  alias: string;
  /** 该类是否默认前端可用（个别成员日后可覆盖） */
  frontend?: boolean;
  members: FfiMethod[];
}

/** java.lang.String：双端同构直发（js 少数字段名不同） */
const STRING_MEMBERS: FfiMethod[] = [
  { name: 'trim', params: [], ret: 'String' },
  { name: 'toUpperCase', params: [], ret: 'String' },
  { name: 'toLowerCase', params: [], ret: 'String' },
  { name: 'contains', params: ['String'], ret: 'Boolean', js: '{recv}.includes({0})' },
  { name: 'startsWith', params: ['String'], ret: 'Boolean' },
  { name: 'endsWith', params: ['String'], ret: 'Boolean' },
  { name: 'replace', params: ['String', 'String'], ret: 'String', js: '{recv}.replaceAll({0}, {1})' },
  { name: 'substring', params: ['Integer', 'Integer'], ret: 'String', js: '{recv}.slice({0}, {1})' },
  { name: 'indexOf', params: ['String'], ret: 'Integer' },
  { name: 'isEmpty', params: [], ret: 'Boolean', js: '{recv}.length === 0' },
  { name: 'length', params: [], ret: 'Integer', java: '{recv}.length()', js: '{recv}.length' },
];

/** java.math.BigDecimal：backend-only（前端走 number 算术） */
const DECIMAL_MEMBERS: FfiMethod[] = [
  { name: 'add', params: ['Decimal'], ret: 'Decimal' },
  { name: 'subtract', params: ['Decimal'], ret: 'Decimal' },
  { name: 'multiply', params: ['Decimal'], ret: 'Decimal' },
  { name: 'abs', params: [], ret: 'Decimal' },
  { name: 'min', params: ['Decimal'], ret: 'Decimal' },
  { name: 'max', params: ['Decimal'], ret: 'Decimal' },
];

/** java.time.LocalDate / LocalDateTime：backend-only */
const DATE_MEMBERS: FfiMethod[] = [
  { name: 'now', static: true, params: [], ret: 'Date', java: 'java.time.LocalDate.now()' },
  { name: 'plusDays', params: ['Integer'], ret: 'Date' },
  { name: 'minusDays', params: ['Integer'], ret: 'Date' },
  { name: 'isBefore', params: ['Date'], ret: 'Boolean' },
  { name: 'isAfter', params: ['Date'], ret: 'Boolean' },
  { name: 'getYear', params: [], ret: 'Integer' },
];

const DATETIME_MEMBERS: FfiMethod[] = [
  { name: 'now', static: true, params: [], ret: 'DateTime', java: 'java.time.LocalDateTime.now()' },
  { name: 'plusDays', params: ['Integer'], ret: 'DateTime' },
  { name: 'minusDays', params: ['Integer'], ret: 'DateTime' },
  { name: 'plusHours', params: ['Integer'], ret: 'DateTime' },
  { name: 'isBefore', params: ['DateTime'], ret: 'Boolean' },
  { name: 'isAfter', params: ['DateTime'], ret: 'Boolean' },
];

/** java.util.List：双端（前端数组原生映射） */
const LIST_MEMBERS: FfiMethod[] = [
  { name: 'add', params: ['Object'], ret: 'Boolean', js: '{recv}.push({0})' },
  { name: 'size', params: [], ret: 'Integer', java: '{recv}.size()', js: '{recv}.length' },
  { name: 'count', params: [], ret: 'Integer', java: '{recv}.size()', js: '{recv}.length' },  // TDSL .count 语义糖别名
  { name: 'contains', params: ['Object'], ret: 'Boolean', js: '{recv}.includes({0})' },
  { name: 'isEmpty', params: [], ret: 'Boolean', js: '{recv}.length === 0' },
  { name: 'get', params: ['Integer'], ret: 'Object', java: '{recv}.get({0})', js: '{recv}[{0}]' },
];

export const FFI_CATALOG: FfiClass[] = [
  { class: 'java.lang.String', alias: 'String', frontend: true, members: STRING_MEMBERS },
  { class: 'java.math.BigDecimal', alias: 'Decimal', members: DECIMAL_MEMBERS },
  { class: 'java.time.LocalDate', alias: 'Date', members: DATE_MEMBERS },
  { class: 'java.time.LocalDateTime', alias: 'DateTime', members: DATETIME_MEMBERS },
  { class: 'java.util.List', alias: 'List', frontend: true, members: LIST_MEMBERS },
];

/** TDSL 语义核别名 → FFI 类 */
export function ffiByAlias(alias: string): FfiClass | undefined {
  return FFI_CATALOG.find((c) => c.alias === alias);
}

export function ffiMember(c: FfiClass, name: string): FfiMethod | undefined {
  return c.members.find((m) => m.name === name);
}
