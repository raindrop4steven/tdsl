import { randomUUID } from 'node:crypto';

export function createId(): string {
  return randomUUID();
}

/** 创建带 kind + id 的最小节点（具体节点由各构造函数扩展字段） */
export function createNode<const K extends string>(kind: K): { kind: K; id: string } {
  return { kind, id: createId() };
}