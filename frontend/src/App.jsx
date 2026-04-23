import React, { useState, useEffect, createContext, useContext } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { api, isAuthenticated, setToken, clearToken } from './api';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Studio from './pages/Studio';
import Dashboard from './pages/Dashboard';
import Balance from './pages/Balance';
import Settings from './pages/Settings';
import EndpointDetail from './pages/EndpointDetail';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isAuthenticated()) {
      api.me().then(data => {
        setUser(data);
        setLoading(false);
      }).catch(() => {
        clearToken();
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    const data = await api.login({ email, password });
    setToken(data.token);
    setUser(data.user);
    return data;
  };

  const signup = async (email, password) => {
    const data = await api.signup({ email, password });
    setToken(data.token);
    setUser(data.user);
    return data;
  };

  const logout = () => {
    clearToken();
    setUser(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-0 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-cast-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, login, signup, logout, setUser }}>
      <Routes>
        <Route path="/" element={user ? <Navigate to="/studio" replace /> : <Landing />} />
        <Route path="/login" element={user ? <Navigate to="/studio" replace /> : <Login />} />
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route path="/studio" element={<Studio />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/endpoints/:id" element={<EndpointDetail />} />
          <Route path="/balance" element={<Balance />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </AuthContext.Provider>
  );
}
