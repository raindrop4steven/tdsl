import {
  createVarScope,
  lookupVar,
  type AppNode,
  type EndpointNode,
  type EntityNode,
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

/** app 名转包名：com.<name> */
function pkgOf(app: AppNode): string {
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
  const whereFields = collectWhereFields(app);

  files.push(...scaffoldFiles(app));
  for (const ent of entities) {
    files.push(entityFile(pkg, ent));
    files.push(repositoryFile(pkg, ent, whereFields.get(ent.name) ?? []));
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
  return files;
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

${s.properties.length > 0 ? 'import java.util.*;\n' : ''}${referencesEntity ? `import ${pkg}.entity.*;\n` : ''}public class ${s.name} {

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
      path: 'src/main/resources/application.yml',
      content: `spring:
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

function entityFile(pkg: string, ent: EntityNode): GeneratedFile {
  const className = ent.name;
  const table = tableNameOf(ent);
  const fields = ent.properties
    .map((p) => {
      const lines: string[] = [];
      if (p.primary) {
        lines.push('  @Id');
        lines.push('  @GeneratedValue(strategy = GenerationType.IDENTITY)');
      } else {
        lines.push(`  @Column(nullable = ${p.nullable !== true})`);
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

@Entity
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

// ---------- Repository：每实体一个接口（含 where 派生查询） ----------

/** where 字段：字段名 + Java 类型 */
interface WhereField {
  field: string;
  javaType: string;
}

/** 收集所有 logic 中的 Entity.where(field = value)，返回 实体名 → 查询字段列表 */
function collectWhereFields(app: AppNode): Map<string, WhereField[]> {
  const map = new Map<string, WhereField[]>();
  const add = (entName: string, f: WhereField): void => {
    const list = map.get(entName) ?? [];
    if (!list.some((x) => x.field === f.field)) list.push(f);
    map.set(entName, list);
  };
  for (const l of app.logics) {
    forEachStmt(l.body, (st) => {
      const scan = (e: Expr): void => {
        if (
          e.kind === 'Call' &&
          e.callee.kind === 'Member' &&
          e.callee.prop === 'where'
        ) {
          const entName = entityNameOfReceiver(app, e.callee.obj);
          const ent = entName ? findEntityByName(app, entName) : null;
          const cond = e.args[0];
          if (ent && entName && cond?.kind === 'Binary' && cond.operator === '=' && cond.left.kind === 'Ident') {
            const fieldName = cond.left.name;
            const prop = ent.properties.find((p) => p.name === fieldName);
            if (prop) add(entName, { field: prop.name, javaType: javaType(prop.type) });
          }
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
          // 嵌套语句由 forEachStmt 递归访问，此处只扫表达式
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

function repositoryFile(pkg: string, ent: EntityNode, whereFields: WhereField[]): GeneratedFile {
  const idProp = ent.properties.find((p) => p.primary);
  const idType = idProp ? javaType(idProp.type) : 'Long';
  const methods = whereFields
    .map((w) => `  java.util.List<${ent.name}> findBy${cap(w.field)}(${w.javaType} ${w.field});`)
    .join('\n');
  const methodBlock = methods ? '\n' + methods + '\n' : '';
  const content = `package ${pkg}.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import ${pkg}.entity.${ent.name};

public interface ${ent.name}Repository extends JpaRepository<${ent.name}, ${idType}> {
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
    // 外部服务注入注解 import
    ...(usedServices.some((s) => s.kind_ === 'dubbo')
      ? ['import org.apache.dubbo.config.annotation.DubboReference;']
      : []),
    ...(usedServices.some((s) => s.kind_ !== 'dubbo')
      ? ['import org.springframework.beans.factory.annotation.Autowired;']
      : []),
    // 参数或返回类型引用 structure 时补 import
    ...(logic.params.some((p) => p.type.kind === 'reference' && isStructure(app, p.type)) ||
      logic.returns.some((r) => r.type.kind === 'reference' && isStructure(app, r.type))
      ? [`import ${pkg}.structure.*;`]
      : []),
  ].join('\n');

  const content = `package ${pkg}.service;

${imports}
${serviceApiImport}
@Service
public class ${className} {
${repoFields}${serviceFields ? `\n${serviceFields}` : ''}

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

  // 是否需要 import structure（@RequestBody 结构类型）
  const usesStructure = itf.endpoints.some((ep) => {
    const logic = app.logics.find((l) => l.name === (ep.logicRef?.split('.').pop() ?? ep.name));
    return (logic?.params ?? []).some((p) => isStructure(app, p.type));
  });
  const structureImport = usesStructure ? `import ${pkg}.structure.*;\n` : '';

  const content = `package ${pkg}.controller;

import org.springframework.web.bind.annotation.*;
import ${pkg}.service.*;
${structureImport}import ${pkg}.entity.*;
@RestController
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

  // 方法参数：path 变量 → @PathVariable；结构/实体 → @RequestBody
  const params = (logic?.params ?? []).map((p) => {
    const isPathVar = ep.path.includes(`{${p.name}}`);
    if (isPathVar) {
      return `@PathVariable ${javaType(p.type)} ${p.name}`;
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
      // 识别 Todo.get(id) / erp.Order.get(id) / new Todo() / new OrderDetail() 推断类型（实体或结构）
      const getInit = st.init;
      const inferredType =
        getInit?.kind === 'Call' &&
        getInit.callee.kind === 'Member' &&
        getInit.callee.prop === 'get'
          ? findEntityByName(app, entityNameOfReceiver(app, getInit.callee.obj) ?? '')?.name
          : getInit?.kind === 'New' && getInit.type.kind === 'reference'
            ? typeNameFromPath(getInit.type.path)
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
    case 'Return':
      return [`    return ${st.value ? genExpr(app, st.value, entities, vars) : ''};`];
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
      const containerStr = ent
        ? isWhereCall(st.container)
          ? genExpr(app, st.container, entities, vars)
          : `${repoVar(ent)}.findAll()`
        : genExpr(app, st.container, entities, vars);
      const lines = [`    for (${itemType} ${st.item} : ${containerStr}) {`];
      lines.push(...genStatements(app, st.body, entities, bodyScope));
      lines.push('    }');
      return lines;
    }
    case 'CallStmt':
      return [`    ${genExpr(app, st.call, entities, vars)};`];
    default: {
      const _never: never = st;
      return [_never];
    }
  }
}

// ---------- 表达式 Java 类型推断（Decimal 算术需要类型感知） ----------

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

/** 从 where 容器解析实体（Entity.where(...) / erp.Order.where(...) → 实体） */
function findEntityForWhere(app: AppNode, e: Expr): EntityNode | null {
  if (e.kind !== 'Call' || e.callee.kind !== 'Member' || e.callee.prop !== 'where') {
    return null;
  }
  const name = entityNameOfReceiver(app, e.callee.obj);
  return name ? findEntityByName(app, name) : null;
}

function genExpr(
  app: AppNode,
  e: Expr,
  entities: Map<string, EntityNode>,
  vars: VarScope,
): string {
  switch (e.kind) {
    case 'Ident':
      return e.name;
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
      // 实体静态方法：Todo.all / Todo.get(id) / Todo.where(...) / erp.Order.all
      if (callee.kind === 'Member') {
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
          if (callee.prop === 'where') {
            const cond = e.args[0];
            if (cond?.kind === 'Binary' && cond.operator === '=' && cond.left.kind === 'Ident') {
              const field = cond.left.name;
              const value = genExpr(app, cond.right, entities, vars);
              return `${repo}.findBy${cap(field)}(${value})`;
            }
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