// 全局 crypto.randomUUID：Node 18+ 与浏览器均可用（环境无关，供编译服务/playground 复用）
export function createId(): string {
  return crypto.randomUUID();
}

/** 创建带 kind + id 的最小节点（具体节点由各构造函数扩展字段） */
export function createNode<const K extends string>(kind: K): { kind: K; id: string } {
  return { kind, id: createId() };
}