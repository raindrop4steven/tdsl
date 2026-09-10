#!/usr/bin/env node
/**
 * dsl 命令行入口（M8）：
 *   bin 只做装载与退出码，逻辑在 src/index.ts（薄命令层，编译服务可复用）。
 *   全仓 packages 均以 TS 源为 main（不开构建链），经 tsx 的 ESM register 加载。
 */
import { register } from 'tsx/esm/api';
register();

const { main } = await import('../src/index.ts');
main(process.argv.slice(2));
