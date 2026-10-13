# Error cheat sheet & fixes (tdsl check diagnostics)

> [中文](errors.zh.md) · **English**

> `tdsl check` prints structured diagnostics: `[severity] [code] message (file:line:col) + change to: suggestion`.
> Fix loop: read the diagnostic → look up the code in the table below → fix → **check again** (it reports everything at once, so you can fix several in one pass).
> Principle: **errors must be zeroed; warnings (DEP-2/3, FK-REF-NO-QUERY, NULLABLE-HINT) don't block but should be reviewed**.

## 1. Fix workflow (agent loop)

```
1. tdsl check <tdsl dir>            # full diagnostics (ordered error → warning, declaration order)
2. Read each: the code locates the error class → use the table to get "change to"
3. Fix same-layer issues together (the compiler reports all errors, so no one-per-round); re-run check
4. Only 0 errors counts as passing; running build is optional (tdsl build)
```

Discipline (lessons from real use):
- **Write business copy/data in TDSL** (`@ok`, enum label, button text) — don't count on changing the generator.
- **Foreign keys need an explicit `@ref`** — the compiler infers nothing; a name like `xxxId` carries no semantics.
- Functions a page uses **must be exposed by an interface endpoint**, otherwise the generated frontend api.ts lacks them → blank screen.
- Clear the output directory before generating (orphan files make mvn fail on duplicate main classes).

## 2. Syntax errors (parser, no code)

| Symptom | Cause | Change to |
|---|---|---|
| unexpected / deprecated hint | used legacy lexical forms `logic` / `:=` / `for-in` | `function` / `const x =` / `for (const x of xs)` |
| error line contains `?` `:` ternary | TDSL has no ternary | `if (...) {...} else {...}` |
| template-string `` ` `` errors | no template strings | string concatenation `'a' + x` |
| arrow function errors | no arrow functions | ordinary statements / for-of |
| `for` missing const | `for (x of xs)` | `for (const x of xs)` |

## 3. Entities & queries

| code | Trigger | Change to |
|---|---|---|
| `DANGLE-REF` | references a nonexistent entity/struct/logic (incl. a mistyped cross-file short name) | align the name; qualify cross-source same-name as `erp.Order` |
| `ENTITY-METHOD` | entity method misuse (e.g. `get()` with no arg, `all()` with an arg) | `Order.get(id)` / `Order.all` (the property takes no parentheses) |
| `ENTITY-WHERE` | a where condition isn't `field op value` | condition fields must be entity properties; ops `= >= <= > < like in` (`=` means equals) |
| `ENTITY-CHAIN` | query-chain misuse (empty orderBy, limit/page position, aggregate right after where) | follow the syntax: `.orderBy(f desc).limit(n).page(n,size)`; aggregate `where(...).aggregate(count())` |
| `FOREACH-CONTAINER` | for-of container isn't a List | use an entity query / a known List variable |
| `LIST-SHAPE` | List usage/shape mismatch | refer to `xs.add/count/get/contains/isEmpty` |

## 4. Foreign keys @ref

| code | Trigger | Change to |
|---|---|---|
| `FK-REF-ENTITY` | the X in `@ref(X)` isn't an entity | use the target entity name |
| `FK-REF-DISPLAY` | the display field doesn't exist or isn't a String | use a String field of the target entity (defaults to `'name'`) |
| `FK-REF-NO-QUERY` (warning) | the target entity lacks a `query*` dropdown source | add a query logic returning `List<that entity>` |

## 5. Pages & forms

| code | Trigger | Change to |
|---|---|---|
| `VIEW-COMPONENT` | component tag unmatched (not a built-in name, or a missing npm declaration) | use a built-in component, or add `dependency npm "pkg" import X;` |
| `VIEW-BINDING` | dangling/mis-shaped binding (useQuery pointing at an unexposed function, navigate pointing at a dialog, openDialog at a page) | see the detail table below |
| `FORM-SEMANTICS` | wrong form/repeat/summary structure | a `summary` field must match a repeat in the same form; `of` and `expr` are mutually exclusive |
| `SUMMARY-TARGET` | summary field doesn't match a repeat | set field to the field name of the corresponding `<repeat field="items">` |
| `SUMMARY-EXPR` | expr isn't an expression | `expr={qty * price}` (a pure row-context expression) |
| `INTERFACE-LOGICREF` | endpoint `-> xxx` is dangling | align the @export function name |

VIEW-BINDING details (page-binding 6 checks):

| message keyword | Change to |
|---|---|
| `悬空逻辑引用` ("dangling logic reference") | the bound function doesn't exist — align the function name |
| `没有 interface 端点暴露` ("no interface endpoint exposes it") | add a line `GET '/api/...' -> fnName` in the interface |
| `openDialog 悬空页面` ("openDialog dangling page") | wrong dialog name |
| `是 page 而非 dialog` ("is a page, not a dialog") | use `navigate` for a page, `openDialog` for a dialog |
| `navigate 悬空页面` ("navigate dangling page") | wrong page name |
| `是 dialog…改用 openDialog` ("is a dialog… use openDialog") | a dialog has no route; use `openDialog('X', row)` |

## 6. Dependency declarations (DEP-1~4)

| code | Trigger | Change to |
|---|---|---|
| `DEP-1` | used an undeclared third-party class | add at top level `dependency java "g:a:v" import { ClassName };` |
| `DEP-2` (warning) | declared a java dependency but libs/ has no scanned artifact | `tdsl bundle-jar <jar> -o <project>/libs/x.json` |
| `DEP-3` (warning) | declared version ≠ artifact-coordinate version | align the versions on both sides |
| `DEP-4` | alias collision (same-named classes across jars, e.g. both fastjson/jackson ship JSON) | change the artifact alias, or `dependency java "..." as ns` then write `ns.JSON` |

## 7. FFI / service

| code | Trigger | Change to |
|---|---|---|
| `FFI-MEMBER` | member not in the kernel catalog/dependency artifact | use an available member; for jar-library members run `tdsl bundle-jar` and merge it in |
| `FFI-STATIC` | instance method called statically | first `const x = new Class(…)`, then `x.m(...)` |
| `MEMBER-UNKNOWN` | a struct variable accessed a nonexistent field | align the field name declared on the struct |
| `SERVICE-KIND` | invalid service kind | only `dubbo` / `http` are supported |
| `SERVICE-HTTP-OPER` | http service missing METHOD+path | `GET '/api/x/{id}' -> fn(...): T;` |
| `SERVICE-MEMBER` | service member declared incorrectly | follow the service syntax (method signature / http operation line) |
| `NULLABLE-HINT` (warning) | local variable shadowing (e.g. ambiguous null-check on an `X.get` result) | just review; doesn't block |
