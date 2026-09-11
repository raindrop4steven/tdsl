import {
  createVarScope,
  lookupVar,
  type AppNode,
  type EndpointNode,
  type EntityNode,
  type EnumNode,
  type Expr,
  type GeneratedFile,
  type InterfaceNode,
  type LogicNode,
  type ServiceNode,
  type Statement,
  type StructureNode,
  type VarScope,
} from '@tdsl/core';
import { cap, javaType, typeNameFromPath } from './type-map';

/** app 名转包名：com.<name>；必须为合法 Java 标识符（M7 app 名参数化后防御） */
function pkgOf(app: AppNode): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(app.name)) {
    throw new Error(
      `app name '${app.name}' is not a valid Java identifier: it is used as package name 'com.${app.name}'`,
    );
  }
  return `com.${app.name}`;
}

/** 实体名 → repository 变量名（如 Todo → todoRepository） */
function repoVar(ent: EntityNode): string {
  return `${ent.name.charAt(0).toLowerCase()}${ent.name.slice(1)}Repository`;
}

/** 查找引用 X.all / X.get 的实体名 */
/** 实体短名/限定名 → 实体名（erp.Order → Order；Order → Order；非实体返回 null） */
function entityNameOfIdent(app: AppNode, name: string): string | null {
  const ent = findEntityByName(app, name);
  return ent ? ent.name : null;
}

/** 实体查询接收者表达式 → 实体名（Ident('Order') → 'Order'；Member(Ident('erp'),'Order') 且 erp 是数据源 → 'erp.Order'；非实体返回 null） */
function entityNameOfReceiver(app: AppNode, e: Expr): string | null {
  if (e.kind === 'Ident') return entityNameOfIdent(app, e.name);
  if (e.kind === 'Member' && e.obj.kind === 'Ident') {
    // 限定名：仅当左段是数据源名才解析为 ds.Entity
    const qname = `${e.obj.name}.${e.prop}`;
    const ent = findEntityByName(app, qname);
    if (ent) return qname;
    return null;
  }
  return null;
}

/** 查找引用 X.all 的实体 */
function findEntityForAll(app: AppNode, all: Expr): EntityNode | null {
  if (all.kind !== 'Member' || all.prop !== 'all') return null;
  const name = entityNameOfReceiver(app, all.obj);
  return name ? findEntityByName(app, name) : null;
}

/** 按短名或限定名（erp.Order）查找实体 */
function findEntityByName(app: AppNode, name: string): EntityNode | null {
  if (name.includes('.')) {
    const dot = name.indexOf('.');
    const dsName = name.slice(0, dot);
    const entName = name.slice(dot + 1);
    const ds = app.datasources.find((d) => d.name === dsName);
    return ds?.entities.find((e) => e.name === entName) ?? null;
  }
  const hits = app.datasources.flatMap((ds) => ds.entities).filter((e) => e.name === name);
  return hits.length === 1 ? hits[0] : null;
}

/** Java 值类型（primitive 包装 / 集合 / var），无字段访问 */
function isValueType(jsType: string): boolean {
  return (
    jsType === 'var' ||
    jsType.startsWith('java.util.List') ||
    jsType.startsWith('java.util.Map') ||
    ['Boolean', 'Long', 'Integer', 'String', 'boolean', 'long', 'int', 'java.math.BigDecimal',
      'java.time.LocalDate', 'java.time.LocalTime', 'java.time.ZonedDateTime'].includes(jsType)
  );
}

/** 遍历逻辑体内所有被引用的实体（ForEach 容器 / Todo.get / entity.save / entity.delete） */
function collectUsedEntities(app: AppNode, logic: LogicNode): Map<string, EntityNode> {
  const used = new Map<string, EntityNode>();
  // 变量名 → 实体名（跟踪 new X() / X.get() 的变量类型）
  const entityVars = new Map<string, string>();
  const add = (name: string): void => {
    const ent = findEntityByName(app, name);
    if (ent) used.set(name, ent);
  };

  const scanExpr = (e: Expr, isStmt?: boolean): void => {
    switch (e.kind) {
      case 'Call': {
        const callee = e.callee;
        if (callee.kind === 'Member') {
          // 实体查询链（where 多条件 / orderBy / page / limit / groupBy / aggregate）→ 收集实体
          const spec = querySpecOf(app, e);
          if (spec) {
            const sent = findEntityByName(app, spec.entity);
            if (sent) add(spec.entity);
          }
          // Todo.get(id) / Todo.all / Todo.where(...) / erp.Order.all —— 静态实体调用
          const entName = entityNameOfReceiver(app, callee.obj);
          if (entName && (callee.prop === 'get' || callee.prop === 'all' || callee.prop === 'where')) {
            add(entName);
          }
          // entity.save() / entity.delete() —— 实例方法（接收者是实体变量）
          if (callee.obj.kind === 'Ident') {
            const recvEnt = entityVars.get(callee.obj.name);
            if (recvEnt && (callee.prop === 'save' || callee.prop === 'delete')) add(recvEnt);
          }
        }
        e.args.forEach((a) => scanExpr(a));
        break;
      }
      case 'Member': {
        // 实体静态 X.all / erp.Order.all → 收集该实体（接收者是 e.obj）
        const entName = entityNameOfReceiver(app, e.obj);
        if (entName && e.prop === 'all') add(entName);
        scanExpr(e.obj);
        break;
      }
      case 'New':
        e.args.forEach((a) => scanExpr(a));
        break;
      case 'NewList':
        e.items.forEach((a) => scanExpr(a));
        break;
      case 'Binary':
        scanExpr(e.left);
        scanExpr(e.right);
        break;
      case 'Group':
        scanExpr(e.expr);
        break;
      case 'Ident':
      case 'Bool':
      case 'Numeric':
      case 'String':
      case 'Null':
        break;
    }
  };

  const scanStmt = (st: Statement): void => {
    switch (st.kind) {
      case 'VarDecl':
        if (st.init) {
          scanExpr(st.init);
          // 变量类型跟踪：new X() / X.get() → 实体
          const init = st.init;
          if (init.kind === 'New' && init.type.kind === 'reference') {
            entityVars.set(st.name, entityNameOfIdent(app, init.type.path.split('.').pop() ?? '') ?? '');
          } else if (
            init.kind === 'Call' &&
            init.callee.kind === 'Member' &&
            init.callee.obj.kind === 'Ident' &&
            init.callee.prop === 'get'
          ) {
            entityVars.set(st.name, init.callee.obj.name);
          }
        }
        break;
      case 'Assign':
        scanExpr(st.target);
        scanExpr(st.value);
        break;
      case 'Return':
        if (st.value) scanExpr(st.value);
        break;
      case 'If':
        scanExpr(st.cond);
        st.then.forEach(scanStmt);
        if (st.else) st.else.forEach(scanStmt);
        break;
      case 'ForEach': {
        scanExpr(st.container);
        const ent = findEntityForAll(app, st.container);
        if (ent) {
          used.set(ent.name, ent);
          entityVars.set(st.item, ent.name);
        }
        st.body.forEach(scanStmt);
        break;
      }
      case 'CallStmt':
        scanExpr(st.call);
        break;
    }
  };

  logic.body.forEach(scanStmt);
  return used;
}

/** 外部服务变量名：UserService → userService（logic 内调用接收者） */
function serviceVarName(s: ServiceNode): string {
  return s.name.charAt(0).toLowerCase() + s.name.slice(1);
}

/** 遍历逻辑体内被调用的外部服务（userService.getUser(...) 接收者是 service 变量名） */
function collectUsedServices(app: AppNode, logic: LogicNode): ServiceNode[] {
  const used = new Map<string, ServiceNode>();
  const scanExpr = (e: Expr): void => {
    switch (e.kind) {
      case 'Call': {
        const callee = e.callee;
        if (callee.kind === 'Member' && callee.obj.kind === 'Ident') {
          const recvName = callee.obj.name;
          const svc = app.services.find((s) => serviceVarName(s) === recvName);
          if (svc) used.set(svc.name, svc);
        }
        e.args.forEach(scanExpr);
        break;
      }
      case 'Member':
        scanExpr(e.obj);
        break;
      case 'New':
        e.args.forEach(scanExpr);
        break;
      case 'NewList':
        e.items.forEach(scanExpr);
        break;
      case 'Binary':
        scanExpr(e.left);
        scanExpr(e.right);
        break;
      case 'Group':
        scanExpr(e.expr);
        break;
      case 'Ident':
      case 'Bool':
      case 'Numeric':
      case 'String':
      case 'Null':
        break;
    }
  };
  forEachStmt(logic.body, (st) => {
    switch (st.kind) {
      case 'VarDecl':
        if (st.init) scanExpr(st.init);
        break;
      case 'Assign':
        scanExpr(st.target);
        scanExpr(st.value);
        break;
      case 'Return':
        if (st.value) scanExpr(st.value);
        break;
      case 'If':
        scanExpr(st.cond);
        break;
      case 'ForEach':
        scanExpr(st.container);
        break;
      case 'CallStmt':
        scanExpr(st.call);
        break;
    }
  });
  return [...used.values()];
}

