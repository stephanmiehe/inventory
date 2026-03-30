function getAuthHeaders() {
  const token = localStorage.getItem('authToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function authFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...getAuthHeaders(),
    },
  });
}
