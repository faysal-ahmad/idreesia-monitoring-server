import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { App as AntdApp, ConfigProvider } from 'antd';
import { StrictMode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import * as ReactDOM from 'react-dom/client';
import { SESSION_QUERY_KEY } from './api/auth';
import { ApiError } from './api/client';
import App from './app/app';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);

// A 401 from any admin API means the session expired (or the password changed), so re-check it —
// the admin section then swaps to the login form instead of showing the error.
const recheckSessionOnUnauthorized = (error: Error) => {
  if (error instanceof ApiError && error.status === 401) {
    queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
  }
};

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: recheckSessionOnUnauthorized }),
  mutationCache: new MutationCache({ onError: recheckSessionOnUnauthorized }),
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

root.render(
  <StrictMode>
    <ConfigProvider>
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </AntdApp>
    </ConfigProvider>
  </StrictMode>,
);
