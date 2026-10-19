import {
  AlertOutlined,
  CameraOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Button, Flex, Layout, Menu } from 'antd';
import { useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AlertsPage from '../pages/alerts-page';
import ChannelsPage from '../pages/channels-page';
import ConfigurationPage from '../pages/configuration-page';
import MonitoringProfilesPage from '../pages/monitoring-profiles-page';

const { Header, Sider, Content } = Layout;

// Just enough for a menu icon and its padding (antd's default collapsed width is 80px).
const SIDEBAR_COLLAPSED_WIDTH = 56;

const NAV_ITEMS = [
  { key: '/channels', icon: <CameraOutlined />, label: <Link to="/channels">Channels</Link> },
  { key: '/monitoring-profiles', icon: <UserOutlined />, label: <Link to="/monitoring-profiles">Monitoring Profiles</Link> },
  { key: '/alerts', icon: <AlertOutlined />, label: <Link to="/alerts">Alerts</Link> },
  { key: '/configuration', icon: <SettingOutlined />, label: <Link to="/configuration">Configuration</Link> },
];

export function App() {
  const location = useLocation();
  const selectedKey = NAV_ITEMS.find((item) => location.pathname.startsWith(item.key))?.key ?? '/channels';
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    // Viewport-height shell: only the content area scrolls, so the sidebar's collapse toggle stays
    // pinned to the bottom of the screen on long pages.
    <Layout style={{ height: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ color: 'white', fontSize: 18, fontWeight: 600 }}>Security Server</span>
      </Header>
      <Layout style={{ minHeight: 0 }}>
        {/* Collapses to icons only; the menu follows the Sider's collapsed state automatically. */}
        <Sider
          className="app-shell-sidebar"
          width={220}
          collapsedWidth={SIDEBAR_COLLAPSED_WIDTH}
          theme="light"
          collapsible
          trigger={null}
          collapsed={sidebarCollapsed}
        >
          <Flex vertical className="app-shell-sidebar-inner">
            <div className="app-shell-sidebar-menu">
              <Menu mode="inline" selectedKeys={[selectedKey]} items={NAV_ITEMS} />
            </div>
            <Button
              type="link"
              className="app-shell-sidebar-collapse"
              icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              style={{ fontSize: '16px', width: SIDEBAR_COLLAPSED_WIDTH, height: 64 }}
            />
          </Flex>
        </Sider>
        <Layout style={{ padding: 24, overflow: 'auto' }}>
          <Content style={{ background: '#fff', padding: 24, borderRadius: 8 }}>
            <Routes>
              <Route path="/" element={<Navigate to="/channels" replace />} />
              <Route path="/channels" element={<ChannelsPage />} />
              <Route path="/monitoring-profiles" element={<MonitoringProfilesPage />} />
              <Route path="/alerts" element={<AlertsPage />} />
              <Route path="/configuration" element={<ConfigurationPage />} />
            </Routes>
          </Content>
        </Layout>
      </Layout>
    </Layout>
  );
}

export default App;
