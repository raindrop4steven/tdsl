/**
 * 一体化交付打包：编译器（单包自包含 tarball）+ tdsl-skill 知识包 + 安装说明 → 单一产物目录 + zip。
 * 用法：npm run pack:dist    （仓库根执行）
 *
 * 产物：
 *   npm-dist/bundle/            ← 交付目录（拷给客户/内网即可）
 *     packages/*.tgz            ← @tdsl/cli 单包自包含（编译器全量内联，压缩 JS，无 TS 源码）
 *     tdsl-skill/               ← agent 知识包（语法/fewshot/errors/spec-first/demo）
 *     README.md                 ← 安装与使用说明（本文件由脚本生成，带版本号）
 *   npm-dist/tdsl-bundle.zip    ← 上目录的 zip（交付单文件；生成失败不阻断）
 *
 * 前置：先有 pack:compiler 产物（本脚本自动先跑一遍）。
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const NPM_DIST = join(ROOT, 'npm-dist');
const BUNDLE = join(NPM_DIST, 'bundle');

// 0) 前置：编译器 tarball（pack-compiler 自带清场）
console.log('[1/4] 打包编译器（pack:compiler）…');
const pack = spawnSync(process.execPath, [join(ROOT, 'scripts', 'pack-compiler.mjs')], { stdio: 'inherit' });
if (pack.status !== 0) throw new Error('pack:compiler 失败');

// 1) 清场 + 组装 bundle
console.log('[2/4] 组装 bundle …');
rmSync(BUNDLE, { recursive: true, force: true });
mkdirSync(join(BUNDLE, 'packages'), { recursive: true });

const tarballs = readdirSync(NPM_DIST).filter((f) => f.endsWith('.tgz')).sort();
if (tarballs.length !== 1) throw new Error(`期望 1 个 tarball（@tdsl/cli 自包含），实得 ${tarballs.length}：${tarballs.join(', ')}`);
for (const t of tarballs) cpSync(join(NPM_DIST, t), join(BUNDLE, 'packages', t));

const skillSrc = join(ROOT, 'tdsl-skill');
if (!existsSync(join(skillSrc, 'README.md'))) throw new Error('缺少 tdsl-skill/（仓库根）');
cpSync(skillSrc, join(BUNDLE, 'tdsl-skill'), { recursive: true });

// 2) 版本戳（取 cli 包版本）
const cliMeta = JSON.parse(readFileSync(join(ROOT, 'packages', 'cli', 'package.json'), 'utf8'));
const version = cliMeta.version;

// 3) 生成安装说明
const readme = `# TDSL 交付包（编译器 + CLI + agent 知识包）v${version}

> 一套离线交付物：TDSL 编译器与 CLI（\`tdsl\` 命令，单包自包含）+ 给大模型/agent 用的 TDSL 知识包（tdsl-skill）。
> 产物只含压缩 JS，不含 TS 源码；采用 Apache-2.0 许可（见仓库根 LICENSE）。

## 目录

\`\`\`
packages/tdsl-cli-*.tgz   # 编译器 + CLI（@tdsl/cli 单包：core/parser/typecheck/codegen 全部内联，零依赖）
tdsl-skill/               # agent 知识包（README.md 是 LLM 的路由入口）
README.md                 # 本说明
\`\`\`

## 前置要求

- Node.js >= 18（CLI 单包零依赖）
- 仅 \`tdsl generate/build\`（真实产出工程）需要：Java 17 + Maven 3.8+；React 侧由生成工程自带 vite
- check-spec 需要\`spec.yaml\` + \`tdsl/\` 目录约定（见下）

## 安装

**方式 A（推荐）：全局安装 —— 机器装一次，任意目录可用（工具心智，对标 javac/tsc）**

\`\`\`bash
npm i -g <交付包路径>/packages/tdsl-cli-*.tgz

tdsl --help          # 任何目录直接用，无需 npm 工程、无需 package.json
\`\`\`

**方式 B：工程内安装 —— CI/团队需要锁版本时用**

\`\`\`bash
cd your-project                      # 任意 npm 工程
npm i -D ./packages/tdsl-cli-*.tgz   # 装进 devDependencies，版本随工程锁定
npx tdsl --help
\`\`\`

> 升级：重装新版本 tarball 覆盖（全局 \`npm i -g\` / 工程 \`npm i -D\` 同理）。

## CLI 用法

\`\`\`bash
tdsl check <tdsl目录|文件>            # 编译 + 诊断（error 退出码 1）
tdsl check-spec <工程目录>            # spec.yaml × tdsl/ 五维覆盖对照（缺口退出码 1）
tdsl generate <tdsl目录> --name x -o generated   # 生成 Java + React 工程
tdsl build <tdsl目录>                 # generate + mvn compile + vite build
tdsl bundle-jar <jar> -o libs/x.json  # 第三方 jar → FFI 产物（配 dependency java 声明用）
\`\`\`

## agent 知识包（tdsl-skill）接法

1. 把 \`tdsl-skill/\` 拷进（或挂载到）agent 的工作区，入口是 **\`tdsl-skill/README.md\`**（工作流 + 路由表）。
2. agent 写 TDSL 的标准动线：接需求 → \`spec/SKILL.md\` 先写/改 spec.yaml → 按 spec 写 .tdsl
   → \`tdsl check\`（报错读 \`errors/\`）→ \`tdsl check-spec\` 对照补缺口 → 全绿后 \`generate\`。
3. 各篇自包含，可整包塞 prompt，也可让 agent 按路由表按需读。

## 最小冒烟

\`\`\`bash
tdsl check tdsl-skill/demo-yudao/tdsl         # → 0 问题
tdsl check-spec tdsl-skill/demo-yudao         # → 1091 项 100%
\`\`\`
`;
writeFileSync(join(BUNDLE, 'README.md'), readme, 'utf8');

// 4) zip（尽力而为：交付单文件）
console.log('[3/4] 压缩 zip …');
const zipPath = join(NPM_DIST, 'tdsl-bundle.zip');
rmSync(zipPath, { force: true });
const zip = spawnSync('powershell', [
  '-NoProfile', '-Command',
  `Compress-Archive -Path '${BUNDLE}' -DestinationPath '${zipPath}' -Force`,
], { stdio: 'pipe' });
if (zip.status !== 0 || !existsSync(zipPath)) {
  console.log('  ! zip 生成失败（不阻断，交付目录已就绪）');
} else {
  console.log(`  ✓ tdsl-bundle.zip`);
}

console.log(`[4/4] 完成：
  交付目录  npm-dist/bundle/           （packages/tdsl-cli-*.tgz + tdsl-skill/ + README.md）
  单文件    npm-dist/tdsl-bundle.zip`);
