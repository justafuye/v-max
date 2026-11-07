const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID?.trim() ?? ''
export const SPOTIFY_REDIRECT_URI = import.meta.env.VITE_SPOTIFY_REDIRECT_URI?.trim() || `${window.location.origin}/`
const SESSION_KEY = 'vmax-spotify-session'
const VERIFIER_KEY = 'vmax-spotify-verifier'
const STATE_KEY = 'vmax-spotify-auth-state'

export const spotifyConfigured = Boolean(CLIENT_ID)
export const spotifyScopes = [
  'streaming',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-recently-played',
]

export function readSpotifySession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null')
    if (session?.accessToken && session?.expiresAt) return session
  } catch {
    return null
  }
  return null
}

export function clearSpotifySession() {
  sessionStorage.removeItem(SESSION_KEY)
  sessionStorage.removeItem(VERIFIER_KEY)
  sessionStorage.removeItem(STATE_KEY)
}

function saveSpotifySession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  return session
}

function base64UrlEncode(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function beginSpotifyAuthorization() {
  if (!CLIENT_ID) throw new Error('Add VITE_SPOTIFY_CLIENT_ID to .env.local, then restart V-MAX.')
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(64)))
  const challengeDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(24)))
  const challenge = base64UrlEncode(challengeDigest)
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  sessionStorage.setItem(STATE_KEY, state)

  const authorizeUrl = new URL('https://accounts.spotify.com/authorize')
  authorizeUrl.search = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: SPOTIFY_REDIRECT_URI,
    scope: spotifyScopes.join(' '),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  }).toString()
  window.location.assign(authorizeUrl)
}

async function requestToken(parameters) {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...parameters, client_id: CLIENT_ID }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error_description || data.error || 'Spotify authorization failed.')
  return data
}

export async function finishSpotifyAuthorization(code, returnedState) {
  const expectedState = sessionStorage.getItem(STATE_KEY)
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  sessionStorage.removeItem(STATE_KEY)
  sessionStorage.removeItem(VERIFIER_KEY)
  if (!expectedState || returnedState !== expectedState || !verifier) {
    throw new Error('Spotify sign-in could not be verified. Please connect again.')
  }

  const data = await requestToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    code_verifier: verifier,
  })
  return saveSpotifySession({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  })
}

export async function getValidSpotifySession(session) {
  if (!session?.accessToken) throw new Error('Connect Spotify to continue.')
  if (session.expiresAt > Date.now() + 60_000) return session
  if (!session.refreshToken) throw new Error('Your Spotify session expired. Connect again.')

  const data = await requestToken({
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken,
  })
  return saveSpotifySession({
    accessToken: data.access_token,
    refreshToken: data.refresh_token || session.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  })
}

export async function spotifyRequest(accessToken, endpoint, options = {}) {
  const response = await fetch(`https://api.spotify.com/v1/${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  if (!response.ok) {
    const details = await response.json().catch(() => ({}))
    const error = new Error(details.error?.message || `Spotify request failed (${response.status}).`)
    error.status = response.status
    throw error
  }
  if (response.status === 204) return null
  return response.json()
}

export function loadSpotifyPlaybackSdk() {
  if (window.Spotify?.Player) return Promise.resolve()
  if (window.spotifySdkPromise) return window.spotifySdkPromise

  window.spotifySdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://sdk.scdn.co/spotify-player.js'
    script.async = true
    script.onerror = () => {
      window.spotifySdkPromise = null
      reject(new Error('Spotify’s playback player could not be loaded.'))
    }
    window.onSpotifyWebPlaybackSDKReady = resolve
    document.head.appendChild(script)
  })
  return window.spotifySdkPromise
}
