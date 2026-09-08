import type {
  AppNode,
  EndpointNode,
  EntityNode,
  Expr,
  GeneratedFile,
  InterfaceNode,
  LogicNode,
  Statement,
  StructureNode,
} from '@tdsl/core';
import { cap, javaType } from './type-map';

/** app 名转包名：com.<name> */
function pkgOf(app: AppNode): string {
  return `com.${app.name}`;
}

/** 实体名 → repository 变量名（如 Todo → todoRepository） */
function repoVar(ent: EntityNode): string {
  return `${ent.name.charAt(0).toLowerCase()}${ent.name.slice(1)}Repository`;
}

/** 查找引用 X.all / X.get 的实体名 */
function entityNameOfIdent(app: AppNode, name: string): string | null {
  for (const ds of app.datasources) {
    for (const ent of ds.entities) {
      if (ent.name === name) return ent.name;
    }
  }
  return null;
}

/** 查找引用 X.all 的实体 */
function findEntityForAll(app: AppNode, all: Expr): EntityNode | null {
  if (all.kind !== 'Member' || all.obj.kind !== 'Ident' || all.prop !== 'all') return null;
  const name = entityNameOfIdent(app, all.obj.name);
  return name ? findEntityByName(app, name) : null;
}

function findEntityByName(app: AppNode, name: string): EntityNode | null {
  for (const ds of app.datasources) {
    for (const ent of ds.entities) {
      if (ent.name === name) return ent;
    }
  }
  return null;
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
          if (callee.obj.kind === 'Ident') {
            // Todo.get(id) 或 Todo.all —— 静态实体调用
            const entName = entityNameOfIdent(app, callee.obj.name);
            if (entName && (callee.prop === 'get' || callee.prop === 'all')) add(entName);
            // entity.save() / entity.delete() —— 实例方法
            const recvEnt = entityVars.get(callee.obj.name);
            if (recvEnt && (callee.prop === 'save' || callee.prop === 'delete')) add(recvEnt);
          }
        }
        e.args.forEach((a) => scanExpr(a));
        break;
      }
      case 'Member': {
        // 实体静态 X.all → 收集该实体
        if (e.obj.kind === 'Ident') {
          const entName = entityNameOfIdent(app, e.obj.name);
          if (entName && e.prop === 'all') add(entName);
        }
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

/** 生成完整 Spring Boot 工程文件列表 */
export function generateJava(app: AppNode): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const pkg = pkgOf(app);
  const entities = app.datasources.flatMap((ds) => ds.entities);

  files.push(...scaffoldFiles(app));
  for (const ent of entities) {
    files.push(entityFile(pkg, ent));
    files.push(repositoryFile(pkg, ent));
  }
  for (const s of app.structures) {
    files.push(structureFile(pkg, s));
  }
  for (const logic of app.logics) {
    files.push(serviceFile(app, logic));
  }
  for (const itf of app.interfaces) {
    files.push(controllerFile(app, itf));
  }
  return files;
}

// ---------- Structure → POJO ----------

function structureFile(pkg: string, s: StructureNode): GeneratedFile {
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
  const content = `package ${pkg}.structure;

${s.properties.length > 0 ? 'import java.util.*;\n' : ''}
public class ${s.name} {

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

function entityFile(pkg: string, ent: EntityNode): GeneratedFile {
  const className = ent.name;
  const table = ent.table ?? ent.name.toLowerCase();
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

// ---------- Repository：每实体一个接口 ----------

function repositoryFile(pkg: string, ent: EntityNode): GeneratedFile {
  const idProp = ent.properties.find((p) => p.primary);
  const idType = idProp ? javaType(idProp.type) : 'Long';
  const content = `package ${pkg}.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import ${pkg}.entity.${ent.name};

public interface ${ent.name}Repository extends JpaRepository<${ent.name}, ${idType}> {
}
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

  const repoFields = [...usedEntities.values()]
    .map((ent) => `  private final ${ent.name}Repository ${repoVar(ent)};`)
    .join('\n');
  const ctorParams = [...usedEntities.values()]
    .map((ent) => `${ent.name}Repository ${repoVar(ent)}`)
    .join(', ');
  const ctorAssign = [...usedEntities.values()]
    .map((ent) => `    this.${repoVar(ent)} = ${repoVar(ent)};`)
    .join('\n');

  const returnType = logic.returns[0] ? javaType(logic.returns[0].type) : 'void';

  // 方法参数签名 + 变量登记（参数在方法体可见）
  const methodParams = logic.params
    .map((p) => `${javaType(p.type)} ${p.name}`)
    .join(', ');
  const vars = new Map<string, string>();
  for (const p of logic.params) {
    vars.set(p.name, javaType(p.type));
  }
  const body = genStatements(app, logic.body, usedEntities, vars).join('\n');

  const imports = [
    'import org.springframework.stereotype.Service;',
    ...(usedEntities.size > 0 ? [`import ${pkg}.entity.*;`, `import ${pkg}.repository.*;`] : []),
    ...(logic.params.some((p) => p.type.kind === 'reference' && isStructure(app, p.type))
      ? [`import ${pkg}.structure.*;`]
      : []),
  ].join('\n');

  const content = `package ${pkg}.service;

${imports}

@Service
public class ${className} {
${repoFields}

  public ${className}(${ctorParams}) {
${ctorAssign}
  }

  public ${returnType} ${logic.name}(${methodParams}) {
${body}
  }
}
`;
  return {
    path: `src/main/java/${pkg.replaceAll('.', '/')}/service/${className}.java`,
    content,
  };
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
  vars: Map<string, string>,
): string[] {
  return stmts.flatMap((st) => genStatement(app, st, entities, vars));
}

