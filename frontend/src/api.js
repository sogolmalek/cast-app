const BASE_URL = '/api';

function getToken() {
  return localStorage.getItem('cast_token');
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json();

  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('cast_token');
      window.location.href = '/login';
    }
    throw new Error(data.error || `Request failed: ${res.status}`);
  }

  return data;
}

export const api = {
  // Auth
  signup: (body) => request('/auth/signup', { method: 'POST', body }),
  login: (body) => request('/auth/login', { method: 'POST', body }),
  me: () => request('/auth/me'),
  saveClaudeKey: (apiKey) => request('/auth/claude-key', { method: 'PUT', body: { apiKey } }),
  deleteClaudeKey: () => request('/auth/claude-key', { method: 'DELETE' }),

  // Endpoints
  listEndpoints: () => request('/endpoints'),
  getEndpoint: (id) => request(`/endpoints/${id}`),
  generateEndpoint: (body) => request('/endpoints/generate', { method: 'POST', body }),
  iterateEndpoint: (body) => request('/endpoints/iterate', { method: 'POST', body }),
  deployEndpoint: (body) => request('/endpoints/deploy', { method: 'POST', body }),
  updateEndpoint: (id, body) => request(`/endpoints/${id}`, { method: 'PUT', body }),
  deleteEndpoint: (id) => request(`/endpoints/${id}`, { method: 'DELETE' }),
  testEndpoint: (id, body) => request(`/endpoints/${id}/test`, { method: 'POST', body }),
  getAnalytics: (id, days) => request(`/endpoints/${id}/analytics?days=${days || 30}`),

  // Balance
  getBalance: () => request('/balance'),
  getEarningsHistory: (days) => request(`/balance/history?days=${days || 30}`),
  withdraw: (body) => request('/balance/withdraw', { method: 'POST', body }),
  getWithdrawals: () => request('/balance/withdrawals'),

  // Conversations
  listConversations: () => request('/conversations'),
  getConversation: (id) => request(`/conversations/${id}`),
  deleteConversation: (id) => request(`/conversations/${id}`, { method: 'DELETE' }),
};

export function setToken(token) {
  localStorage.setItem('cast_token', token);
}

export function clearToken() {
  localStorage.removeItem('cast_token');
}

export function isAuthenticated() {
  return !!getToken();
}
