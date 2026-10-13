/**
 * 把编译器打包成**一个自包含 npm 包**（发布产物 = 编译+压缩后的 JS，**不含 TS 源码**）
 * 用法：npm run pack:compiler    （仓库根执行；产物在 npm-dist/tdsl-cli-*.tgz）
 *
 * 说明：
 *  - 只发 @tdsl/cli 一个包：esbuild 把 core/parser/typecheck/codegen-java/codegen-react 与 js-yaml
 *    全量内联（node 内置模块除外）→ 安装零依赖、不存在"多包同装"问题；
 *  - packages/* 的分层是**开发期结构**（workspaces 复用/单测/类型边界），不进交付面；
 *  - 本脚本为「对外发布」单独构建：minify（无 sourcemap）→ 改写 package.json（bin 指 dist、清空 deps）后 npm pack；
 *  - 这是提高复制门槛（去源码/压缩/去 sourcemap），**不是加密**：JS 仍可被逆向阅读。
 *    真正的护城河是语义设计 + 文档 + 服务形态。
 */
import { build } from 'esbuild';
import { mkdirSync, rmSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'npm-dist');
const STAGE = join(OUT, 'stage-cli');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(STAGE, 'dist'), { recursive: true });

const cliDir = join(ROOT, 'packages', 'cli');
const meta = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf8'));

// 1) bundle 压缩：@tdsl/* 与 js-yaml 全部内联（node: 内置自动外部化），ESM / node18
await build({
  entryPoints: [join(cliDir, 'src/index.ts')],
  outfile: join(STAGE, 'dist/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
});
console.log('  ✓ cli dist/index.js（全量内联，minified，无源码）');

// 2) 发布用 package.json：bin 指 dist、**零依赖**（一切已内联）
const publishMeta = {
  name: meta.name,
  version: meta.version,
  description: meta.description,
  license: 'Apache-2.0',
  type: 'module',
  main: './dist/index.js',
  exports: { '.': './dist/index.js' },
  bin: { tdsl: 'dist/cli.js' },
  files: ['dist', 'LICENSE', 'README.md'],
  keywords: meta.keywords,
  engines: { node: '>=18' },
  repository: {
    type: 'git',
    url: 'git+https://github.com/raindrop4steven/tdsl.git',
    directory: 'packages/cli',
  },
  homepage: 'https://github.com/raindrop4steven/tdsl#readme',
  bugs: { url: 'https://github.com/raindrop4steven/tdsl/issues' },
  publishConfig: { access: 'public' },
};
writeFileSync(join(STAGE, 'package.json'), JSON.stringify(publishMeta, null, 2) + '\n', 'utf8');
copyFileSync(join(ROOT, 'LICENSE'), join(STAGE, 'LICENSE'));
copyFileSync(join(cliDir, 'README.md'), join(STAGE, 'README.md'));

// 3) CLI 入口（bin）
await build({
  stdin: {
    contents: `import { main } from './index.js';\nmain(process.argv.slice(2));\n`,
    resolveDir: join(STAGE, 'dist'),
    loader: 'ts',
  },
  outfile: join(STAGE, 'dist/cli.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  minify: true,
  sourcemap: false,
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'warning',
});

// 4) 打 tarball（唯一一个）
const out = execSync(`npm pack --silent --pack-destination "${OUT}"`, { cwd: STAGE }).toString().trim().split('\n').pop();
console.log(`  ✓ ${out}`);

console.log(`
打包完成（单包自包含，产物只含压缩 JS，不含 TS 源码）：npm-dist/${out}

安装：
  # 全局（推荐，任意目录可用）
  npm i -g npm-dist/${out}
  # 或工程内（CI 锁版本）
  npm i -D ./npm-dist/${out}
  # 或发布到 registry/私服后：npm i -g @tdsl/cli

安装后：
  tdsl --help
  tdsl check <tdsl目录>
  tdsl generate <tdsl目录> --name myapp -o generated
`);
