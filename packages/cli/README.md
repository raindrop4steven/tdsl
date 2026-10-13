<div align="center">

# 🧩 TDSL CLI

**`@tdsl/cli`** · TDSL 命令行工具（parse / check / generate / build / check-spec / bundle-jar）

面向 Coding Agent 的低代码 DSL：以 TypeScript 为书写面，编译出 **Spring Boot + React** 双端工程。

[![npm](https://img.shields.io/npm/v/@tdsl/cli?color=cb3837&logo=npm&label=npm)](https://www.npmjs.com/package/@tdsl/cli)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A518-3c873a.svg?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg?logo=apache&logoColor=white)](https://github.com/raindrop4steven/tdsl/blob/master/LICENSE)
[![GitHub](https://img.shields.io/github/stars/raindrop4steven/tdsl?logo=github&color=f5c542)](https://github.com/raindrop4steven/tdsl)
[![Site](https://img.shields.io/badge/site-playground-6f42c1.svg?logo=githubpages&logoColor=white)](https://raindrop4steven.github.io/tdsl/)

[快速开始](#-快速开始) · [命令行](#-命令行) · [交给 Coding Agent](#-交给-coding-agent) · [文档](#-文档)

</div>

---

## ✨ 这是什么

TDSL 是一台编译器。以类 TypeScript 的语法描述实体、接口、页面与逻辑，产出类型化 AST，检查通过后生成两套可独立构建的工程。书写面贴合大模型最熟悉的 TypeScript，仅在建模型处引入少量领域关键字（entity / interface / page）；诊断以结构化形式返回，便于模型自校验与收敛。

本包 `@tdsl/cli` 是 TDSL 的命令行入口，单包自包含、零运行时依赖。

## 📦 安装

```bash
npm i -g @tdsl/cli
```

需要 Node.js ≥ 18；`generate` / `build` 另需 Java 17 与 Maven 3.8+。

## 🚀 快速开始

```bash
tdsl check tdsl/                              # 编译与诊断（有 error 退出码 1）
tdsl generate tdsl/ --name app -o generated   # 生成 Java + React 工程
tdsl build tdsl/                              # generate + mvn compile + vite build
```

完整可编译示例见 [todo-app](https://github.com/raindrop4steven/tdsl/tree/master/examples/todo-app)。

## 🖥️ 命令行

| 命令 | 说明 |
|---|---|
| `tdsl check <目录\|文件>` | 编译与诊断，有 error 退出码 1 |
| `tdsl generate <目录> --name <app> -o <目录>` | 生成 Spring Boot + React 工程 |
| `tdsl build <目录>` | generate + `mvn compile` + `vite build` |
| `tdsl check-spec <工程目录>` | Spec 与实现对拍，输出覆盖缺口 |
| `tdsl bundle-jar <jar> -o libs/x.json` | 第三方 jar → 依赖产物（配 `dependency java`） |

## 🤖 交给 Coding Agent

将以下提示词交给 agent，由其安装 CLI、读取知识包并编写 TDSL：

```
请用 TDSL 开发这个应用：一门能编译出 React + Java 双端的低代码 DSL。

1. 安装 CLI：npm i -g @tdsl/cli
2. 读 agent 知识包 tdsl-skill/README.md（语法 / fewshot 示例 / 错误码 / 真工程参照）。
3. 写 .tdsl 分片；每次改动后跑 `tdsl check <目录>`，按提示修到 0 error。
4. 需要产出工程：`tdsl generate <目录> --name app -o generated`；`tdsl build` 跑双端构建。
```

## 📚 文档

- 📖 语法参考与示例：[tdsl-skill](https://github.com/raindrop4steven/tdsl/tree/master/tdsl-skill)（语法全书 / few-shot 示例 / 错误码）
- 🧪 示例工程：[examples](https://github.com/raindrop4steven/tdsl/tree/master/examples)（`todo-app` / `todo-multi`）
- 🌐 在线 Playground：[raindrop4steven.github.io/tdsl](https://raindrop4steven.github.io/tdsl/)
- 🐙 仓库：[github.com/raindrop4steven/tdsl](https://github.com/raindrop4steven/tdsl)

## 📄 许可

Apache License 2.0，见 [LICENSE](https://github.com/raindrop4steven/tdsl/blob/master/LICENSE)。
