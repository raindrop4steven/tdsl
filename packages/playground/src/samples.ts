import todoTdsl from '../../../examples/todo-app/todo.tdsl?raw';
import { EXAMPLES } from '@tdsl/llm';

export interface Sample {
  name: string;
  tdsl: string;
}

/** 示例库：todo.tdsl 全量订单场景（与 slice 同一文件，永不漂移）+ llm 示例矩阵 5 域 */
export const SAMPLES: Sample[] = [
  { name: '订单场景全量（todo.tdsl）', tdsl: todoTdsl },
  ...EXAMPLES.map((e) => ({ name: `示例【${e.domain}】`, tdsl: e.tdsl })),
];
