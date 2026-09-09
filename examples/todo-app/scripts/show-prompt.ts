// 临时脚本：查看 composePrompt 真实产物
import { composePrompt } from '@tdsl/llm';

const prompt = composePrompt({
  requirement: '帮我做一个库存管理：商品有名称/数量/单价，支持入库出库、库存查询（按名称搜索、低库存预警排序）、库存统计报表',
});

console.log(prompt);
console.log(`\n===== 统计 =====`);
console.log(`总长度: ${prompt.length} 字符`);
