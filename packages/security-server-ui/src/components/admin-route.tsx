import { LockOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Flex, Form, Input, Spin, Typography } from 'antd';
import { Outlet } from 'react-router-dom';
import { authApi, SESSION_QUERY_KEY } from '../api/auth';

const { Text } = Typography;

export function useAdminSession() {
  const { data, isLoading } = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: authApi.session,
  });
  return { isAdmin: data?.authenticated ?? false, isLoading };
}

function AdminLoginForm() {
  const queryClient = useQueryClient();
  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY }),
  });

  return (
    <Flex justify="center" style={{ paddingTop: 48 }}>
      <Card title="Admin login" style={{ width: 360 }}>
        <Form
          layout="vertical"
          onFinish={({ password }: { password: string }) =>
            loginMutation.mutate(password)
          }
        >
          <Form.Item
            name="password"
            label="Password"
            rules={[{ required: true, message: 'Password is required' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              autoFocus
              autoComplete="current-password"
            />
          </Form.Item>
          {loginMutation.error && (
            <Form.Item>
              <Text type="danger">{loginMutation.error.message}</Text>
            </Form.Item>
          )}
          <Button
            type="primary"
            htmlType="submit"
            block
            loading={loginMutation.isPending}
          >
            Log in
          </Button>
        </Form>
      </Card>
    </Flex>
  );
}

// Wraps the admin routes: renders them only with a valid admin session, otherwise the login form
// in their place (keeping the URL, so logging in lands on the page that was asked for).
export function AdminRoute() {
  const { isAdmin, isLoading } = useAdminSession();
  if (isLoading) return <Spin style={{ display: 'block', marginTop: 48 }} />;
  return isAdmin ? <Outlet /> : <AdminLoginForm />;
}

export default AdminRoute;
