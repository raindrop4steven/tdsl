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
      return `java.util.List<${javaType(tr.args[0] ?? { kind: 'primitive', builtin: 'String' })}>`;
    case 'db':
      return 'java.math.BigDecimal';
  }
  // 判别联合穷尽：理论不可达
  const _never: never = tr;
  return _never;
}