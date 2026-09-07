import type { AppNode, EntityNode, Expr, GeneratedFile, LogicNode, Statement } from '@tdsl/core';
import { cap, javaType } from './type-map';

/** app 名转包名：com.<name> */
function pkgOf(app: AppNode): string {
  return `com.${app.name}`;
}

/** 实体名 → repository 变量名（如 Todo → todoRepository） */
function repoVar(ent: EntityNode): string {
  return `${ent.name.charAt(0).toLowerCase()}${ent.name.slice(1)}Repository`;
}

/** 查找引用 X.all 的实体 */
function findEntityForAll(app: AppNode, all: Expr): EntityNode | null {
  if (all.kind !== 'Member' || all.obj.kind !== 'Ident' || all.prop !== 'all') return null;
  for (const ds of app.datasources) {
    for (const ent of ds.entities) {
      if (ent.name === all.obj.name) return ent;
    }
  }
  return null;
}

/** 遍历逻辑体内所有 ForEach 引用的实体 */
function collectUsedEntities(app: AppNode, logic: LogicNode): Map<string, EntityNode> {
  const used = new Map<string, EntityNode>();
  const scan = (stmts: Statement[]): void => {
    for (const st of stmts) {
      if (st.kind === 'ForEach') {
        const ent = findEntityForAll(app, st.container);
        if (ent) used.set(ent.name, ent);
        scan(st.body);
      } else if (st.kind === 'If') {
        scan(st.then);
        if (st.else) scan(st.else);
      }
    }
  };
  scan(logic.body);
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
  for (const logic of app.logics) {
    files.push(serviceFile(app, logic));
  }
  return files;
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
  const body = genStatements(app, logic.body, usedEntities, new Map()).join('\n');

  const imports = [
    'import org.springframework.stereotype.Service;',
    ...(usedEntities.size > 0 ? [`import ${pkg}.entity.*;`, `import ${pkg}.repository.*;`] : []),
  ].join('\n');

  const content = `package ${pkg}.service;

${imports}

@Service
public class ${className} {
${repoFields}

  public ${className}(${ctorParams}) {
${ctorAssign}
  }

  public ${returnType} ${logic.name}() {
${body}
  }
}
`;
  return {
    path: `src/main/java/${pkg.replaceAll('.', '/')}/service/${className}.java`,
    content,
  };
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
      const typeStr = st.type
        ? javaType(st.type)
        : elemType
          ? `java.util.List<${javaType(elemType)}>`
          : 'var';
      if (st.type) vars.set(st.name, javaType(st.type));
      else if (elemType) vars.set(st.name, `java.util.List<${javaType(elemType)}>`);
      const initStr = st.init ? genExpr(app, st.init, entities, vars) : 'null';
      return [`    ${typeStr} ${st.name} = ${initStr};`];
    }
    case 'Assign':
      return [
        `    ${genExpr(app, st.target, entities, vars)} = ${genExpr(app, st.value, entities, vars)};`,
      ];
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
      // 实体变量字段访问 → getter（如 todo.done → todo.getDone()）
      if (e.obj.kind === 'Ident') {
        const entName = vars.get(e.obj.name);
        if (entName && entities.has(entName)) {
          const ent = entities.get(entName);
          if (ent && ent.properties.some((p) => p.name === e.prop)) {
            return `${e.obj.name}.get${cap(e.prop)}()`;
          }
        }
        return `${e.obj.name}.${e.prop}`;
      }
      return `${genExpr(app, e.obj, entities, vars)}.${e.prop}`;
    }
    case 'Call': {
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