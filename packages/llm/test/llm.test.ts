import { describe, expect, it } from 'vitest';
import type { AppNode } from '@tdsl/core';
import {
  EXAMPLES,
  SYNTAX_CHEATSHEET,
  autoMatchExamples,
  composePrompt,
  humanizePath,
  listExamples,
  repairLoopPlan,
  repairPrompt,
  selectExamples,
  validateTdsl,
} from '../src';

// dev/19 验收：示例矩阵中每条样例 parse + check 全绿（防示例腐烂）
describe('llm/examples', () => {
  it('每个示例都是可编译 TDSL（parse + typecheck 全绿）', () => {
    for (const e of EXAMPLES) {
      const result = validateTdsl(e.tdsl);
      expect(result.ok, `示例 ${e.id} 编译失败:\n${result.feedback ?? ''}`).toBe(true);
      expect(result.app).toBeDefined();
    }
  });

  it('listExamples 不泄露 TDSL 正文', () => {
    const metas = listExamples();
    expect(metas).toHaveLength(EXAMPLES.length);
    for (const m of metas) {
      expect((m as unknown as Record<string, unknown>)['tdsl']).toBeUndefined();
    }
  });

  it('selectExamples 按域/关键词命中，cap 生效，未命中回退默认顺序', () => {
    expect(selectExamples(['订单'], 5).map((e) => e.id)).toEqual(['master-detail-order']);
    expect(selectExamples(['查询', '外部'], 5)).toHaveLength(2);
    expect(selectExamples([], 2)).toHaveLength(2);
    expect(selectExamples(['不存在的域'], 1)[0].id).toBe('crud-single-table');
  });

  it('autoMatchExamples：从需求文本自动匹配关键词（示例检索器规则层）', () => {
    // 需求含"订单"（主子表域）+"搜索/排序/统计"（报表域）→ 双命中（都相关，优于单命中）
    expect(autoMatchExamples('做一个订单报表，支持按名称搜索、按金额排序、统计', 3).map((e) => e.id)).toEqual([
      'master-detail-order',
      'query-report',
    ]);
    // 需求含"dubbo/集成" → 命中外部服务域
    expect(autoMatchExamples('需要调用 dubbo 服务和外部 http 接口', 3).map((e) => e.id)).toEqual([
      'external-service',
    ]);
    // 全无命中 → 回退默认顺序
    expect(autoMatchExamples('做一个神秘的系统', 2).map((e) => e.id)).toEqual([
      'crud-single-table',
      'master-detail-order',
    ]);
  });
});

describe('llm/prompt', () => {
  it('composePrompt 含五层：角色/速查/示例/需求/输出契约', () => {
    const prompt = composePrompt({ requirement: '做一个图书管理' });
    expect(prompt).toContain('TDSL 编译器的书写前端');
    expect(prompt).toContain(SYNTAX_CHEATSHEET);
    expect(prompt).toContain('===== 用户需求 =====\n做一个图书管理');
    expect(prompt).toContain('只输出一个完整的 TDSL 源文件内容');
  });

  it('composePrompt 默认注入 2 个示例；domains 过滤生效', () => {
    const def = composePrompt({ requirement: 'x' });
    expect(def.match(/===== 示例【/g)).toHaveLength(2);
    const picked = composePrompt({ requirement: 'x', domains: ['多数据源'], maxExamples: 5 });
    expect(picked).toContain('示例【多数据源/命名空间】');
    expect(picked).not.toContain('示例【CRUD 单表】');
  });

  it('速查表标注 TS 词法面规范与领域差异（LLM 最易犯的 TS 习惯）', () => {
    expect(SYNTAX_CHEATSHEET).toContain('const/let');
    expect(SYNTAX_CHEATSHEET).toContain('for-of');
    expect(SYNTAX_CHEATSHEET).toContain('没有 number/string/Date');
    expect(SYNTAX_CHEATSHEET).toContain('非赋值');
  });
});

describe('llm/repair', () => {
  it('validateTdsl：语法错误返回带行列的 feedback', () => {
    const r = validateTdsl('entity Todo { id: Integer }');
    expect(r.ok).toBe(false);
    expect(r.feedback).toContain('语法错误（第 1 行');
    expect(r.diagnostics?.[0]?.line).toBe(1);
  });

  it('validateTdsl：link 阶段错误（line 0）给出可读的引导语', () => {
    // 悬空页面在 link 阶段报（line/col = 0）→ feedback 不应出现"第 0 行"这种对 LLM 无意义的定位
    const r = validateTdsl('entity Todo { id: Integer @pk; }\npage A { <button text="去" action={navigate(\'Nope\')} /> }');
    expect(r.ok).toBe(false);
    expect(r.feedback).toContain("cannot resolve page 'Nope'");
    expect(r.feedback).toContain('link 阶段');
    expect(r.feedback).not.toContain('第 0 行');
  });

  it('validateTdsl：typecheck 阶段失败返回 humanize 后的 nodePath 提示', () => {
    // 未知实体方法 parser 放行、typecheck 报错（能走到 typecheck 阶段）
    const src = `
entity Order { id: Integer @pk; total: Decimal; }
@export
function bad(): List<Order> {
  return Order.batchDelete();
}
`;
    const r = validateTdsl(src);
    expect(r.ok).toBe(false);
    expect(r.feedback).toContain('类型检查未通过');
    expect(r.feedback).toContain('实体 Order 无方法 batchDelete');
    expect(r.feedback).toContain('逻辑 bad');
  });

  it('humanizePath：nodePath → 人话（实体/逻辑/页面/结构）', () => {
    const app: AppNode = validateTdsl(EXAMPLES[0].tdsl).app as AppNode;
    expect(humanizePath(app, 'app.logics.createTodo')).toBe('逻辑 createTodo');
    expect(humanizePath(app, 'app.views.TodoList')).toBe('页面 TodoList');
    expect(humanizePath(app, 'app.structures.TodoInput')).toBe('结构 TodoInput');
    expect(humanizePath(app, 'app.datasources.defaultDS.entities.Todo.properties.title')).toBe(
      '实体 Todo（数据源 defaultDS）',
    );
    expect(humanizePath(app, 'app.unknown.path')).toBe('app.unknown.path');
  });

  it('repairPrompt：含反馈 + 原稿 + 完整修正稿要求', () => {
    const p = repairPrompt('draft...', '第 1 行有错');
    expect(p).toContain('第 1 行有错');
    expect(p).toContain('draft...');
    expect(p).toContain('完整 TDSL 源文件');
    expect(p).toContain('不是 diff');
  });

  it('repairLoopPlan：合法稿零轮通过；非法稿按 maxRounds 迭代', () => {
    const ok = repairLoopPlan(EXAMPLES[0].tdsl, 3);
    expect(ok.rounds).toHaveLength(0);
    expect(ok.finalOk).toBe(true);
    expect(ok.app).toBeDefined();

    const bad = repairLoopPlan('entity Todo { id: Integer }', 2);
    expect(bad.rounds).toHaveLength(2);
    expect(bad.finalOk).toBe(false);
    expect(bad.rounds[0].prompt).toContain('编译失败');
  });
});
