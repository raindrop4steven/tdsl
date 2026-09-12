系统：进销存管理系统（id=jxc）

── 数据字典（枚举） ──
enum PayStatus { WAIT_CONFIRM、WAIT_INVOICE、WAIT_PAY、DONE } // 应收应付状态：WAIT_CONFIRM=待确认、WAIT_INVOICE=待开票、WAIT_PAY=待回款、DONE=已完结

── 实体 ──
entity Payable {
  id: Integer;  // 主键
  billNo: String;  // 关联进货单号
  supplierId: Integer;  // 供应商
  amount: Decimal;  // 应付金额
  invoiceNo: String @nullable;  // 发票号
  paidAmount: Decimal @nullable;  // 已付金额
  status: PayStatus;  // 状态
  remark: String @nullable;  // 备注
}
entity Receivable {
  id: Integer;  // 主键
  billNo: String;  // 关联销货单号
  customerId: Integer;  // 客户
  amount: Decimal;  // 应收金额
  invoiceNo: String @nullable;  // 发票号
  paidAmount: Decimal @nullable;  // 已收金额
  status: PayStatus;  // 状态
  remark: String @nullable;  // 备注
}

── 模块 应收应付（id=finance） ──
功能 应付款（id=payable）
- 页面 PayableList（应付款列表，类型 list，实体 Payable）
  主查询逻辑: searchPayables
  列表列: billNo、supplierId、amount、invoiceNo、paidAmount、status
  查询条件: billNo、status
  按钮 确认（row），动作 logic('confirmPayable')
  按钮 开票（row），动作 logic('invoicePayable')
  按钮 回款（row），动作 logic('payPayable')
功能 应收款（id=receivable）
- 页面 ReceivableList（应收款列表，类型 list，实体 Receivable）
  主查询逻辑: searchReceivables
  列表列: billNo、customerId、amount、invoiceNo、paidAmount、status
  查询条件: billNo、status
  按钮 确认（row），动作 logic('confirmReceivable')
  按钮 开票（row），动作 logic('invoiceReceivable')
  按钮 回款（row），动作 logic('payReceivable')

要求：输出单个 TDSL 文件，包含以上实体 + @export function（页面绑定与按钮动作都要接通）+ interface + page/dialog 声明，覆盖上列所有页面与按钮。
命名映射：页面 id = TDSL page/dialog 名；按钮 name = button text；主查询/动作 target = TDSL function 名。
业务规则提示（来自原系统）：单据仅 暂存(DRAFT)/已提交(SUBMITTED) 两态；提交后不可编辑删除。