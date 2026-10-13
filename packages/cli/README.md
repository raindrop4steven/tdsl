<div align="center">

# 🧩 TDSL CLI

**`@tdsl/cli`** · the TDSL command-line tool (parse / check / generate / build / check-spec / bundle-jar)

A low-code DSL for Coding Agents: write in TypeScript, compile to a **Spring Boot + React** full stack.

[![npm](https://img.shields.io/npm/v/@tdsl/cli?color=cb3837&logo=npm&label=npm)](https://www.npmjs.com/package/@tdsl/cli)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A518-3c873a.svg?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg?logo=apache&logoColor=white)](https://github.com/raindrop4steven/tdsl/blob/master/LICENSE)
[![GitHub](https://img.shields.io/github/stars/raindrop4steven/tdsl?logo=github&color=f5c542)](https://github.com/raindrop4steven/tdsl)
[![Site](https://img.shields.io/badge/site-playground-6f42c1.svg?logo=githubpages&logoColor=white)](https://raindrop4steven.github.io/tdsl/)

[Quick start](#-quick-start) · [CLI](#-cli) · [Hand it to an agent](#-hand-it-to-a-coding-agent) · [Docs](#-docs) · [中文](README.zh.md)

</div>

---

## ✨ What is this

TDSL is a compiler. Describe entities, APIs, pages, and logic in TypeScript-like syntax; it produces a typed AST and, once checks pass, generates two independently buildable projects. The surface sticks to TypeScript — the language LLMs know best — adding only a few domain keywords (entity / interface / page). Diagnostics are structured, so a model can self-check and converge.

This package, `@tdsl/cli`, is the command-line entry point: a single self-contained bundle with zero runtime dependencies.

## 📦 Install

```bash
npm i -g @tdsl/cli
```

Requires Node.js ≥ 18; `generate` / `build` additionally require Java 17 and Maven 3.8+.

## 🚀 Quick start

```bash
tdsl check tdsl/                              # compile & diagnose (exit code 1 on error)
tdsl generate tdsl/ --name app -o generated   # generate Java + React projects
tdsl build tdsl/                              # generate + mvn compile + vite build
```

See the full compilable example at [todo-app](https://github.com/raindrop4steven/tdsl/tree/master/examples/todo-app).

## 🖥️ CLI

| Command | Description |
|---|---|
| `tdsl check <dir\|file>` | Compile & diagnose; exit code 1 on error |
| `tdsl generate <dir> --name <app> -o <dir>` | Generate Spring Boot + React projects |
| `tdsl build <dir>` | generate + `mvn compile` + `vite build` |
| `tdsl check-spec <project-dir>` | Reconcile spec against implementation, report coverage gaps |
| `tdsl bundle-jar <jar> -o libs/x.json` | Third-party jar → dependency artifact (paired with `dependency java`) |

## 🤖 Hand it to a Coding Agent

Give the following prompt to an agent; it will install the CLI, read the knowledge pack, and write TDSL:

```
Build this app with TDSL: a low-code DSL that compiles to React + Java.

1. Install the CLI: npm i -g @tdsl/cli
2. Read the agent knowledge pack tdsl-skill/README.md (syntax / few-shot examples / error codes / a real project reference).
3. Write .tdsl shards; after each change run `tdsl check <dir>` and fix until 0 errors.
4. To emit projects: `tdsl generate <dir> --name app -o generated`; `tdsl build` runs the two-target build.
```

## 📚 Docs

- 📖 Syntax reference & examples: [tdsl-skill](https://github.com/raindrop4steven/tdsl/tree/master/tdsl-skill) (full syntax / few-shot examples / error codes)
- 🧪 Example projects: [examples](https://github.com/raindrop4steven/tdsl/tree/master/examples) (`todo-app` / `todo-multi`)
- 🌐 Online Playground: [raindrop4steven.github.io/tdsl](https://raindrop4steven.github.io/tdsl/)
- 🐙 Repository: [github.com/raindrop4steven/tdsl](https://github.com/raindrop4steven/tdsl)

## 📄 License

Apache License 2.0, see [LICENSE](https://github.com/raindrop4steven/tdsl/blob/master/LICENSE).