/** 生成完整 Spring Boot 工程文件列表 */
export function generateJava(app: AppNode): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const pkg = pkgOf(app);
  const entities = app.datasources.flatMap((ds) => ds.entities);
  const querySpecs = collectQuerySpecs(app);

  files.push(...scaffoldFiles(app));
  // 枚举类（实体/结构体/Controller 可能引用，先于实体生成）
  for (const en of app.enums) {
    files.push(enumFile(pkg, en));
  }
  for (const ent of entities) {
    files.push(entityFile(pkg, ent, app.enums.length > 0));
    files.push(repositoryFile(pkg, ent, querySpecs.get(ent.name) ?? [], app.enums.length > 0));
  }
  for (const s of app.structures) {
    files.push(structureFile(app, s));
  }
  for (const svc of app.services) {
    files.push(serviceApiFile(pkg, svc));
  }
  for (const logic of app.logics) {
    files.push(serviceFile(app, logic));
  }
  for (const itf of app.interfaces) {
    files.push(controllerFile(app, itf));
  }
  files.push(tdslErrorFile(pkg));
  files.push(tdslAdviceFile(pkg));
  return files;
}

/** TDSL enum → Java enum（独立 enums 子包，各生成文件以 wildcard import 引用） */
function enumFile(pkg: string, en: EnumNode): GeneratedFile {
  // label：Java enum 恒带 label 字段（无 TDSL 标签时退化为枚举名），供后端显示/接口字典使用
  const items = en.items.map((i) => `  ${i.name}("${i.label ?? i.name}"),`).join('\n');
  return {
    path: `src/main/java/${pkg.replaceAll('.', '/')}/enums/${en.name}.java`,
    content: `package ${pkg}.enums;

// TDSL enum：${en.name}
public enum ${en.name} {
${items}
;

  private final String label;

  ${en.name}(String label) {
    this.label = label;
  }

  public String getLabel() {
    return label;
  }
}
`,
  };
}

// ---------- External Service → Dubbo/Bean/Feign 接口 ----------

/** 外部服务接口文件：dubbo/bean 生成普通接口；http 生成 @FeignClient 接口 */
function serviceApiFile(pkg: string, svc: ServiceNode): GeneratedFile {
  const methods = svc.operations
    .map((op) => {
      const params = op.params.map((p) => `${javaType(p.type)} ${p.name}`).join(', ');
      const ret = op.returns[0] ? javaType(op.returns[0].type) : 'void';
      if (svc.kind_ === 'http') {
        const ann = HTTP_ANNOTATION[op.method ?? 'GET'];
        return `  @${ann}("${op.path}")\n  ${ret} ${op.name}(${params});`;
      }
      return `  ${ret} ${op.name}(${params});`;
    })
    .join('\n\n');

  if (svc.kind_ === 'http') {
    const name = svc.config['name'] ?? svc.name.toLowerCase();
    const url = svc.config['baseUrl'] ?? '';
    const content = `package ${pkg}.service.api;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

@FeignClient(name = "${name}", url = "${url}")
public interface ${svc.name} {

${methods}
}
`;
    return { path: `src/main/java/${pkg.replaceAll('.', '/')}/service/api/${svc.name}.java`, content };
  }

  const content = `package ${pkg}.service.api;

public interface ${svc.name} {

${methods}
}
`;
  return { path: `src/main/java/${pkg.replaceAll('.', '/')}/service/api/${svc.name}.java`, content };
}

// ---------- Structure → POJO ----------

function structureFile(app: AppNode, s: StructureNode): GeneratedFile {
  const pkg = pkgOf(app);
  const fields = s.properties
    .map((p) => `  private ${javaType(p.type)} ${p.name};`)
    .join('\n');
  const gettersSetters = s.properties
    .map((p) => {
      const C = cap(p.name);
      const t = javaType(p.type);
      return `  public ${t} get${C}() { return ${p.name}; }

  public void set${C}(${t} ${p.name}) { this.${p.name} = ${p.name}; }`;
    })
    .join('\n\n');
  // 结构字段引用实体类型（reference → entity）时补 entity import
  const entityNames = app.datasources.flatMap((ds) => ds.entities).map((e) => e.name);
  const referencesEntity = s.properties.some((p) => {
    const t = p.type;
    if (t.kind === 'reference') return entityNames.includes(t.path.split('.').pop() ?? '');
    if (t.kind === 'generic') {
      return t.args.some((a) => a.kind === 'reference' && entityNames.includes(a.path.split('.').pop() ?? ''));
    }
    return false;
  });
  const content = `package ${pkg}.structure;

${s.properties.length > 0 ? 'import java.util.*;\n' : ''}${referencesEntity ? `import ${pkg}.entity.*;\n` : ''}${enumsImport(pkg, app.enums.length > 0)}public class ${s.name} {

${fields}

  public ${s.name}() {
  }

${gettersSetters}
}
`;
  return {
    path: `src/main/java/${pkg.replaceAll('.', '/')}/structure/${s.name}.java`,
    content,
  };
}

// ---------- 工程脚手架 ----------

