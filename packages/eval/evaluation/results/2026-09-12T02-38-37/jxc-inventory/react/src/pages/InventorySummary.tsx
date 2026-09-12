import { useQuery } from '../hooks';
import * as api from '../api';
import { Table, Card } from 'antd';

export default function InventorySummary() {
  const qInventorySummary = useQuery(() => api.inventorySummary());
  return (
    <Card style={{ margin: '0 auto' }}>
      <h2 style={{ marginTop: 0 }}>InventorySummary</h2>
<Table
  dataSource={qInventorySummary.data ?? []}
  rowKey="goodsCode"
  pagination={false}
  columns={[
    { title: 'goodsCode', dataIndex: 'goodsCode' },
    { title: 'goodsName', dataIndex: 'goodsName' },
    { title: 'category', dataIndex: 'category' },
    { title: 'spec', dataIndex: 'spec' },
    { title: 'unit', dataIndex: 'unit' },
    { title: 'safetyStock', dataIndex: 'safetyStock' },
    { title: 'inQty', dataIndex: 'inQty' },
    { title: 'inRetQty', dataIndex: 'inRetQty' },
    { title: 'outQty', dataIndex: 'outQty' },
    { title: 'outRetQty', dataIndex: 'outRetQty' },
    { title: 'stock', dataIndex: 'stock' }
  ]}
/>
    </Card>
  );
}
