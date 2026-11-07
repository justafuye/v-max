import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { deleteAudioFile, getSavedAudioFiles, saveAudioFile } from './libraryStorage.js'
import AuthDialog from './AuthDialog.jsx'
import { onAuthStateChanged } from '@firebase/auth'
import { firebaseAuth, firebaseConfigured } from './firebase.js'
import {
  beginSpotifyAuthorization,
  clearSpotifySession,
  finishSpotifyAuthorization,
  getValidSpotifySession,
  loadSpotifyPlaybackSdk,
  readSpotifySession,
  spotifyConfigured,
  spotifyRequest,
} from './spotify.js'

const CreatorHub = lazy(() => import('./CreatorHub.jsx'))
const CHART_URL = 'https://itunes.apple.com/us/rss/topsongs/limit=25/json'
const YOUTUBE_API_KEY = import.meta.env.VITE_YOUTUBE_API_KEY?.trim() ?? ''
const LIKED_STORAGE_KEY = 'vmax-liked-tracks'
const PLAYLIST_STORAGE_KEY = 'vmax-playlist'
const HISTORY_STORAGE_KEY = 'vmax-listening-history'
const PREFERENCES_STORAGE_KEY = 'vmax-listening-preferences'
const MUSIC_GENRES = ['Afrobeats', 'Hip-Hop', 'Pop', 'R&B / Soul', 'Rock / Indie', 'Electronic', 'Jazz', 'Gospel', 'Reggae', 'Classical', 'Country']
const LISTENING_MOODS = ['Chill', 'Energy', 'Focus', 'Dreamy', 'Feel good']

function readStoredValue(key, fallback) {
  try {
    const stored = localStorage.getItem(key)
    return stored ? JSON.parse(stored) : fallback
  } catch {
    return fallback
  }
}

function saveStoredValue(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function getSavedListeningPreferences() {
  const saved = readStoredValue(PREFERENCES_STORAGE_KEY, null)
  if (!saved || !Array.isArray(saved.genres) || !Array.isArray(saved.moods)) return null
  return {
    genres: saved.genres.filter((genre) => MUSIC_GENRES.includes(genre)),
    moods: saved.moods.filter((item) => LISTENING_MOODS.includes(item)),
  }
}

function normalizeMusicGenre(value) {
  const genre = value?.trim().toLowerCase()
  const genreAliases = {
    'afro beats': 'Afrobeats',
    'afrobeats': 'Afrobeats',
    'hip hop': 'Hip-Hop',
    'hip-hop/rap': 'Hip-Hop',
    'hip hop/rap': 'Hip-Hop',
    'rap': 'Hip-Hop',
    'r&b': 'R&B / Soul',
    'r&b/soul': 'R&B / Soul',
    'r&b / soul': 'R&B / Soul',
    'alternative': 'Rock / Indie',
    'indie': 'Rock / Indie',
    'dance': 'Electronic',
    'electronic/dance': 'Electronic',
  }
  if (!genre) return ''
  return genreAliases[genre] ?? MUSIC_GENRES.find((item) => item.toLowerCase() === genre) ?? ''
}

function matchesListeningPreferences(track, preferences) {
  if (!preferences) return true
  const hasGenreFilter = preferences.genres.length > 0
  const hasMoodFilter = preferences.moods.length > 0
  if (!hasGenreFilter && !hasMoodFilter) return true
  const matchesGenre = !hasGenreFilter || (track.genres ?? []).some((genre) => preferences.genres.includes(genre))
  const matchesMood = !hasMoodFilter || (track.mood ?? []).some((item) => preferences.moods.includes(item))
  return matchesGenre && matchesMood
}

function toLibraryTrack(track) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    durationSeconds: track.durationSeconds,
    image: track.image,
    source: track.source,
    spotifyUri: track.spotifyUri,
    color: track.color,
    mood: track.mood,
    note: track.note,
    lyrics: track.lyrics,
  }
}

function mapChartTracks(entries) {
  return entries.map((entry, index) => {
    const category = entry.category?.attributes?.label
      ?? entry['im:category']?.attributes?.label
      ?? entry.category?.attributes?.term
    return {
      id: `chart-${entry.id?.attributes?.['im:id'] ?? index}`,
      title: entry['im:name']?.label ?? 'Unknown track',
      artist: entry['im:artist']?.label ?? 'Unknown artist',
      album: entry['im:collection']?.['im:name']?.label ?? 'Unknown album',
      duration: '—',
      image: entry['im:image']?.at(-1)?.label ?? '',
      source: 'chart',
      genres: [normalizeMusicGenre(category)].filter(Boolean),
    }
  })
}

function mapSpotifyTrack(track) {
  return {
    id: `spotify-${track.id}`,
    spotifyUri: track.uri,
    title: track.name,
    artist: track.artists.map((artist) => artist.name).join(', '),
    album: track.album.name,
    duration: `${Math.floor(track.duration_ms / 60000)}:${String(Math.floor(track.duration_ms / 1000) % 60).padStart(2, '0')}`,
    durationSeconds: track.duration_ms / 1000,
    image: track.album.images?.[0]?.url ?? '',
    source: 'spotify',
  }
}

function getLocalDateKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

const tracks = [
  {
    id: 1,
    title: 'Golden Hour',
    artist: 'JVKE',
    album: 'this is what ____ feels like',
    duration: '3:29',
    image: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=500&q=85',
    color: 'violet',
    genres: ['Pop'],
    mood: ['Feel good', 'Focus'],
    note: 'A sunlit piano melody that grew from a simple voice memo into a worldwide sing-along.',
    lyrics: 'It was just two lovers\\nSittin’ in the car, listening to Blonde\\nFallin’ for each other'
  },
  {
    id: 2,
    title: 'Sunset Lover',
    artist: 'Petit Biscuit',
    album: 'Presence',
    duration: '3:57',
    image: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=500&q=85',
    color: 'orange',
    genres: ['Electronic'],
    mood: ['Chill', 'Feel good'],
    note: 'Warm electronic textures and a hazy, late-summer feeling make this an instant escape.',
    lyrics: 'A little space, a little time\\nLet the evening take its time\\nMeet me where the sky turns gold'
  },
  {
    id: 3,
    title: 'Dracos World',
    artist: 'Beach House',
    album: 'Depression Cherry',
    duration: '5:20',
    image: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?auto=format&fit=crop&w=500&q=85',
    color: 'blue',
    genres: ['Rock / Indie'],
    mood: ['Dreamy', 'Chill'],
    note: 'A drifting, cinematic track built around soft-focus synths and a voice that feels like a memory.',
    lyrics: 'Fall back into place\\nTender is the night\\nFor a broken heart'
  },
  {
    id: 4,
    title: 'Midnight City',
    artist: 'M83',
    album: 'Hurry Up, We’re Dreaming',
    duration: '4:03',
    image: 'https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=500&q=85',
    color: 'pink',
    genres: ['Electronic'],
    mood: ['Energy', 'Focus'],
    note: 'Big neon synths capture the rush of a city that stays awake long after midnight.',
    lyrics: 'Waiting in the car\\nWaiting for the ride in the dark\\nAt night the city grows'
  },
  {
    id: 5,
    title: 'Pink + White',
    artist: 'Frank Ocean',
    album: 'Blonde',
    duration: '3:04',
    image: 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=500&q=85',
    color: 'rose',
    genres: ['R&B / Soul'],
    mood: ['Chill', 'Dreamy'],
    note: 'A gentle, sun-warmed reflection with luminous backing vocals and a tender sense of nostalgia.',
    lyrics: 'That’s the way every day goes\\nEvery time we’ve no control\\nIf the sky is pink and white'
  },
  {
    id: 6,
    title: 'Dracos World',
    artist: 'MGMT',
    album: 'Oracular Spectacular',
    duration: '3:49',
    image: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=500&q=85',
    color: 'green',
    genres: ['Rock / Indie', 'Electronic'],
    mood: ['Energy', 'Feel good'],
    note: 'A playful bassline and woozy synths turn this indie-pop favorite into a dance-floor spark.',
    lyrics: 'All along the western front\\nPeople line up to receive\\nShe got the power in her hands'
  },
  {
    id: 7,
    title: 'After Dark',
    artist: 'Mr.Kitty',
    album: 'Time',
    duration: '4:17',
    image: 'https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=500&q=85',
    color: 'blue',
    genres: ['Electronic'],
    mood: ['Dreamy', 'Energy'],
    note: 'Darkwave drums and shimmering synths make for a nocturnal, cinematic rush.',
    lyrics: 'I see you, you see me\\nHow pleasant, this feeling\\nThe moment you hold me'
  },
  {
    id: 8,
    title: 'Coffee Breath',
    artist: 'Sofia Mills',
    album: 'Baby Magic',
    duration: '2:43',
    image: 'https://images.unsplash.com/photo-1445116572660-236099ec97a0?auto=format&fit=crop&w=500&q=85',
    color: 'orange',
    genres: ['Pop', 'Rock / Indie'],
    mood: ['Focus', 'Chill'],
    note: 'An intimate indie-pop diary entry, best enjoyed slowly with your first coffee of the day.',
    lyrics: 'I think I like you\\nMore than I meant to\\nLet’s stay a little longer'
  },
]

const moods = [
  { name: 'Chill', emoji: '☁', gradient: 'mood-lilac' },
  { name: 'Energy', emoji: '⚡', gradient: 'mood-coral' },
  { name: 'Focus', emoji: '◉', gradient: 'mood-blue' },
  { name: 'Dreamy', emoji: '✳', gradient: 'mood-pink' },
  { name: 'Feel good', emoji: '☀', gradient: 'mood-peach' },
]

const mixes = [
  { title: 'Soft focus', detail: 'Your calm-workday mix', image: tracks[2].image, tint: 'mix-purple', mood: 'Focus' },
  { title: 'Golden hour', detail: 'A little brighter, always', image: tracks[0].image, tint: 'mix-orange', mood: 'Feel good' },
  { title: 'After hours', detail: 'For the ride home', image: tracks[6].image, tint: 'mix-blue', mood: 'Dreamy' },
]

const friends = [
  { name: 'Maya Chen', handle: '@mayasounds', initials: 'MC', color: 'avatar-peach', track: 'Snooze · SZA', active: 'Listening now' },
  { name: 'Jordan Lee', handle: '@jordy.wav', initials: 'JL', color: 'avatar-lilac', track: 'My Love Mine All Mine · Mitski', active: '12 min ago' },
  { name: 'Alex Rivera', handle: '@alexonaux', initials: 'AR', color: 'avatar-blue', track: 'Glue Song · beabadoobee', active: '32 min ago' },
]

function Icon({ name, size = 18, fill = 'none' }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    music: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
    heart: <><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    play: <><path d="m8 5 12 7-12 7z" /></>,
    pause: <><path d="M8 5h3v14H8zM15 5h3v14h-3z" /></>,
    next: <><path d="m5 5 11 7-11 7zM19 5v14" /></>,
    previous: <><path d="m19 5-11 7 11 7zM5 5v14" /></>,
    shuffle: <><path d="m18 14 4 4-4 4M18 2l4 4-4 4M2 18h2.5a5 5 0 0 0 4-2l7-10a5 5 0 0 1 4-2H22M2 6h2.5a5 5 0 0 1 4 2l1 1M14 15l1.5 2a5 5 0 0 0 4 2H22" /></>,
    repeat: <><path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" /></>,
    volume: <><path d="M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    spark: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-2-5.8L4 11l6-2.2zM19 14l1.1 2.9L23 18l-2.9 1.1L19 22l-1.1-2.9L15 18l2.9-1.1z" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    headphones: <><path d="M3 14v-3a9 9 0 0 1 18 0v3" /><path d="M5 14h2v6H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2ZM19 14h-2v6h2a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2Z" /></>,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.7 10.7 6.6-4.4M8.7 13.3l6.6 4.4" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>,
    message: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z" /></>,
  }
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  )
}

