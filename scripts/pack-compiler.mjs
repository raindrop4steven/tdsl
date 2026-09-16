/**
 * 把编译器打包成可独立安装的 npm 包（发布产物 = 编译+压缩后的 JS，**不含 TS 源码**）
 * 用法：npm run pack:compiler    （仓库根执行；产物在 npm-dist/*.tgz）
 *
 * 说明：
 *  - 仓库内开发流程不变（packages/* 以 TS 源为 main，tsx 直跑，测试 import src）；
 *  - 本脚本为「对外发布」单独做一次构建：esbuild bundle + minify（无 sourcemap）→ npm-dist/stage/<pkg>/dist/index.js，
 *    再改写 package.json（main/exports/bin 指向 dist、去掉 tsx 运行时依赖）后 npm pack；
 *  - 这是提高复制门槛（去源码/压缩/去 sourcemap），**不是加密**：JS 仍可被逆向阅读。
 *    真正的护城河是语义设计 + 文档 + 服务形态（packages/server 的在线编译），法务侧靠 LICENSE（专有许可）。
 */
import { build } from 'esbuild';
import { mkdirSync, rmSync, writeFileSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'npm-dist');
const STAGE = join(OUT, 'stage');

const PKGS = ['core', 'parser', 'typecheck', 'codegen-java', 'codegen-react', 'cli'];
/** 其它编译包保持 external（安装后从 node_modules 解析），避免重复打包 */
const EXTERNAL = PKGS.map((p) => `@tdsl/${p}`);

const LICENSE = `专有软件许可（Proprietary License）

Copyright (c) TDSL Project. All rights reserved.

本软件及其源码、编译产物、文档均为专有财产，仅限授权范围内使用。
未经书面许可，不得复制、分发、再许可、反向工程或用于构建竞争产品。
`;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

for (const p of PKGS) {
  const pkgDir = join(ROOT, 'packages', p);
  const src = join(pkgDir, 'package.json');
  if (!existsSync(src)) throw new Error(`缺少 packages/${p}/package.json`);
  const meta = JSON.parse(readFileSync(src, 'utf8'));
  const outDir = join(STAGE, p);
  mkdirSync(join(outDir, 'dist'), { recursive: true });

  // 1) bundle 压缩（ESM / node18；@tdsl/* 外部化）
  await build({
    entryPoints: [join(pkgDir, 'src/index.ts')],
    outfile: join(outDir, 'dist/index.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    external: EXTERNAL,
    logLevel: 'warning',
  });

  // 2) 改写为发布用 package.json（指向 dist；去掉 tsx 运行时依赖）
  const deps = { ...(meta.dependencies ?? {}) };
  if (p === 'cli') delete deps.tsx;
  const publishMeta = {
    name: meta.name,
    version: meta.version,
    description: meta.description,
    license: 'UNLICENSED',
    type: 'module',
    main: './dist/index.js',
    exports: { '.': './dist/index.js' },
    ...(p === 'cli' ? { bin: { tdsl: './dist/cli.js' }, files: ['dist', 'LICENSE'] } : { files: ['dist', 'LICENSE'] }),
    ...(Object.keys(deps).length > 0 ? { dependencies: deps } : {}),
  };
  writeFileSync(join(outDir, 'package.json'), JSON.stringify(publishMeta, null, 2) + '\n', 'utf8');
  writeFileSync(join(outDir, 'LICENSE'), LICENSE, 'utf8');

  // 3) CLI 入口（无 tsx：直接 import dist）
  if (p === 'cli') {
    await build({
      stdin: {
        contents: `import { main } from './index.js';\nmain(process.argv.slice(2));\n`,
        resolveDir: join(outDir, 'dist'),
        loader: 'ts',
      },
      outfile: join(outDir, 'dist/cli.js'),
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node18',
      minify: true,
      sourcemap: false,
      banner: { js: '#!/usr/bin/env node' },
      external: EXTERNAL,
      logLevel: 'warning',
    });
  }
  console.log(`  ✓ packages/${p} → dist（minified，无源码）`);
}

// 4) 打 tarball
const tarballs = [];
for (const p of PKGS) {
  const out = execSync(`npm pack --silent --pack-destination "${OUT}"`, { cwd: join(STAGE, p) }).toString().trim().split('\n').pop();
  tarballs.push(out);
  console.log(`  ✓ ${out}`);
}

console.log(`
打包完成（产物只含压缩 JS，不含 TS 源码）：${tarballs.map((t) => `npm-dist/${t}`).join(', ')}

新环境安装（不依赖本仓库目录结构）：
  # 方式 A：本地 tarball（6 个一起装，npm 无法让 tarball 互相解析依赖）
  npm i -D ${tarballs.map((t) => `./npm-dist/${t}`).join(' ')}

  # 方式 B：发布到 registry/私服后
  npm i -D @tdsl/cli

安装后：
  npx tdsl --help
  npx tdsl check <tdsl目录>
  npx tdsl generate <tdsl目录> --name myapp -o generated
`);
