export type BuiltinType =
  | 'Boolean'
  | 'Integer'
  | 'Decimal'
  | 'String'
  | 'Date'
  | 'Time'
  | 'DateTime';

export type TypeRef =
  | { kind: 'primitive'; builtin: BuiltinType }
  | { kind: 'reference'; path: string }
  | { kind: 'generic'; name: 'List' | 'Map' | 'Page'; args: TypeRef[] }
  | { kind: 'db'; builtin: string; args?: Record<string, unknown> };