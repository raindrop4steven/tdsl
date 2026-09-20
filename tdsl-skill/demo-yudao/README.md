# demo：芋道 ERP/CRM（完整真工程参照）

> 来源 `examples/yudao/`：真实企业系统（芋道 ruoyi-vue-pro ERP/CRM 子集）复刻的 TDSL 工程。
> **已验证**：`tdsl check` 0 问题、check-spec 覆盖 1091 项 100%、Java/React 双端 build 通过。
> 想看"一个完整企业应用怎么组织 TDSL"，读这个。

## spec.yaml（需求侧事实源）

`spec.yaml` 是这个工程的**结构化需求 Spec**（六层：系统→模块→功能→页面→按钮→字段，1743 行）——先有 Spec，TDSL 分片按它逐层实现，`check-spec` 对照器验证覆盖率 100%。

LLM 参照价值：看"一段业务需求怎么拆成页面/按钮/字段清单"，再怎么落成 TDSL。读 TDSL 时对照 spec 同名条目即可理解每个分片对应哪块需求。

## 分片结构（按功能域纵向切）

| 分片 | 内容 |
|---|---|
| `00-model.tdsl` | 全部枚举（数据字典）+ 实体（46 个）+ 输入结构；@ref 外键集中声明 |
| `05-portal.tdsl` | 门户看板：条件聚合统计 + statistic/carousel/progress/row-col 门户组件 |
| `10-product.tdsl` | 产品/分类/单位 + 字典 + 人员：查询/保存/删除 + 列表/表单页面 |
| `20-stock.tdsl` | 仓库/库存/流水 + `applyStock` 共享联动入口（审批写库存） |
| `30-purchase.tdsl` | 采购：订单/入库/退货/付款（主子表 + 审批流 + 状态化按钮 + 明细 repeat dataSource） |
| `40-sale.tdsl` | 销售：订单/出库/退货/收款（同采购范式 + 出库联动库存） |
| `50-finance.tdsl` | 结算账户/收付款核销 |
| `60-crm.tdsl` | CRM：线索/客户/商机/合同/回款（公海语义：领取/放入/锁定/分配） |

## 读法（LLM 参照建议）

1. **先读 `00-model.tdsl`** 学数据建模：枚举 label/颜色、@ref 显式外键、@nullable、struct 输入。
2. **再读 `10-product.tdsl`** 学单表 CRUD 完整形态（logic + interface + page/dialog）。
3. **读 `30-purchase.tdsl`** 学企业级范式：主子表、状态机按钮（visible/disabled）、明细 dataSource、详情抽屉、@ok、审批联动。
4. **读 `05-portal.tdsl`** 学聚合统计与门户组件。
5. 写自己业务时对照 `../fewshot/patterns-yudao.md` 的模式清单。

## 编译方式

```bash
tdsl check <本目录>/tdsl
tdsl generate <本目录>/tdsl --name yudao -o <输出目录>
```

注意：分片共享全局命名空间——实体/函数/页面名全局唯一；`@datasource('yudaoDS')` 声明一次，后续分片沿用（或再声明切换）。