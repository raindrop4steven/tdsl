// 节点 id：优先原生 crypto.randomUUID（Node 18+ 与浏览器安全上下文均可用），
// 非安全上下文（如局域网 http 访问 playground）降级为手写 uuid v4，保证演示不炸
export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // uuid v4（fallback）：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => {
    const n = Number(c);
    return (n ^ (getRandomByte() & 0xf) >> (n / 4)).toString(16);
  });
}

function getRandomByte(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    return crypto.getRandomValues(new Uint8Array(1))[0];
  }
  return Math.floor(Math.random() * 256); // 最后兜底
}

/** 创建带 kind + id 的最小节点（具体节点由各构造函数扩展字段） */
export function createNode<const K extends string>(kind: K): { kind: K; id: string } {
  return { kind, id: createId() };
}