function genStatement(
  app: AppNode,
  st: Statement,
  entities: Map<string, EntityNode>,
  vars: Map<string, string>,
): string[] {
  switch (st.kind) {
    case 'VarDecl': {
      const elemType = st.init?.kind === 'NewList' ? st.init.elem : undefined;
      // 识别 Todo.get(id) 或 new Todo() 推断实体类型
      const getInit = st.init;
      const inferredType =
        getInit?.kind === 'Call' &&
        getInit.callee.kind === 'Member' &&
        getInit.callee.obj.kind === 'Ident' &&
        getInit.callee.prop === 'get'
          ? entityNameOfIdent(app, getInit.callee.obj.name)
          : getInit?.kind === 'New' && getInit.type.kind === 'reference'
            ? entityNameOfIdent(app, getInit.type.path.split('.').pop() ?? '')
            : undefined;
      const typeStr = st.type
        ? javaType(st.type)
        : elemType
          ? `java.util.List<${javaType(elemType)}>`
          : inferredType
            ? inferredType
            : 'var';
      if (st.type) vars.set(st.name, javaType(st.type));
      else if (elemType) vars.set(st.name, `java.util.List<${javaType(elemType)}>`);
      else if (inferredType) vars.set(st.name, inferredType);
      const initStr = st.init ? genExpr(app, st.init, entities, vars) : 'null';
      return [`    ${typeStr} ${st.name} = ${initStr};`];
    }
    case 'Assign': {
      const value = genExpr(app, st.value, entities, vars);
      const t = st.target;
      // target 为 实体/结构变量.prop → setter
      if (t.kind === 'Member' && t.obj.kind === 'Ident') {
        const varType = vars.get(t.obj.name);
        if (varType && !isValueType(varType)) {
          return [`    ${t.obj.name}.set${cap(t.prop)}(${value});`];
        }
      }
      return [`    ${genExpr(app, st.target, entities, vars)} = ${value};`];
    }
    case 'Return':
      return [`    return ${st.value ? genExpr(app, st.value, entities, vars) : ''};`];
    case 'If': {
      const lines = [`    if (${genExpr(app, st.cond, entities, vars)}) {`];
      lines.push(...genStatements(app, st.then, entities, vars));
      if (st.else) {
        lines.push('    } else {');
        lines.push(...genStatements(app, st.else, entities, vars));
      }
      lines.push('    }');
      return lines;
    }
    case 'ForEach': {
      const ent = findEntityForAll(app, st.container);
      const itemType = ent ? ent.name : 'var';
      if (ent) vars.set(st.item, ent.name);
      const containerStr = ent
        ? `${repoVar(ent)}.findAll()`
        : genExpr(app, st.container, entities, vars);
      const lines = [`    for (${itemType} ${st.item} : ${containerStr}) {`];
      lines.push(...genStatements(app, st.body, entities, vars));
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

function genExpr(
  app: AppNode,
  e: Expr,
  entities: Map<string, EntityNode>,
  vars: Map<string, string>,
): string {
  switch (e.kind) {
    case 'Ident':
      return e.name;
    case 'Member': {
      // 实体静态 X.all → findAll()
      if (e.obj.kind === 'Ident') {
        const entName = entityNameOfIdent(app, e.obj.name);
        if (entName && e.prop === 'all') {
          return `${repoVar(findEntityByName(app, entName)!)}.findAll()`;
        }
        const varType = vars.get(e.obj.name);
        // 实体/结构变量字段访问 → getter（如 todo.done → todo.getDone()、input.title → input.getTitle()）
        if (varType && !isValueType(varType)) {
          return `${e.obj.name}.get${cap(e.prop)}()`;
        }
        return `${e.obj.name}.${e.prop}`;
      }
      return `${genExpr(app, e.obj, entities, vars)}.${e.prop}`;
    }
    case 'Call': {
      const callee = e.callee;
      // 实体静态方法：Todo.all / Todo.get(id)
      if (callee.kind === 'Member' && callee.obj.kind === 'Ident') {
        const entName = entityNameOfIdent(app, callee.obj.name);
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
        const recvVar = vars.get(callee.obj.name);
        if (recvVar && !isValueType(recvVar)) {
          const ent = findEntityByName(app, recvVar);
          if (ent && (callee.prop === 'save' || callee.prop === 'delete')) {
            return `${repoVar(ent)}.${callee.prop}(${genExpr(app, callee.obj, entities, vars)})`;
          }
        }
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