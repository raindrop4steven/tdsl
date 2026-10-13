# Overseas launch kit (English)

> Copy-paste ready for Product Hunt / Hacker News / Reddit / X. Tweak the voice to match your account.
> Assets to prepare: a hero GIF (TDSL source → generated Spring Boot + React tree), a `tdsl check` terminal shot, and a screenshot of the Yudao portal dashboard.

## Shared building blocks

**One-liner:** TDSL is an agent-first low-code DSL: write TypeScript-like code, compile to a Spring Boot + React full stack.

**Tagline (≤60 chars):** Write once in TypeScript, compile to React + Spring Boot

**Elevator pitch:**
> TDSL (Typed DSL) is a low-code DSL for Coding Agents. You describe entities, APIs, pages, and business logic in TypeScript-like syntax; it builds a typed AST, and once checks pass, generates two independently buildable projects — Spring Boot / JPA and React / Ant Design. Diagnostics are structured, so an LLM can read them and fix itself to zero errors. Everything is explicit: the compiler infers nothing, which keeps behavior predictable.

**Key facts (for all posts):**
- One source, two targets: Spring Boot + JPA and React + Ant Design, generated from a single definition.
- Agent-first: structured diagnostics `[severity] [code] message (file:line:col) + change to: suggestion`.
- Zero inference: foreign keys need explicit `@ref`, page-used functions must be exposed by an endpoint, business copy lives in the DSL.
- Spec-first workflow with `tdsl check-spec` to reconcile requirements coverage.
- Proven on a real system: a subset of Yudao ruoyi-vue-pro ERP/CRM — 46 entities / 79 pages / 201 buttons, `tdsl check` 0 issues, 100% spec coverage (1091 items), both Java and React builds pass.
- `npm i -g @tdsl/cli` · Node ≥ 18 (build needs Java 17 + Maven 3.8+) · Apache-2.0
- Repo: https://github.com/raindrop4steven/tdsl · Playground: https://raindrop4steven.github.io/tdsl/

---

## Product Hunt

**Name:** TDSL

**Tagline:** Write once in TypeScript, compile to React + Spring Boot

**Description:**
> TDSL is an agent-first low-code DSL that compiles to a full stack.
>
> Describe entities, APIs, pages, and business logic in TypeScript-like syntax — the language LLMs know best. TDSL produces a typed AST and, once checks pass, generates two independently buildable projects: Spring Boot / JPA and React / Ant Design. Front- and back-end stay aligned by construction, so there's no more "the fields don't match" integration pain.
>
> It's built for AI coding agents: diagnostics are structured (`[severity] [code] message (file:line:col) + fix`), so a model can read them, locate the problem, and iterate to zero errors on its own.
>
> It ships with a spec-first workflow (`tdsl check-spec`) and an agent knowledge pack (syntax, few-shot examples, error codes, and a complete real-project reference).
>
> Validated on a real ERP/CRM system: 46 entities / 79 pages / 201 buttons, 0 check issues, 100% requirement coverage, both targets building.

**First comment (maker):**
> Hi Product Hunt! 👋
>
> I kept hitting the same wall with LLM-written business apps: it writes front and back end separately, they drift, types go wild, and when it breaks the model can't read the error well enough to fix its own code. The missing piece was a compiler to act as arbiter.
>
> TDSL is that compiler. You write TypeScript-like definitions once; it generates a Spring Boot + React stack and hands back structured errors an agent can actually fix. The guiding rule is "the compiler infers nothing" — every foreign key, every page binding, every label is explicit, so behavior stays predictable.
>
> Early days (0.0.x), API still moving. Would love your feedback on the syntax and the agent workflow — and if you build something with it, tell me what broke. 🙏

---

## Show HN

**Title:** Show HN: TDSL – write TypeScript-like DSL, compile to React + Spring Boot

