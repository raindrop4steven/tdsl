<div align="center">

# 🧩 TDSL

**Typed DSL** · A low-code DSL for Coding Agents

Write low-code in TypeScript, compile to a **Spring Boot + React** full stack.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg?logo=apache&logoColor=white)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A518-3c873a.svg?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![npm](https://img.shields.io/npm/v/@tdsl/cli?color=cb3837&logo=npm&label=npm)](https://www.npmjs.com/package/@tdsl/cli)
[![GitHub stars](https://img.shields.io/github/stars/raindrop4steven/tdsl?logo=github&color=f5c542)](https://github.com/raindrop4steven/tdsl/stargazers)
[![Site](https://img.shields.io/badge/site-playground-6f42c1.svg?logo=githubpages&logoColor=white)](https://raindrop4steven.github.io/tdsl/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/raindrop4steven/tdsl/pulls)

[中文](README.md) · **English**

[Quick Start](#-quick-start) · [Hand it to an Agent](#-hand-it-to-a-coding-agent) · [CLI](#-cli) · [Docs](#-docs)

</div>

---

## ✨ What is this

TDSL is a compiler. You describe entities, APIs, pages, and business logic in TypeScript-like syntax; it produces a typed AST, and once the checks pass, generates two independently buildable projects. The surface syntax sticks to TypeScript — the language LLMs know best — introducing only a handful of domain keywords (`entity` / `interface` / `page`). Diagnostics are returned in a structured form, so a model can self-check and converge.

- 📝 **TypeScript surface** — model in the language LLMs know best; near-zero learning cost
- 🧱 **One source, two targets** — Spring Boot / JPA + React / Ant Design
- 🩺 **Structured diagnostics** — errors an agent can read and fix itself, down to 0 errors
- 🧩 **Agent knowledge pack** — `tdsl-skill/` ships syntax, examples, error codes, and a real-world project reference

## 📦 Install

```bash
npm i -g @tdsl/cli
```

Requires Node.js ≥ 18; `generate` / `build` additionally require Java 17 and Maven 3.8+.

## 🚀 Quick Start

```bash
tdsl check tdsl/                              # compile & diagnose (exit code 1 on error)
tdsl generate tdsl/ --name app -o generated   # generate Java + React projects
tdsl build tdsl/                              # generate + mvn compile + vite build
```

See the full compilable example at [`examples/todo-app/todo.tdsl`](examples/todo-app/todo.tdsl).

## 🤖 Hand it to a Coding Agent

Give the following prompt to an agent; it will install the CLI, read the knowledge pack, and write TDSL:

```
Build this app with TDSL: a low-code DSL that compiles to React + Java.

1. Install the CLI: npm i -g @tdsl/cli
2. Read the agent knowledge pack tdsl-skill/README.en.md (syntax / few-shot examples / error codes / a real project reference).
3. Write .tdsl shards; after each change run `tdsl check <dir>` and fix until 0 errors.
4. To emit projects: `tdsl generate <dir> --name app -o generated`; `tdsl build` runs the full two-target build.
```

## 🖥️ CLI

| Command | Description |
|---|---|
| `tdsl check <dir\|file>` | Compile & diagnose; exit code 1 on error |
| `tdsl generate <dir> --name <app> -o <dir>` | Generate Spring Boot + React projects |
| `tdsl build <dir>` | generate + `mvn compile` + `vite build` |
| `tdsl check-spec <project-dir>` | Reconcile spec against implementation, report coverage gaps |
| `tdsl bundle-jar <jar> -o libs/x.json` | Third-party jar → dependency artifact (paired with `dependency java`) |

## 📚 Docs

- 📖 Syntax reference & examples: [`tdsl-skill/`](tdsl-skill/) (full syntax / few-shot examples / error codes)
- 🧪 Example projects: [`examples/`](examples/) (`todo-app` / `todo-multi`)
- 🌐 Online Playground: [raindrop4steven.github.io/tdsl](https://raindrop4steven.github.io/tdsl/)

## 📄 License

Apache License 2.0, see [LICENSE](LICENSE).
