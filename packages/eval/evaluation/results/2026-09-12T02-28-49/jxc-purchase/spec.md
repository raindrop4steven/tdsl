系统：进销存管理系统（id=jxc）

── 数据字典（枚举） ──
enum GoodsCategory { FOOD、DAILY、CLOTH、OTHER } // 商品类别：FOOD=食品、DAILY=日用品、CLOTH=服装、OTHER=其他
enum Unit { PIECE、KILOGRAM、BOX、BOTTLE } // 计量单位：PIECE=个、KILOGRAM=千克、BOX=箱、BOTTLE=瓶
enum SettleMode { CASH、ACCOUNT } // 结算方式：CASH=现金、ACCOUNT=对账
enum DocStatus { DRAFT、SUBMITTED } // 单证状态：DRAFT=暂存、SUBMITTED=已提交

── 实体 ──
entity PurchaseBill {
  id: Integer;  // 主键
  billNo: String;  // 进货单号
  status: DocStatus;  // 单证状态
  billDate: DateTime;  // 进货日期
  supplierId: Integer;  // 供应商
  contractNo: String @nullable;  // 合同号
  invoiceNo: String @nullable;  // 发票号
  logisticsCompany: String @nullable;  // 物流公司
  logisticsNo: String @nullable;  // 物流单号
  totalAmount: Decimal @nullable;  // 总金额
  settleMode: SettleMode;  // 结算方式
  remark: String @nullable;  // 备注
}
entity PurchaseBillItem {
  id: Integer;  // 主键
  billId: Integer;  // 进货单
  goodsId: Integer;  // 商品
  goodsCode: String @nullable;  // 商品编码
  goodsName: String @nullable;  // 商品名称
  category: GoodsCategory @nullable;  // 商品类别
  spec: String @nullable;  // 规格型号
  unit: Unit @nullable;  // 计量单位
  qty: Integer;  // 数量
  price: Decimal;  // 单价
  amount: Decimal @nullable;  // 金额
  remark: String @nullable;  // 备注
}
entity PurchaseReturnBill {
  id: Integer;  // 主键
  billNo: String;  // 退货单号
  status: DocStatus;  // 单证状态
  returnDate: DateTime;  // 退货日期
  sourceBillNo: String;  // 原进货单号
  totalAmount: Decimal @nullable;  // 总金额
  remark: String @nullable;  // 备注
}

── 模块 采购管理（id=purchase） ──
功能 进货单（id=purchase-bill）
- 页面 PurchaseBillList（进货单列表，类型 list，实体 PurchaseBill）
  主查询逻辑: searchPurchaseBills
  列表列: billNo、billDate、supplierId、status、totalAmount、settleMode
  查询条件: billNo、status
  按钮 新增进货单（page），动作 openDialog('PurchaseBillEdit')
  按钮 编辑（row），动作 openDialog('PurchaseBillEdit')
  按钮 删除（row），动作 logic('deletePurchaseBill')
  按钮 复制（row），动作 logic('copyPurchaseBill')
  按钮 整单退货（row），动作 logic('returnPurchaseBill')
- 页面 PurchaseBillEdit（进货单编辑，类型 dialog-form，实体 PurchaseBill）
  表单字段: billNo、billDate、supplierId、contractNo、invoiceNo、logisticsCompany、logisticsNo、settleMode、remark
  明细子表: repeat 字段 items（PurchaseBillItem），字段 goodsId、qty、price
  按钮 暂存（page），动作 logic('savePurchaseBill')
  按钮 提交（page），动作 logic('submitPurchaseBill')
功能 进货退货查询（id=purchase-return）
- 页面 PurchaseReturnList（进货退货列表，类型 list，实体 PurchaseReturnBill）
  主查询逻辑: searchPurchaseReturns
  列表列: billNo、returnDate、sourceBillNo、totalAmount、status
  查询条件: billNo

要求：输出单个 TDSL 文件，包含以上实体 + @export function（页面绑定与按钮动作都要接通）+ interface + page/dialog 声明，覆盖上列所有页面与按钮。
命名映射：页面 id = TDSL page/dialog 名；按钮 name = button text；主查询/动作 target = TDSL function 名。
业务规则提示（来自原系统）：单据仅 暂存(DRAFT)/已提交(SUBMITTED) 两态；提交后不可编辑删除。