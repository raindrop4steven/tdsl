---
name: tdsl-spec-first
description: TDSL requirements-first workflow (Spec-Driven Development, SDD). Use when receiving a business requirement to write TDSL, when a vague requirement needs structuring first, when creating or modifying a TDSL project, or when reconciling requirement coverage.
---

# Spec-first: requirements → spec → TDSL → reconcile

> [中文](SKILL.md) · **English**

> On receiving a requirement, **write the spec first (or edit the existing spec), then write TDSL** — this is the main methodology validated on this project
> (the jxc inventory system and the yudao ERP were both delivered this way, at 100% reconciliation coverage).
> Benefits: ① once structured, omissions surface; ② the spec is the contract you align with the user on (change the spec first); ③ the reconciler can automatically verify "nothing written is missing".

## Workflow

```
1. Receive requirement → read the project's existing spec.yaml (edit if present, create if not)
2. Lay the requirement into the spec using the six-layer format (list every uncertain field/button — don't guess)
3. Confirm the spec with the user (this is the requirement checklist)
4. Write/modify tdsl shards per the spec (see ../fewshot/ and ../demo-yudao/)
5. tdsl check → 0 errors (fix via ../errors/)
6. check-spec reconciliation (if the project ships a reconciler) → fill gaps to 100%
```

## spec.yaml six-layer format

```
system:                  # ① System: one-line positioning
  id: yudao
  name: Yudao ERP/CRM business platform
  description: >- ...

data:                    # ② Data dictionary (③ Data model)
  enums:
    - id: DocStatus
      name: Document status
      items:
        - { key: UNAUDIT, label: Unaudited }
        - { key: AUDITED, label: Audited }
  entities:
    - id: ProductCategory
      name: Product category
      fields:
        - { id: id, name: PK, type: Integer, required: true }
        - { id: parentId, name: Parent category, type: Integer }
        - { id: name, name: Category name, type: String, required: true }
        - { id: status, name: Enabled status, type: ProductStatus, required: true }

modules:                 # ④ Module → ⑤ Function → ⑥ Page (columns/search/form fields/buttons/actions)
  - id: product
    name: Product management
    functions:
      - id: erp-category
        name: Product category
        pages:
          - id: erpProductCategoryList     # page id must match the TDSL page/dialog name
            name: Product category list
            kind: list                      # list | dialog-form | detail | dashboard
            entity: ProductCategory         # corresponding TDSL entity
            query: queryErpProductCategory  # list data logic name
            columns: [name, code, sort, status]
            search: [name, status]
            buttons:
              - { id: add, name: Add category, scope: page, action: { type: openDialog, target: erpProductCategoryForm } }
              - { id: edit, name: Edit, scope: row, action: { type: openDialog, target: erpProductCategoryForm } }
              - { id: remove, name: Delete, scope: row, action: { type: logic, target: deleteErpProductCategory } }
          - id: erpProductCategoryForm
            name: Category edit
            kind: dialog-form
            entity: ProductCategory
            fields: [parentId, name, code, sort, status]
            buttons:
              - { id: save, name: Save, scope: page, action: { type: logic, target: saveErpProductCategory } }
```

## Field mapping

| spec form | Corresponding TDSL |
|---|---|
| `kind: list` | `page XxxList` (@title/@menu) |
| `kind: dialog-form` | `dialog XxxForm` + `<form submit={useMutation('saveXxx')}>` |
| `kind: detail` | `dialog XxxDetail` + `<detail dataSource={useQuery('getXxx', initial.id)}>` |
| `action.type: logic` | `useMutation('target', row.id)` |
| `action.type: openDialog` | `openDialog('target', row)` |
| `button.scope: page/row` | Page-level button / table-row button |
| button `name` | Must match the TDSL `<button text="...">` (the reconciler matches by text) |
| enum label | TDSL enum `KEY('label')`; add a second argument for a color |

## Reconciler (check-spec)

```bash
tdsl check-spec <project-dir>    # the dir must contain spec.yaml and tdsl/*.tdsl
```

- Five-dimensional reconciliation: entity fields / enums / pages / buttons / action bindings, all at error level; a non-zero gap exits with code 1 (CI-friendly).
- Exit codes: 0 = zero gaps; 1 = gaps present; 2 = spec/tdsl read or parse failure.
- The gap list is literally "the TDSL not yet written" — fill it in and re-reconcile to 100%.
- Spec and TDSL changes **must stay in sync both ways**: change the requirement first in the spec; change the implementation and it must pass reconciliation.

## Full reference

`../demo-yudao/spec.yaml` (1743 lines, 46 entities / 79 pages / 201 buttons) plus the 8 tdsl shards in the same directory — every layer of the spec has a counterpart in the TDSL.