**Body:**
> TDSL is a low-code DSL aimed at coding agents. You describe entities, REST endpoints, pages, and logic in TypeScript-like syntax (`entity` / `interface` / `page` keywords, otherwise TS lexical forms). It parses to a typed AST and, after typechecking, generates two projects: Spring Boot + JPA and React + Ant Design.
>
> The design bet: give the model a compiler as arbiter. Diagnostics are structured (`[severity] [code] message (file:line:col) + change to: suggestion`) so an agent can self-correct — write, `tdsl check`, fix, repeat until 0 errors. It also enforces "zero inference": foreign keys must be explicit `@ref(...)`, any function used by a page must be exposed by an interface endpoint (this specific check is there to prevent blank frontends), and business copy (enum labels, button text, operation feedback) lives in the DSL rather than the generator.
>
> It's not strict TypeScript — there's no ternary, template strings, `==`, arrow functions, or `class`; a small forbidden list keeps the surface unambiguous and easy to compile.
>
> There's a spec-first path too: write `spec.yaml` (six layers: system → module → function → page → button → field), implement in `.tdsl` shards, then `tdsl check-spec` reconciles coverage and exits non-zero in CI.
>
> Validated on a real system: a subset of the Yudao ERP/CRM — 46 entities, 79 pages, 201 buttons; check is clean, coverage is 100%, and both targets build.
>
> CLI is on npm (`npm i -g @tdsl/cli`), Apache-2.0, Node ≥ 18. Repo and playground in the links.
>
> Happy to answer anything about the compiler, the codegen, or why the "no inference" rule ended up mattering so much in practice.

---

## Reddit

Suggested subs: r/webdev, r/programming, r/reactjs (angle: generated React), r/java (angle: generated Spring Boot), r/LocalLLaMA or an agent-focused sub (angle: agent-first).

**Title:** I built a DSL where you write TypeScript-like code once and it compiles to both a React and a Spring Boot app

**Body:**
> Context: I got tired of LLM-generated business apps drifting between front and back end. There's no compiler to catch the mismatch, and the model can't read the resulting errors well enough to fix its own code.
>
> TDSL is my attempt to fix that. You write one set of definitions (entities, REST contracts, pages, logic) in TypeScript-like syntax; it generates a Spring Boot / JPA backend and a React / Ant Design frontend that actually build. The frontend and backend fields/types/endpoints line up by construction.
>
> The part I'm most curious to get feedback on: the compiler is deliberately "zero inference." Foreign keys need explicit `@ref(Entity)` (a field named `supplierId` does nothing), and any function a page binds to must be exposed by an interface endpoint or typecheck fails. More typing, but way fewer surprises.
>
> Diagnostics are structured so an AI agent can self-repair to zero errors, and there's a spec→code→coverage reconciliation step (`tdsl check-spec`) for CI.
>
> It's early (0.0.x). `npm i -g @tdsl/cli`; repo: https://github.com/raindrop4steven/tdsl
>
> Would genuinely love critiques on the syntax and the "explicit everything" philosophy.

---

## X / Twitter thread

1/ Writing business apps with LLMs keeps hitting the same wall: no compiler as arbiter. Front and back end drift, types go wild, and the model can't read the errors well enough to fix its own code.

So I built one. Meet TDSL 🧵

2/ TDSL is a low-code DSL for coding agents: write entities, APIs, pages and logic in TypeScript-like syntax → compile to **Spring Boot + React**, two independently buildable projects.

One source. Two targets. Aligned by construction.

3/ It's built for agents, not just humans. Errors come back structured:
`[error] ENTITY-WHERE ... (file:line:col) + change to: ...`
So the model can read → locate → fix → re-check, looping to 0 errors on its own.

4/ Design rule: **the compiler infers nothing.**
• FKs need explicit `@ref(Salesman)`
• A function used by a page must be exposed by an endpoint (prevents blank screens)
• Enum labels / button text / feedback copy all live in the DSL

Explicit > clever.

5/ Spec-first is baked in: write `spec.yaml`, implement in `.tdsl` shards, then `tdsl check-spec` reconciles coverage and fails CI on gaps.

6/ Proven on a real system: a subset of Yudao ERP/CRM — 46 entities / 79 pages / 201 buttons, 0 check errors, 100% coverage (1091 items), both builds green. ✅

7/ Early days (0.0.x), Apache-2.0.
`npm i -g @tdsl/cli`
Repo: https://github.com/raindrop4steven/tdsl
Playground: https://raindrop4steven.github.io/tdsl/

Try it, break it, tell me what's missing. 🙏

---

## LinkedIn / newsletter blurb

> Most "AI writes your app" demos fall over in production for a boring reason: there's no compiler. The model writes the front end and back end separately, they drift, and nothing catches it.
>
> TDSL is a low-code DSL for coding agents that fixes this at the language level. Write entities, REST contracts, pages and logic once, in TypeScript-like syntax — compile to a Spring Boot + React stack. Diagnostics are structured so an agent can fix its own errors, and the compiler deliberately infers nothing, keeping behavior predictable.
>
> Validated on a real ERP/CRM system: 46 entities, 79 pages, 201 buttons, 0 errors, 100% requirement coverage, both targets building. Apache-2.0, `npm i -g @tdsl/cli`.
