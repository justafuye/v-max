import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addCreatorComment,
  createCreatorPlaylist,
  loadCreatorComments,
  loadCreatorPlatform,
  loadSharedCreatorPlaylist,
  publishCreatorTrack,
  saveCreatorProfile,
  toggleCreatorFollow,
  toggleCreatorLike,
} from './creatorPlatform.js'

const genres = ['Afrobeats', 'Hip-Hop', 'Pop', 'R&B / Soul', 'Rock / Indie', 'Electronic', 'Jazz', 'Gospel', 'Reggae', 'Classical', 'Country']
const emptyPlatform = { profiles: [], tracks: [], ownTracks: [], playlists: [], ownPlaylists: [], following: [], likedTracks: [], plays: [] }

function trackDate(track) {
  return track.createdAt?.toDate?.().toLocaleDateString() ?? 'New release'
}

function CreatorTrackCard({ track, user, profile, likedTrackIds, onPlay, onOfflineSave, onToast }) {
  const [liked, setLiked] = useState(likedTrackIds.includes(track.id))
  const [comments, setComments] = useState([])
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [busy, setBusy] = useState(false)

  const toggleLike = async () => {
    if (!user) {
      onToast('Sign in to like creator tracks.')
      return
    }
    try {
      const nextLiked = await toggleCreatorLike(user, track.id)
      setLiked(nextLiked)
    } catch (error) {
      onToast(`Could not update your like: ${error.message}`)
    }
  }

  const toggleComments = async () => {
    if (commentsOpen) {
      setCommentsOpen(false)
      return
    }
    try {
      setBusy(true)
      setComments(await loadCreatorComments(track.id))
      setCommentsOpen(true)
    } catch (error) {
      onToast(`Could not load comments: ${error.message}`)
    } finally {
      setBusy(false)
    }
  }

  const submitComment = async (event) => {
    event.preventDefault()
    if (!user) {
      onToast('Sign in to join the conversation.')
      return
    }
    if (!commentText.trim()) return
    try {
      setBusy(true)
      await addCreatorComment(user, track.id, profile, commentText)
      setCommentText('')
      setComments(await loadCreatorComments(track.id))
    } catch (error) {
      onToast(`Could not post your comment: ${error.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="creator-track-card">
      <img className="creator-track-art" src={track.image || ''} alt="" />
      <div className="creator-track-details">
        <span className="creator-track-meta">{track.genre || 'Independent'} · {trackDate(track)}</span>
        <h3>{track.title}</h3>
        <p>{track.artist}{track.album ? ` · ${track.album}` : ''}</p>
        {track.description && <p className="creator-track-description">{track.description}</p>}
        <div className="creator-track-actions">
          <button className="primary-pill" onClick={() => onPlay({ ...track, source: 'creator' })}>Play</button>
          <button className={`secondary-pill ${liked ? 'creator-liked' : ''}`} onClick={toggleLike}>{liked ? 'Liked' : 'Like'}</button>
          {track.allowOffline && <button className="secondary-pill" onClick={() => onOfflineSave(track)}>Save offline</button>}
          <button className="secondary-pill" onClick={toggleComments} disabled={busy}>{commentsOpen ? 'Hide comments' : 'Comments'}</button>
        </div>
        {commentsOpen && (
          <div className="creator-comments">
            {comments.map((comment) => (
              <p key={comment.id}><strong>{comment.displayName}</strong> {comment.text}</p>
            ))}
            {!comments.length && <p className="creator-muted">No comments yet. Start the conversation.</p>}
            <form onSubmit={submitComment}>
              <input value={commentText} onChange={(event) => setCommentText(event.target.value)} maxLength={500} placeholder="Write a kind comment..." aria-label={`Comment on ${track.title}`} />
              <button className="secondary-pill" type="submit" disabled={busy || !commentText.trim()}>Post</button>
            </form>
          </div>
        )}
      </div>
    </article>
  )
}

export default function CreatorHub({ user, onPlay, onOfflineSave, onToast, onNavigate, onSignIn }) {
  const [platform, setPlatform] = useState(emptyPlatform)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const sharedPlaylistId = new URLSearchParams(window.location.hash.slice(1)).get('playlist')
  const [sharedPlaylist, setSharedPlaylist] = useState(null)
  const [activeTab, setActiveTab] = useState(sharedPlaylistId ? 'playlists' : 'feed')
  const [selectedGenre, setSelectedGenre] = useState('All')
  const [profileDraft, setProfileDraft] = useState({ displayName: '', bio: '', genres: [] })
  const [profileBusy, setProfileBusy] = useState(false)
  const [uploadDraft, setUploadDraft] = useState({ title: '', album: '', description: '', genre: '', image: '', allowOffline: false })
  const [audioFile, setAudioFile] = useState(null)
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(null)
  const [playlistDraft, setPlaylistDraft] = useState({ title: '', description: '' })
  const [selectedTrackIds, setSelectedTrackIds] = useState([])
  const [playlistBusy, setPlaylistBusy] = useState(false)
  const [followingBusy, setFollowingBusy] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setPageError('')
    try {
      const nextPlatform = await loadCreatorPlatform(user)
      setPlatform(nextPlatform)
      const ownProfile = nextPlatform.profiles.find((item) => item.ownerId === user?.uid)
      setProfileDraft({
        displayName: ownProfile?.displayName ?? user?.displayName ?? user?.email?.split('@')[0] ?? '',
        bio: ownProfile?.bio ?? '',
        genres: ownProfile?.genres ?? [],
      })
    } catch (error) {
      setPageError(error.message)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    const timer = window.setTimeout(() => { void reload() }, 0)
    return () => window.clearTimeout(timer)
  }, [reload])

  useEffect(() => {
    let active = true
    if (!sharedPlaylistId) return undefined
    loadSharedCreatorPlaylist(sharedPlaylistId)
      .then((playlist) => { if (active) setSharedPlaylist(playlist) })
      .catch((error) => { if (active) setPageError(error.message) })
    return () => { active = false }
  }, [sharedPlaylistId])

  const ownProfile = platform.profiles.find((profile) => profile.ownerId === user?.uid)
  const publicTracks = useMemo(() => platform.tracks
    .filter((track) => selectedGenre === 'All' || track.genre === selectedGenre)
    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)), [platform.tracks, selectedGenre])
  const feedTracks = useMemo(() => {
    if (!user || !platform.following.length) return publicTracks
    const followedIds = new Set(platform.following)
    return publicTracks.filter((track) => followedIds.has(track.ownerId))
  }, [user, platform.following, publicTracks])
  const playCounts = useMemo(() => platform.plays.reduce((counts, play) => {
    counts[play.trackId] = (counts[play.trackId] ?? 0) + 1
    return counts
  }, {}), [platform.plays])

  const saveProfile = async (event) => {
    event.preventDefault()
    if (!user) {
      onToast('Sign in to create your creator profile.')
      return
    }
    if (!profileDraft.displayName.trim()) {
      onToast('Add a creator name before saving your profile.')
      return
    }
    try {
      setProfileBusy(true)
      await saveCreatorProfile(user, profileDraft)
      await reload()
      onToast('Creator profile saved.')
    } catch (error) {
      onToast(`Could not save your profile: ${error.message}`)
    } finally {
      setProfileBusy(false)
    }
  }

  const publishTrack = async (event) => {
    event.preventDefault()
    if (!user) {
      onToast('Sign in to publish tracks.')
      return
    }
    if (!ownProfile) {
      onToast('Save your creator profile before publishing.')
      setActiveTab('studio')
      return
    }
    if (!audioFile || !uploadDraft.title.trim() || !uploadDraft.genre || !rightsConfirmed) {
      onToast('Add a title, genre, audio file, and confirm you have the rights to publish it.')
      return
    }
    try {
      setUploadProgress(0)
      const track = await publishCreatorTrack(user, audioFile, uploadDraft, setUploadProgress)
      setPlatform((current) => ({ ...current, tracks: [track, ...current.tracks], ownTracks: [track, ...current.ownTracks] }))
      setAudioFile(null)
      setRightsConfirmed(false)
      setUploadDraft({ title: '', album: '', description: '', genre: '', image: '', allowOffline: false })
      event.currentTarget.reset()
      onToast('Your track is published on V-MAX.')
    } catch (error) {
      onToast(`Could not publish your track: ${error.message}`)
    } finally {
      setUploadProgress(null)
    }
  }

  const followCreator = async (creatorId) => {
    if (!user) {
      onToast('Sign in to follow creators.')
      return
    }
    try {
      setFollowingBusy(creatorId)
      const isFollowing = await toggleCreatorFollow(user, creatorId)
      setPlatform((current) => ({
        ...current,
        following: isFollowing
          ? [...current.following, creatorId]
          : current.following.filter((id) => id !== creatorId),
      }))
    } catch (error) {
      onToast(`Could not update your follows: ${error.message}`)
    } finally {
      setFollowingBusy('')
    }
  }

  const savePlaylist = async (event) => {
    event.preventDefault()
    if (!user) {
      onToast('Sign in to publish a playlist.')
      return
    }
    const selectedTracks = platform.tracks.filter((track) => selectedTrackIds.includes(track.id))
    if (!playlistDraft.title.trim() || !selectedTracks.length) {
      onToast('Give your playlist a name and choose at least one public track.')
      return
    }
    try {
      setPlaylistBusy(true)
      await createCreatorPlaylist(user, playlistDraft.title, playlistDraft.description, selectedTracks)
      setPlaylistDraft({ title: '', description: '' })
      setSelectedTrackIds([])
      await reload()
      onToast('Your public playlist is ready to share.')
    } catch (error) {
      onToast(`Could not publish your playlist: ${error.message}`)
    } finally {
      setPlaylistBusy(false)
    }
  }

  const sharePlaylist = async (playlist) => {
    const url = new URL(window.location.href)
    url.hash = `playlist=${encodeURIComponent(playlist.id)}`
    try {
      await navigator.clipboard.writeText(url.toString())
      onToast('Playlist link copied.')
    } catch (error) {
      onToast(`Could not copy the playlist link: ${error.message}`)
    }
  }

  const updateGenres = (genre) => {
    setProfileDraft((current) => ({
      ...current,
      genres: current.genres.includes(genre)
        ? current.genres.filter((item) => item !== genre)
        : current.genres.length < 5 ? [...current.genres, genre] : current.genres,
    }))
  }

  const tracksForPlaylist = platform.tracks.filter((track) => selectedTrackIds.includes(track.id))
  const tabs = [
    { id: 'feed', label: 'Community feed' },
    { id: 'discover', label: 'Discover' },
    { id: 'artists', label: 'Artist profiles' },
    { id: 'studio', label: 'Creator studio' },
    { id: 'playlists', label: 'Playlists' },
    { id: 'analytics', label: 'Analytics & earnings' },
  ]

  return (
    <div className="page-content alternate-page creator-hub">
      <div className="page-title-row">
        <div>
          <p className="eyebrow">INDEPENDENT MUSIC, YOUR WAY</p>
          <h1>Creator <span>Studio.</span></h1>
          <p className="welcome-subtitle">Share rights-cleared music, meet artists, and build playlists together.</p>
        </div>
        <span className="creator-studio-mark" aria-hidden="true">♫</span>
      </div>

      <div className="creator-hub-notice"><strong>Creator features</strong><span>Public uploads are hosted in your Firebase Storage bucket. Only publish music and artwork you have permission to share.</span></div>
      {!user && <div className="creator-sign-in-prompt"><span>Sign in to publish tracks, follow artists, comment, and create playlists.</span><button className="secondary-pill" onClick={onSignIn}>Sign in / create account</button></div>}
      {pageError && <p className="search-hint search-error" role="alert">{pageError}</p>}
      {loading && <p className="search-hint"><span className="search-spinner" /> Loading creator community...</p>}
      {!loading && !pageError && !platform.tracks.length && <p className="creator-muted creator-empty-hint">No creator uploads yet. Be the first to publish a rights-cleared track.</p>}

      <nav className="creator-tabs" aria-label="Creator platform sections">
        {tabs.map((tab) => <button key={tab.id} className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}
      </nav>

      {sharedPlaylist && activeTab === 'playlists' && (
        <section className="creator-shared-playlist">
          <div className="section-heading"><div><p className="eyebrow">SHARED PLAYLIST</p><h2>{sharedPlaylist.title}</h2></div><button className="secondary-pill" onClick={() => setSharedPlaylist(null)}>Close</button></div>
          {sharedPlaylist.description && <p className="creator-muted">{sharedPlaylist.description}</p>}
          <div className="creator-track-list">{sharedPlaylist.tracks.map((track) => <CreatorTrackCard key={track.id} track={track} user={user} profile={ownProfile} likedTrackIds={platform.likedTracks} onPlay={onPlay} onOfflineSave={onOfflineSave} onToast={onToast} />)}</div>
        </section>
      )}

      {activeTab === 'feed' && (
        <section className="creator-section">
          <div className="section-heading"><div><p className="eyebrow">FROM YOUR COMMUNITY</p><h2>{platform.following.length ? 'Latest from creators you follow' : 'Fresh from independent creators'}</h2></div><button className="secondary-pill" onClick={() => void reload()} disabled={loading}>Refresh</button></div>
          {feedTracks.length
            ? <div className="creator-track-list">{feedTracks.map((track) => <CreatorTrackCard key={track.id} track={track} user={user} profile={ownProfile} likedTrackIds={platform.likedTracks} onPlay={onPlay} onOfflineSave={onOfflineSave} onToast={onToast} />)}</div>
            : <div className="empty-state">No posts from followed creators yet. Discover artists to fill your feed.</div>}
        </section>
      )}

      {activeTab === 'discover' && (
        <section className="creator-section">
          <div className="section-heading"><div><p className="eyebrow">NEW AND INDEPENDENT</p><h2>Discover creator releases</h2></div>
            <label className="creator-genre-filter">Genre
              <select value={selectedGenre} onChange={(event) => setSelectedGenre(event.target.value)}>
                <option>All</option>{genres.map((genre) => <option key={genre}>{genre}</option>)}
              </select>
            </label>
          </div>
          <div className="creator-track-list">{publicTracks.map((track) => <CreatorTrackCard key={track.id} track={track} user={user} profile={ownProfile} likedTrackIds={platform.likedTracks} onPlay={onPlay} onOfflineSave={onOfflineSave} onToast={onToast} />)}</div>
          {!publicTracks.length && <div className="empty-state">No published tracks in this genre yet.</div>}
        </section>
      )}

      {activeTab === 'artists' && (
        <section className="creator-section">
          <div className="section-heading"><div><p className="eyebrow">MEET THE PEOPLE BEHIND THE MUSIC</p><h2>Artist profiles</h2></div></div>
          {platform.profiles.length
            ? <div className="creator-profile-grid">{platform.profiles.map((profile) => {
              const profileTracks = platform.tracks.filter((track) => track.ownerId === profile.ownerId)
              const isFollowing = platform.following.includes(profile.ownerId)
              return (
                <article className="creator-profile-card" key={profile.ownerId}>
                  <span className="creator-avatar">{profile.displayName?.slice(0, 1).toUpperCase() ?? '♪'}</span>
                  <h3>{profile.displayName}</h3>
                  <p>{profile.bio || 'Independent creator on V-MAX.'}</p>
                  <small>{profile.genres?.join(' · ') || 'Independent'} · {profileTracks.length} releases</small>
                  {profile.ownerId !== user?.uid && <button className="secondary-pill" disabled={followingBusy === profile.ownerId} onClick={() => void followCreator(profile.ownerId)}>{isFollowing ? 'Unfollow' : 'Follow'}</button>}
                  {profileTracks.length > 0 && <div className="creator-profile-releases">{profileTracks.slice(0, 2).map((track) => <button key={track.id} onClick={() => onPlay({ ...track, source: 'creator' })}>{track.title} · Play</button>)}</div>}
                </article>
              )
            })}</div>
            : <div className="empty-state">Creator profiles will appear here when artists publish.</div>}
        </section>
      )}

      {activeTab === 'studio' && (
        <div className="creator-studio-columns">
          <section className="creator-section creator-form-card">
            <div className="section-heading"><div><p className="eyebrow">YOUR ARTIST PAGE</p><h2>{ownProfile ? 'Edit your profile' : 'Create your profile'}</h2></div></div>
            {!user
              ? <div className="creator-muted">Sign in to create a creator profile and publish music.</div>
              : <form className="creator-form" onSubmit={saveProfile}>
                <label htmlFor="creator-name">Artist or creator name</label>
                <input id="creator-name" value={profileDraft.displayName} maxLength={40} onChange={(event) => setProfileDraft({ ...profileDraft, displayName: event.target.value })} required />
                <label htmlFor="creator-bio">Bio</label>
                <textarea id="creator-bio" value={profileDraft.bio} maxLength={240} onChange={(event) => setProfileDraft({ ...profileDraft, bio: event.target.value })} rows={3} placeholder="Tell listeners a little about your sound." />
                <fieldset><legend>Genres (up to 5)</legend><div className="creator-genre-options">{genres.map((genre) => <label key={genre}><input type="checkbox" checked={profileDraft.genres.includes(genre)} disabled={!profileDraft.genres.includes(genre) && profileDraft.genres.length >= 5} onChange={() => updateGenres(genre)} />{genre}</label>)}</div></fieldset>
                <button className="primary-pill" disabled={profileBusy}>{profileBusy ? 'Saving…' : 'Save creator profile'}</button>
              </form>}
          </section>

          <section className="creator-section creator-form-card">
            <div className="section-heading"><div><p className="eyebrow">PUBLISH YOUR MUSIC</p><h2>Upload a track</h2></div></div>
            {!user
              ? <div className="creator-muted">Sign in to publish. Audio uploads are stored in your Firebase Storage project.</div>
              : <form className="creator-form" onSubmit={publishTrack}>
                <label htmlFor="upload-title">Track title</label>
                <input id="upload-title" value={uploadDraft.title} maxLength={100} onChange={(event) => setUploadDraft({ ...uploadDraft, title: event.target.value })} required />
                <label htmlFor="upload-album">Album or release (optional)</label>
                <input id="upload-album" value={uploadDraft.album} maxLength={100} onChange={(event) => setUploadDraft({ ...uploadDraft, album: event.target.value })} />
                <label htmlFor="upload-genre">Genre</label>
                <select id="upload-genre" value={uploadDraft.genre} onChange={(event) => setUploadDraft({ ...uploadDraft, genre: event.target.value })} required><option value="">Choose a genre</option>{genres.map((genre) => <option key={genre}>{genre}</option>)}</select>
                <label htmlFor="upload-description">Description (optional)</label>
                <textarea id="upload-description" value={uploadDraft.description} maxLength={500} onChange={(event) => setUploadDraft({ ...uploadDraft, description: event.target.value })} rows={2} />
                <label htmlFor="upload-artwork">Artwork image URL (optional)</label>
                <input id="upload-artwork" type="url" value={uploadDraft.image} onChange={(event) => setUploadDraft({ ...uploadDraft, image: event.target.value })} placeholder="https://..." />
                <label htmlFor="upload-audio">Audio file (max 50 MB)</label>
                <input id="upload-audio" type="file" accept="audio/*" onChange={(event) => setAudioFile(event.target.files?.[0] ?? null)} required />
                <label className="creator-rights-check"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} />I own or have permission to publish this recording and artwork.</label>
                <label className="creator-rights-check"><input type="checkbox" checked={uploadDraft.allowOffline} onChange={(event) => setUploadDraft({ ...uploadDraft, allowOffline: event.target.checked })} />Allow listeners to save this track for offline listening.</label>
                {uploadProgress !== null && <div className="creator-upload-progress" role="status">Uploading… {Math.round(uploadProgress * 100)}%</div>}
                <button className="primary-pill" disabled={uploadProgress !== null || !ownProfile}>{uploadProgress !== null ? 'Publishing…' : 'Publish track'}</button>
                {!ownProfile && <small className="creator-muted">Save your creator profile before publishing.</small>}
              </form>}
          </section>

          <section className="creator-section creator-full-width">
            <div className="section-heading"><div><p className="eyebrow">YOUR CATALOG</p><h2>Your published tracks</h2></div></div>
            {platform.ownTracks.length
              ? <div className="creator-track-list">{platform.ownTracks.map((track) => <div className="creator-owned-track" key={track.id}><span>{track.title} <small>{track.genre} · {playCounts[track.id] ?? 0} play starts</small></span><button className="secondary-pill" onClick={() => onPlay({ ...track, source: 'creator' })}>Play</button></div>)}
              </div>
              : <div className="creator-muted">Your published releases will show here.</div>}
          </section>
        </div>
      )}

      {activeTab === 'playlists' && (
        <div className="creator-studio-columns">
          <section className="creator-section creator-form-card">
            <div className="section-heading"><div><p className="eyebrow">SHARE A COLLECTION</p><h2>Create a public playlist</h2></div></div>
            {!user
              ? <div className="creator-muted">Sign in to create and share playlists.</div>
              : <form className="creator-form" onSubmit={savePlaylist}>
                <label htmlFor="playlist-title">Playlist name</label><input id="playlist-title" maxLength={80} value={playlistDraft.title} onChange={(event) => setPlaylistDraft({ ...playlistDraft, title: event.target.value })} required />
                <label htmlFor="playlist-description">Description</label><textarea id="playlist-description" maxLength={300} rows={2} value={playlistDraft.description} onChange={(event) => setPlaylistDraft({ ...playlistDraft, description: event.target.value })} />
                <fieldset><legend>Choose published tracks</legend><div className="creator-playlist-choices">{platform.tracks.map((track) => <label key={track.id}><input type="checkbox" checked={selectedTrackIds.includes(track.id)} onChange={(event) => setSelectedTrackIds((current) => event.target.checked ? [...current, track.id].slice(0, 30) : current.filter((id) => id !== track.id))} />{track.title} · {track.artist}</label>)}</div></fieldset>
                <small className="creator-muted">{tracksForPlaylist.length} of 30 tracks selected. Playlists are public.</small>
                <button className="primary-pill" disabled={playlistBusy}>{playlistBusy ? 'Publishing…' : 'Publish playlist'}</button>
              </form>}
          </section>
          <section className="creator-section creator-form-card">
            <div className="section-heading"><div><p className="eyebrow">FROM THE COMMUNITY</p><h2>Public playlists</h2></div></div>
            {platform.playlists.length
              ? <div className="creator-playlist-list">{platform.playlists.map((playlist) => <article key={playlist.id}><strong>{playlist.title}</strong><p>{playlist.description || `${playlist.trackNames?.length ?? 0} tracks`}</p><button className="secondary-pill" onClick={() => void sharePlaylist(playlist)}>Copy share link</button></article>)}</div>
              : <div className="creator-muted">Community playlists will appear here.</div>}
          </section>
        </div>
      )}

      {activeTab === 'analytics' && (
        <section className="creator-section">
          <div className="section-heading"><div><p className="eyebrow">YOUR AUDIENCE</p><h2>Creator analytics</h2></div></div>
          {!user
            ? <div className="creator-muted">Sign in to view your creator analytics.</div>
            : <>
              <div className="creator-metrics">
                <article><span>Published tracks</span><strong>{platform.ownTracks.length}</strong></article>
                <article><span>Play starts recorded</span><strong>{platform.plays.length}</strong></article>
                <article><span>Followers (not counted)</span><strong>—</strong></article>
                <article><span>Offline-enabled tracks</span><strong>{platform.ownTracks.filter((track) => track.allowOffline).length}</strong></article>
              </div>
              <p className="creator-muted">Play starts are client-reported and approximate. They are not verified streams, royalty statements, or payout calculations. Follower totals and creator payouts require a trusted server-side aggregation and payment provider.</p>
              <div className="creator-analytics-list">{platform.ownTracks.map((track) => <div key={track.id}><span>{track.title}<small>{track.genre}</small></span><strong>{playCounts[track.id] ?? 0} play starts</strong></div>)}</div>
              <div className="creator-payout-notice"><strong>Creator payouts are not connected.</strong><span>Before you promise earnings, configure a payment provider, server-side verification, payout terms, and applicable tax and licensing requirements.</span><button className="secondary-pill" onClick={onNavigate}>View support setup</button></div>
            </>}
        </section>
      )}
    </div>
  )
}
