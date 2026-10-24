import {
  AlertOutlined,
  CameraOutlined,
  FileTextOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Flex, Layout, Menu, Tooltip } from 'antd';
import { useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { authApi, SESSION_QUERY_KEY } from '../api/auth';
import AdminRoute, { useAdminSession } from '../components/admin-route';
import AlertsPage from '../pages/alerts-page';
import ChannelsPage from '../pages/channels-page';
import ConfigurationPage from '../pages/configuration-page';
import MonitoringProfilesPage from '../pages/monitoring-profiles-page';
import SystemLogsPage from '../pages/system-logs-page';

const { Header, Sider, Content } = Layout;

// Just enough for a menu icon and its padding (antd's default collapsed width is 80px).
const SIDEBAR_COLLAPSED_WIDTH = 56;

// Only the admin section has a sidebar; the public Alerts page links to it from the header instead.
// Alerts is listed here too, as the way back out.
const ADMIN_NAV_ITEMS = [
  { key: '/alerts', icon: <AlertOutlined />, label: <Link to="/alerts">Alerts</Link> },
  { key: '/admin/channels', icon: <CameraOutlined />, label: <Link to="/admin/channels">Channels</Link> },
  {
    key: '/admin/monitoring-profiles',
    icon: <UserOutlined />,
    label: <Link to="/admin/monitoring-profiles">Monitoring Profiles</Link>,
  },
  { key: '/admin/configuration', icon: <SettingOutlined />, label: <Link to="/admin/configuration">Configuration</Link> },
  { key: '/admin/system-logs', icon: <FileTextOutlined />, label: <Link to="/admin/system-logs">System Logs</Link> },
];

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin } = useAdminSession();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const isAdminSection = location.pathname.startsWith('/admin');
  // Logged out, the admin section is just the login form, so there's nothing for a sidebar to list.
  const showSidebar = isAdminSection && isAdmin;
  const selectedKey = ADMIN_NAV_ITEMS.find((item) => location.pathname.startsWith(item.key))?.key;

  // Drops every cached admin query along with the session, then leaves the admin section.
  const logoutMutation = useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'alerts' });
      queryClient.setQueryData(SESSION_QUERY_KEY, { authenticated: false });
      navigate('/alerts');
    },
  });

  return (
    // Viewport-height shell: only the content area scrolls, so the sidebar's collapse toggle stays
    // pinned to the bottom of the screen on long pages.
    <Layout style={{ height: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center' }}>
        <Link to="/alerts" style={{ color: 'white', fontSize: 18, fontWeight: 600 }}>
          Security Server
        </Link>
        <div style={{ marginLeft: 'auto' }}>
          {!isAdminSection && (
            <Tooltip title="Admin">
              <Link to="/admin" aria-label="Admin" style={{ color: 'white', fontSize: 20, display: 'flex' }}>
                <SettingOutlined />
              </Link>
            </Tooltip>
          )}
          {isAdminSection && isAdmin && (
            <Button icon={<LogoutOutlined />} loading={logoutMutation.isPending} onClick={() => logoutMutation.mutate()}>
              Log out
            </Button>
          )}
        </div>
      </Header>
      <Layout style={{ minHeight: 0 }}>
        {showSidebar && (
          // Collapses to icons only; the menu follows the Sider's collapsed state automatically.
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
                <Menu mode="inline" selectedKeys={selectedKey ? [selectedKey] : []} items={ADMIN_NAV_ITEMS} />
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
        )}
        <Layout style={{ padding: 24, overflow: 'auto' }}>
          <Content style={{ background: '#fff', padding: 24, borderRadius: 8 }}>
            <Routes>
              <Route path="/alerts" element={<AlertsPage />} />
              <Route path="/admin" element={<AdminRoute />}>
                <Route index element={<Navigate to="/admin/channels" replace />} />
                <Route path="channels" element={<ChannelsPage />} />
                <Route path="monitoring-profiles" element={<MonitoringProfilesPage />} />
                <Route path="configuration" element={<ConfigurationPage />} />
                <Route path="system-logs" element={<SystemLogsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/alerts" replace />} />
            </Routes>
          </Content>
        </Layout>
      </Layout>
    </Layout>
  );
}

export default App;
