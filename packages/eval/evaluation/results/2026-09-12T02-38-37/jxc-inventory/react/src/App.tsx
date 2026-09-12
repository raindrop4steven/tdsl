// 自动生成：页面路由 + 管理端布局（TDSL page）
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Layout, Menu } from 'antd';
import InventorySummary from './pages/InventorySummary';

const { Header, Sider, Content } = Layout;

const MENU_ITEMS = [
  { key: '/inventory-summary', label: 'InventorySummary' },
];

export default function App() {
  const nav = useNavigate();
  const base = '/' + (useLocation().pathname.split('/')[1] ?? '');
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: '#001529', color: '#fff', display: 'flex', alignItems: 'center', paddingInline: 24, fontWeight: 600, fontSize: 16 }}>
        Evalapp 管理系统
      </Header>
      <Layout>
        <Sider width={216} style={{ background: '#001529' }} collapsible collapsedWidth={64}>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[base]}
            defaultOpenKeys={[]}
            items={MENU_ITEMS}
            onClick={({ key }) => (String(key).startsWith('group-') ? undefined : nav(String(key)))}
            style={{ height: '100%', borderInlineEnd: 'none' }}
          />
        </Sider>
        <Content style={{ padding: 24, background: '#f5f5f5' }}>
          <Routes>
  <Route path="/" element={<Navigate to="/inventory-summary" replace />} />
  <Route path="/inventory-summary" element={<InventorySummary />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}