function App() {
  const [page, setPage] = useState(() => (
    new URLSearchParams(window.location.hash.slice(1)).has('playlist') ? 'Creator Studio' : 'Home'
  ))
  const [query, setQuery] = useState('')
  const [mood, setMood] = useState('')
  const [listeningPreferences, setListeningPreferences] = useState(getSavedListeningPreferences)
  const [preferenceDraft, setPreferenceDraft] = useState(() => getSavedListeningPreferences() ?? { genres: [], moods: [] })
  const [preferencesOpen, setPreferencesOpen] = useState(() => getSavedListeningPreferences() === null)
  const [currentTrack, setCurrentTrack] = useState(() => (
    tracks.find((track) => matchesListeningPreferences(track, getSavedListeningPreferences())) ?? tracks[0]
  ))
  const [isPlaying, setIsPlaying] = useState(false)
  const [liked, setLiked] = useState(() => {
    const saved = readStoredValue(LIKED_STORAGE_KEY, tracks.filter((track) => [3, 5].includes(track.id)).map(toLibraryTrack))
    return Array.isArray(saved) ? saved : []
  })
  const [queue, setQueue] = useState(() => tracks.filter((track) => matchesListeningPreferences(track, getSavedListeningPreferences())).slice(1, 4))
  const [toast, setToast] = useState('')
  const [firebaseUser, setFirebaseUser] = useState(null)
  const [authDialogOpen, setAuthDialogOpen] = useState(false)
  const [spotifySession, setSpotifySession] = useState(readSpotifySession)
  const [spotifyTracks, setSpotifyTracks] = useState([])
  const [spotifySearchStatus, setSpotifySearchStatus] = useState('idle')
  const [spotifySearchError, setSpotifySearchError] = useState(null)
  const [spotifySearchTerm, setSpotifySearchTerm] = useState('')
  const [spotifyRecentTracks, setSpotifyRecentTracks] = useState([])
  const [spotifyRecentStatus, setSpotifyRecentStatus] = useState('idle')
  const [spotifyRecentError, setSpotifyRecentError] = useState(null)
  const [spotifyRecentRefresh, setSpotifyRecentRefresh] = useState(0)
  const [spotifyPlayerStatus, setSpotifyPlayerStatus] = useState(() => (
    spotifyConfigured ? (readSpotifySession() ? 'connecting' : 'disconnected') : 'unconfigured'
  ))
  const [spotifyDeviceId, setSpotifyDeviceId] = useState('')
  const [canInstallApp, setCanInstallApp] = useState(() => {
    const isIosDevice = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
    return isIosDevice && !isStandalone
  })
  const [installStatus, setInstallStatus] = useState('idle')
  const [storyTrack, setStoryTrack] = useState(null)
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false)
  const [promptText, setPromptText] = useState('')
  const [playlist, setPlaylist] = useState(() => readStoredValue(PLAYLIST_STORAGE_KEY, null))
  const [listeningHistory, setListeningHistory] = useState(() => {
    const saved = readStoredValue(HISTORY_STORAGE_KEY, [])
    return Array.isArray(saved) ? saved : []
  })
  const [localTracks, setLocalTracks] = useState([])
  const [localLibraryStatus, setLocalLibraryStatus] = useState('loading')
  const [audioImportProgress, setAudioImportProgress] = useState(null)
  const [trendingTracks, setTrendingTracks] = useState([])
  const [trendingStatus, setTrendingStatus] = useState('loading')
  const [trendingUpdatedAt, setTrendingUpdatedAt] = useState(null)
  const [catalogTracks, setCatalogTracks] = useState([])
  const [catalogStatus, setCatalogStatus] = useState('idle')
  const [catalogSearchTerm, setCatalogSearchTerm] = useState('')
  const [youtubeVideoId, setYoutubeVideoId] = useState('')
  const [youtubeTracks, setYoutubeTracks] = useState([])
  const [youtubeStatus, setYoutubeStatus] = useState('idle')
  const [youtubeSearchTerm, setYoutubeSearchTerm] = useState('')
  const [youtubeError, setYoutubeError] = useState('')
  const [discoverIndex, setDiscoverIndex] = useState(0)
  const [roomActive, setRoomActive] = useState(false)
  const [joinedRoom, setJoinedRoom] = useState(false)
  const [completedChallenges, setCompletedChallenges] = useState([])
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(100)
  const audioEngineRef = useRef(null)
  const audioTimerRef = useRef(null)
  const mediaAudioRef = useRef(null)
  const trendingRequestRef = useRef(null)
  const installPromptRef = useRef(null)
  const fileInputRef = useRef(null)
  const localAudioUrlsRef = useRef(new Set())
  const searchInputRef = useRef(null)
  const spotifyPlayerRef = useRef(null)
  const spotifyDeviceIdRef = useRef('')
  const spotifyCallbackHandledRef = useRef(false)
  const spotifySessionRef = useRef(spotifySession)
  const currentTrackRef = useRef(currentTrack)
  const queueRef = useRef(queue)

  const getSpotifyAccessToken = useCallback(async () => {
    const refreshedSession = await getValidSpotifySession(spotifySessionRef.current)
    spotifySessionRef.current = refreshedSession
    setSpotifySession(refreshedSession)
    return refreshedSession.accessToken
  }, [])

  const filteredTracks = useMemo(() => {
    const search = query.trim().toLowerCase()
    return tracks.filter((track) => {
      const matchesSearch = !search || `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(search)
      const matchesMood = !mood || track.mood.includes(mood)
      return matchesSearch && matchesMood && matchesListeningPreferences(track, listeningPreferences)
    })
  }, [query, mood, listeningPreferences])

  const likedTracks = liked
  const preferredTracks = tracks.filter((track) => (
    matchesListeningPreferences(track, listeningPreferences)
    && (!mood || track.mood.includes(mood))
  ))
  const personalizedPlaylist = playlist
    ? { ...playlist, tracks: playlist.tracks.filter((track) => matchesListeningPreferences(track, listeningPreferences)) }
    : null
  const personalizedFriends = friends
    .slice(0, preferredTracks.length)
    .map((friend, index) => ({ ...friend, recommendedTrack: preferredTracks[index] }))
  const recommendedMixes = mixes
    .map((mix) => ({
      ...mix,
      tracks: preferredTracks.filter((track) => track.mood.includes(mix.mood)),
    }))
    .filter((mix) => mix.tracks.length)
  const musicPreferenceSummary = listeningPreferences
    ? [...listeningPreferences.genres, ...listeningPreferences.moods].join(' · ')
    : ''
  const discoverTrack = preferredTracks.length ? preferredTracks[discoverIndex % preferredTracks.length] : null
  const visibleLocalTracks = localTracks.filter((track) => (
    !query.trim() || `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query.trim().toLowerCase())
  ))
  const catalogResultsMatch = catalogSearchTerm === query.trim()
  const spotifyResultsMatch = spotifySearchTerm === query.trim()
  const hasSpotifySession = Boolean(spotifySession)
  const youtubeResultsMatch = youtubeSearchTerm === query.trim()

  const toggleListeningPreference = (category, value) => {
    setPreferenceDraft((current) => ({
      ...current,
      [category]: current[category].includes(value)
        ? current[category].filter((item) => item !== value)
        : [...current[category], value],
    }))
  }

  const saveListeningPreferences = (preferences) => {
    if (!saveStoredValue(PREFERENCES_STORAGE_KEY, preferences)) {
      setToast('Could not save your music picks in this browser. Check storage permissions and try again.')
      return
    }
    const matchingTracks = tracks.filter((track) => matchesListeningPreferences(track, preferences))
    if (matchingTracks.length) {
      if (currentTrack.source !== 'local' && !matchesListeningPreferences(currentTrack, preferences)) {
        stopDemoAudio()
        mediaAudioRef.current?.pause()
        setCurrentTrack(matchingTracks[0])
        setIsPlaying(false)
        setCurrentTime(0)
        setDuration(0)
      }
      setQueue(matchingTracks.filter((track) => track.id !== currentTrack.id).slice(0, 4))
    } else {
      if (currentTrack.source !== 'local') {
        stopDemoAudio()
        mediaAudioRef.current?.pause()
        setIsPlaying(false)
        setCurrentTime(0)
        setDuration(0)
      }
      setQueue([])
    }
    setListeningPreferences(preferences)
    setPreferencesOpen(false)
    setToast(preferences.genres.length || preferences.moods.length ? 'Your V-MAX picks are ready.' : 'You can personalize your picks any time.')
  }

  const finishPreferences = () => {
    if (!preferenceDraft.genres.length && !preferenceDraft.moods.length) {
      setToast('Choose at least one genre or listening mood, or skip for now.')
      return
    }
    saveListeningPreferences(preferenceDraft)
  }

  const skipPreferences = () => {
    saveListeningPreferences({ genres: [], moods: [] })
  }

  useEffect(() => {
    spotifySessionRef.current = spotifySession
  }, [spotifySession])

  useEffect(() => {
    queueRef.current = queue
  }, [queue])

  useEffect(() => {
    currentTrackRef.current = currentTrack
  }, [currentTrack])

  useEffect(() => {
    if (page !== 'Your library' || query.trim() || !spotifyConfigured || !spotifySession) return undefined

    let active = true
    const controller = new AbortController()

    const loadRecentlyPlayed = async () => {
      if (!active) return
      setSpotifyRecentStatus('loading')
      setSpotifyRecentError(null)
      try {
        const accessToken = await getSpotifyAccessToken()
        const result = await spotifyRequest(
          accessToken,
          'me/player/recently-played?limit=20',
          { signal: controller.signal },
        )
        if (!active) return
        setSpotifyRecentTracks((result.items ?? []).map((item) => ({
          ...mapSpotifyTrack(item.track),
          playedAt: item.played_at,
        })))
        setSpotifyRecentStatus('ready')
      } catch (error) {
        if (!active || error.name === 'AbortError') return
        setSpotifyRecentError({
          message: error.message,
          status: error.status ?? null,
        })
        setSpotifyRecentStatus('error')
      }
    }

    void Promise.resolve().then(loadRecentlyPlayed)
    return () => {
      active = false
      controller.abort()
    }
  }, [getSpotifyAccessToken, page, query, spotifyRecentRefresh, spotifySession])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const error = params.get('error')
    if ((!code && !error) || spotifyCallbackHandledRef.current) return
    spotifyCallbackHandledRef.current = true
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`)

    if (error) {
      const errorDescription = params.get('error_description')
      Promise.resolve().then(() => {
        setSpotifyPlayerStatus('disconnected')
        setToast(`Spotify authorization failed: ${errorDescription || error}`)
      })
      return
    }

    Promise.resolve().then(() => setSpotifyPlayerStatus('connecting'))
    finishSpotifyAuthorization(code, params.get('state'))
      .then((session) => {
        spotifySessionRef.current = session
        setSpotifySession(session)
        setToast('Spotify connected. Starting its player…')
      })
      .catch((authorizationError) => {
        setSpotifyPlayerStatus('disconnected')
        setToast(`Spotify sign-in failed: ${authorizationError.message}`)
      })
  }, [])

  useEffect(() => {
    if (!spotifyConfigured || !hasSpotifySession) return undefined

    let active = true
    let player
    loadSpotifyPlaybackSdk()
      .then(() => {
        if (!active) return
        if (!window.Spotify?.Player) throw new Error('Spotify’s playback SDK did not initialize.')

        player = new window.Spotify.Player({
          name: 'V-MAX Web Player',
          getOAuthToken: (callback) => {
            getSpotifyAccessToken()
              .then(callback)
              .catch((error) => {
                if (active) setToast(`Spotify authorization expired: ${error.message}`)
                callback('')
              })
          },
        })
        spotifyPlayerRef.current = player
        player.addListener('ready', ({ device_id }) => {
          if (!active) return
          spotifyDeviceIdRef.current = device_id
          setSpotifyDeviceId(device_id)
          setSpotifyPlayerStatus('ready')
          setToast('Spotify is ready to play.')
        })
        player.addListener('not_ready', () => {
          if (!active) return
          spotifyDeviceIdRef.current = ''
          setSpotifyDeviceId('')
          setSpotifyPlayerStatus('disconnected')
        })
        player.addListener('player_state_changed', (state) => {
          if (!active) return
          if (!state) {
            if (currentTrackRef.current.source === 'spotify') setIsPlaying(false)
            return
          }
          if (state.paused && currentTrackRef.current.source !== 'spotify') return
          const playingTrack = mapSpotifyTrack(state.track_window.current_track)
          setCurrentTrack(playingTrack)
          setCurrentTime(state.position / 1000)
          setDuration(state.duration / 1000)
          setIsPlaying(!state.paused)
        })
        for (const eventName of ['initialization_error', 'authentication_error', 'account_error', 'playback_error']) {
          player.addListener(eventName, ({ message }) => {
            if (!active) return
            setSpotifyPlayerStatus('error')
            setToast(`Spotify player error: ${message}`)
          })
        }
        player.connect().then((connected) => {
          if (active && !connected) {
            setSpotifyPlayerStatus('error')
            setToast('Spotify could not connect its web player. Check your account and try again.')
          }
        }).catch((error) => {
          if (!active) return
          setSpotifyPlayerStatus('error')
          setToast(`Spotify player could not start: ${error.message}`)
        })
      })
      .catch((error) => {
        if (!active) return
        setSpotifyPlayerStatus('error')
        setToast(`Spotify player could not load: ${error.message}`)
      })

    return () => {
      active = false
      if (spotifyPlayerRef.current === player) spotifyPlayerRef.current = null
      player?.disconnect()
    }
  }, [hasSpotifySession, getSpotifyAccessToken])

  useEffect(() => {
    if (!firebaseAuth) return undefined
    return onAuthStateChanged(
      firebaseAuth,
      setFirebaseUser,
      (error) => setToast(`Could not restore your V-MAX account: ${error.message}`),
    )
  }, [])

  useEffect(() => {
    let cancelled = false
    getSavedAudioFiles()
      .then((savedTracks) => {
        if (cancelled) return
        const restoredTracks = savedTracks.map(({ audioBlob, ...track }) => {
          const audioUrl = URL.createObjectURL(audioBlob)
          localAudioUrlsRef.current.add(audioUrl)
          return { ...track, audioUrl, source: 'local' }
        })
        setLocalTracks(restoredTracks)
        setLocalLibraryStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        setLocalLibraryStatus('error')
        setToast(`Could not load your audio library: ${error.message}`)
      })
    return () => { cancelled = true }
  }, [])

  const refreshTrending = useCallback(async () => {
    trendingRequestRef.current?.abort()
    const controller = new AbortController()
    trendingRequestRef.current = controller
    setTrendingStatus('loading')
    try {
      const response = await fetch(CHART_URL, { signal: controller.signal, cache: 'no-store' })
      if (!response.ok) throw new Error(`Music chart request failed (${response.status}).`)
      const data = await response.json()
      const entries = data.feed?.entry ?? []
      if (!entries.length) throw new Error('The chart did not return any tracks.')
      setTrendingTracks(mapChartTracks(entries))
      setTrendingUpdatedAt(new Date())
      setTrendingStatus('ready')
    } catch (error) {
      if (error.name === 'AbortError') return
      setTrendingStatus('error')
      setToast(`Could not load the music chart: ${error.message}`)
    }
  }, [])

  useEffect(() => {
    let activeDate = getLocalDateKey(new Date())
    let midnightTimer
    const initialRefreshTimer = window.setTimeout(refreshTrending, 0)
    const refreshIfDateChanged = () => {
      const currentDate = getLocalDateKey(new Date())
      if (currentDate !== activeDate) {
        activeDate = currentDate
        refreshTrending()
      }
    }
    const scheduleMidnightRefresh = () => {
      const nextMidnight = new Date()
      nextMidnight.setHours(24, 0, 0, 0)
      midnightTimer = window.setTimeout(() => {
        refreshIfDateChanged()
        scheduleMidnightRefresh()
      }, nextMidnight.getTime() - Date.now() + 100)
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshIfDateChanged()
    }

    scheduleMidnightRefresh()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.clearTimeout(midnightTimer)
      window.clearTimeout(initialRefreshTimer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      trendingRequestRef.current?.abort()
    }
  }, [refreshTrending])

  useEffect(() => {
    const searchTerm = query.trim()
    if (searchTerm.length < 2) return undefined

    let cancelled = false
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setCatalogStatus('loading')
      const url = new URL('https://itunes.apple.com/search')
      url.search = new URLSearchParams({
        term: searchTerm,
        entity: 'song',
        limit: '20',
      }).toString()
      fetch(url, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error(`Catalog search failed (${response.status}).`)
          return response.json()
        })
        .then((data) => {
          if (cancelled) return
          setCatalogTracks((data.results ?? []).map((track) => ({
            id: `catalog-${track.trackId}`,
            title: track.trackName,
            artist: track.artistName,
            album: track.collectionName ?? 'Unknown album',
            duration: '—',
            image: track.artworkUrl100 ?? '',
            source: 'catalog',
          })))
          setCatalogSearchTerm(searchTerm)
          setCatalogStatus('ready')
        })
        .catch((error) => {
          if (cancelled || error.name === 'AbortError') return
          setCatalogTracks([])
          setCatalogSearchTerm(searchTerm)
          setCatalogStatus('error')
          setToast(`Music search failed: ${error.message}`)
        })
    }, 300)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  useEffect(() => {
    const searchTerm = query.trim()
    if (searchTerm.length < 2) return undefined

    if (!spotifyConfigured || !spotifySession) return undefined

    let cancelled = false
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setSpotifySearchStatus('loading')
      setSpotifySearchTerm(searchTerm)
      try {
        const accessToken = await getSpotifyAccessToken()
        const results = await spotifyRequest(
          accessToken,
          `search?${new URLSearchParams({ q: searchTerm, type: 'track', limit: '20' })}`,
          { signal: controller.signal },
        )
        if (cancelled) return
        setSpotifyTracks((results.tracks?.items ?? []).map(mapSpotifyTrack))
        setSpotifySearchError(null)
        setSpotifySearchStatus('ready')
      } catch (error) {
        if (cancelled || error.name === 'AbortError') return
        setSpotifyTracks([])
        setSpotifySearchError({ message: error.message, status: error.status ?? null })
        setSpotifySearchStatus('error')
        setSpotifySearchTerm(searchTerm)
        setToast(`Spotify search failed: ${error.message}`)
      }
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [getSpotifyAccessToken, query, spotifySession])

  useEffect(() => {
    const searchTerm = query.trim()
    if (searchTerm.length < 2) return undefined

    let cancelled = false
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setYoutubeVideoId('')
      setYoutubeTracks([])
      setYoutubeSearchTerm(searchTerm)
      setYoutubeError('')
      if (!YOUTUBE_API_KEY) {
        setYoutubeStatus('unavailable')
        return
      }

      setYoutubeStatus('loading')
      try {
        const url = new URL('https://www.googleapis.com/youtube/v3/search')
        url.search = new URLSearchParams({
          part: 'snippet',
          type: 'video',
          maxResults: '10',
          q: searchTerm,
          key: YOUTUBE_API_KEY,
        }).toString()
        const response = await fetch(url, { signal: controller.signal })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error?.message ?? `YouTube search failed (${response.status}).`)
        if (cancelled) return
        setYoutubeTracks((data.items ?? []).flatMap((item) => {
          const id = item.id?.videoId
          if (!id || !item.snippet?.title) return []
          return [{
            id,
            title: item.snippet.title,
            artist: item.snippet.channelTitle ?? 'YouTube',
            image: item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url ?? '',
          }]
        }))
        setYoutubeStatus('ready')
      } catch (error) {
        if (cancelled || error.name === 'AbortError') return
        setYoutubeTracks([])
        setYoutubeError(error.message)
        setYoutubeStatus('error')
      }
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  useEffect(() => () => {
    localAudioUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const handleInstallPrompt = (event) => {
      event.preventDefault()
      installPromptRef.current = event
      setCanInstallApp(true)
    }
    const handleInstalled = () => {
      installPromptRef.current = null
      setCanInstallApp(false)
      setInstallStatus('installed')
      setToast('V-MAX has been installed.')
    }
    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  const installApp = async () => {
    if (!installPromptRef.current) {
      setToast('To install on iPhone/iPad: tap Share in Safari, then choose Add to Home Screen.')
      return
    }
    try {
      const promptEvent = installPromptRef.current
      setInstallStatus('prompting')
      await promptEvent.prompt()
      setInstallStatus('installing')
      const { outcome } = await promptEvent.userChoice
      installPromptRef.current = null
      setCanInstallApp(false)
      if (outcome === 'accepted') {
        setToast('V-MAX is being installed. Your browser will confirm when it is ready.')
      } else {
        setInstallStatus('idle')
      }
    } catch (error) {
      console.error('V-MAX installation prompt failed:', error)
      setInstallStatus('idle')
      setToast('V-MAX could not open the installation prompt. Try your browser menu.')
    }
  }

  useEffect(() => {
    if (!nowPlayingOpen) return undefined
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setNowPlayingOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [nowPlayingOpen])

  useEffect(() => {
    const handleShortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  const stopDemoAudio = () => {
    window.clearInterval(audioTimerRef.current)
    audioTimerRef.current = null
    const engine = audioEngineRef.current
    if (engine) {
      engine.master.gain.cancelScheduledValues(engine.context.currentTime)
      engine.master.gain.setTargetAtTime(0, engine.context.currentTime, 0.04)
    }
  }

  const changeVolume = (nextVolume) => {
    const value = Number(nextVolume)
    setVolume(value)
    if (mediaAudioRef.current) mediaAudioRef.current.volume = value / 100
    spotifyPlayerRef.current?.setVolume(value / 100).catch((error) => {
      setToast(`Could not change Spotify volume: ${error.message}`)
    })
    const engine = audioEngineRef.current
    if (engine) {
      engine.master.gain.setTargetAtTime(value / 100 * 1.5, engine.context.currentTime, 0.04)
    }
  }

  const connectSpotify = async () => {
    try {
      await beginSpotifyAuthorization()
    } catch (error) {
      setToast(`Could not start Spotify sign-in: ${error.message}`)
    }
  }

  const pauseSpotifyPlayback = () => {
    spotifyPlayerRef.current?.pause().catch((error) => {
      setToast(`Spotify playback could not be paused: ${error.message}`)
    })
  }

  const disconnectSpotify = () => {
    try {
      clearSpotifySession()
      spotifyPlayerRef.current?.disconnect()
      spotifyPlayerRef.current = null
      spotifyDeviceIdRef.current = ''
      setSpotifyDeviceId('')
      setSpotifySession(null)
      setSpotifyPlayerStatus(spotifyConfigured ? 'disconnected' : 'unconfigured')
      setSpotifyTracks([])
      setSpotifyRecentTracks([])
      setSpotifyRecentStatus('idle')
      setSpotifyRecentError(null)
      if (currentTrack.source === 'spotify') {
        const fallbackTrack = tracks.find((track) => matchesListeningPreferences(track, listeningPreferences)) ?? tracks[0]
        setCurrentTrack(fallbackTrack)
        setCurrentTime(0)
        setDuration(0)
        setIsPlaying(false)
      }
      setToast('Spotify disconnected from V-MAX.')
    } catch (error) {
      setToast(`Could not disconnect Spotify: ${error.message}`)
    }
  }

  const playSpotifyTrack = async (track) => {
    if (!spotifyPlayerRef.current || !spotifyDeviceIdRef.current) {
      setToast('Wait for the Spotify player to finish connecting, then try again.')
      return
    }
    try {
      const activation = spotifyPlayerRef.current.activateElement?.()
      if (activation) await activation
      const accessToken = await getSpotifyAccessToken()
      const endpoint = `me/player/play?device_id=${encodeURIComponent(spotifyDeviceIdRef.current)}`
      await spotifyRequest(accessToken, endpoint, {
        method: 'PUT',
        body: JSON.stringify({ uris: [track.spotifyUri] }),
      })
      setCurrentTrack(track)
      setCurrentTime(0)
      setDuration(track.durationSeconds ?? 0)
    } catch (error) {
      setIsPlaying(false)
      setToast(`Spotify could not play this track: ${error.message}`)
    }
  }

  const addLocalAudioFiles = async (event) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    const audioFiles = files.filter((file) => (
      file.type.startsWith('audio/') || /\.(aac|flac|m4a|mp3|oga|ogg|opus|wav|webm)$/i.test(file.name)
    ))
    if (!audioFiles.length) {
      setToast('Choose audio files you own or have permission to use.')
      return
    }

    const importedTracks = []
    let failedFile = ''
    try {
      for (const [index, file] of audioFiles.entries()) {
        failedFile = file.name
        setAudioImportProgress({
          current: index + 1,
          total: audioFiles.length,
          fileName: file.name,
        })
        const track = {
          id: `local-${Date.now()}-${index}-${crypto.randomUUID()}`,
          title: file.name.replace(/\.[^.]+$/, ''),
          artist: 'Your device',
          album: 'Local audio',
          duration: '—',
          image: tracks[0].image,
          source: 'local',
          audioBlob: file,
        }
        await saveAudioFile(track)
        const audioUrl = URL.createObjectURL(file)
        localAudioUrlsRef.current.add(audioUrl)
        importedTracks.push({ ...track, audioBlob: undefined, audioUrl })
        failedFile = ''
      }
      setLocalTracks((current) => [...current, ...importedTracks])
      setLocalLibraryStatus('ready')
      setToast(`${importedTracks.length} full ${importedTracks.length === 1 ? 'track' : 'tracks'} added to your library`)
    } catch (error) {
      if (importedTracks.length) {
        setLocalTracks((current) => [...current, ...importedTracks])
        setLocalLibraryStatus('ready')
        setToast(`Added ${importedTracks.length} ${importedTracks.length === 1 ? 'track' : 'tracks'}; could not add ${failedFile || 'the next file'}: ${error.message}`)
      } else {
        setToast(`Could not save ${failedFile || 'your audio files'}: ${error.message}`)
      }
    } finally {
      setAudioImportProgress(null)
    }
  }

  const removeLocalTrack = async (track) => {
    try {
      await deleteAudioFile(track.id)
      const remainingTracks = localTracks.filter((item) => item.id !== track.id)
      if (currentTrack.id === track.id) {
        if (remainingTracks.length) {
          playTrack(remainingTracks[0])
        } else {
          stopDemoAudio()
          mediaAudioRef.current?.pause()
          if (mediaAudioRef.current) {
            mediaAudioRef.current.removeAttribute('src')
            mediaAudioRef.current.load()
          }
          setCurrentTrack(tracks[0])
          setCurrentTime(0)
          setDuration(0)
          setIsPlaying(false)
        }
      }
      URL.revokeObjectURL(track.audioUrl)
      localAudioUrlsRef.current.delete(track.audioUrl)
      setLocalTracks(remainingTracks)
      setQueue((current) => current.filter((item) => item.id !== track.id))
      setToast(`${track.title} removed from this device`)
    } catch (error) {
      setToast(`Could not remove this audio file: ${error.message}`)
    }
  }

  const saveCreatorTrackOffline = async (track) => {
    if (!track.allowOffline) {
      setToast('This creator has not enabled offline listening for this track.')
      return
    }
    try {
      const response = await fetch(track.audioUrl)
      if (!response.ok) throw new Error(`Track download failed (${response.status}).`)
      const audioBlob = await response.blob()
      const offlineTrack = {
        ...toLibraryTrack(track),
        id: `offline-${track.id}`,
        source: 'local',
        audioBlob,
      }
      await saveAudioFile(offlineTrack)
      const audioUrl = URL.createObjectURL(audioBlob)
      const previousTrack = localTracks.find((item) => item.id === offlineTrack.id)
      if (previousTrack?.audioUrl) {
        URL.revokeObjectURL(previousTrack.audioUrl)
        localAudioUrlsRef.current.delete(previousTrack.audioUrl)
      }
      localAudioUrlsRef.current.add(audioUrl)
      setLocalTracks((current) => [
        ...current.filter((item) => item.id !== offlineTrack.id),
        { ...offlineTrack, audioBlob: undefined, audioUrl },
      ])
      setToast(`${track.title} saved for offline listening on this device.`)
    } catch (error) {
      setToast(`Could not save this track offline: ${error.message}`)
    }
  }

  const startDemoAudio = (track, resumeAt = 0) => {
    const AudioContextType = window.AudioContext || window.webkitAudioContext
    if (!AudioContextType) {
      setIsPlaying(false)
      setToast('Audio playback is not supported in this browser.')
      return
    }

    let engine = audioEngineRef.current
    if (!engine) {
      const context = new AudioContextType()
      const master = context.createGain()
      const compressor = context.createDynamicsCompressor()
      compressor.threshold.setValueAtTime(-10, context.currentTime)
      compressor.knee.setValueAtTime(5, context.currentTime)
      compressor.ratio.setValueAtTime(10, context.currentTime)
      compressor.attack.setValueAtTime(0.003, context.currentTime)
      compressor.release.setValueAtTime(0.2, context.currentTime)
      master.gain.value = 0
      master.connect(compressor)
      compressor.connect(context.destination)
      engine = { context, master, compressor }
      audioEngineRef.current = engine
    }

    window.clearInterval(audioTimerRef.current)
    engine.context.resume().then(() => {
      const activeEngine = audioEngineRef.current
      if (!activeEngine) return
      const { context, master } = activeEngine
      master.gain.cancelScheduledValues(context.currentTime)
      master.gain.setTargetAtTime(volume / 100 * 1.5, context.currentTime, 0.04)
      const roots = [220, 246.94, 196, 261.63, 207.65, 233.08, 174.61, 293.66]
      const scale = [0, 3, 7, 10, 7, 3, 5, 12]
      const root = roots[track.id - 1] ?? 220
      const [minutes, seconds] = track.duration.split(':').map(Number)
      const songLength = minutes * 60 + seconds
      let step = Math.floor(resumeAt / 0.45)

      const playTone = (frequency, type, level, length) => {
        const now = context.currentTime
        const oscillator = context.createOscillator()
        const envelope = context.createGain()
        oscillator.type = type
        oscillator.frequency.setValueAtTime(frequency, now)
        envelope.gain.setValueAtTime(0.0001, now)
        envelope.gain.exponentialRampToValueAtTime(level, now + 0.04)
        envelope.gain.exponentialRampToValueAtTime(0.0001, now + length)
        oscillator.connect(envelope)
        envelope.connect(master)
        oscillator.start(now)
        oscillator.stop(now + length + 0.02)
      }

      const playNote = () => {
        const frequency = root * 2 ** (scale[step % scale.length] / 12)
        playTone(frequency, 'triangle', 0.38, 0.38)
        playTone(frequency * 2, 'sine', 0.08, 0.3)
        if (step % 4 === 0) {
          ;[root / 2, root * 1.25, root * 1.5].forEach((chordTone) => playTone(chordTone, 'sine', 0.09, 1.65))
        }
        step += 1
        setCurrentTime(Math.min(songLength, step * 0.45))
        if (step * 0.45 >= songLength) {
          stopDemoAudio()
          skipTrack(1)
        }
      }

      playNote()
      audioTimerRef.current = window.setInterval(playNote, 450)
    }).catch(() => {
      setIsPlaying(false)
      setToast('Audio could not start. Try pressing play again.')
    })
  }

  const playTrack = (track, nextQueue) => {
    if (track.source === 'chart' || track.source === 'catalog') {
      setToast('This result is song information only. Search Spotify or add an audio file to play music here.')
      return
    }

    if (track.source === 'spotify') {
      stopDemoAudio()
      mediaAudioRef.current?.pause()
      setIsPlaying(false)
      if (nextQueue) setQueue(nextQueue)
      playSpotifyTrack(track)
      return
    }

    if (track.source === 'local' || track.source === 'creator') {
      const playableTrack = track.source === 'creator' || track.audioUrl
        ? track
        : localTracks.find((item) => item.id === track.id)
      stopDemoAudio()
      pauseSpotifyPlayback()
      if (!playableTrack?.audioUrl || !mediaAudioRef.current) {
        setToast('This local track is unavailable. Re-add the audio file from your device.')
        return
      }
      mediaAudioRef.current.pause()
      mediaAudioRef.current.src = playableTrack.audioUrl
      mediaAudioRef.current.volume = volume / 100
      mediaAudioRef.current.load()
      setCurrentTrack(playableTrack)
      setCurrentTime(0)
      setDuration(0)
      if (nextQueue) setQueue(nextQueue)
      mediaAudioRef.current.play()
        .then(() => {
          setIsPlaying(true)
          if (playableTrack.source === 'creator' && firebaseUser) {
            import('./creatorPlatform.js')
              .then(({ recordCreatorPlay }) => recordCreatorPlay(firebaseUser, playableTrack))
              .catch((error) => console.error('Could not record creator play:', error))
          }
          const nextHistory = [toLibraryTrack(playableTrack), ...listeningHistory.filter((item) => item.id !== playableTrack.id)].slice(0, 50)
          setListeningHistory(nextHistory)
          if (!saveStoredValue(HISTORY_STORAGE_KEY, nextHistory)) {
            setToast('Track played, but browser storage could not save your listening history.')
          }
        })
        .catch((error) => {
          setIsPlaying(false)
          setToast(`Could not play this audio file: ${error.message}`)
        })
      return
    }

    stopDemoAudio()
    mediaAudioRef.current?.pause()
    pauseSpotifyPlayback()
    setCurrentTrack(track)
    setCurrentTime(0)
    setDuration(track.duration.split(':').reduce((total, part) => total * 60 + Number(part), 0))
    setIsPlaying(true)
    startDemoAudio(track)
    if (nextQueue) setQueue(nextQueue)
  }

  const togglePlayback = () => {
    if (currentTrack.source === 'spotify') {
      const action = isPlaying ? spotifyPlayerRef.current?.pause() : spotifyPlayerRef.current?.resume()
      action?.catch((error) => setToast(`Spotify playback could not be changed: ${error.message}`))
      return
    }
    if (currentTrack.source === 'local' || currentTrack.source === 'creator') {
      if (!mediaAudioRef.current) return
      if (mediaAudioRef.current.paused) {
        mediaAudioRef.current.play()
          .then(() => setIsPlaying(true))
          .catch((error) => setToast(`Could not resume playback: ${error.message}`))
      } else {
        mediaAudioRef.current.pause()
        setIsPlaying(false)
      }
      return
    }
    if (isPlaying) {
      stopDemoAudio()
      setIsPlaying(false)
      return
    }
    setIsPlaying(true)
    startDemoAudio(currentTrack, currentTime)
  }

  const seekTo = (seconds) => {
    if (currentTrack.source === 'spotify') {
      spotifyPlayerRef.current?.seek(seconds * 1000).catch((error) => {
        setToast(`Could not seek in Spotify: ${error.message}`)
      })
      setCurrentTime(seconds)
      return
    }
    if (currentTrack.source === 'local' || currentTrack.source === 'creator') {
      if (mediaAudioRef.current) mediaAudioRef.current.currentTime = seconds
      setCurrentTime(seconds)
      return
    }
    setCurrentTime(seconds)
    if (isPlaying) startDemoAudio(currentTrack, seconds)
  }

  const toggleLike = (track) => {
    const nextLiked = liked.some((item) => item.id === track.id)
      ? liked.filter((item) => item.id !== track.id)
      : [toLibraryTrack(track), ...liked]
    setLiked(nextLiked)
    if (!saveStoredValue(LIKED_STORAGE_KEY, nextLiked)) {
      setToast('Your change was made, but browser storage could not save your likes.')
    }
  }

  const skipTrack = (direction = 1) => {
    if (currentTrack.source === 'spotify' && !queueRef.current.length) {
      const action = direction > 0
        ? spotifyPlayerRef.current?.nextTrack()
        : spotifyPlayerRef.current?.previousTrack()
      action?.catch((error) => setToast(`Spotify could not skip this track: ${error.message}`))
      return
    }
    const list = currentTrack.source === 'local'
      ? queue.filter((track) => track.source === 'local').length
        ? queue.filter((track) => track.source === 'local')
        : localTracks
      : queue.length ? queue : tracks
    if (!list.length) {
      setIsPlaying(false)
      return
    }
    const index = list.findIndex((track) => track.id === currentTrack.id)
    const nextIndex = index === -1 ? 0 : (index + direction + list.length) % list.length
    playTrack(list[nextIndex])
  }

  const isLiked = (track) => liked.some((item) => item.id === track.id)

  const addToQueue = (track) => {
    if (track.source === 'chart' || track.source === 'catalog') {
      setToast('Catalog results cannot be added to your queue because they are not playable in V-MAX.')
      return
    }
    setQueue((current) => [...current, track])
    setToast(`${track.title} added to your queue`)
  }

  const generatePlaylist = (event) => {
    event.preventDefault()
    const prompt = promptText.trim()
    if (!prompt) {
      setToast('Add a vibe or moment to build your mix.')
      return
    }
    const words = prompt.toLowerCase()
    const match = moods.find((item) => words.includes(item.name.toLowerCase()))
    const picks = match
      ? preferredTracks.filter((track) => track.mood.includes(match.name))
      : preferredTracks
    if (!picks.length) {
      setToast('No available tracks match both your prompt and music picks yet.')
      return
    }
    const nextPlaylist = { name: prompt.replace(/\b\w/g, (letter) => letter.toUpperCase()), tracks: picks.slice(0, 5) }
    setPlaylist(nextPlaylist)
    setToast(saveStoredValue(PLAYLIST_STORAGE_KEY, nextPlaylist)
      ? 'Your playlist is ready and saved in this browser'
      : 'Your playlist is ready, but browser storage could not save it')
  }

  const shareRoom = async () => {
    const invite = `${window.location.origin} — join my V-MAX listening room for ${currentTrack.title}`
    try {
      await navigator.clipboard.writeText(invite)
      setRoomActive(true)
      setToast('Room invite copied — send it to a friend')
    } catch {
      setRoomActive(true)
      setToast('Your V-MAX listening room is live — invite a friend to join')
    }
  }

  const formatTime = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

  const spotifySearchHelp = spotifySearchError?.status === 403
    ? 'Spotify denied this app or account. In your Spotify Developer Dashboard, check app access and add this Spotify account under Settings → Users Management if the app is in development mode.'
    : spotifySearchError?.status === 401
      ? 'The Spotify sign-in may have expired. Disconnect Spotify, connect again, and approve access.'
      : spotifySearchError?.status === 429
        ? 'Spotify rate-limited the app. Wait a little and try again.'
        : spotifySearchError?.status
          ? 'Check Spotify app access and try again.'
          : 'Check your internet connection and make sure Spotify is reachable.'

  const startMix = (mix) => {
    const mixTracks = preferredTracks.filter((track) => track.mood.includes(mix.mood))
    if (!mixTracks.length) {
      setToast('No tracks match this mix and your music picks yet.')
      return
    }
    setQueue(mixTracks)
    playTrack(mixTracks[0])
    setToast(`${mix.title} is on`)
  }

  const renderTrack = (track, index, options = {}) => (
    <div className={`track-row ${options.compact ? 'track-row-compact' : ''}`} key={`${track.id}-${index}`}>
      <button className="track-index" aria-label={track.source === 'chart' || track.source === 'catalog' ? `${track.title} catalog information` : `Play ${track.title}`} onClick={() => playTrack(track)}>
        {currentTrack.id === track.id && isPlaying ? <span className="playing-equalizer"><i /><i /><i /></span> : String(index + 1).padStart(2, '0')}
      </button>
      <button className="track-cover" onClick={() => playTrack(track)} aria-label={track.source === 'chart' || track.source === 'catalog' ? `${track.title} catalog information` : `Play ${track.title}`}>
        <img src={track.image} alt="" />
        <span className="cover-play"><Icon name="play" size={14} fill="currentColor" /></span>
      </button>
      <button className="track-name" onClick={() => track.source === 'chart' || track.source === 'catalog' ? playTrack(track) : setStoryTrack(track)}>
        <strong>{track.title}</strong>
        <span>{track.artist}{track.source === 'chart' || track.source === 'catalog' ? ' · Info only · Not playable here' : ''}{track.playedAt ? ` · Played ${new Date(track.playedAt).toLocaleString()}` : ''}</span>
      </button>
      {!options.compact && <span className="track-album">{track.album}</span>}
      <button className={`icon-button track-like ${isLiked(track) ? 'is-liked' : ''}`} aria-label={isLiked(track) ? 'Remove from liked songs' : 'Like song'} onClick={() => toggleLike(track)}>
        <Icon name="heart" size={17} fill={isLiked(track) ? 'currentColor' : 'none'} />
      </button>
      <span className="track-duration">{track.duration}</span>
      {options.removable
        ? <button className="icon-button track-more" aria-label={`Remove ${track.title} from this device`} onClick={() => removeLocalTrack(track)}><Icon name="close" size={16} /></button>
        : track.source !== 'chart' && track.source !== 'catalog' && <button className="icon-button track-more" aria-label={`Add ${track.title} to queue`} onClick={() => addToQueue(track)}>
        <Icon name="plus" size={17} />
      </button>}
    </div>
  )

  const renderTrendingSection = (limit = 10) => (
    <section className="section-block trending-section">
      <div className="section-heading">
        <div><p className="eyebrow">LISTENERS ARE INTO</p><h2>Trending songs</h2></div>
        <div className="trending-tools">
          <span className="section-aside">{trendingUpdatedAt ? `Updated ${trendingUpdatedAt.toLocaleDateString()} · US chart` : 'US song chart · updates daily'}</span>
          <button className="secondary-pill refresh-chart-button" onClick={refreshTrending} disabled={trendingStatus === 'loading'}>
            {trendingStatus === 'loading' ? 'Updating…' : 'Refresh'}
          </button>
        </div>
      </div>
      {trendingStatus === 'loading' && <p className="search-hint"><span className="search-spinner" /> Loading today’s chart...</p>}
      {trendingStatus === 'error' && <p className="search-hint search-error">The chart could not load. Check your connection and refresh.</p>}
      {trendingStatus === 'ready' && trendingTracks.length > 0 && <div className="track-list">{trendingTracks.slice(0, limit).map((track, index) => renderTrack(track, index))}</div>}
      {trendingStatus === 'ready' && trendingTracks.length === 0 && <div className="empty-state"><Icon name="music" size={20} /><span>The chart did not return any tracks. Try refreshing later.</span></div>}
      <p className="chart-attribution">Chart and search entries provide song information only. They do not open another app or play audio.</p>
    </section>
  )

  const renderYouTubePanel = () => (
    <section className="section-block youtube-panel">
      <div className="section-heading">
        <div><p className="eyebrow">OFFICIAL YOUTUBE PLAYER</p><h2>YouTube videos</h2></div>
      </div>
      {query.trim().length < 2 && <p className="search-hint">Search for a song or artist in the search box above. Matching YouTube videos will appear here.</p>}
      {query.trim().length >= 2 && !YOUTUBE_API_KEY && <p className="search-hint">Add a restricted YouTube Data API key to <code>.env.local</code> to show video search results. See the setup steps in README.</p>}
      {query.trim().length >= 2 && YOUTUBE_API_KEY && !youtubeResultsMatch && <p className="search-hint"><span className="search-spinner" /> Searching YouTube for “{query.trim()}”...</p>}
      {youtubeResultsMatch && youtubeStatus === 'loading' && <p className="search-hint"><span className="search-spinner" /> Searching YouTube...</p>}
      {youtubeResultsMatch && youtubeStatus === 'error' && <p className="search-hint search-error">YouTube search failed: {youtubeError}</p>}
      {youtubeResultsMatch && youtubeStatus === 'ready' && youtubeTracks.length > 0 && (
        <div className="youtube-results">
          {youtubeTracks.map((track) => (
            <button className="youtube-result" key={track.id} onClick={() => setYoutubeVideoId(track.id)}>
              <img src={track.image} alt="" />
              <span><strong>{track.title}</strong><small>{track.artist}</small></span>
              <Icon name="play" size={16} />
            </button>
          ))}
        </div>
      )}
      {youtubeResultsMatch && youtubeStatus === 'ready' && youtubeTracks.length === 0 && <p className="search-hint">No YouTube videos found for this search.</p>}
      {youtubeVideoId && (
        <div className="youtube-player-frame">
          <iframe
            title="Official YouTube video player"
            src={`https://www.youtube.com/embed/${youtubeVideoId}?playsinline=1`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      )}
      <p className="chart-attribution">Choose a video to play it in YouTube’s official player. Some videos may be unavailable to embed or may not be full songs.</p>
    </section>
  )

  return (
    <div className="app-shell">
      <input
        ref={fileInputRef}
        className="visually-hidden-audio-input"
        type="file"
        accept="audio/*,.aac,.flac,.m4a,.mp3,.oga,.ogg,.opus,.wav,.webm"
        multiple
        onChange={addLocalAudioFiles}
        aria-label="Choose audio files to add to your library"
      />
      <aside className="sidebar">
        <button className="brand" onClick={() => setPage('Home')} aria-label="V-MAX home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
          <span className="brand-name">V-MAX</span>
        </button>

        <div className="side-label">MENU</div>
        <nav className="main-nav" aria-label="Main navigation">
          {[
            { name: 'Home', icon: 'home' },
            { name: 'Discover', icon: 'search' },
            { name: 'Trending', icon: 'spark' },
            { name: 'Creator Studio', icon: 'music' },
            { name: 'Your library', icon: 'music' },
            { name: 'For you', icon: 'heart' },
            { name: 'Support V-MAX', icon: 'spark' },
          ].map((item) => (
            <button key={item.name} className={`nav-item ${page === item.name ? 'active' : ''}`} onClick={() => setPage(item.name)}>
              <Icon name={item.icon} size={19} /><span>{item.name}</span>
              {item.name === 'For you' && <span className="nav-new-dot" />}
            </button>
          ))}
        </nav>

        <div className="side-label playlist-label">YOUR PLAYLISTS <button className="icon-button" aria-label="Create playlist" onClick={() => document.getElementById('playlist-prompt')?.scrollIntoView({ behavior: 'smooth' })}><Icon name="plus" size={16} /></button></div>
        <div className="playlist-links">
          <button onClick={() => setPage('Your library')}><span className="playlist-swatch swatch-one"><Icon name="heart" size={15} fill="currentColor" /></span>Liked songs</button>
          <button onClick={() => setPage('Your library')}><span className="playlist-swatch swatch-two">✦</span>Sunday slowdown</button>
          <button onClick={() => setPage('Your library')}><span className="playlist-swatch swatch-three">☼</span>Little victories</button>
          {playlist && <button onClick={() => setPage('Your library')}><span className="playlist-swatch swatch-four"><Icon name="spark" size={15} /></span>{playlist.name}</button>}
        </div>

        <div className="sidebar-spacer" />
        <div className="sidebar-note">
          <div className="note-icon"><Icon name="headphones" size={18} /></div>
          <p>Good music.<br /><strong>Better moments.</strong></p>
          <span>Made for your every day.</span>
        </div>
        <div className="spotify-sidebar-control">
          <div className={`spotify-status-dot ${spotifyPlayerStatus === 'ready' && spotifyDeviceId ? 'is-ready' : ''}`} />
          <div className="spotify-sidebar-copy">
            <strong>Spotify</strong>
            <small>{!spotifyConfigured
              ? 'Add your Client ID to enable'
              : spotifyPlayerStatus === 'ready' && spotifyDeviceId
                ? 'Player connected'
                : spotifySession
                  ? spotifyPlayerStatus === 'connecting' ? 'Connecting player…' : 'Account connected'
                  : 'Catalog and playback'}</small>
          </div>
          <button
            className="spotify-auth-button"
            onClick={spotifySession ? disconnectSpotify : connectSpotify}
            disabled={spotifyPlayerStatus === 'connecting'}
          >
            {!spotifyConfigured ? 'Set up' : spotifySession ? 'Disconnect' : 'Connect'}
          </button>
        </div>
        <button className="profile-button" onClick={() => setAuthDialogOpen(true)}>
          <span className="profile-avatar">{firebaseUser?.email?.slice(0, 2).toUpperCase() ?? 'VM'}</span>
          <span><strong>{firebaseUser?.email ?? 'Sign in / create account'}</strong><small>{firebaseUser ? 'V-MAX account' : firebaseConfigured ? 'Firebase account' : 'Set up Firebase'}</small></span>
          <Icon name="more" size={18} />
        </button>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs"><span>Good evening</span><span className="breadcrumb-dot">/</span><strong>{page}</strong></div>
          <label className="search-box">
            <Icon name="search" size={18} />
            <input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search songs, artists, albums..." aria-label="Search songs, artists, albums" />
            {query && <button className="icon-button" onClick={() => setQuery('')} aria-label="Clear search"><Icon name="close" size={15} /></button>}
            <kbd>⌘ K</kbd>
          </label>
          {canInstallApp && <button className="install-app-button" onClick={installApp} disabled={installStatus === 'prompting' || installStatus === 'installing'}>{installStatus === 'prompting' ? 'Opening…' : 'Install app'}</button>}
          {installStatus === 'installing' && <span className="install-app-status" role="status"><i /> Installing…</span>}
          {installStatus === 'installed' && <span className="install-app-status is-installed" role="status">Installed</span>}
          <button className="mobile-account-button" onClick={() => setAuthDialogOpen(true)} aria-label="Open V-MAX account">
            {firebaseUser?.email?.slice(0, 2).toUpperCase() ?? 'VM'}
          </button>
          <button className="top-action" onClick={() => setToast('You’re all caught up — new music is on the way.')}><span className="notification-dot" /><span className="top-action-label">What’s new</span></button>
        </header>

        {query.trim() ? (
          <div className="page-content alternate-page search-results-page">
            <div className="section-heading search-results-heading"><div><p className="eyebrow">V-MAX SEARCH</p><h2>Results for “{query.trim()}”</h2></div><span className="section-aside">{filteredTracks.length + visibleLocalTracks.length + (catalogResultsMatch ? catalogTracks.length : 0) + (spotifyResultsMatch && spotifySearchStatus === 'ready' ? spotifyTracks.length : 0)} results</span></div>
            {visibleLocalTracks.length > 0 && <section className="search-result-group"><div className="search-group-title"><h3>Your full tracks</h3><span>On this device</span></div><div className="track-list">{visibleLocalTracks.map((track, index) => renderTrack(track, index))}</div></section>}
            {filteredTracks.length > 0 && <section className="search-result-group"><div className="search-group-title"><h3>V-MAX picks</h3></div><div className="track-list">{filteredTracks.map((track, index) => renderTrack(track, index))}</div></section>}
            <section className="search-result-group spotify-results">
              <div className="search-group-title"><h3>Spotify catalog</h3><span>Full playback with an eligible Premium account</span></div>
              {query.trim().length < 2 && <p className="search-hint">Enter at least 2 characters to search Spotify.</p>}
              {hasSpotifySession && spotifySearchStatus === 'loading' && spotifyResultsMatch && <p className="search-hint"><span className="search-spinner" /> Searching Spotify…</p>}
              {(!spotifyConfigured || !hasSpotifySession) && <div className="spotify-connect-prompt"><p className="search-hint">{spotifyConfigured ? 'Connect Spotify to search its catalog and play available tracks.' : 'Add your Spotify Client ID in .env.local, then restart V-MAX.'}</p><button className="primary-pill" onClick={spotifyConfigured ? connectSpotify : () => setToast('Add VITE_SPOTIFY_CLIENT_ID to .env.local and restart V-MAX.')}>{spotifyConfigured ? 'Connect Spotify' : 'Set up Spotify'}</button></div>}
              {spotifySession && <div className="spotify-connect-prompt"><p className="search-hint">{spotifyPlayerStatus === 'ready' ? 'Spotify is connected and ready to stream.' : 'Spotify account connected; player status: ' + spotifyPlayerStatus + '.'}</p><button className="secondary-pill" onClick={disconnectSpotify}>Disconnect</button></div>}
              {hasSpotifySession && spotifyResultsMatch && spotifySearchStatus === 'error' && <div className="search-hint search-error"><strong>Spotify search failed{spotifySearchError?.status ? ` (${spotifySearchError.status})` : ''}:</strong> {spotifySearchError?.message ?? 'Unknown error.'}<br />{spotifySearchHelp}</div>}
              {hasSpotifySession && spotifyResultsMatch && spotifySearchStatus === 'ready' && spotifyTracks.length > 0 && <div className="track-list">{spotifyTracks.map((track, index) => renderTrack(track, index))}</div>}
              {hasSpotifySession && spotifyResultsMatch && spotifySearchStatus === 'ready' && spotifyTracks.length === 0 && <p className="search-hint">No Spotify tracks found for this search.</p>}
              <p className="chart-attribution">Playback is provided by Spotify and requires an eligible account. V-MAX does not download Spotify tracks.</p>
            </section>
            <section className="search-result-group catalog-results">
              <div className="search-group-title"><h3>Music catalog</h3><span>Metadata search · no sign-in</span></div>
              {catalogStatus === 'loading' && <p className="search-hint"><span className="search-spinner" /> Searching songs, artists, and albums...</p>}
              {catalogStatus === 'error' && <p className="search-hint search-error">Catalog search failed. Check your connection and try again.</p>}
              {catalogResultsMatch && catalogStatus === 'ready' && catalogTracks.length > 0 && <div className="track-list">{catalogTracks.map((track, index) => renderTrack(track, index))}</div>}
              {catalogResultsMatch && catalogStatus === 'ready' && catalogTracks.length === 0 && <p className="search-hint">No catalog results for this search.</p>}
              <p className="chart-attribution">Apple catalog results provide song information only. Search Spotify above to play tracks with an eligible account.</p>
            </section>
            {renderYouTubePanel()}
            {filteredTracks.length === 0 && visibleLocalTracks.length === 0 && catalogResultsMatch && catalogStatus === 'ready' && catalogTracks.length === 0 && <div className="empty-state"><Icon name="search" size={21} /><span>No tracks found. Try another song, artist, or album.</span><button className="text-link" onClick={() => setQuery('')}>Clear search</button></div>}
          </div>
        ) : page === 'Home' && (
          <div className="page-content">
            <section className="welcome-row">
              <div>
                <p className="eyebrow"><span className="live-spark">✳</span> THURSDAY, OCTOBER 22</p>
                <h1>Your day, <span>your soundtrack.</span></h1>
                <p className="welcome-subtitle">{musicPreferenceSummary ? `Showing V-MAX picks for ${musicPreferenceSummary}.` : 'A little music to make this moment yours.'}</p>
                <button className="taste-settings-link" onClick={() => {
                  setPreferenceDraft(listeningPreferences ?? { genres: [], moods: [] })
                  setPreferencesOpen(true)
                }}>
                  {listeningPreferences?.genres.length || listeningPreferences?.moods.length ? 'Edit your music picks' : 'Choose your music picks'}
                </button>
              </div>
              <div className="streak-badge"><span>✦</span><div><strong>3 day streak</strong><small>You’re building a lovely habit</small></div></div>
            </section>

            <section className="hero-card">
              {discoverTrack && <img className="hero-image" src={discoverTrack.image} alt="" />}
              <div className="hero-shade" />
              <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
              <div className="hero-copy">
                <span className="hero-kicker"><Icon name="spark" size={14} /> YOUR DAILY MIX</span>
                <h2>{musicPreferenceSummary ? <>Your picks,<br /><em>your soundtrack.</em></> : <>A softer<br />kind of <em>Sunday.</em></>}</h2>
                <p>{musicPreferenceSummary ? `Music matched to ${musicPreferenceSummary}.` : <>Gentle sounds for when you want to<br />slow down and stay a little longer.</>}</p>
                <div className="hero-actions">
                  {recommendedMixes[0]
                    ? <button className="hero-play" onClick={() => startMix(recommendedMixes[0])}><Icon name="play" size={17} fill="currentColor" /> Play your mix <span>↗</span></button>
                    : <button className="hero-play" onClick={() => { setPreferenceDraft(listeningPreferences ?? { genres: [], moods: [] }); setPreferencesOpen(true) }}>Adjust your music picks</button>}
                  <button className="hero-upload" onClick={() => fileInputRef.current?.click()}><Icon name="plus" size={15} /> Add your audio</button>
                </div>
              </div>
              <div className="hero-caption"><span className="hero-caption-line" /> curated for you <span>·</span> {preferredTracks.length} V-MAX picks</div>
              <div className="hero-float-card"><span className="float-cover" style={{ backgroundImage: `url(${currentTrack.image})` }} /><span><small>NOW PLAYING</small><strong>{currentTrack.title}</strong><small>{currentTrack.artist}</small></span><span className="float-bars"><i /><i /><i /><i /></span></div>
            </section>

            <section className="section-block mixes-section">
              <div className="section-heading"><div><p className="eyebrow">MADE AROUND YOU</p><h2>Little worlds, on repeat</h2></div><button className="text-link" onClick={() => setPage('For you')}>See all <Icon name="arrow" size={15} /></button></div>
              <div className="mix-grid">
                {recommendedMixes.map((mix, index) => (
                  <button className={`mix-card ${mix.tint}`} key={mix.title} onClick={() => startMix(mix)}>
                    <span className="mix-card-top"><span className="mix-number">0{index + 1} <i>·</i> DAILY MIX</span><span className="mix-card-arrow"><Icon name="arrow" size={16} /></span></span>
                    <span className="mix-art-stack">{mix.tracks.slice(0, 3).map((track) => <img key={track.id} src={track.image} alt="" />)}</span>
                    <span className="mix-card-info"><strong>{mix.title}</strong><small>{mix.detail}</small></span>
                    <span className="mix-play"><Icon name="play" size={15} fill="currentColor" /></span>
                  </button>
                ))}
                {!recommendedMixes.length && <div className="empty-state">No curated mixes match these picks yet. Try another genre or mood.</div>}
              </div>
            </section>

            {renderTrendingSection(8)}

            <section className="section-block mood-section">
              <div className="section-heading"><div><p className="eyebrow">WHAT’S YOUR VIBE?</p><h2>Pick a feeling</h2></div><span className="section-aside">Let the music meet you there.</span></div>
              <div className="mood-list">
                {moods.map((item) => (
                  <button key={item.name} className={`mood-chip ${item.gradient} ${mood === item.name ? 'selected' : ''}`} onClick={() => setMood(mood === item.name ? '' : item.name)}>
                    <span>{item.emoji}</span>{item.name}{mood === item.name && <Icon name="check" size={15} />}
                  </button>
                ))}
              </div>
              {mood && <div className="filtered-mood-panel"><span>{filteredTracks.length} songs for your {mood.toLowerCase()} mood</span><button className="text-link" onClick={() => { setPage('Discover'); setQuery('') }}>Explore tracks <Icon name="arrow" size={14} /></button></div>}
            </section>

            <section className="section-block discover-section">
              <div className="section-heading"><div><p className="eyebrow">A NEW LITTLE OBSESSION</p><h2>One more for the road</h2></div><button className="text-link" onClick={() => setPage('Discover')}>Discover more <Icon name="arrow" size={15} /></button></div>
              {discoverTrack ? <div className="discover-card">
                <div className={`discover-art ${discoverTrack.color}`}><img src={discoverTrack.image} alt="" /><span className="discover-art-label"><Icon name="spark" size={13} /> PICKED FOR YOU</span></div>
                <div className="discover-details"><span className="discover-match">Picked from your selected genres and moods</span><h3>{discoverTrack.title}</h3><p>{discoverTrack.artist} <span>·</span> {discoverTrack.album}</p><div className="discover-actions"><button className="primary-pill" onClick={() => playTrack(discoverTrack)}><Icon name="play" size={15} fill="currentColor" /> Play track</button><button className={`round-action ${isLiked(discoverTrack) ? 'is-liked' : ''}`} onClick={() => toggleLike(discoverTrack)} aria-label={isLiked(discoverTrack) ? 'Remove from liked songs' : 'Like this track'}><Icon name="heart" size={18} fill={isLiked(discoverTrack) ? 'currentColor' : 'none'} /></button><button className="round-action" onClick={() => addToQueue(discoverTrack)} aria-label="Add to queue"><Icon name="plus" size={18} /></button><button className="round-action skip-action" onClick={() => setDiscoverIndex((discoverIndex + 1) % preferredTracks.length)} aria-label="Skip recommendation"><Icon name="next" size={17} /></button></div></div>
                <div className="discover-tip"><span className="tip-icon">✧</span><span><strong>Why this?</strong><small>This track matches the genres and moods you picked.</small></span></div>
              </div> : <div className="empty-state">No V-MAX picks match all your selected genres and moods yet. Update your picks to see more recommendations.<button className="text-link" onClick={() => { setPreferenceDraft(listeningPreferences ?? { genres: [], moods: [] }); setPreferencesOpen(true) }}>Edit your music picks</button></div>}
            </section>

            <section className="section-block prompt-section" id="playlist-prompt">
              <div className="prompt-copy"><span className="prompt-icon"><Icon name="spark" size={18} /></span><p className="eyebrow">A PLAYLIST, FROM A FEELING</p><h2>Tell us the moment.<br /><em>We’ll find the music.</em></h2><p className="prompt-description">The long way home. A kitchen dance party.<br />Whatever it is, there’s a soundtrack for it.</p></div>
              <form className="prompt-form" onSubmit={generatePlaylist}><label htmlFor="prompt-input">I need music for...</label><div className="prompt-input-wrap"><input id="prompt-input" value={promptText} onChange={(event) => setPromptText(event.target.value)} placeholder="e.g. slow mornings and a second coffee" /><button type="submit" aria-label="Generate playlist"><Icon name="arrow" size={17} /></button></div><span className="prompt-suggestion">✦ Try “a little late-night nostalgia”</span></form>
              {personalizedPlaylist?.tracks.length > 0 && <div className="generated-playlist"><span className="generated-art">{personalizedPlaylist.tracks.slice(0, 4).map((track) => <img key={track.id} src={track.image} alt="" />)}</span><span><small>YOUR NEW PLAYLIST</small><strong>{personalizedPlaylist.name}</strong><small>{personalizedPlaylist.tracks.length} tracks · matched to your picks</small></span><button className="icon-button" aria-label="Play generated playlist" onClick={() => { setQueue(personalizedPlaylist.tracks); playTrack(personalizedPlaylist.tracks[0]) }}><Icon name="play" size={17} fill="currentColor" /></button></div>}
            </section>

            <section className="section-block tracks-section">
              <div className="section-heading"><div><p className="eyebrow">A FEW GOOD SOUNDS</p><h2>{query ? `Results for “${query}”` : mood ? `For your ${mood.toLowerCase()} mood` : 'In your orbit'}</h2></div><button className="text-link" onClick={() => setPage('Your library')}>Your library <Icon name="arrow" size={15} /></button></div>
              <div className="track-list">
                {filteredTracks.slice(0, 4).map((track, index) => renderTrack(track, index))}
                {filteredTracks.length === 0 && <div className="empty-state"><Icon name="search" size={21} /><span>No V-MAX picks match all your selected genres and moods yet.</span><button className="text-link" onClick={() => { setMood(''); setPreferenceDraft(listeningPreferences ?? { genres: [], moods: [] }); setPreferencesOpen(true) }}>Edit music picks</button></div>}
              </div>
            </section>

            <section className="section-block stories-section">
              <div className="section-heading"><div><p className="eyebrow">BEHIND THE SOUND</p><h2>Listen a little closer</h2></div><span className="section-aside">Every song has a story.</span></div>
              <div className="story-grid">{filteredTracks.slice(0, 3).map((track) => <button className="story-card" key={track.id} onClick={() => setStoryTrack(track)}><span className="story-image"><img src={track.image} alt="" /><span className="story-play"><Icon name="music" size={17} /></span></span><span className="story-copy"><small>TRACK NOTES <i>·</i> {track.duration}</small><strong>{track.title}</strong><span>{track.artist} <Icon name="arrow" size={13} /></span></span></button>)}{!filteredTracks.length && <div className="empty-state">Track stories will appear when V-MAX has picks for your selected genres and moods.</div>}</div>
            </section>

            <section className="section-block challenge-section">
              <div className="section-heading"><div><p className="eyebrow">A SMALL, LOVELY CHALLENGE</p><h2>Make a little room for music</h2></div><span className="section-aside">No pressure. Just good sounds.</span></div>
              <div className="challenge-card"><div className="challenge-badge">✦</div><div className="challenge-copy"><small>THIS WEEK’S LISTENING CHALLENGE</small><strong>Take the scenic route</strong><span>Discover 3 new songs you’ve never heard before.</span></div><div className="challenge-progress"><div className="progress-label"><strong>{Math.min(completedChallenges.length, 3)} <span>/ 3 songs</span></strong><span>{Math.round(Math.min(completedChallenges.length, 3) / 3 * 100)}%</span></div><div className="progress-track"><span style={{ width: `${Math.min(completedChallenges.length, 3) / 3 * 100}%` }} /></div></div><button className="challenge-button" onClick={() => { if (completedChallenges.length >= 3) { setToast('You earned the Curious Ears badge!'); return }; const track = filteredTracks.find((item) => !completedChallenges.includes(item.id)); if (!track) { setToast('No new tracks match your current music picks yet.'); return }; setCompletedChallenges((current) => [...current, track.id]); playTrack(track); setToast('New song discovered — challenge progress updated!') }}>{completedChallenges.length >= 3 ? 'Badge earned ✓' : 'Find a new song'} <Icon name="arrow" size={15} /></button></div>
            </section>
          </div>
        )}

        {!query.trim() && page === 'Discover' && (
          <div className="page-content alternate-page">
            <div className="page-title-row"><div><p className="eyebrow">FOLLOW YOUR CURIOSITY</p><h1>Find your <span>next favorite.</span></h1><p className="welcome-subtitle">Little discoveries, picked for the way you listen.</p></div><span className="page-title-spark">✳</span></div>
            {renderYouTubePanel()}
            {renderTrendingSection(25)}
            {discoverTrack
              ? <section className="discover-feature"><div className="feature-image"><img src={discoverTrack.image} alt="" /><span>YOUR NEXT FAVORITE</span></div><div className="feature-copy"><p className="eyebrow">A FRESH FIND · MATCHED TO YOUR PICKS</p><h2>{discoverTrack.title}</h2><p>{discoverTrack.artist} <span>·</span> {discoverTrack.album}</p><p className="feature-note">{discoverTrack.note}</p><div className="discover-actions"><button className="primary-pill" onClick={() => playTrack(discoverTrack)}><Icon name="play" size={15} fill="currentColor" /> Give it a listen</button><button className="round-action" onClick={() => setDiscoverIndex((discoverIndex + 1) % preferredTracks.length)} aria-label="Skip to next recommendation"><Icon name="next" size={17} /></button></div></div></section>
              : <div className="empty-state">No V-MAX picks match all your selected genres and moods yet.<button className="text-link" onClick={() => { setPreferenceDraft(listeningPreferences ?? { genres: [], moods: [] }); setPreferencesOpen(true) }}>Edit your music picks</button></div>}
            <section className="section-block"><div className="section-heading"><div><p className="eyebrow">GO WHERE THE MOOD TAKES YOU</p><h2>Browse by feeling</h2></div></div><div className="mood-list">{moods.map((item) => <button key={item.name} className={`mood-chip ${item.gradient} ${mood === item.name ? 'selected' : ''}`} onClick={() => setMood(mood === item.name ? '' : item.name)}><span>{item.emoji}</span>{item.name}{mood === item.name && <Icon name="check" size={15} />}</button>)}</div></section>
            <section className="section-block"><div className="section-heading"><div><p className="eyebrow">OUT IN THE WORLD</p><h2>{mood ? `For your ${mood.toLowerCase()} mood` : 'Matched to your music picks'}</h2></div></div><div className="track-list">{filteredTracks.map((track, index) => renderTrack(track, index))}{filteredTracks.length === 0 && <div className="empty-state">No V-MAX picks match all your selected genres and moods yet.<button className="text-link" onClick={() => { setPreferenceDraft(listeningPreferences ?? { genres: [], moods: [] }); setPreferencesOpen(true) }}>Edit music picks</button></div>}</div></section>
            <section className="section-block"><div className="section-heading"><div><p className="eyebrow">YOUR NEXT LISTENING ADVENTURE</p><h2>Daily mixes for your picks</h2></div></div><div className="mix-grid">{recommendedMixes.map((mix, index) => <button className={`mix-card ${mix.tint}`} key={mix.title} onClick={() => startMix(mix)}><span className="mix-card-top"><span className="mix-number">0{index + 1} <i>·</i> DAILY MIX</span><span className="mix-card-arrow"><Icon name="arrow" size={16} /></span></span><span className="mix-art-stack">{mix.tracks.slice(0, 3).map((track) => <img key={track.id} src={track.image} alt="" />)}</span><span className="mix-card-info"><strong>{mix.title}</strong><small>{mix.detail}</small></span><span className="mix-play"><Icon name="play" size={15} fill="currentColor" /></span></button>)}{!recommendedMixes.length && <div className="empty-state">No mixes match these music picks yet. Adjust your preferences to explore more.</div>}</div></section>
          </div>
        )}

        {!query.trim() && page === 'Trending' && (
          <div className="page-content alternate-page">
            <div className="page-title-row">
              <div>
                <p className="eyebrow">WHAT PEOPLE ARE LISTENING TO</p>
                <h1>Trending <span>songs.</span></h1>
                <p className="welcome-subtitle">Explore the latest songs on the US top-songs chart.</p>
              </div>
              <span className="page-title-spark"><Icon name="spark" size={38} /></span>
            </div>
            {renderTrendingSection(25)}
          </div>
        )}

        {!query.trim() && page === 'Creator Studio' && (
          <Suspense fallback={<div className="page-content alternate-page"><p className="search-hint"><span className="search-spinner" /> Loading Creator Studio...</p></div>}>
            <CreatorHub
              user={firebaseUser}
              onPlay={playTrack}
              onOfflineSave={saveCreatorTrackOffline}
              onToast={setToast}
              onNavigate={() => setPage('Support V-MAX')}
              onSignIn={() => setAuthDialogOpen(true)}
            />
          </Suspense>
        )}

        {!query.trim() && page === 'Your library' && (
          <div className="page-content alternate-page">
            <div className="page-title-row"><div><p className="eyebrow">THE SOUNDS YOU KEEP</p><h1>Your <span>little corner.</span></h1><p className="welcome-subtitle">All the songs and moments you’ve saved.</p></div><span className="page-title-spark">♫</span></div>
            <div className="library-hero"><span className="library-heart"><Icon name="heart" size={25} fill="currentColor" /></span><div><small>YOUR COLLECTION</small><h2>Liked songs</h2><p>{likedTracks.length} songs saved for later (or right now).</p></div><button className="primary-pill" onClick={() => likedTracks.length ? (setQueue(likedTracks), playTrack(likedTracks[0])) : setToast('Like a song to start your collection')}><Icon name="play" size={15} fill="currentColor" /> Play all</button></div>
            <section className="section-block library-list"><div className="section-heading"><div><p className="eyebrow">YOUR COLLECTION</p><h2>Saved songs</h2></div></div><div className="track-list">{likedTracks.length ? likedTracks.map((track, index) => renderTrack(track, index)) : <div className="empty-state"><Icon name="heart" size={20} /><span>Your liked songs will find a home here.</span><button className="text-link" onClick={() => setPage('Discover')}>Find a song <Icon name="arrow" size={14} /></button></div>}</div></section>
            <section className="section-block library-list">
              <div className="section-heading">
                <div><p className="eyebrow">FROM YOUR SPOTIFY ACCOUNT</p><h2>Recently played</h2></div>
                {spotifySession && <button className="secondary-pill" disabled={spotifyRecentStatus === 'loading'} onClick={() => setSpotifyRecentRefresh((current) => current + 1)}>{spotifyRecentStatus === 'loading' ? 'Refreshing…' : 'Refresh'}</button>}
              </div>
              {!spotifyConfigured && <div className="empty-state">Add your Spotify Client ID in .env.local to view your Spotify listening history.</div>}
              {spotifyConfigured && !spotifySession && <div className="spotify-connect-prompt"><p className="search-hint">Connect Spotify to see tracks you’ve recently played.</p><button className="primary-pill" onClick={connectSpotify}>Connect Spotify</button></div>}
              {spotifySession && spotifyRecentStatus === 'loading' && <p className="search-hint"><span className="search-spinner" /> Loading your Spotify listening history…</p>}
              {spotifySession && spotifyRecentStatus === 'error' && <div className="spotify-connect-prompt"><p className="search-hint search-error">{spotifyRecentError?.status === 403 ? 'Spotify did not grant access to your listening history. Disconnect Spotify, then connect again and approve the recently played permission.' : `Could not load your Spotify listening history: ${spotifyRecentError?.message ?? 'Unknown error.'}`}</p></div>}
              {spotifySession && spotifyRecentStatus === 'ready' && <div className="track-list">{spotifyRecentTracks.length ? spotifyRecentTracks.map((track, index) => renderTrack(track, index)) : <div className="empty-state"><Icon name="clock" size={20} /><span>No Spotify listening history was returned.</span></div>}</div>}
            </section>
            <section className="section-block library-list">
              <div className="section-heading"><div><p className="eyebrow">CREATOR STUDIO</p><h2>Audio on this device</h2></div><button className="secondary-pill local-upload-button" disabled={Boolean(audioImportProgress)} onClick={() => fileInputRef.current?.click()}>{audioImportProgress ? 'Adding…' : 'Add audio files'}</button></div>
              <p className="local-audio-note">Import and play audio you own or have permission to use. Files stay in this browser’s local library and are never uploaded to V-MAX.</p>
              {audioImportProgress && <div className="audio-import-progress" role="status" aria-live="polite">
                <div className="audio-import-progress-label"><span>Saving {audioImportProgress.fileName}</span><span>{audioImportProgress.current} of {audioImportProgress.total}</span></div>
                <div className="audio-import-progress-track" role="progressbar" aria-label={`Saving audio file ${audioImportProgress.current} of ${audioImportProgress.total}`} aria-valuetext={`Saving file ${audioImportProgress.current} of ${audioImportProgress.total}`}>
                  <span key={audioImportProgress.current} />
                </div>
              </div>}
              {localLibraryStatus === 'loading' && <p className="search-hint"><span className="search-spinner" /> Loading your local library...</p>}
              {localLibraryStatus === 'error' && <p className="search-hint search-error">The local library could not be opened. Check browser storage permissions and try again.</p>}
              <div className="track-list">{localTracks.length ? localTracks.map((track, index) => renderTrack(track, index, { removable: true })) : localLibraryStatus === 'ready' && <div className="empty-state"><Icon name="music" size={20} /><span>No local audio yet. Add files to start your own collection.</span></div>}</div>
            </section>
            <section className="section-block library-list"><div className="section-heading"><div><p className="eyebrow">RECENTLY PLAYED</p><h2>Listening history</h2></div></div><div className="track-list">{listeningHistory.length ? listeningHistory.map((track, index) => renderTrack(track, index)) : <div className="empty-state"><Icon name="clock" size={20} /><span>Tracks you play from this device will appear here.</span></div>}</div></section>
            {personalizedPlaylist?.tracks.length > 0 && <section className="section-block"><div className="section-heading"><div><p className="eyebrow">MADE FROM YOUR MOMENT</p><h2>{personalizedPlaylist.name}</h2></div><button className="primary-pill" onClick={() => { setQueue(personalizedPlaylist.tracks); playTrack(personalizedPlaylist.tracks[0]) }}><Icon name="play" size={15} fill="currentColor" /> Play playlist</button></div><div className="track-list">{personalizedPlaylist.tracks.map((track, index) => renderTrack(track, index))}</div></section>}
            <section className="section-block"><div className="section-heading"><div><p className="eyebrow">MADE FOR A MOMENT</p><h2>Build another playlist</h2></div></div><form className="library-prompt" onSubmit={generatePlaylist}><Icon name="spark" size={18} /><input value={promptText} onChange={(event) => setPromptText(event.target.value)} placeholder="What does this moment sound like?" aria-label="Playlist idea" /><button type="submit" className="primary-pill">Make a mix <Icon name="arrow" size={14} /></button></form></section>
          </div>
        )}

        {!query.trim() && page === 'For you' && (
          <div className="page-content alternate-page">
            <div className="page-title-row"><div><p className="eyebrow">YOUR PEOPLE, YOUR MUSIC</p><h1>Good things are <span>better shared.</span></h1><p className="welcome-subtitle">See what your friends love, or invite them into the room.</p></div><span className="page-title-spark">♡</span></div>
            <section className="room-card"><div className="room-graphic"><span className="room-orbit" /><span className="room-orbit room-orbit-two" /><span className="room-headphones"><Icon name="headphones" size={30} /></span><span className="room-avatar room-avatar-one">MC</span><span className="room-avatar room-avatar-two">JL</span><span className="room-avatar room-avatar-three">AR</span></div><div className="room-copy"><p className="eyebrow"><span className="room-live-dot" /> {roomActive ? 'YOUR ROOM IS LIVE' : 'LISTEN TOGETHER'}</p><h2>{roomActive ? 'The room is open.' : 'Same song, same moment.'}</h2><p>Start a V-MAX listening room and let your friends join the queue. Good songs are even better together.</p><div className="room-actions"><button className="primary-pill" onClick={shareRoom}><Icon name="users" size={16} /> {roomActive ? 'Copy room invite' : 'Start a V-MAX Room'}</button><button className={`secondary-pill ${joinedRoom ? 'joined-pill' : ''}`} onClick={() => { setJoinedRoom(!joinedRoom); setToast(joinedRoom ? 'You left the listening room' : 'You joined the listening room') }}>{joinedRoom ? <><Icon name="check" size={15} /> Joined room</> : 'Join a room'}</button></div></div><div className="room-current"><small>PLAYING IN YOUR ROOM</small><span className="room-track-cover"><img src={currentTrack.image} alt="" /></span><strong>{currentTrack.title}</strong><span>{currentTrack.artist}</span><div className="room-listeners"><span className="tiny-avatar avatar-peach">MC</span><span className="tiny-avatar avatar-lilac">JL</span><span className="tiny-avatar avatar-blue">AR</span><small>+ you</small></div></div></section>
            <section className="section-block friends-section"><div className="section-heading"><div><p className="eyebrow">THEIR SOUNDTRACK, LATELY</p><h2>Your friends are listening to...</h2></div><button className="text-link" onClick={() => setToast('Invite link copied — bring your friends to V-MAX')}><Icon name="plus" size={15} /> Invite friends</button></div><div className="friend-list">{personalizedFriends.map((friend) => <div className="friend-card" key={friend.handle}><span className={`friend-avatar ${friend.color}`}>{friend.initials}<i /></span><span className="friend-details"><strong>{friend.name}</strong><small>{friend.handle} <i>·</i> {friend.active}</small><span><Icon name="music" size={13} /> {friend.recommendedTrack.title} · {friend.recommendedTrack.artist}</span></span><button className="friend-play" onClick={() => { playTrack(friend.recommendedTrack); setToast(`Playing a song for your music picks`) }} aria-label={`Play ${friend.recommendedTrack.title}`}><Icon name="play" size={14} fill="currentColor" /></button></div>)}{!personalizedFriends.length && <div className="empty-state">No V-MAX picks match your selected genres and moods yet.<button className="text-link" onClick={() => { setPreferenceDraft(listeningPreferences ?? { genres: [], moods: [] }); setPreferencesOpen(true) }}>Edit your music picks</button></div>}</div></section>
            <section className="section-block shared-section"><div className="section-heading"><div><p className="eyebrow">MAKE IT TOGETHER</p><h2>Playlist, plus your people</h2></div></div>{preferredTracks.length ? <div className="shared-card"><div className="shared-cover-grid">{preferredTracks.slice(0, 4).map((track) => <img key={track.id} src={track.image} alt="" />)}</div><div className="shared-info"><span className="shared-pill"><Icon name="users" size={12} /> YOUR MUSIC PICKS</span><h3>The group chat mix</h3><p>A mix built from tracks matching your selected genres and moods.</p><div className="shared-avatars"><span className="tiny-avatar avatar-peach">MC</span><span className="tiny-avatar avatar-lilac">JL</span><span className="tiny-avatar avatar-blue">AR</span><small>Made for your listening taste</small></div></div><button className="secondary-pill" onClick={() => { setQueue(preferredTracks.slice(0, 4)); playTrack(preferredTracks[0]); setToast('Now playing your music-picks mix') }}><Icon name="play" size={14} fill="currentColor" /> Play mix</button><button className="icon-button shared-share" onClick={shareRoom} aria-label="Share collaborative playlist"><Icon name="share" size={17} /></button></div> : <div className="empty-state">No V-MAX picks match your selected genres and moods yet.</div>}</section>
            <section className="section-block"><div className="section-heading"><div><p className="eyebrow">KEEP THE GOOD STUFF GOING</p><h2>Listen together, right now</h2></div></div><div className="social-prompt"><span className="social-prompt-icon"><Icon name="message" size={20} /></span><span><strong>Got a song on your mind?</strong><small>Start a room and let the queue do the talking.</small></span><button className="text-link" onClick={shareRoom}>Start listening <Icon name="arrow" size={15} /></button></div></section>
          </div>
        )}

        {!query.trim() && page === 'Support V-MAX' && (
          <div className="page-content alternate-page monetization-page">
            <div className="page-title-row">
              <div>
                <p className="eyebrow">KEEP THE GOOD SOUNDS GOING</p>
                <h1>Support <span>V-MAX.</span></h1>
                <p className="welcome-subtitle">A few ways to help this little music project grow.</p>
              </div>
              <span className="page-title-spark"><Icon name="spark" size={38} /></span>
            </div>

            <div className="monetization-notice" role="status">
              <Icon name="spark" size={17} />
              <span><strong>Setup preview</strong> Payments and ads are not live yet. No money will be charged on this page.</span>
            </div>

            <section className="section-block monetization-section">
              <div className="section-heading">
                <div><p className="eyebrow">MEMBERSHIP</p><h2>More room for your music</h2></div>
                <span className="section-aside">Subscription checkout needs a payment provider.</span>
              </div>
              <div className="monetization-card subscription-card">
                <div className="monetization-card-copy">
                  <span className="monetization-label">PLANNED MEMBERSHIP</span>
                  <h3>V-MAX Plus</h3>
                  <p>A future paid tier could help fund V-MAX while keeping discovery open to everyone.</p>
                  <ul>
                    <li><Icon name="check" size={15} /> Free discovery stays available</li>
                    <li><Icon name="check" size={15} /> Member perks can be defined before launch</li>
                    <li><Icon name="check" size={15} /> Clear pricing and cancellation terms at checkout</li>
                  </ul>
                </div>
                <div className="monetization-card-action">
                  <span>Price not set</span>
                  <button className="primary-pill" onClick={() => setToast('Subscriptions are not live yet. Connect a payment provider and configure the membership first.')}>Set up subscription <Icon name="arrow" size={14} /></button>
                </div>
              </div>
            </section>

            <section className="section-block monetization-section">
              <div className="section-heading">
                <div><p className="eyebrow">VOLUNTARY SUPPORT</p><h2>Leave a little love</h2></div>
                <span className="section-aside">One-time contributions, when checkout is connected.</span>
              </div>
              <div className="donation-card">
                <span className="donation-icon"><Icon name="heart" size={23} /></span>
                <div className="donation-copy"><h3>Help keep V-MAX growing</h3><p>Choose an amount to preview the support flow. Nothing will be charged until a payment provider is connected.</p></div>
                <div className="donation-actions">
                  {[3, 5, 10].map((amount) => (
                    <button className="secondary-pill" key={amount} onClick={() => setToast('Donations are not live yet. Connect a payment provider before accepting contributions.')}>${amount}</button>
                  ))}
                </div>
              </div>
            </section>

            <section className="section-block monetization-section">
              <div className="section-heading">
                <div><p className="eyebrow">SPONSORED PLACEMENTS</p><h2>Thoughtful ads, clearly labeled</h2></div>
                <span className="section-aside">An ad network and publisher approval are required.</span>
              </div>
              <div className="ad-preview-card">
                <div className="ad-preview-slot"><span>ADVERTISEMENT</span><strong>Sponsored placement preview</strong><small>Approved ads would appear here.</small></div>
                <div className="ad-preview-copy">
                  <h3>Keep listening first.</h3>
                  <p>This reserved space is only a preview. No ads are being served and this app is not earning ad revenue yet.</p>
                  <button className="secondary-pill" onClick={() => setToast('Ads are not live yet. Set up an ad account, get site approval, and connect its approved integration.')}>Set up advertising</button>
                </div>
              </div>
            </section>

            <p className="monetization-footnote">Before launch, connect a secure payment provider for memberships and donations. For ads, follow the ad network’s approval and placement policies. Keep third-party music players and their content compliant with their own terms.</p>
          </div>
        )}

        <footer className="footer-note"><span className="brand-mark tiny" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span><span>V-MAX. Find a moment in every song.</span><span>Made with a little love <i>♡</i></span></footer>
      </main>

      <aside className="right-rail">
        <div className="rail-heading"><div><p className="eyebrow">YOUR SPACE</p><h2>In the room</h2></div><button className="icon-button rail-more" aria-label="More listening options" onClick={() => setToast('Your listening space is up to date.')}><Icon name="more" size={18} /></button></div>
        <div className="profile-card">
          <div className="profile-card-top"><span className="listening-status"><i /> YOUR LISTENING ROOM</span><button className="icon-button" aria-label="Share listening room" onClick={shareRoom}><Icon name="share" size={16} /></button></div>
          <button className="rail-now-art" onClick={() => setNowPlayingOpen(true)} aria-label="Open now playing"><img src={currentTrack.image} alt="" /><span className="rail-art-glow" /><span className="rail-art-play"><Icon name={isPlaying ? 'pause' : 'play'} size={17} fill="currentColor" /></span></button>
          <div className="rail-track-title"><strong>{currentTrack.title}</strong><span>{currentTrack.artist}</span></div>
          <div className="rail-listening-to"><span className="mini-avatar avatar-peach">MC</span><span className="mini-avatar avatar-lilac">JL</span><span className="mini-avatar avatar-blue">AR</span><small>{roomActive ? 'You + 3 friends are here' : 'Just you, for now'}</small></div>
          <button className="rail-room-button" onClick={shareRoom}><Icon name="users" size={15} /> {roomActive ? 'Invite a friend' : 'Start a listening room'} <Icon name="arrow" size={14} /></button>
        </div>

        <div className="rail-section"><div className="rail-section-heading"><div><p className="eyebrow">FRIENDS’ ACTIVITY</p><h3>Around your people</h3></div><button className="icon-button" aria-label="See all friends" onClick={() => setPage('For you')}><Icon name="arrow" size={16} /></button></div><div className="activity-list">{friends.slice(0, 2).map((friend) => <button className="activity-item" key={friend.handle} onClick={() => setPage('For you')}><span className={`activity-avatar ${friend.color}`}>{friend.initials}<i /></span><span className="activity-copy"><strong>{friend.name}</strong><small>is listening to</small><span>{friend.track}</span></span><span className="activity-time">{friend.active === 'Listening now' ? <i /> : '12m'}</span></button>)}</div><button className="rail-see-all" onClick={() => setPage('For you')}>See all activity <Icon name="arrow" size={14} /></button></div>

        <div className="rail-section queue-section"><div className="rail-section-heading"><div><p className="eyebrow">UP NEXT</p><h3>Your listening queue</h3></div><button className="icon-button" aria-label="Clear queue" onClick={() => { setQueue([]); setToast('Your queue is clear') }}><Icon name="more" size={18} /></button></div><div className="queue-list">{queue.length ? queue.slice(0, 4).map((track, index) => <button className="queue-item" key={`${track.id}-${index}`} onClick={() => playTrack(track)}><span className="queue-art"><img src={track.image} alt="" />{currentTrack.id === track.id && isPlaying && <i />}</span><span className="queue-info"><strong>{track.title}</strong><small>{track.artist}</small></span><span className="queue-duration">{track.duration}</span></button>) : <div className="queue-empty">Your queue is clear.<br />Add a song to keep the music going.</div>}</div><button className="queue-add" onClick={() => setPage('Discover')}><Icon name="plus" size={15} /> Find songs to add</button></div>

        <div className="rail-bottom-card"><span className="rail-bottom-spark">✧</span><div><strong>Make it a moment.</strong><span>Pick a feeling, find a song,<br />stay a little longer.</span></div><button onClick={() => { setPage('Home'); document.querySelector('.mood-section')?.scrollIntoView({ behavior: 'smooth' }) }} aria-label="Pick a mood"><Icon name="arrow" size={15} /></button></div>
      </aside>

      <div className={`player-bar ${isPlaying ? 'is-playing' : ''}`}>
        <audio
          ref={mediaAudioRef}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => {
            const audioDuration = event.currentTarget.duration
            if (!Number.isFinite(audioDuration)) return
            const durationLabel = `${Math.floor(audioDuration / 60)}:${String(Math.floor(audioDuration % 60)).padStart(2, '0')}`
            setDuration(audioDuration)
            setCurrentTrack((track) => ['local', 'creator'].includes(track.source) ? { ...track, duration: durationLabel } : track)
            setLocalTracks((current) => current.map((track) => (
              track.id === currentTrack.id ? { ...track, duration: durationLabel } : track
            )))
          }}
          onEnded={() => skipTrack(1)}
          onError={() => {
            if (currentTrack.source === 'local' || currentTrack.source === 'creator') {
              setIsPlaying(false)
              setToast('This audio could not be played. Check the file format and Firebase Storage permissions.')
            }
          }}
        />
        <div className="player-track"><button className="player-cover" onClick={() => setNowPlayingOpen(true)} aria-label="Open now playing"><img src={currentTrack.image} alt="" /></button><button className="player-track-copy" onClick={() => setNowPlayingOpen(true)} aria-label={`Open now playing: ${currentTrack.title}`}><strong>{currentTrack.title}</strong><span>{currentTrack.artist}</span><small>{currentTrack.source === 'local' ? 'LOCAL AUDIO · FULL TRACK' : currentTrack.source === 'creator' ? 'V-MAX CREATOR · FULL TRACK' : currentTrack.source === 'spotify' ? 'SPOTIFY · STREAMING' : 'IN-BROWSER DEMO AUDIO'}</small></button><button className={`icon-button player-like ${isLiked(currentTrack) ? 'is-liked' : ''}`} aria-label={isLiked(currentTrack) ? 'Remove from liked songs' : 'Like current track'} onClick={() => toggleLike(currentTrack)}><Icon name="heart" size={17} fill={isLiked(currentTrack) ? 'currentColor' : 'none'} /></button></div>
        <div className="player-controls"><div className="control-buttons"><button className="icon-button control-secondary" aria-label="Shuffle"><Icon name="shuffle" size={17} /></button><button className="icon-button control-secondary" aria-label="Previous track" onClick={() => skipTrack(-1)}><Icon name="previous" size={17} /></button><button className="player-toggle" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={togglePlayback}><Icon name={isPlaying ? 'pause' : 'play'} size={17} fill="currentColor" /></button><button className="icon-button control-secondary" aria-label="Next track" onClick={() => skipTrack(1)}><Icon name="next" size={17} /></button><button className="icon-button control-secondary" aria-label="Repeat"><Icon name="repeat" size={17} /></button></div><div className="progress-row"><span>{formatTime(currentTime)}</span><input type="range" min="0" max={duration || 100} value={duration ? currentTime : 0} onChange={(event) => seekTo(Number(event.target.value))} aria-label="Track progress" style={{ '--progress': duration ? `${currentTime / duration * 100}%` : '0%' }} /><span>{duration ? formatTime(duration) : currentTrack.duration}</span></div></div>
        <div className="player-extras"><button className="icon-button queue-toggle" aria-label="Show queue" onClick={() => setToast(`${queue.length} songs in your queue`)}><Icon name="list" size={18} /></button><button className="icon-button player-volume" aria-label="Volume"><Icon name="volume" size={18} /></button><input type="range" min="0" max="100" value={volume} onChange={(event) => changeVolume(event.target.value)} aria-label="Volume" style={{ '--progress': `${volume}%` }} /><button className="icon-button player-room" aria-label="Start listening room" onClick={shareRoom}><Icon name="users" size={17} /></button></div>
      </div>

      {nowPlayingOpen && <div className="now-playing-backdrop" role="presentation" onClick={() => setNowPlayingOpen(false)}><section className="now-playing-view" role="dialog" aria-modal="true" aria-labelledby="now-playing-title" onClick={(event) => event.stopPropagation()}>
        <button className="now-playing-close icon-button" aria-label="Close now playing" onClick={() => setNowPlayingOpen(false)}><Icon name="close" size={21} /></button>
        <div className="now-playing-topline"><span className="brand-mark tiny" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span><span>NOW PLAYING</span><button className="icon-button" aria-label="View listening queue" onClick={() => setToast(`${queue.length} songs in your queue`)}><Icon name="list" size={19} /></button></div>
        <div className="now-playing-layout">
          <div className="now-playing-artwork"><img src={currentTrack.image} alt={`${currentTrack.album} artwork`} /></div>
          <div className="now-playing-details">
            <p className="eyebrow">{currentTrack.source === 'local' ? 'YOUR LOCAL LIBRARY' : currentTrack.source === 'creator' ? 'V-MAX CREATOR RELEASE' : currentTrack.source === 'spotify' ? 'PLAYING FROM SPOTIFY' : 'V-MAX DEMO TRACK'}</p>
            <h2 id="now-playing-title">{currentTrack.title}</h2>
            <p className="now-playing-artist">{currentTrack.artist}<span> · </span>{currentTrack.album}</p>
            <div className="now-playing-progress">
              <input type="range" min="0" max={duration || 100} value={duration ? currentTime : 0} onChange={(event) => seekTo(Number(event.target.value))} aria-label="Track progress" style={{ '--progress': duration ? `${currentTime / duration * 100}%` : '0%' }} />
              <div><span>{formatTime(currentTime)}</span><span>{duration ? formatTime(duration) : currentTrack.duration}</span></div>
            </div>
            <div className="now-playing-controls">
              <button className={`icon-button now-playing-like ${isLiked(currentTrack) ? 'is-liked' : ''}`} aria-label={isLiked(currentTrack) ? 'Remove from liked songs' : 'Like current track'} onClick={() => toggleLike(currentTrack)}><Icon name="heart" size={22} fill={isLiked(currentTrack) ? 'currentColor' : 'none'} /></button>
              <button className="icon-button" aria-label="Previous track" onClick={() => skipTrack(-1)}><Icon name="previous" size={24} /></button>
              <button className="now-playing-toggle" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={togglePlayback}><Icon name={isPlaying ? 'pause' : 'play'} size={22} fill="currentColor" /></button>
              <button className="icon-button" aria-label="Next track" onClick={() => skipTrack(1)}><Icon name="next" size={24} /></button>
              <button className="icon-button" aria-label="Add current track to queue" onClick={() => addToQueue(currentTrack)}><Icon name="plus" size={21} /></button>
            </div>
            <p className="now-playing-notice">{currentTrack.source === 'local' ? 'Full audio from a file saved on this device.' : currentTrack.source === 'creator' ? 'Rights-cleared audio published by a V-MAX creator.' : currentTrack.source === 'spotify' ? 'Playback is streamed by Spotify and is not available for download in V-MAX.' : 'Demo tones only—not the original commercial recording.'}</p>
          </div>
        </div>
        {queue.length > 0 && <div className="now-playing-queue"><div className="section-heading"><div><p className="eyebrow">UP NEXT</p><h2>Your queue</h2></div></div><div className="now-playing-queue-list">{queue.slice(0, 5).map((track, index) => <button key={`${track.id}-${index}`} onClick={() => playTrack(track)}><img src={track.image} alt="" /><span><strong>{track.title}</strong><small>{track.artist}</small></span><Icon name="play" size={15} /></button>)}</div></div>}
      </section></div>}
      {storyTrack && <div className="modal-backdrop" role="presentation" onClick={() => setStoryTrack(null)}><section className="story-modal" role="dialog" aria-modal="true" aria-labelledby="story-title" onClick={(event) => event.stopPropagation()}><button className="modal-close icon-button" aria-label="Close story" onClick={() => setStoryTrack(null)}><Icon name="close" size={19} /></button><div className="modal-cover"><img src={storyTrack.image} alt="" /><span>THE STORY BEHIND THE SOUND</span></div><div className="modal-content"><p className="eyebrow">A CLOSER LISTEN <span>·</span> {storyTrack.duration}</p><h2 id="story-title">{storyTrack.title}</h2><p className="modal-artist">{storyTrack.artist} <span>·</span> {storyTrack.album}</p><p className="modal-note">{storyTrack.note}</p><div className="modal-lyrics"><span>✦ A FEW LINES</span><p>{storyTrack.lyrics.split('\n').map((line) => <span key={line}>{line}</span>)}</p></div><div className="modal-credits"><span>TRACK CREDITS</span><p>Written by {storyTrack.artist} <i>·</i> Produced by {storyTrack.artist} <i>·</i> Released on {storyTrack.album}</p></div><button className="primary-pill modal-play" onClick={() => { playTrack(storyTrack); setStoryTrack(null) }}><Icon name="play" size={15} fill="currentColor" /> Play this track</button></div></section></div>}
      {preferencesOpen && <div className="modal-backdrop preferences-backdrop" role="presentation" onClick={() => listeningPreferences && setPreferencesOpen(false)}>
        <section className="preferences-dialog" role="dialog" aria-modal="true" aria-labelledby="preferences-title" onClick={(event) => event.stopPropagation()}>
          {listeningPreferences && <button className="modal-close icon-button" aria-label="Close music preferences" onClick={() => setPreferencesOpen(false)}><Icon name="close" size={18} /></button>}
          <p className="eyebrow">A SOUND THAT FEELS LIKE YOU</p>
          <h2 id="preferences-title">What do you love listening to?</h2>
          <p className="preferences-intro">Pick a few genres and moods. We’ll use them to shape your V-MAX discoveries. You can change these any time.</p>
          <div className="preferences-group">
            <h3>Genres <span>Choose any</span></h3>
            <div className="preferences-options">
              {MUSIC_GENRES.map((genre) => <button key={genre} type="button" className={`preference-chip ${preferenceDraft.genres.includes(genre) ? 'selected' : ''}`} aria-pressed={preferenceDraft.genres.includes(genre)} onClick={() => toggleListeningPreference('genres', genre)}>
                <span>{preferenceDraft.genres.includes(genre) ? <Icon name="check" size={14} /> : '+'}</span>{genre}
              </button>)}
            </div>
          </div>
          <div className="preferences-group">
            <h3>Listening moods <span>Choose any</span></h3>
            <div className="preferences-options mood-preferences">
              {LISTENING_MOODS.map((item) => <button key={item} type="button" className={`preference-chip ${preferenceDraft.moods.includes(item) ? 'selected' : ''}`} aria-pressed={preferenceDraft.moods.includes(item)} onClick={() => toggleListeningPreference('moods', item)}>
                <span>{preferenceDraft.moods.includes(item) ? <Icon name="check" size={14} /> : '+'}</span>{item}
              </button>)}
            </div>
          </div>
          <div className="preferences-footer">
            {!listeningPreferences && <button className="preferences-skip" onClick={skipPreferences}>Skip for now</button>}
            <button className="primary-pill" onClick={finishPreferences}>Show me my music <Icon name="arrow" size={15} /></button>
          </div>
          <p className="preferences-footnote">Your picks are saved in this browser and help personalize V-MAX’s curated recommendations. They do not unlock or download Spotify catalog tracks.</p>
        </section>
      </div>}
      {authDialogOpen && <AuthDialog user={firebaseUser} onClose={() => setAuthDialogOpen(false)} />}
      {toast && <div className="toast-message"><span className="toast-check"><Icon name="check" size={14} /></span>{toast}</div>}
    </div>
  )
}

export default App
