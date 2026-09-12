系统：进销存管理系统（id=jxc）

── 数据字典（枚举） ──
enum GoodsCategory { FOOD、DAILY、CLOTH、OTHER } // 商品类别：FOOD=食品、DAILY=日用品、CLOTH=服装、OTHER=其他
enum Unit { PIECE、KILOGRAM、BOX、BOTTLE } // 计量单位：PIECE=个、KILOGRAM=千克、BOX=箱、BOTTLE=瓶

── 实体 ──
entity Goods {
  id: Integer;  // 主键
  code: String;  // 商品编码
  name: String;  // 商品名称
  category: GoodsCategory;  // 商品类别
  spec: String @nullable;  // 规格型号
  origin: String @nullable;  // 产地
  unit: Unit;  // 计量单位
  purchasePrice: Decimal;  // 采购单价
  salePrice: Decimal;  // 销售单价
  safetyStock: Integer @nullable;  // 安全库存
  remark: String @nullable;  // 备注
}
entity Supplier {
  id: Integer;  // 主键
  name: String;  // 供应商名称
  shortName: String @nullable;  // 供应商简称
  creditCode: String;  // 信用代码
  contact: String @nullable;  // 联系人
  phone: String @nullable;  // 联系电话
  address: String @nullable;  // 联系地址
  invoiceAddress: String @nullable;  // 开票地址
  invoicePhone: String @nullable;  // 开票电话
  bankName: String @nullable;  // 开户银行
  bankAccount: String @nullable;  // 银行账号
  remark: String @nullable;  // 备注
}
entity Customer {
  id: Integer;  // 主键
  name: String;  // 客户名称
  shortName: String @nullable;  // 客户简称
  creditCode: String;  // 信用代码
  contact: String @nullable;  // 联系人
  phone: String @nullable;  // 联系电话
  address: String @nullable;  // 联系地址
  invoiceAddress: String @nullable;  // 开票地址
  invoicePhone: String @nullable;  // 开票电话
  bankName: String @nullable;  // 开户银行
  bankAccount: String @nullable;  // 银行账号
  remark: String @nullable;  // 备注
}

── 模块 基础数据（id=base） ──
功能 商品管理（id=goods）
- 页面 GoodsList（商品列表，类型 list，实体 Goods）
  主查询逻辑: searchGoods
  列表列: code、name、category、spec、unit、purchasePrice、salePrice、safetyStock
  查询条件: code、name、category
  按钮 新增商品（page），动作 openDialog('GoodsEdit')
  按钮 编辑（row），动作 openDialog('GoodsEdit')
  按钮 删除（row），动作 logic('deleteGoods')
- 页面 GoodsEdit（商品编辑，类型 dialog-form，实体 Goods）
  表单字段: code、name、category、spec、origin、unit、purchasePrice、salePrice、safetyStock、remark
  按钮 保存（page），动作 logic('saveGoods')
功能 供应商管理（id=supplier）
- 页面 SupplierList（供应商列表，类型 list，实体 Supplier）
  主查询逻辑: searchSuppliers
  列表列: name、shortName、contact、phone、creditCode、address
  查询条件: name
  按钮 新增供应商（page），动作 openDialog('SupplierEdit')
  按钮 编辑（row），动作 openDialog('SupplierEdit')
  按钮 删除（row），动作 logic('deleteSupplier')
- 页面 SupplierEdit（供应商编辑，类型 dialog-form，实体 Supplier）
  表单字段: name、shortName、creditCode、contact、phone、address、invoiceAddress、invoicePhone、bankName、bankAccount、remark
  按钮 保存（page），动作 logic('saveSupplier')
功能 客户管理（id=customer）
- 页面 CustomerList（客户列表，类型 list，实体 Customer）
  主查询逻辑: searchCustomers
  列表列: name、shortName、contact、phone、creditCode、address
  查询条件: name
  按钮 新增客户（page），动作 openDialog('CustomerEdit')
  按钮 编辑（row），动作 openDialog('CustomerEdit')
  按钮 删除（row），动作 logic('deleteCustomer')
- 页面 CustomerEdit（客户编辑，类型 dialog-form，实体 Customer）
  表单字段: name、shortName、creditCode、contact、phone、address、invoiceAddress、invoicePhone、bankName、bankAccount、remark
  按钮 保存（page），动作 logic('saveCustomer')

要求：输出单个 TDSL 文件，包含以上实体 + @export function（页面绑定与按钮动作都要接通）+ interface + page/dialog 声明，覆盖上列所有页面与按钮。
命名映射：页面 id = TDSL page/dialog 名；按钮 name = button text；主查询/动作 target = TDSL function 名。
业务规则提示（来自原系统）：单据仅 暂存(DRAFT)/已提交(SUBMITTED) 两态；提交后不可编辑删除。