function scaffoldFiles(app: AppNode): GeneratedFile[] {
  const pkg = pkgOf(app);

  // 外部服务依赖：dubbo → dubbo starter；bean(jar) → jar 坐标；http → openfeign
  const serviceDeps = app.services
    .map((svc) => {
      if (svc.kind_ === 'dubbo') {
        return `    <dependency>
      <groupId>org.apache.dubbo</groupId>
      <artifactId>dubbo-spring-boot-starter</artifactId>
      <version>2.7.23</version>
    </dependency>`;
      }
      if (svc.kind_ === 'bean' && svc.config['jar']) {
        const [g, a, v] = svc.config['jar'].split(':');
        return `    <dependency>
      <groupId>${g}</groupId>
      <artifactId>${a}</artifactId>
      <version>${v}</version>
    </dependency>`;
      }
      if (svc.kind_ === 'http') {
        return `    <dependency>
      <groupId>org.springframework.cloud</groupId>
      <artifactId>spring-cloud-starter-openfeign</artifactId>
      <version>3.1.8</version>
    </dependency>`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');

  return [
    {
      path: 'pom.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>2.7.18</version>
    <relativePath/>
  </parent>
  <groupId>com.${app.name}</groupId>
  <artifactId>${app.name}-app</artifactId>
  <version>0.0.1-SNAPSHOT</version>
  <properties>
    <java.version>17</java.version>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-data-jpa</artifactId>
    </dependency>
    <dependency>
      <groupId>com.h2database</groupId>
      <artifactId>h2</artifactId>
      <scope>runtime</scope>
    </dependency>
${serviceDeps}
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>
`,
    },
    {
      path: `src/main/java/${pkg.replaceAll('.', '/')}/${cap(app.name)}Application.java`,
      content: `package ${pkg};

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class ${cap(app.name)}Application {

  public static void main(String[] args) {
    SpringApplication.run(${cap(app.name)}Application.class, args);
  }
}
`,
    },
    {
      // 运行探针（M10 runner 启动就绪检测用）
      path: `src/main/java/${pkg.replaceAll('.', '/')}/HealthController.java`,
      content: `package ${pkg};

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** 运行探针：runner 以 GET /healthz 判定后端就绪 */
@RestController
public class HealthController {

  @GetMapping("/healthz")
  public java.util.Map<String, Object> healthz() {
    return java.util.Map.of("ok", true);
  }
}
`,
    },
    {
      path: 'src/main/resources/application.yml',
      content: `server:
  port: \${TDSL_BACKEND_PORT:8080}
spring:
  datasource:
    url: jdbc:h2:mem:${app.name}
    driver-class-name: org.h2.Driver
  jpa:
    hibernate:
      ddl-auto: update
`,
    },
  ];
}

// ---------- Entity → JPA ----------

/** SQL 保留字（H2 等），实体名撞车时用引号包裹表名 */
const SQL_RESERVED = new Set([
  'order', 'group', 'user', 'key', 'value', 'select', 'from', 'where', 'table',
  'index', 'view', 'create', 'drop', 'alter', 'grant', 'union', 'all', 'and',
  'or', 'not', 'null', 'primary', 'foreign', 'join', 'left', 'right', 'inner',
  'full', 'on', 'as', 'by', 'to', 'in', 'is', 'like', 'between', 'exists',
]);

/** 表名：实体名撞 SQL 保留字 → 双引号包裹（H2 支持 quoted identifier），Java 字符串需转义 */
function tableNameOf(ent: EntityNode): string {
  const base = ent.table ?? ent.name.toLowerCase();
  return SQL_RESERVED.has(base) ? `\\"${base}\\"` : base;
}

function entityFile(pkg: string, ent: EntityNode, hasEnums: boolean): GeneratedFile {
  const className = ent.name;
  const table = tableNameOf(ent);
  const fields = ent.properties
    .map((p) => {
      const lines: string[] = [];
      if (p.primary) {
        lines.push('  @Id');
        lines.push('  @GeneratedValue(strategy = GenerationType.IDENTITY)');
      } else {
        // F11 修复（原判定反向）：@nullable → 列可空；未标记（必填语义）默认 Hibernate 可空列（写入约束由前端/服务校验兜底，避免存量 demo 插入崩）
        if (p.nullable === true) lines.push('  @Column(nullable = true)');
      }
      lines.push(`  private ${javaType(p.type)} ${p.name};`);
      return lines.join('\n');
    })
    .join('\n\n');

  const gettersSetters = ent.properties
    .map((p) => {
      const C = cap(p.name);
      const t = javaType(p.type);
      return `  public ${t} get${C}() { return ${p.name}; }

  public void set${C}(${t} ${p.name}) { this.${p.name} = ${p.name}; }`;
    })
    .join('\n\n');

  const content = `package ${pkg}.entity;

import javax.persistence.*;
${enumsImport(pkg, hasEnums)}@Entity
@Table(name = "${table}")
public class ${className} {

${fields}

  public ${className}() {
  }

${gettersSetters}
}
`;
  return { path: `src/main/java/${pkg.replaceAll('.', '/')}/entity/${className}.java`, content };
}

// ---------- Repository：每实体一个接口（含 where/链式/聚合查询） ----------

/** where 条件运算符（M2） */
type WhereOp = '=' | '>=' | '<=' | '>' | '<' | 'like' | 'in';

/** 条件值来源：param=逻辑参数变量；literal=数组字面量；other=其他表达式 */
type ValueKind = 'param' | 'literal' | 'other';

/** 查询规格：一个实体上的一种查询形态（条件集 + 排序 + 分页/聚合），去重后映射一个 Repository 方法 */
interface QuerySpec {
  entity: string;
  /** 展平条件（逗号/&& = AND；|| = OR，按树序展平） */
  conditions: Array<{
    field: string;
    op: WhereOp;
    value: Expr;
    valueKind: ValueKind;
    /** 与前一个条件的连接：'and'（逗号/&&）或 'or'（||） */
    connector: 'and' | 'or';
  }>;
  orderBy: Array<{ field: string; dir: 'asc' | 'desc' }>;
  pageable: boolean;
  limit?: number;
  aggregate?: { fn: 'sum' | 'avg' | 'max' | 'min' | 'count'; field?: string };
  groupBy?: string[];
}

/** 收集所有 logic 中实体查询形态 → 实体名 → QuerySpec 列表（去重） */
function collectQuerySpecs(app: AppNode): Map<string, QuerySpec[]> {
  const map = new Map<string, QuerySpec[]>();
  const add = (spec: QuerySpec): void => {
    const list = map.get(spec.entity) ?? [];
    // 去重键 = sameSpec 或「派生方法名 + 分页形态」相同：valueKind 等内部差异不影响生成方法名/签名，
    // 按细键去重会漏——同名方法重复声明 → javac 报重复定义（jxc 对拍发现）
    const ent = app.datasources.flatMap((ds) => ds.entities).find((e) => e.name === spec.entity);
    const collides = ent
      ? (s: QuerySpec) =>
          sameSpec(s, spec) ||
          (s.pageable === spec.pageable &&
            s.limit === spec.limit &&
            !s.aggregate &&
            !spec.aggregate &&
            derivedMethodName(ent, s) === derivedMethodName(ent, spec))
      : (s: QuerySpec) => sameSpec(s, spec);
    if (ent && !list.some(collides)) list.push(spec);
    map.set(spec.entity, list);
  };
  const scan = (e: Expr): void => {
    // 查询链整体收集一次：收集后不再递归 callee（链的内部节点已是本 spec 的一部分）
    const isChain = e.kind === 'Call' && querySpecOf(app, e) !== null;
    if (isChain) {
      const spec = querySpecOf(app, e);
      if (spec) add(spec);
      e.args.forEach(scan);
      return;
    }
    switch (e.kind) {
      case 'Call':
        scan(e.callee);
        e.args.forEach(scan);
        break;
      case 'Member':
        scan(e.obj);
        break;
      case 'New':
        e.args.forEach(scan);
        break;
      case 'NewList':
        e.items.forEach(scan);
        break;
      case 'Binary':
        scan(e.left);
        scan(e.right);
        break;
      case 'Group':
        scan(e.expr);
        break;
      default:
        break;
    }
  };
  for (const l of app.logics) {
    forEachStmt(l.body, (st) => {
      switch (st.kind) {
        case 'VarDecl':
          if (st.init) scan(st.init);
          break;
        case 'Assign':
          scan(st.target);
          scan(st.value);
          break;
        case 'Return':
          if (st.value) scan(st.value);
          break;
        case 'If':
          scan(st.cond);
          break;
        case 'ForEach':
          scan(st.container);
          break;
        case 'CallStmt':
          scan(st.call);
          break;
      }
    });
  }
  return map;
}

/** 两个 QuerySpec 是否等价（条件/排序/分页/聚合/分组完全一致） */
function sameSpec(a: QuerySpec, b: QuerySpec): boolean {
  if (a.entity !== b.entity || a.pageable !== b.pageable || a.limit !== b.limit) return false;
  if ((a.aggregate?.fn ?? '') !== (b.aggregate?.fn ?? '') || (a.aggregate?.field ?? '') !== (b.aggregate?.field ?? '')) return false;
  if (JSON.stringify(a.groupBy ?? []) !== JSON.stringify(b.groupBy ?? [])) return false;
  if (a.conditions.length !== b.conditions.length || a.orderBy.length !== b.orderBy.length) return false;
  for (let i = 0; i < a.conditions.length; i++) {
    const x = a.conditions[i];
    const y = b.conditions[i];
    if (x.field !== y.field || x.op !== y.op || x.connector !== y.connector || x.valueKind !== y.valueKind) return false;
  }
  for (let i = 0; i < a.orderBy.length; i++) {
    if (a.orderBy[i].field !== b.orderBy[i].field || a.orderBy[i].dir !== b.orderBy[i].dir) return false;
  }
  return true;
}

/** 从表达式提取实体查询规格（递归识别 where/aggregate 及链式 orderBy/page/limit/groupBy） */
function querySpecOf(app: AppNode, e: Expr): QuerySpec | null {
  if (e.kind !== 'Call' || e.callee.kind !== 'Member') return null;
  const m = e.callee;
  const entName = entityNameOfReceiver(app, m.obj);
  const ent = entName ? findEntityByName(app, entName) : null;
  if (ent && m.prop === 'where') {
    const conditions = extractConditions(app, ent, e.args);
    return { entity: ent.name, conditions, orderBy: [], pageable: false };
  }
  if (ent && m.prop === 'aggregate') {
    const agg = extractAggregate(app, ent, e.args);
    if (!agg) return null;
    return { entity: ent.name, conditions: [], orderBy: [], pageable: false, aggregate: agg };
  }
  // 链式方法：.orderBy / .page / .limit / .groupBy（接收者是查询调用或 X.all）
  if (m.prop === 'orderBy' || m.prop === 'page' || m.prop === 'limit' || m.prop === 'groupBy') {
    let base = querySpecOf(app, m.obj);
    if (!base && m.obj.kind === 'Member' && m.obj.prop === 'all') {
      // X.all.orderBy(...)/.page(...)：无条件的全量查询基座
      const allEnt = entityNameOfReceiver(app, m.obj.obj);
      if (allEnt) base = { entity: allEnt, conditions: [], orderBy: [], pageable: false };
    }
    if (!base) return null;
    const spec: QuerySpec = { ...base, orderBy: [...base.orderBy] };
    if (m.prop === 'orderBy') {
      spec.orderBy = extractOrderBy(e.args);
    } else if (m.prop === 'page') {
      spec.pageable = true;
      delete spec.limit;
    } else if (m.prop === 'limit') {
      spec.pageable = true;
      spec.limit = e.args[0]?.kind === 'Numeric' ? e.args[0].value : undefined;
    } else if (m.prop === 'groupBy') {
      spec.groupBy = e.args.filter((a) => a.kind === 'Ident').map((a) => (a as { name: string }).name);
    }
    return spec;
  }
  return null;
}

/** 从 where 参数提取条件列表（逗号/&& = AND；|| = OR，树序展平） */
function extractConditions(app: AppNode, ent: EntityNode, args: Expr[]): QuerySpec['conditions'] {
  const conds: QuerySpec['conditions'] = [];
  const fieldJavaType = (name: string): string => {
    const prop = ent.properties.find((p) => p.name === name);
    return prop ? javaType(prop.type) : 'String';
  };
  const visit = (c: Expr, connector: 'and' | 'or'): void => {
    if (c.kind === 'Binary' && (c.operator === '&&' || c.operator === '||')) {
      visit(c.left, c.operator === '&&' ? 'and' : 'or');
      visit(c.right, c.operator === '&&' ? 'and' : 'or');
    } else if (
      c.kind === 'Binary' &&
      (c.operator === '=' || c.operator === '>=' || c.operator === '<=' || c.operator === '>' || c.operator === '<' || c.operator === 'like' || c.operator === 'in') &&
      c.left.kind === 'Ident'
    ) {
      const field = c.left.name;
      const valueKind: ValueKind =
        c.operator === 'in'
          ? c.right.kind === 'NewList'
            ? 'literal'
            : c.right.kind === 'Ident'
              ? 'param'
              : 'other'
          : c.right.kind === 'Ident'
            ? 'param'
            : 'other';
      conds.push({ field, op: c.operator as WhereOp, value: c.right, valueKind, connector });
    }
  };
  args.forEach((a) => visit(a, 'and')); // 逗号分隔 = AND
  return conds;
}

/** 从 aggregate 参数提取聚合规格：sum(total) / count() */
function extractAggregate(app: AppNode, ent: EntityNode, args: Expr[]): QuerySpec['aggregate'] {
  const a = args[0];
  if (a?.kind !== 'Call' || a.callee.kind !== 'Ident') return undefined;
  const fn = a.callee.name;
  if (fn !== 'sum' && fn !== 'avg' && fn !== 'max' && fn !== 'min' && fn !== 'count') return undefined;
  const field = a.args[0]?.kind === 'Ident' ? a.args[0].name : undefined;
  if (!field && fn !== 'count') return undefined;
  return { fn, field };
}

/** 从 orderBy 参数提取排序：[field, 'asc'|'desc'|缺省, ...]（desc/asc 可能被 parser 解析为 Ident 参数） */
function extractOrderBy(args: Expr[]): Array<{ field: string; dir: 'asc' | 'desc' }> {
  const out: Array<{ field: string; dir: 'asc' | 'desc' }> = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.kind !== 'Ident') continue;
    const dirArg = args[i + 1];
    const dirName = dirArg?.kind === 'String' ? dirArg.value : dirArg?.kind === 'Ident' ? dirArg.name : undefined;
    const dir: 'asc' | 'desc' = dirName === 'desc' ? 'desc' : 'asc';
    out.push({ field: a.name, dir });
    if (dirName === 'desc' || dirName === 'asc') i++;
  }
  return out;
}

/** 遍历语句（含嵌套 If/ForEach） */
function forEachStmt(stmts: Statement[], fn: (st: Statement) => void): void {
  for (const st of stmts) {
    fn(st);
    if (st.kind === 'If') {
      forEachStmt(st.then, fn);
      if (st.else) forEachStmt(st.else, fn);
    } else if (st.kind === 'ForEach') {
      forEachStmt(st.body, fn);
    }
  }
}

/** 条件运算符 → Spring Data 派生方法名后缀 */
function opSuffix(op: WhereOp): string {
  switch (op) {
    case '=':
      return '';
    case '>=':
      return 'GreaterThanEqual';
    case '<=':
      return 'LessThanEqual';
    case '>':
      return 'GreaterThan';
    case '<':
      return 'LessThan';
    case 'like':
      return 'Like';
    case 'in':
      return 'In';
  }
}

/** 派生方法名：findBy{Field}{Suffix}[And|Or...]OrderBy{Field}{Dir}；limit → findTop{n}By... */
function derivedMethodName(ent: EntityNode, spec: QuerySpec): string {
  let name = spec.limit !== undefined ? `findTop${spec.limit}By` : 'findBy';
  spec.conditions.forEach((c, i) => {
    if (i > 0) name += c.connector === 'or' ? 'Or' : 'And';
    name += cap(c.field) + opSuffix(c.op);
  });
  for (const o of spec.orderBy) {
    name += `OrderBy${cap(o.field)}${o.dir === 'desc' ? 'Desc' : 'Asc'}`;
  }
  return name;
}

/** 条件参数 Java 类型：in 用集合类型，其余用字段类型 */
function condParamJavaType(ent: EntityNode, c: QuerySpec['conditions'][number]): string {
  const prop = ent.properties.find((p) => p.name === c.field);
  const base = prop ? javaType(prop.type) : 'String';
  if (c.op === 'in') {
    return `java.util.Collection<${base}>`;
  }
  return base;
}

/** 聚合函数 → JPQL 函数 + Java 返回类型 */
function aggJpql(fn: 'sum' | 'avg' | 'max' | 'min' | 'count', field: string | undefined, alias: string): { expr: string; ret: string } {
  switch (fn) {
    case 'count':
      return field ? { expr: `COUNT(${alias}.${field})`, ret: 'Long' } : { expr: `COUNT(${alias})`, ret: 'Long' };
    case 'sum':
    case 'avg':
      return { expr: `${fn.toUpperCase()}(${alias}.${field})`, ret: 'java.math.BigDecimal' };
    case 'max':
    case 'min':
      return { expr: `${fn.toUpperCase()}(${alias}.${field})`, ret: 'java.math.BigDecimal' };
  }
}

/** 单条 QuerySpec → Repository 方法声明 */
function repoMethod(ent: EntityNode, spec: QuerySpec): string {
  const alias = ent.name.charAt(0).toLowerCase();
  // 聚合（@Query JPQL）
  if (spec.aggregate) {
    const agg = aggJpql(spec.aggregate.fn, spec.aggregate.field, alias);
    if (spec.groupBy && spec.groupBy.length > 0) {
      const sel = [...spec.groupBy.map((f) => `${alias}.${f}`), agg.expr].join(', ');
      const grp = spec.groupBy.map((f) => `${alias}.${f}`).join(', ');
      const methodName = `${spec.aggregate.fn}${cap(spec.aggregate.field ?? '')}By${spec.groupBy.map((f) => cap(f)).join('And')}`;
      return `  @org.springframework.data.jpa.repository.Query("SELECT ${sel} FROM ${ent.name} ${alias} GROUP BY ${grp}")\n  java.util.List<Object[]> ${methodName}();`;
    }
    const methodName = `${spec.aggregate.fn}${cap(spec.aggregate.field ?? '')}`;
    return `  @org.springframework.data.jpa.repository.Query("SELECT ${agg.expr} FROM ${ent.name} ${alias}")\n  ${agg.ret} ${methodName}();`;
  }
  // 派生查询
  const name = derivedMethodName(ent, spec);
  const params = spec.conditions.map((c) => `${condParamJavaType(ent, c)} ${c.field}`);
  // null 宽松：无 in/or/limit 的 where 查询 → JPQL（?n IS NULL OR 谓词），
  // 可选参数缺省（null）不做过滤——列表页无条件打开时默认全量，而非 status = NULL 永假空集（jxc 对拍 F9）
  const hasIn = spec.conditions.some((c) => c.op === 'in');
  const hasOr = spec.conditions.some((c) => c.connector === 'or');
  if (!hasIn && !hasOr && spec.limit === undefined && spec.conditions.length > 0) {
    const preds = spec.conditions
      .map((c, i) => {
        const col = `${alias}.${c.field}`;
        const inner =
          c.op === 'like'
            ? `${col} LIKE CONCAT('%', ?${i + 1}, '%')`
            : `${col} ${c.op} ?${i + 1}`;
        return `(?${i + 1} IS NULL OR ${inner})`;
      })
      .join(' AND ');
    const order = spec.orderBy.map((o) => ` ${alias}.${o.field} ${o.dir.toUpperCase()}`).join(', ');
    const orderClause = order ? ` ORDER BY${order}` : '';
    if (spec.pageable) {
      params.push('org.springframework.data.domain.Pageable pageable');
      return `  @org.springframework.data.jpa.repository.Query("SELECT ${alias} FROM ${ent.name} ${alias} WHERE ${preds}${orderClause}")\n  org.springframework.data.domain.Page<${ent.name}> ${name}(${params.join(', ')});`;
    }
    return `  @org.springframework.data.jpa.repository.Query("SELECT ${alias} FROM ${ent.name} ${alias} WHERE ${preds}${orderClause}")\n  java.util.List<${ent.name}> ${name}(${params.join(', ')});`;
  }
  // limit 返回 List；page 返回 Page
  const ret = spec.pageable && spec.limit === undefined ? `org.springframework.data.domain.Page<${ent.name}>` : `java.util.List<${ent.name}>`;
  if (spec.pageable) params.push('org.springframework.data.domain.Pageable pageable');
  return `  ${ret} ${name}(${params.join(', ')});`;
}

function repositoryFile(pkg: string, ent: EntityNode, specs: QuerySpec[], hasEnums: boolean): GeneratedFile {
  const idProp = ent.properties.find((p) => p.primary);
  const idType = idProp ? javaType(idProp.type) : 'Long';
  const methods = specs.map((s) => repoMethod(ent, s)).join('\n');
  const methodBlock = methods ? '\n' + methods + '\n' : '';
  const content = `package ${pkg}.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import ${pkg}.entity.${ent.name};
${enumsImport(pkg, hasEnums)}public interface ${ent.name}Repository extends JpaRepository<${ent.name}, ${idType}> {
${methodBlock}}
`;
  return {
    path: `src/main/java/${pkg.replaceAll('.', '/')}/repository/${ent.name}Repository.java`,
    content,
  };
}

// ---------- Logic → Service ----------

function serviceFile(app: AppNode, logic: LogicNode): GeneratedFile {
  const pkg = pkgOf(app);
  const className = `${cap(logic.name)}Service`;
  const usedEntities = collectUsedEntities(app, logic);
  const usedServices = collectUsedServices(app, logic);
  // logic 间调用 → 注入目标 logic 的 service（genContractNo() → genContractNoService.genContractNo()）
  const usedLogics = collectUsedLogics(app, logic);
  const logicFields = usedLogics
    .map((n) => `  @Autowired\n  private ${cap(n)}Service ${n}Service;`)
    .join('\n');

  const repoFields = [...usedEntities.values()]
    .map((ent) => `  private final ${ent.name}Repository ${repoVar(ent)};`)
    .join('\n');
  const ctorParams = [...usedEntities.values()]
    .map((ent) => `${ent.name}Repository ${repoVar(ent)}`)
    .join(', ');
  const ctorAssign = [...usedEntities.values()]
    .map((ent) => `    this.${repoVar(ent)} = ${repoVar(ent)};`)
    .join('\n');

  // 外部服务注入字段：dubbo → @DubboReference；bean/http → @Autowired
  const serviceFields = usedServices
    .map((svc) => {
      if (svc.kind_ === 'dubbo') {
        const attrs = [
          svc.config['group'] ? `group = "${svc.config['group']}"` : '',
          svc.config['version'] ? `version = "${svc.config['version']}"` : '',
        ]
          .filter(Boolean)
          .join(', ');
        return `  @DubboReference(${attrs})\n  private ${svc.name} ${serviceVarName(svc)};`;
      }
      return `  @Autowired\n  private ${svc.name} ${serviceVarName(svc)};`;
    })
    .join('\n');
  const serviceApiImport =
    usedServices.length > 0 ? `import ${pkg}.service.api.*;\n` : '';

  const returnType = logic.returns[0] ? javaType(logic.returns[0].type) : 'void';

  // 写操作（save/delete）→ 方法加 @Transactional
  const transactional = hasWriteOps(logic) ? '@Transactional\n  ' : '';
  const transactionalImport = hasWriteOps(logic)
    ? 'import org.springframework.transaction.annotation.Transactional;\n'
    : '';

  // 方法参数签名 + 变量登记（参数在方法体可见）
  const methodParams = logic.params
    .map((p) => `${javaType(p.type)} ${p.name}`)
    .join(', ');
  const vars = createVarScope();
  for (const p of logic.params) {
    vars.vars.set(p.name, javaType(p.type));
  }
  const body = genStatements(app, logic.body, usedEntities, vars).join('\n');

  const imports = [
    'import org.springframework.stereotype.Service;',
    ...(transactionalImport ? [transactionalImport.trim()] : []),
    ...(usedEntities.size > 0 ? [`import ${pkg}.entity.*;`, `import ${pkg}.repository.*;`] : []),
    ...(app.enums.length > 0 ? [`import ${pkg}.enums.*;`] : []),
    // logic 间调用注入（@Autowired 字段）
    ...(collectUsedLogics(app, logic).length > 0 ? ['import org.springframework.beans.factory.annotation.Autowired;'] : []),
    // 外部服务注入注解 import
    ...(usedServices.some((s) => s.kind_ === 'dubbo')
      ? ['import org.apache.dubbo.config.annotation.DubboReference;']
      : []),
    ...(usedServices.some((s) => s.kind_ !== 'dubbo')
      ? ['import org.springframework.beans.factory.annotation.Autowired;']
      : []),
    // 参数/返回类型引用 structure 时补 import（含泛型实参：List<Struct> / Page<Struct>）
    ...(logic.params.some((p) => typeUsesStructure(app, p.type)) ||
      logic.returns.some((r) => typeUsesStructure(app, r.type))
      ? [`import ${pkg}.structure.*;`]
      : []),
  ].join('\n');

  const content = `package ${pkg}.service;

${imports}
${serviceApiImport}
@Service
public class ${className} {
${repoFields}${serviceFields ? `\n${serviceFields}` : ''}${logicFields ? `\n${logicFields}` : ''}

  public ${className}(${ctorParams}) {
${ctorAssign}
  }

  ${transactional}public ${returnType} ${logic.name}(${methodParams}) {
${body}
  }
}
`;
  return {
    path: `src/main/java/${pkg.replaceAll('.', '/')}/service/${className}.java`,
    content,
  };
}

/** logic 是否含写操作（.save() / .delete() 调用）→ 需要事务 */
function hasWriteOps(logic: LogicNode): boolean {
  let found = false;
  const scanExpr = (e: Expr): void => {
    if (found) return;
    if (
      e.kind === 'Call' &&
      e.callee.kind === 'Member' &&
      (e.callee.prop === 'save' || e.callee.prop === 'delete')
    ) {
      found = true;
      return;
    }
    switch (e.kind) {
      case 'Call':
        scanExpr(e.callee);
        e.args.forEach(scanExpr);
        break;
      case 'Member':
        scanExpr(e.obj);
        break;
      case 'New':
        e.args.forEach(scanExpr);
        break;
      case 'NewList':
        e.items.forEach(scanExpr);
        break;
      case 'Binary':
        scanExpr(e.left);
        scanExpr(e.right);
        break;
      case 'Group':
        scanExpr(e.expr);
        break;
      default:
        break;
    }
  };
  forEachStmt(logic.body, (st) => {
    switch (st.kind) {
      case 'VarDecl':
        if (st.init) scanExpr(st.init);
        break;
      case 'Assign':
        scanExpr(st.target);
        scanExpr(st.value);
        break;
      case 'Return':
        if (st.value) scanExpr(st.value);
        break;
      case 'If':
        scanExpr(st.cond);
        break;
      case 'ForEach':
        scanExpr(st.container);
        break;
      case 'CallStmt':
        scanExpr(st.call);
        break;
    }
  });
  return found;
}

/** TypeRef 是否指向 structure */
function isStructure(app: AppNode, tr: { kind: string; path?: string }): boolean {
  if (tr.kind !== 'reference' || !tr.path) return false;
  const name = tr.path.split('.').pop();
  return app.structures.some((s) => s.name === name);
}

/** enums wildcard import：仅当 app 声明了枚举才发射（无枚举 app 的 enums 包目录不存在，javac 找不到包） */
function enumsImport(pkg: string, hasEnums: boolean): string {
  return hasEnums ? `import ${pkg}.enums.*;\n` : '';
}

/** 类型是否引用结构：直接引用或泛型实参（List<Struct> / Page<Struct> 递归） */
function typeUsesStructure(app: AppNode, t: { kind: string; path?: string; args?: unknown }): boolean {
  if (isStructure(app, t)) return true;
  if (t.kind === 'generic' && Array.isArray(t.args)) {
    return (t.args as { kind: string; path?: string }[]).some((a) => typeUsesStructure(app, a));
  }
  return false;
}

// ---------- Interface → Controller ----------

const HTTP_ANNOTATION: Record<EndpointNode['method'], string> = {
  GET: 'GetMapping',
  POST: 'PostMapping',
  PUT: 'PutMapping',
  DELETE: 'DeleteMapping',
};

function controllerFile(app: AppNode, itf: InterfaceNode): GeneratedFile {
  const pkg = pkgOf(app);

  // 收集 endpoint 用到的 logic service（构造器注入）
  const serviceVars = new Map<string, string>(); // logicName -> serviceVar
  const fields: string[] = [];
  const ctorParams: string[] = [];
  const ctorAssign: string[] = [];
  for (const ep of itf.endpoints) {
    if (!ep.logicRef) continue;
    const logicName = ep.logicRef.split('.').pop()!;
    if (!serviceVars.has(logicName)) {
      serviceVars.set(logicName, `${logicName}Service`);
      fields.push(`  private final ${cap(logicName)}Service ${logicName}Service;`);
      ctorParams.push(`${cap(logicName)}Service ${logicName}Service`);
      ctorAssign.push(`    this.${logicName}Service = ${logicName}Service;`);
    }
  }

  const methods = itf.endpoints
    .map((ep) => genEndpointMethod(app, ep, serviceVars))
    .join('\n\n');

  // 是否需要 import structure（@RequestBody 结构参数 / 返回 List<Struct> 等泛型实参）
  const usesStructure = itf.endpoints.some((ep) => {
    const logic = app.logics.find((l) => l.name === (ep.logicRef?.split('.').pop() ?? ep.name));
    return (
      (logic?.params ?? []).some((p) => typeUsesStructure(app, p.type)) ||
      (logic?.returns ?? []).some((r) => typeUsesStructure(app, r.type))
    );
  });
  const structureImport = usesStructure ? `import ${pkg}.structure.*;\n` : '';

  const content = `package ${pkg}.controller;

import org.springframework.web.bind.annotation.*;
import ${pkg}.service.*;
${structureImport}import ${pkg}.entity.*;
${enumsImport(pkg, app.enums.length > 0)}@RestController
@CrossOrigin(origins = "*")
public class ${cap(itf.name)}Controller {
${fields.length > 0 ? fields.join('\n') + '\n' : ''}
  public ${cap(itf.name)}Controller(${ctorParams.join(', ')}) {
${ctorAssign.join('\n')}
  }

${methods}
}
`;
  return {
    path: `src/main/java/${pkg.replaceAll('.', '/')}/controller/${cap(itf.name)}Controller.java`,
    content,
  };
}

function genEndpointMethod(
  app: AppNode,
  ep: EndpointNode,
  serviceVars: Map<string, string>,
): string {
  const logicName = ep.logicRef?.split('.').pop() ?? ep.name;
  const logic = app.logics.find((l) => l.name === logicName);
  const returnType = logic?.returns[0] ? javaType(logic.returns[0].type) : 'void';

  // 方法参数：path 变量 → @PathVariable；GET 标量 → @RequestParam 可选（agent/前端常只传部分参数，缺省给人话默认值）；结构/实体 → @RequestBody
  const params = (logic?.params ?? []).map((p) => {
    const isPathVar = ep.path.includes(`{${p.name}}`);
    if (isPathVar) {
      return `@PathVariable ${javaType(p.type)} ${p.name}`;
    }
    if (ep.method === 'GET') {
      const t = p.type;
      if (t.kind === 'primitive' && (t.builtin === 'String' || t.builtin === 'Date' || t.builtin === 'Time' || t.builtin === 'DateTime')) {
        return `@RequestParam(value = "${p.name}", required = false, defaultValue = "") String ${p.name}`;
      }
      if (t.kind === 'reference' && app.enums.some((e) => e.name === typeNameFromPath(t.path))) {
        return `@RequestParam(value = "${p.name}", required = false, defaultValue = "") ${javaType(t)} ${p.name}`;
      }
      return `@RequestParam(value = "${p.name}", required = false, defaultValue = "0") ${javaType(t)} ${p.name}`;
    }
    return `@RequestBody ${javaType(p.type)} ${p.name}`;
  });
  const argNames = (logic?.params ?? []).map((p) => p.name).join(', ');

  return `  @${HTTP_ANNOTATION[ep.method]}("${ep.path}")
  public ${returnType} ${logicName}(${params.join(', ')}) {
    return ${serviceVars.get(logicName)}.${logicName}(${argNames});
  }`;
}

// ---------- 小语言 → Java ----------
// vars: 变量名 → 实体类名（ForEach item 等），用于字段访问转 getter

function genStatements(
  app: AppNode,
  stmts: Statement[],
  entities: Map<string, EntityNode>,
  vars: VarScope,
): string[] {
  return stmts.flatMap((st) => genStatement(app, st, entities, vars));
}

function genStatement(
  app: AppNode,
  st: Statement,
  entities: Map<string, EntityNode>,
  vars: VarScope,
): string[] {
  switch (st.kind) {
    case 'VarDecl': {
      const initStr = st.init ? genExpr(app, st.init, entities, vars) : 'null';
      // Java 语义：同名变量沿链查找，找到则复用（生成赋值，类型沿用外层）；未找到才声明新变量
      const existing = lookupVar(vars, st.name);
      if (existing) {
        return [`    ${st.name} = ${initStr};`];
      }
      const elemType = st.init?.kind === 'NewList' ? st.init.elem : undefined;
      // 识别 Todo.get(id) / erp.Order.get(id) / new Todo() / new OrderDetail() 推断类型（实体或结构）；
      // 查询链（X.where/aggregate…）推断为 List<实体>，使后续 ForEach 能拿到元素类型
      const getInit = st.init;
      const queryInit = getInit?.kind === 'Call' ? querySpecOf(app, getInit) : null;
      const inferredType =
        getInit?.kind === 'Call' &&
        getInit.callee.kind === 'Member' &&
        getInit.callee.prop === 'get'
          ? findEntityByName(app, entityNameOfReceiver(app, getInit.callee.obj) ?? '')?.name
          : getInit?.kind === 'New' && getInit.type.kind === 'reference'
            ? typeNameFromPath(getInit.type.path)
            : queryInit && !queryInit.aggregate
              ? `java.util.List<${findEntityByName(app, queryInit.entity)?.name ?? 'Object'}>`
              : undefined;
      const typeStr = st.type
        ? javaType(st.type)
        : elemType
          ? `java.util.List<${javaType(elemType)}>`
          : inferredType
            ? inferredType
            : 'var';
      if (st.type) vars.vars.set(st.name, javaType(st.type));
      else if (elemType) vars.vars.set(st.name, `java.util.List<${javaType(elemType)}>`);
      else if (inferredType) vars.vars.set(st.name, inferredType);
      // 整数字面量累加器 → long：实体 Integer 字段 getter 是 Long，int + long 会精度损失报错
      if (typeStr === 'var' && st.init?.kind === 'Numeric' && Number.isInteger(st.init.value)) {
        return [`    long ${st.name} = ${st.init.value}L;`];
      }
      return [`    ${typeStr} ${st.name} = ${initStr};`];
    }
    case 'Assign': {
      const value = genExpr(app, st.value, entities, vars);
      const t = st.target;
      // target 为 实体/结构变量.prop → setter
      if (t.kind === 'Member' && t.obj.kind === 'Ident') {
        const varType = lookupVar(vars, t.obj.name)?.javaType;
        if (varType && !isValueType(varType)) {
          let v = value;
          // Decimal 字段赋值整数字面量 → BigDecimal.valueOf(...)
          const fieldType = memberFieldType(app, vars, t.obj.name, t.prop);
          if (fieldType === 'java.math.BigDecimal' && exprJavaType(app, st.value, entities, vars) !== 'java.math.BigDecimal') {
            v = `java.math.BigDecimal.valueOf(${v})`;
          }
          return [`    ${t.obj.name}.set${cap(t.prop)}(${v});`];
        }
      }
      return [`    ${genExpr(app, st.target, entities, vars)} = ${value};`];
    }
    case 'Return': {
      // groupBy 聚合：List<Object[]> → List<Map<String, Object>>（行序=groupBy 字段 + 聚合列）
      const spec = st.value ? querySpecOf(app, st.value) : null;
      if (spec?.aggregate && spec.groupBy && spec.groupBy.length > 0 && st.value) {
        const ent = findEntityByName(app, spec.entity);
        if (ent) {
          const repo = repoVar(ent);
          const methodName = `${spec.aggregate.fn}${cap(spec.aggregate.field ?? '')}By${spec.groupBy.map((f) => cap(f)).join('And')}`;
          const keys = [...spec.groupBy, spec.aggregate.field ? `${spec.aggregate.fn}(${spec.aggregate.field})` : `count`];
          const puts = keys
            .map((k, i) => `      m.put("${k}", row[${i}]);`)
            .join('\n');
          return [
            `    java.util.List<java.util.Map<String, Object>> result = new java.util.ArrayList<>();`,
            `    for (Object[] row : ${repo}.${methodName}()) {`,
            `      java.util.Map<String, Object> m = new java.util.HashMap<>();`,
            puts,
            `      result.add(m);`,
            `    }`,
            `    return result;`,
          ];
        }
      }
      return [`    return ${st.value ? genExpr(app, st.value, entities, vars) : ''};`];
    }
    case 'If': {
      const lines = [`    if (${genExpr(app, st.cond, entities, vars)}) {`];
      const thenScope = createVarScope(vars);
      lines.push(...genStatements(app, st.then, entities, thenScope));
      if (st.else) {
        const elseScope = createVarScope(vars);
        lines.push('    } else {');
        lines.push(...genStatements(app, st.else, entities, elseScope));
      }
      lines.push('    }');
      return lines;
    }
    case 'ForEach': {
      const bodyScope = createVarScope(vars);
      const ent = findEntityForAll(app, st.container) ?? findEntityForWhere(app, st.container);
      let itemType: string;
      if (ent) {
        itemType = ent.name;
      } else {
        // 结构 List 容器（如 input.items: List<OrderItemInput>）→ 元素类型
        const ct = exprJavaType(app, st.container, entities, vars);
        const m = ct?.match(/^java\.util\.List<(.+)>$/);
        itemType = m ? m[1] : 'var';
      }
      bodyScope.vars.set(st.item, itemType);
      const containerStr = findEntityForAll(app, st.container)
        ? `${repoVar(ent!)}.findAll()`
        : genExpr(app, st.container, entities, vars);
      const lines = [`    for (${itemType} ${st.item} : ${containerStr}) {`];
      lines.push(...genStatements(app, st.body, entities, bodyScope));
      lines.push('    }');
      return lines;
    }
    case 'CallStmt':
      return [`    ${genExpr(app, st.call, entities, vars)};`];
    case 'Throw': {
      // dev/30 A1：框架错误类（全局 advice 映 HTTP 4xx）
      return [`    throw new ${pkgOf(app)}.support.TdslError(${genExpr(app, st.message, entities, vars)});`];
    }
    default: {
      const _never: never = st;
      return [_never];
    }
  }
}

// ---------- 表达式 Java 类型推断（Decimal 算术需要类型感知） ----------

/** 枚举字面量所属枚举名（DRAFT → ContractStatus；非枚举项返回 null） */
function enumItemOwner(app: AppNode, name: string): string | null {
  for (const en of app.enums) {
    if (en.items.some((i) => i.name === name)) return en.name;
  }
  return null;
}

/** logic 体内调用的其它 logic（logic 间调用 → 注入对方 service）；排除自身 */
function collectUsedLogics(app: AppNode, logic: LogicNode): string[] {
  const names = new Set<string>();
  const visit = (e: Expr): void => {
    switch (e.kind) {
      case 'Call': {
        const c = e.callee;
        if (c.kind === 'Ident' && c.name !== logic.name && app.logics.some((l) => l.name === c.name)) {
          names.add(c.name);
        }
        if (c.kind === 'Member') visit(c.obj);
        e.args.forEach(visit);
        break;
      }
      case 'Member':
        visit(e.obj);
        break;
      case 'New':
        e.args.forEach(visit);
        break;
      case 'NewList':
        e.items.forEach(visit);
        break;
    }
  };
  const scanStmt = (st: Statement): void => {
    switch (st.kind) {
      case 'VarDecl':
        if (st.init) visit(st.init);
        break;
      case 'Assign':
        if (st.target.kind === 'Member') visit(st.target.obj);
        visit(st.value);
        break;
      case 'Return':
        if (st.value) visit(st.value);
        break;
      case 'If':
        visit(st.cond);
        st.then.forEach(scanStmt);
        if (st.else) st.else.forEach(scanStmt);
        break;
      case 'ForEach':
        visit(st.container);
        st.body.forEach(scanStmt);
        break;
      case 'CallStmt':
        visit(st.call);
        break;
    }
  };
  logic.body.forEach(scanStmt);
  return [...names];
}

/** 推断表达式 Java 类型（尽力而为；无法推断返回 null） */
function exprJavaType(
  app: AppNode,
  e: Expr,
  entities: Map<string, EntityNode>,
  vars: VarScope,
): string | null {
  switch (e.kind) {
    case 'Ident':
      return lookupVar(vars, e.name)?.javaType ?? null;
    case 'Numeric':
      return 'Long'; // 数字字面量默认 Integer→Long
    case 'Bool':
      return 'Boolean';
    case 'String':
      return 'String';
    case 'Null':
      return null;
    case 'Member': {
      if (e.obj.kind === 'Ident') {
        return memberFieldType(app, vars, e.obj.name, e.prop);
      }
      return null;
    }
    case 'Call': {
      if (e.callee.kind === 'Member') {
        // 实体查询链（where/orderBy/page/limit/groupBy/aggregate）→ 按规格推导返回类型
        const spec = querySpecOf(app, e);
        if (spec) {
          const ent = findEntityByName(app, spec.entity);
          if (ent) {
            if (spec.aggregate) {
              if (spec.groupBy && spec.groupBy.length > 0) return `java.util.List<java.util.Map<String, Object>>`;
              // 聚合标量返回类型：count → Long；sum/avg/max/min → BigDecimal
              return spec.aggregate.fn === 'count' ? 'Long' : 'java.math.BigDecimal';
            }
            if (spec.pageable) return `org.springframework.data.domain.Page<${ent.name}>`;
            return `java.util.List<${ent.name}>`;
          }
        }
        const entName = entityNameOfReceiver(app, e.callee.obj);
        const ent = entName ? findEntityByName(app, entName) : null;
        if (ent && e.callee.prop === 'get') return ent.name;
        if (ent && (e.callee.prop === 'all' || e.callee.prop === 'where')) {
          return `java.util.List<${ent.name}>`;
        }
      }
      return null;
    }
    case 'Binary': {
      if (e.operator === '+' || e.operator === '-' || e.operator === '*') {
        const lt = exprJavaType(app, e.left, entities, vars);
        const rt = exprJavaType(app, e.right, entities, vars);
        if (lt === 'java.math.BigDecimal' || rt === 'java.math.BigDecimal') return 'java.math.BigDecimal';
        return 'Long';
      }
      return 'Boolean'; // 比较/逻辑
    }
    case 'Group':
      return exprJavaType(app, e.expr, entities, vars);
    default:
      return null;
  }
}

/** 变量某字段的 Java 类型（变量类型是实体或结构时查属性类型） */
function memberFieldType(
  app: AppNode,
  vars: VarScope,
  varName: string,
  prop: string,
): string | null {
  const typeName = lookupVar(vars, varName)?.javaType;
  if (!typeName) return null;
  return typeFieldType(app, typeName, prop);
}

/** 按类型名（实体/结构类名）查字段 Java 类型 */
function typeFieldType(app: AppNode, typeName: string, prop: string): string | null {
  const ent = findEntityByName(app, typeName);
  if (ent) {
    const p = ent.properties.find((x) => x.name === prop);
    if (p) return javaType(p.type);
  }
  const st = app.structures.find((s) => s.name === typeName);
  if (st) {
    const p = st.properties.find((x) => x.name === prop);
    if (p) return javaType(p.type);
  }
  return null;
}

/** 把表达式转为 BigDecimal：已是 BigDecimal 直接用，否则 BigDecimal.valueOf(...) */
function toBigDecimal(
  app: AppNode,
  e: Expr,
  entities: Map<string, EntityNode>,
  vars: VarScope,
): string {
  const t = exprJavaType(app, e, entities, vars);
  const s = genExpr(app, e, entities, vars);
  if (t === 'java.math.BigDecimal') return s;
  return `java.math.BigDecimal.valueOf(${s})`;
}

/** 是否为 Entity.where(...) / erp.Order.where(...) 调用 */
function isWhereCall(e: Expr): boolean {
  return (
    e.kind === 'Call' &&
    e.callee.kind === 'Member' &&
    (e.callee.obj.kind === 'Ident' || (e.callee.obj.kind === 'Member' && e.callee.obj.obj.kind === 'Ident')) &&
    e.callee.prop === 'where'
  );
}

/** 从 where/查询链容器解析实体（Entity.where(...) / Entity.where(...).orderBy(...) / aggregate 等 → 实体） */
function findEntityForWhere(app: AppNode, e: Expr): EntityNode | null {
  const spec = querySpecOf(app, e);
  if (!spec) return null;
  return findEntityByName(app, spec.entity);
}

/** 生成实体查询调用：repo.findBy...(params) / repo.findBy...(params, Pageable) / repo.sumTotal() / repo.sumTotalByCustomer() */
function genQueryCall(
  app: AppNode,
  e: Expr,
  spec: QuerySpec,
  ent: EntityNode,
  entities: Map<string, EntityNode>,
  vars: VarScope,
): string {
  const repo = repoVar(ent);
  // 聚合
  if (spec.aggregate) {
    if (spec.groupBy && spec.groupBy.length > 0) {
      const methodName = `${spec.aggregate.fn}${cap(spec.aggregate.field ?? '')}By${spec.groupBy.map((f) => cap(f)).join('And')}`;
      return `${repo}.${methodName}()`;
    }
    const methodName = `${spec.aggregate.fn}${cap(spec.aggregate.field ?? '')}`;
    return `${repo}.${methodName}()`;
  }
  // 派生查询
  const methodName = derivedMethodName(ent, spec);
  const args = spec.conditions.map((c) => {
    const v = genExpr(app, c.value, entities, vars);
    // 字段是 BigDecimal 且值非 BigDecimal（字面量/整型）→ BigDecimal.valueOf(...)
    const prop = ent.properties.find((p) => p.name === c.field);
    const fieldJava = prop ? javaType(prop.type) : null;
    if (fieldJava === 'java.math.BigDecimal' && exprJavaType(app, c.value, entities, vars) !== 'java.math.BigDecimal') {
      return `java.math.BigDecimal.valueOf(${v})`;
    }
    return v;
  });
  if (spec.pageable) {
    if (spec.limit !== undefined) {
      args.push(`org.springframework.data.domain.PageRequest.of(0, ${spec.limit})`);
    } else if (e.kind === 'Call' && e.callee.kind === 'Member' && e.callee.prop === 'page' && e.args.length >= 2) {
      // .page(n, size) —— n/size 是最外层 page 调用的参数（DSL Integer → Java Long，转 int）
      const n = genExpr(app, e.args[0], entities, vars);
      const size = genExpr(app, e.args[1], entities, vars);
      args.push(`org.springframework.data.domain.PageRequest.of(${n}.intValue(), ${size}.intValue())`);
    }
  }
  return `${repo}.${methodName}(${args.join(', ')})`;
}

function genExpr(
  app: AppNode,
  e: Expr,
  entities: Map<string, EntityNode>,
  vars: VarScope,
): string {
  switch (e.kind) {
    case 'Ident': {
      // 变量优先；裸枚举字面量（如 DRAFT）→ 枚举名限定（Java 无裸枚举常量）
      if (lookupVar(vars, e.name)) return e.name;
      const owner = enumItemOwner(app, e.name);
      if (owner) return `${owner}.${e.name}`;
      return e.name;
    }
    case 'Member': {
      // list.count → .size()
      if (e.prop === 'count') {
        return `${genExpr(app, e.obj, entities, vars)}.size()`;
      }
      // 实体静态 X.all / erp.Order.all → findAll()
      if (e.obj.kind === 'Ident') {
        const entName = entityNameOfIdent(app, e.obj.name);
        if (entName && e.prop === 'all') {
          return `${repoVar(findEntityByName(app, entName)!)}.findAll()`;
        }
        const varType = lookupVar(vars, e.obj.name)?.javaType;
        // 实体/结构变量字段访问 → getter（如 todo.done → todo.getDone()、input.title → input.getTitle()）
        if (varType && !isValueType(varType)) {
          return `${e.obj.name}.get${cap(e.prop)}()`;
        }
        return `${e.obj.name}.${e.prop}`;
      }
      // erp.Order.all —— Member(Member(Ident('erp'),'Order'),'all')
      if (e.obj.kind === 'Member' && e.obj.obj.kind === 'Ident') {
        const qname = `${e.obj.obj.name}.${e.obj.prop}`;
        const ent = findEntityByName(app, qname);
        if (ent && e.prop === 'all') {
          return `${repoVar(ent)}.findAll()`;
        }
      }
      return `${genExpr(app, e.obj, entities, vars)}.${e.prop}`;
    }
    case 'Call': {
      const callee = e.callee;
      // logic 间调用：genContractNo() → genContractNoService.genContractNo(...)（服务字段由 collectUsedLogics 注入）
      if (callee.kind === 'Ident' && app.logics.some((l) => l.name === callee.name)) {
        const args = e.args.map((a) => genExpr(app, a, entities, vars)).join(', ');
        return `${callee.name}Service.${callee.name}(${args})`;
      }
      // 实体静态方法：Todo.all / Todo.get(id) / Todo.where(...) / erp.Order.all
      if (callee.kind === 'Member') {
        // 实体查询链（where 多条件 / orderBy / page / limit / groupBy / aggregate）→ Repository 方法调用
        const spec = querySpecOf(app, e);
        if (spec) {
          const ent = findEntityByName(app, spec.entity);
          if (ent) return genQueryCall(app, e, spec, ent, entities, vars);
        }
        const entName = entityNameOfReceiver(app, callee.obj);
        if (entName) {
          const ent = findEntityByName(app, entName)!;
          const repo = repoVar(ent);
          if (callee.prop === 'all') {
            return `${repo}.findAll()`;
          }
          if (callee.prop === 'get') {
            const idArg = genExpr(app, e.args[0], entities, vars);
            return `${repo}.findById(${idArg}).orElseThrow()`;
          }
        }
        // 实体实例方法：entity.save() / entity.delete()
        if (callee.obj.kind === 'Ident') {
          const recvVar = lookupVar(vars, callee.obj.name)?.javaType;
          if (recvVar && !isValueType(recvVar)) {
            const ent = findEntityByName(app, recvVar);
            if (ent && (callee.prop === 'save' || callee.prop === 'delete')) {
              return `${repoVar(ent)}.${callee.prop}(${genExpr(app, callee.obj, entities, vars)})`;
            }
          }
        }
      }
      // list.add(x)
      if (callee.kind === 'Member' && callee.prop === 'add') {
        const args = e.args.map((a) => genExpr(app, a, entities, vars)).join(', ');
        return `${genExpr(app, callee.obj, entities, vars)}.add(${args})`;
      }
      const args = e.args.map((a) => genExpr(app, a, entities, vars)).join(', ');
      return `${genExpr(app, e.callee, entities, vars)}(${args})`;
    }
    case 'New': {
      const args = e.args.map((a) => genExpr(app, a, entities, vars)).join(', ');
      return `new ${javaType(e.type)}(${args})`;
    }
    case 'NewList': {
      const elem = javaType(e.elem);
      if (e.items.length > 0) {
        const items = e.items.map((i) => genExpr(app, i, entities, vars)).join(', ');
        return `new java.util.ArrayList<${elem}>(java.util.Arrays.asList(${items}))`;
      }
      return `new java.util.ArrayList<${elem}>()`;
    }
    case 'Bool':
      return e.value ? 'true' : 'false';
    case 'Numeric':
      return String(e.value);
    case 'String':
      return `"${e.value}"`;
    case 'Null':
      return 'null';
    case 'Binary': {
      const op = e.operator === '===' ? '==' : e.operator === '!==' ? '!=' : e.operator;
      const lt = exprJavaType(app, e.left, entities, vars);
      const rt = exprJavaType(app, e.right, entities, vars);
      // Decimal 算术：+ → .add()、* → .multiply()、- → .subtract()（BigDecimal 不能用 Java 运算符）
      if ((e.operator === '+' || e.operator === '*' || e.operator === '-') &&
          (lt === 'java.math.BigDecimal' || rt === 'java.math.BigDecimal')) {
        const m = e.operator === '+' ? 'add' : e.operator === '*' ? 'multiply' : 'subtract';
        return `(${toBigDecimal(app, e.left, entities, vars)}.${m}(${toBigDecimal(app, e.right, entities, vars)}))`;
      }
      // Decimal 比较：>/< 形运算符 → compareTo（BigDecimal 无运算符重载）
      if ((e.operator === '<' || e.operator === '<=' || e.operator === '>' || e.operator === '>=') &&
          (lt === 'java.math.BigDecimal' || rt === 'java.math.BigDecimal')) {
        return `(${toBigDecimal(app, e.left, entities, vars)}.compareTo(${toBigDecimal(app, e.right, entities, vars)}) ${op} 0)`;
      }
      return `(${genExpr(app, e.left, entities, vars)} ${op} ${genExpr(app, e.right, entities, vars)})`;
    }
    case 'Group':
      return `(${genExpr(app, e.expr, entities, vars)})`;
    default: {
      const _never: never = e;
      return _never;
    }
  }
}
// ---------- dev/30 A1：框架错误类 + 全局 advice（TDSL 逻辑忍不住时体面地大声） ----------

/** TdslError：TDSL 抛出的业务错误（ Advice 统一映 400 {code, message}） */
function tdslErrorFile(pkg: string): GeneratedFile {
  const pathBase = `src/main/java/${pkg.replaceAll('.', '/')}/support`;
  return {
    path: `${pathBase}/TdslError.java`,
    content: `package ${pkg}.support;

/** TDSL 业务错误（throw 语句的框架载体；全局 advice 映 4xx {code, message}） */
public class TdslError extends RuntimeException {
  private final String code;

  public TdslError(String message) {
    super(message);
    this.code = "GENERIC";
  }

  public TdslError(String code, String message) {
    super(message);
    this.code = code;
  }

  public String getCode() {
    return code;
  }
}
`,
  };
}

/** 全局 advice：TdslError → 400 {error, message}（前端 hooks.error 直接展示） */
function tdslAdviceFile(pkg: string): GeneratedFile {
  const pathBase = `src/main/java/${pkg.replaceAll('.', '/')}/support`;
  return {
    path: `${pathBase}/GlobalAdvice.java`,
    content: `package ${pkg}.support;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** 统一错误面：TdslError → 400 {code, message}；其余异常 → 500 {message} */
@RestControllerAdvice
public class GlobalAdvice {
  @ExceptionHandler(TdslError.class)
  public org.springframework.http.ResponseEntity<java.util.Map<String, Object>> tdslError(TdslError e) {
    java.util.Map<String, Object> body = new java.util.HashMap<>();
    body.put("code", e.getCode());
    body.put("message", e.getMessage());
    return org.springframework.http.ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
  }

  @ExceptionHandler(Exception.class)
  public org.springframework.http.ResponseEntity<java.util.Map<String, Object>> unexpected(Exception e) {
    java.util.Map<String, Object> body = new java.util.HashMap<>();
    body.put("code", "INTERNAL");
    body.put("message", e.getMessage());
    return org.springframework.http.ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(body);
  }
}
`,
  };
}
