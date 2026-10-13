import todoTdsl from '../../../examples/todo-app/todo.tdsl?raw';
import { EXAMPLES } from '@tdsl/llm';
import { fmt, type Dict } from './i18n';

export interface Sample {
  key: string;
  domain: string;
  tdsl: string;
}

/** 示例库：todo.tdsl 全量订单场景（与 slice 同一文件，永不漂移）+ llm 示例矩阵 5 域 */
export const SAMPLES: Sample[] = [
  { key: 'todo', domain: '', tdsl: todoTdsl },
  ...EXAMPLES.map((e) => ({ key: e.id, domain: e.domain, tdsl: e.tdsl })),
];

/** 按当前语言渲染示例名（英文域用 domains 映射，缺省回落 EXAMPLES 原值） */
export function sampleName(t: Dict, s: Sample): string {
  if (s.key === 'todo') return t.samples.todo;
  return fmt(t.samples.prefix, { domain: t.samples.domains[s.key] ?? s.domain });
}
