/**
 * Spec 覆盖度对照（jxc）：canonical 实现在 @tdsl/cli（tdsl check-spec）。
 * 本脚本保留为工程内快捷入口（npm run check-spec），逻辑零重复。
 */
import { fileURLToPath } from 'node:url';
import { runCheckSpec } from '@tdsl/cli';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const r = runCheckSpec(ROOT);
console.log(r.stdout);
process.exitCode = r.code;
