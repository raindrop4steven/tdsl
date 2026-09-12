import { describe, expect, it } from 'vitest';
import { evalSample } from '../src/harness';
import { buildSamples, moduleRequirement, loadJxcSpec } from '../src/samples';
import { stripCodeBlock } from '../src/provider';

describe('C4 harness（mock LLM）', () => {
  it('样卷 7 份：jxc×5 + demo + todo；jxc 模块样卷带数据字典与按钮动作', () => {
    const samples = buildSamples();
    expect(samples.length).toBe(7);
    expect(samples[0].id).toBe('jxc-base');
    const goods = samples.find((s) => s.id === 'jxc-base')!;
    expect(goods.requirement).toContain('enum GoodsCategory');
    expect(goods.requirement).toContain('页面 GoodsList');

  });

  it('首轮绿 → 直接 buildJava(模拟)；不绿走修复 ≤N 轮', async () => {
    const good = '@datasource(\'defaultDS\')\nentity T { id: Integer @pk; }\n@export\nfunction f(): Boolean { return true; }\ninterface A { GET \'/api/f\' -> f }';
    const r1 = await evalSample({ id: 'ok', title: '', requirement: 'x' }, async () => good, { maxRounds: 0, skipBuild: true, artifactDir: 'C:/Users/Administrator/AppData/Local/Temp/opencode/eval-ok' });
    expect(r1.firstCheckPass).toBe(true);
    expect(r1.finalPass).toBe(true);
    expect(r1.repairRounds).toBe(0);

    const bad1 = "@datasource('defaultDS')\nentity T { id: Integer @pk; }\n@export\nfunction f(): Boolean { return true; ";
    let call = 0;
    const r2 = await evalSample({ id: 'fix', title: '', requirement: 'x' }, async () => {
      call++;
      return call === 1 ? bad1 : good;
    }, { maxRounds: 3, skipBuild: true, artifactDir: 'C:/Users/Administrator/AppData/Local/Temp/opencode/eval-fix' });
    expect(r2.repairRounds).toBe(1);
    expect(r2.finalPass).toBe(true);
  });

  it('stripCodeBlock：fence 内代码提取 + 无 fence 保底截取', () => {
    expect(stripCodeBlock('```tdsl\nentity A { }\n```')).toBe('entity A { }');
    expect(stripCodeBlock('entity B { }')).toBe('entity B { }');
  });

  it('样卷切片有数：loadJxcSpec() 有枚举/实体/模块', () => {
    const spec = loadJxcSpec();
    expect(spec.data.enums.length).toBe(5);
    expect(spec.modules.length).toBe(5);
  });
});
