import { AlertOutlined, CameraOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons';
import { Layout, Menu } from 'antd';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AlertsPage from '../pages/alerts-page';
import ChannelsPage from '../pages/channels-page';
import ConfigurationPage from '../pages/configuration-page';
import MonitoringProfilesPage from '../pages/monitoring-profiles-page';

const { Header, Sider, Content } = Layout;

const NAV_ITEMS = [
  { key: '/channels', icon: <CameraOutlined />, label: <Link to="/channels">Channels</Link> },
  { key: '/monitoring-profiles', icon: <UserOutlined />, label: <Link to="/monitoring-profiles">Monitoring Profiles</Link> },
  { key: '/alerts', icon: <AlertOutlined />, label: <Link to="/alerts">Alerts</Link> },
  { key: '/configuration', icon: <SettingOutlined />, label: <Link to="/configuration">Configuration</Link> },
];

export function App() {
  const location = useLocation();
  const selectedKey = NAV_ITEMS.find((item) => location.pathname.startsWith(item.key))?.key ?? '/channels';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ color: 'white', fontSize: 18, fontWeight: 600 }}>Security Server</span>
      </Header>
      <Layout>
        <Sider width={220} theme="light">
          <Menu mode="inline" selectedKeys={[selectedKey]} items={NAV_ITEMS} style={{ height: '100%' }} />
        </Sider>
        <Layout style={{ padding: 24 }}>
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
