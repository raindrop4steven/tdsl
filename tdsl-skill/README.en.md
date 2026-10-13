# TDSL Skill Pack (agent knowledge pack)

> [中文](README.md) · **English**

> A complete knowledge pack for an LLM/agent writing TDSL: syntax reference, few-shot examples, error fixes, and a real-world project reference.
> Companion compiler as the arbiter: `@tdsl/cli` (`tdsl check / generate / build`). **write → check → fix → check again** is the shortest loop.
>
> Build principle: `fewshot/basics.en.md` and `demo-yudao/` both come from **projects/unit-test-locked examples that actually compile**, not hand-written docs — this prevents example drift.

## Workflow (the standard route for an agent writing TDSL)

```
1. Read the requirements → **first write/modify spec.yaml** (structured requirements; see spec/SKILL.en.md; if the project has a spec, edit against it)
2. Unsure how to write something → pick a skill from the routing table below
3. Need an example to copy → pick a compilable example from fewshot/
4. Write .tdsl shards per the spec → tdsl check <tdsl dir>
5. Diagnostics → read the errors/ cheat sheet → fix → check again (loop to 0 errors)
6. check-spec reconciliation → the gap list is exactly what you haven't written; fill it to 100%
7. All green → optionally run tdsl generate / build to verify both targets
```

> Sharding convention (multi-file projects): split vertically by functional domain (model/product/inventory/purchase/sales/finance/CRM…); each shard starts with `@datasource(...)` belonging to the same app; the global namespace is shared across files, so entity/enum/function/page names are globally unique. See `demo-yudao/`.

## Routing table

| What you want to do | Where to go |
|---|---|
| Forgot a piece of syntax / first time here | `syntax/SKILL.en.md` (complete syntax, authoritative) |
| Got a business requirement and about to start / need to structure a vague one | `spec/SKILL.en.md` (spec-first workflow + six-layer format) |
| Want a complete compilable example to copy | `fewshot/basics.en.md` (5 basics, unit-test-locked, compilable) |
| Writing an enterprise app and want battle-tested patterns (foreign keys / stateful buttons / line items / drawers / portals) | `fewshot/patterns-yudao.en.md` (excerpted from the real yudao project) |
| `tdsl check` reported an error | `errors/errors.en.md` (error-code cheat sheet + fix discipline) |
| Want to imitate a complete real enterprise project | `demo-yudao/` (a subset of Yudao ERP/CRM: spec.yaml + 8 shards, compilable) |

## Directories

```
README.en.md         # this doc (routing entry point)
spec/                # spec-first: SKILL.en.md (requirements→spec→tdsl→reconcile workflow + six-layer format)
syntax/              # full syntax: SKILL.en.md
fewshot/             # examples: basics.en.md (basics) / patterns-yudao.en.md (enterprise patterns)
errors/              # fixes: errors.en.md (error-code cheat sheet + process)
demo-yudao/          # real-project reference: spec.yaml + 8 tdsl/*.tdsl shards + notes
```

## Provenance & versions

- Syntax forms and semantics are sourced from `docs/70_教程/20_语法手册.md`; this pack is the "for agents" distillation of it.
- Few-shot basics are sourced from `packages/llm/src/examples.ts` (unit-test-locked, compilable).
- The demo is sourced from `examples/yudao/` (0 check issues, both targets build).
- Compiler version it pairs with: see the `tdsl` CLI command version (`tdsl check` is authoritative).
