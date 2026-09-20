import type { TypeRef } from '@tdsl/core';

/** 大写首字母 */
export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** 实体/结构名（nodePath 最后一段） */
export function typeNameFromPath(path: string): string {
  const seg = path.split('.').pop();
  return seg ?? path;
}

/** TypeRef → SQL 列类型（schema.sql 建库底稿；与 javaType 逐一对应：Integer→Long 列=BIGINT，Decimal→DECIMAL(19,2)）。
 * 非标量（List/实体引用等，实体属性本不应出现）返回 undefined → 列跳过。 */
export function sqlType(tr: TypeRef, enumNames: string[]): string | undefined {
  switch (tr.kind) {
    case 'primitive':
      switch (tr.builtin) {
        case 'Boolean': return 'BOOLEAN';
        case 'Integer': return 'BIGINT';
        case 'Decimal': return 'DECIMAL(19,2)';
        case 'String': return 'VARCHAR(255)';
        case 'Date': return 'DATE';
        case 'Time': return 'TIME';
        case 'DateTime': return 'TIMESTAMP';
      }
      break;
    case 'reference':
      if (enumNames.includes(typeNameFromPath(tr.path))) return 'VARCHAR(255)';
      return undefined;
    case 'generic':
      return undefined;
    case 'db':
      return 'DECIMAL(19,2)';
  }
  // 判别联合穷尽：理论不可达
  const _never: never = tr;
  return _never;
}

/** TypeRef → Java 类型（全限定，避免 import 管理） */
export function javaType(tr: TypeRef): string {
  switch (tr.kind) {
    case 'primitive':
      switch (tr.builtin) {
        case 'Boolean':
          return 'Boolean';
        case 'Integer':
          return 'Long';
        case 'Decimal':
          return 'java.math.BigDecimal';
        case 'String':
          return 'String';
        case 'Date':
          return 'java.time.LocalDate';
        case 'Time':
          return 'java.time.LocalTime';
        case 'DateTime':
          return 'java.time.ZonedDateTime';
      }
      break;
    case 'reference':
      return typeNameFromPath(tr.path);
    case 'generic':
      if (tr.name === 'List') return `java.util.List<${javaType(tr.args[0] ?? { kind: 'primitive', builtin: 'String' })}>`;
      if (tr.name === 'Map') return `java.util.Map<String, ${javaType(tr.args[0] ?? { kind: 'primitive', builtin: 'String' })}>`;
      if (tr.name === 'Page') return `org.springframework.data.domain.Page<${javaType(tr.args[0] ?? { kind: 'primitive', builtin: 'String' })}>`;
      return `java.util.List<${javaType(tr.args[0] ?? { kind: 'primitive', builtin: 'String' })}>`;
    case 'db':
      return 'java.math.BigDecimal';
  }
  // 判别联合穷尽：理论不可达
  const _never: never = tr;
  return _never;
}