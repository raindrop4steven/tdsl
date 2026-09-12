系统：进销存管理系统（id=jxc）

── 数据字典（枚举） ──

── 实体 ──

── 模块 库存查询（id=inventory） ──
功能 进销存汇总（id=summary）
- 页面 InventorySummary（进销存汇总表，类型 list）
  主查询逻辑: inventorySummary
  列表列: goodsCode、goodsName、category、spec、unit、safetyStock、inQty、inRetQty、outQty、outRetQty、stock
  查询条件: goodsCode

要求：输出单个 TDSL 文件，包含以上实体 + @export function（页面绑定与按钮动作都要接通）+ interface + page/dialog 声明，覆盖上列所有页面与按钮。
命名映射：页面 id = TDSL page/dialog 名；按钮 name = button text；主查询/动作 target = TDSL function 名。
业务规则提示（来自原系统）：单据仅 暂存(DRAFT)/已提交(SUBMITTED) 两态；提交后不可编辑删除。