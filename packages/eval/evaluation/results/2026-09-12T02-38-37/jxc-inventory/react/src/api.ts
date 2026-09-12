// 自动生成：接口 → fetch 封装（TDSL interface）
import type { Goods } from './types';
const API = '';

export function inventorySummary(goodsCode?: string): Promise<Array<Goods>> {
  const qs: string[] = [];
  if (goodsCode !== undefined) qs.push('goodsCode=' + encodeURIComponent(String(goodsCode)));
  return fetch(API + '/api/inventory/summary' + (qs.length ? '?' + qs.join('&') : '')).then((r) => r.json());
}
