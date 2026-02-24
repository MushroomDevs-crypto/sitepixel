let jwtToken = null

export function setToken(token) {
  jwtToken = token
}

export function clearToken() {
  jwtToken = null
}

export function getToken() {
  return jwtToken
}

export async function apiFetch(path, options = {}) {
  const headers = { ...options.headers }

  if (jwtToken) {
    headers['Authorization'] = `Bearer ${jwtToken}`
  }

  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetch(`/api${path}`, { ...options, headers })

  if (response.status === 401) {
    clearToken()
    throw new Error('Sessao expirada. Reconecte sua carteira.')
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.message || `Erro na API: ${response.status}`)
  }

  return response.json()
}
