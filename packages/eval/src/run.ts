/**
 * 跑批入口（C4）：串行执行样卷 → 落 evaluation/results/<ts>/ → 一页汇总。
 * 用法：
 *   npm run eval -w @tdsl/eval [-- --skip-build] [--samples id1,id2] [--rounds 3]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { llmConfigFromEnv, chatOnce } from './provider';
import { buildSamples } from './samples';
import { evalSample, type EvalRecord } from './harness';

function parseArgs(argv: string[]): { skipBuild: boolean; samples: string[] | null; rounds: number } {
  const out = { skipBuild: false, samples: null as string[] | null, rounds: 3 };
  for (const a of argv) {
    if (a === '--skip-build') out.skipBuild = true;
    else if (a.startsWith('--samples=')) out.samples = a.slice(10).split(',').filter(Boolean);
    else if (a.startsWith('--rounds=')) out.rounds = Number(a.slice(9)) || 3;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfg = llmConfigFromEnv();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const baseDir = join(process.cwd(), 'evaluation', 'results', stamp);
  mkdirSync(baseDir, { recursive: true });

  const samples = buildSamples().filter((s) => !args.samples || args.samples.includes(s.id));

  const llm = async (p: string): Promise<string> => await chatOnce(cfg, p);
  const records: EvalRecord[] = [];
  console.log(`C4 评测：${samples.length} 样例 · model=${cfg.model} · build=${args.skipBuild ? 'skip' : 'on'}`);
  for (const s of samples) {
    console.log(`\n▶ ${s.id} — ${s.title}`);
    const t0 = Date.now();
    const rec = await evalSample(s, llm, { maxRounds: args.rounds, skipBuild: args.skipBuild, artifactDir: join(baseDir, s.id) });
    records.push(rec);
    console.log(`  ✓ 首译 ${rec.firstParsePass ? 'ok' : '✗'} · check首过 ${rec.firstCheckPass ? 'ok' : 'x'} · 修复 ${rec.repairRounds} 轮 · final ${rec.finalPass ? '✔' : '✖'} · java ${rec.buildJava} · react ${rec.buildReact} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }

  // 一页汇总
  const pass = records.filter((r) => r.finalPass).length;
  const built = records.filter((r) => r.buildJava === 'pass' && r.buildReact === 'pass').length;
  const firstPassRate = Math.round((records.filter((r) => r.firstCheckPass).length / records.length) * 100);
  const summary = `=== C4 基线 ${new Date().toISOString()} ===
样例 ${records.length} | 首轮编译通过率 ${firstPassRate}% | 最终通过 ${pass}/${records.length} | build 双通过 ${built}/${records.length}
修复轮次分布: ${['0','1','2','3'].map((n) => `${n}轮=${records.filter((r) => String(r.repairRounds) === n).length}`).join(' ')}
明细: ${records.map((r) => `${r.sampleId}${r.finalPass ? '✔' : '✖'}(${r.repairRounds})`).join(' ')}
`;
  console.log('\n' + summary);
  writeFileSync(join(baseDir, 'records.json'), JSON.stringify(records, null, 2), 'utf8');
  writeFileSync(join(baseDir, 'summary.txt'), summary, 'utf8');
}

main().catch((e) => { console.error(e); process.exit(1); });
