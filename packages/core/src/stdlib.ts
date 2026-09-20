/**
 * Java FFI 内核目录（dev/27/32）：语言自有域的成员表（语义核类型定义的一部分）。
 * 边界（dev/32）：本文件只收语言自有五域（String/Decimal/Date/DateTime/List）；
 * 一切带 Maven/npm 坐标的第三方类一律外置到工程 libs/ 产物，经 createCatalog 合并装载。
 * 规则：成员模板"有 java 才能后端调、有 js 才能前端调"；双模板成员两端各译。
 * 目录缺失时的诊断必须附带补录口径（tdsl bundle-jar）。
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
  /** Maven 坐标 groupId:artifactId:version —— 目录驱动的 pom 依赖注入 */
  maven?: string;
  /** TDSL 语义核别名（原始类型名或 List） */
  alias: string;
  /** 该类是否默认前端可用（个别成员日后可覆盖） */
  frontend?: boolean;
  /** 平台内置域（如 Auth）：成员模板全限定自洽，import 收集必须跳过（类不存在于产物包） */
  internal?: boolean;
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
  { name: 'now', static: true, params: [], ret: 'DateTime', java: 'java.time.ZonedDateTime.now()' },
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

/**
 * 平台鉴权域（M11，dev/51 §2.2）：密码哈希的平台自有原语（backend-only）。
 * 地位同 String.trim —— 平台自宿主能力，非第三方坐标（无 maven 字段 → 不触发 pom 注入）；
 * java 模板指向生成器产出的 ${pkg}.support.PasswordUtil（codegen-java 在 app.auth 存在时生成）。
 */
const AUTH_MEMBERS: FfiMethod[] = [
  { name: 'hash', static: true, params: ['String', 'String'], ret: 'String', java: '__PKG__.support.PasswordUtil.hash({0}, {1})' },
  { name: 'matches', static: true, params: ['String', 'String', 'String'], ret: 'Boolean', java: '__PKG__.support.PasswordUtil.matches({0}, {1}, {2})' },
];

export const FFI_CORE: FfiClass[] = [
  { class: 'java.lang.String', alias: 'String', frontend: true, members: STRING_MEMBERS },
  { class: 'java.math.BigDecimal', alias: 'Decimal', members: DECIMAL_MEMBERS },
  { class: 'java.time.LocalDate', alias: 'Date', members: DATE_MEMBERS },
  { class: 'java.time.LocalDateTime', alias: 'DateTime', members: DATETIME_MEMBERS },
  { class: 'java.util.List', alias: 'List', frontend: true, members: LIST_MEMBERS },
  { class: 'tdsl.auth.Auth', alias: 'Auth', internal: true, members: AUTH_MEMBERS },
];

/** 依赖声明坐标（java: g:a:v；npm: name@range 的规整形式） */
export function depCoordinate(d: { name: string; version?: string }): string {
  return d.version ? `${d.name}:${d.version}` : `${d.name}:*`;
}

/** 依赖声明是否命中某产物坐标（按 name 段匹配、版本通配——版本比对归 D-dep-3 诊断） */
export function depMatches(d: { eco: string; name: string; version?: string }, coordinate: string): boolean {
  const sep = d.eco === 'npm' ? '@' : ':';
  return coordinate === d.name || coordinate.startsWith(`${d.name}${sep}`);
}

/** 工程侧扫描产物（bundle-jar / 未来 npm d.ts 投影）：自带坐标头 */
export interface LoadedCatalog {
  /** 来源文件（诊断定位用） */
  file?: string;
  eco: 'java' | 'npm';
  /** Maven 坐标 g:a:v 或 npm 包名@版本 */
  coordinate: string;
  classes: FfiClass[];
}

/** alias 撞车记录（D-dep-4 诊断素材） */
export interface CatalogCollision {
  alias: string;
  coordinates: string[];
}

/** 有效目录：内核五域 ∪ 声明依赖的产物类（alias 全局唯一不变式，见 dev/32 §2.7） */
export interface EffectiveCatalog {
  /** 裸 alias 唯一命中；零命中或多命中返回 undefined（多命中走 hitsOf + collisions 报错） */
  byAlias(alias: string): FfiClass | undefined;
  /** ns.Alias 限定命中（dependency ... as <ns>） */
  byQualified(ns: string, alias: string): FfiClass | undefined;
  /** 某裸 alias 的全部命中（歧义诊断用） */
  hitsOf(alias: string): FfiClass[];
  member(c: FfiClass, name: string): FfiMethod | undefined;
  collisions: CatalogCollision[];
}

/**
 * 合并内核目录与工程产物为有效目录（纯函数）。
 * - 产物类补 maven 坐标（java eco；来自产物头 coordinate）
 * - as <ns> 的依赖：其产物类进 ns 限定索引，不占裸 alias
 * - alias 冲突只记录不丢弃（诊断权在 typecheck）
 */
export function createCatalog(loaded: LoadedCatalog[], deps: { eco: string; name: string; version?: string; ns?: string }[]): EffectiveCatalog {
  const nsOf = new Map<string, string>();
  for (const d of deps) {
    if (!d.ns) continue;
    for (const lc of loaded) {
      if (lc.eco === d.eco && depMatches(d, lc.coordinate)) nsOf.set(lc.coordinate, d.ns);
    }
  }
  const all: FfiClass[] = FFI_CORE.map((c) => ({ ...c }));
  const hits = new Map<string, FfiClass[]>();
  const nsIndex = new Map<string, Map<string, FfiClass>>();
  const push = (c: FfiClass, coordinate: string | undefined, ns: string | undefined): void => {
    const entry = coordinate ? { ...c, maven: c.maven ?? coordinate } : c;
    if (ns) {
      let m = nsIndex.get(ns);
      if (!m) { m = new Map(); nsIndex.set(ns, m); }
      if (!m.has(c.alias)) m.set(c.alias, entry);
      return;
    }
    const list = hits.get(c.alias) ?? [];
    list.push(entry);
    hits.set(c.alias, list);
  };
  for (const core of all) push(core, undefined, undefined);
  for (const lc of loaded) {
    const ns = nsOf.get(lc.coordinate);
    for (const c of lc.classes) push(c, lc.eco === 'java' ? lc.coordinate : undefined, ns);
  }
  const collisions: CatalogCollision[] = [];
  for (const [alias, list] of hits) {
    if (list.length > 1) {
      collisions.push({
        alias,
        coordinates: [...new Set(list.map((c) => c.maven).filter((m): m is string => !!m))],
      });
    }
  }
  return {
    byAlias(alias) {
      const list = hits.get(alias);
      return list && list.length === 1 ? list[0] : undefined;
    },
    byQualified(ns, alias) {
      return nsIndex.get(ns)?.get(alias);
    },
    hitsOf(alias) {
      return hits.get(alias) ?? [];
    },
    member: ffiMember,
    collisions,
  };
}

/** TDSL 语义核别名 → FFI 类（内核五域；工程第三方走 createCatalog） */
export function ffiByAlias(alias: string): FfiClass | undefined {
  return FFI_CORE.find((c) => c.alias === alias);
}

export function ffiMember(c: FfiClass, name: string): FfiMethod | undefined {
  return c.members.find((m) => m.name === name);
}
