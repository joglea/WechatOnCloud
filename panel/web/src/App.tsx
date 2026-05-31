import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { UIProvider } from './ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Admin from './pages/Admin';
import Desktop from './pages/Desktop';
import type { ReactNode } from 'react';

function Splash() {
  return (
    <div className="center-screen">
      <div className="spinner" />
    </div>
  );
}

function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Shell() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAuth admin>
            <Admin />
          </RequireAuth>
        }
      />
      <Route
        path="/desktop/:id"
        element={
          <RequireAuth>
            <Desktop />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <UIProvider>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </UIProvider>
  );
}
