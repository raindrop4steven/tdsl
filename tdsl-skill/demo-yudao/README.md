# demo: Yudao ERP/CRM (a complete real-project reference)

> [中文](README.zh.md) · **English**

> Source `examples/yudao/`: a TDSL project replicating a real enterprise system (a subset of Yudao ruoyi-vue-pro ERP/CRM).
> **Verified**: `tdsl check` 0 issues, check-spec 100% over 1091 items, both Java/React targets build.
> To see "how a complete enterprise app is organized in TDSL", read this.

## spec.yaml (the requirements-side source of truth)

`spec.yaml` is this project's **structured requirements spec** (six layers: system → module → function → page → button → field, 1743 lines) — the spec comes first, the TDSL shards implement it layer by layer, and the `check-spec` reconciler verifies 100% coverage.

Value for an LLM: see "how a piece of business requirements is broken into page/button/field lists", then how it lands as TDSL. When reading TDSL, match it against the same-named spec entries to understand which requirement each shard covers.

## Shard structure (split vertically by functional domain)

| Shard | Content |
|---|---|
| `00-model.tdsl` | All enums (data dictionary) + entities (46) + input structs; @ref foreign keys declared centrally |
| `05-portal.tdsl` | Portal dashboard: conditional aggregation stats + statistic/carousel/progress/row-col portal components |
| `10-product.tdsl` | Product/category/unit + dictionary + staff: query/save/delete + list/form pages |
| `20-stock.tdsl` | Warehouse/stock/movements + the shared `applyStock` linkage entry point (approval writes stock) |
| `30-purchase.tdsl` | Purchasing: order/goods-receipt/return/payment (master-detail + approval flow + stateful buttons + line-item repeat dataSource) |
| `40-sale.tdsl` | Sales: order/goods-out/return/collection (same patterns as purchasing + goods-out links to stock) |
| `50-finance.tdsl` | Settlement accounts / payment-receipt reconciliation |
| `60-crm.tdsl` | CRM: leads/customers/opportunities/contracts/collections (public-pool semantics: claim/put back/lock/assign) |

## How to read (LLM reference suggestions)

1. **Read `00-model.tdsl` first** to learn data modeling: enum label/color, explicit @ref foreign keys, @nullable, struct inputs.
2. **Then read `10-product.tdsl`** to learn the complete single-table CRUD shape (logic + interface + page/dialog).
3. **Read `30-purchase.tdsl`** to learn enterprise patterns: master-detail, state-machine buttons (visible/disabled), line-item dataSource, detail drawer, @ok, approval linkage.
4. **Read `05-portal.tdsl`** to learn aggregation stats and portal components.
5. When writing your own business, compare against the pattern list in `../fewshot/patterns-yudao.md`.

## How to compile

```bash
tdsl check <this dir>/tdsl
tdsl generate <this dir>/tdsl --name yudao -o <output dir>
```

Note: shards share a global namespace — entity/function/page names are globally unique; `@datasource('yudaoDS')` is declared once and later shards reuse it (or re-declare to switch).
