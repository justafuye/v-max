import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from '@firebase/firestore'
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from '@firebase/storage'
import { firebaseDb, firebaseStorage } from './firebaseCreator.js'

function requireFirestore() {
  if (!firebaseDb) throw new Error('Configure Firebase and enable Firestore before using Creator Studio.')
}

function requireStorage() {
  requireFirestore()
  if (!firebaseStorage) throw new Error('Add VITE_FIREBASE_STORAGE_BUCKET to .env.local and enable Firebase Storage.')
}

function docsToObjects(snapshot) {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
}

export async function loadCreatorPlatform(user) {
  requireFirestore()
  const [profilesSnapshot, tracksSnapshot, playlistsSnapshot, ownTracksSnapshot, ownPlaylistsSnapshot, followingSnapshot, likesSnapshot, playsSnapshot] = await Promise.all([
    getDocs(query(collection(firebaseDb, 'profiles'), limit(100))),
    getDocs(query(collection(firebaseDb, 'tracks'), where('status', '==', 'published'), limit(100))),
    getDocs(query(collection(firebaseDb, 'playlists'), where('visibility', '==', 'public'), limit(50))),
    user ? getDocs(query(collection(firebaseDb, 'tracks'), where('ownerId', '==', user.uid), limit(100))) : Promise.resolve({ docs: [] }),
    user ? getDocs(query(collection(firebaseDb, 'playlists'), where('ownerId', '==', user.uid), limit(50))) : Promise.resolve({ docs: [] }),
    user ? getDocs(collection(firebaseDb, 'users', user.uid, 'following')) : Promise.resolve({ docs: [] }),
    user ? getDocs(collection(firebaseDb, 'users', user.uid, 'likes')) : Promise.resolve({ docs: [] }),
    user ? getDocs(query(collection(firebaseDb, 'playEvents'), where('ownerId', '==', user.uid), limit(500))) : Promise.resolve({ docs: [] }),
  ])
  return {
    profiles: docsToObjects(profilesSnapshot),
    tracks: docsToObjects(tracksSnapshot),
    ownTracks: docsToObjects(ownTracksSnapshot),
    playlists: docsToObjects(playlistsSnapshot),
    ownPlaylists: docsToObjects(ownPlaylistsSnapshot),
    following: followingSnapshot.docs.map((item) => item.id),
    likedTracks: likesSnapshot.docs.map((item) => item.id),
    plays: docsToObjects(playsSnapshot),
  }
}

export async function saveCreatorProfile(user, profile) {
  requireFirestore()
  const profileRef = doc(firebaseDb, 'profiles', user.uid)
  await setDoc(profileRef, {
    ownerId: user.uid,
    displayName: profile.displayName.trim().slice(0, 40),
    bio: profile.bio.trim().slice(0, 240),
    genres: profile.genres.slice(0, 5),
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

export async function publishCreatorTrack(user, file, metadata, onProgress) {
  requireStorage()
  if (!file.type.startsWith('audio/') || file.size > 50 * 1024 * 1024) {
    throw new Error('Choose an audio file smaller than 50 MB.')
  }

  const profileSnapshot = await getDoc(doc(firebaseDb, 'profiles', user.uid))
  const profile = profileSnapshot.exists() ? profileSnapshot.data() : null
  if (!profile?.displayName) throw new Error('Save your creator profile before publishing a track.')

  const trackRef = doc(collection(firebaseDb, 'tracks'))
  const storagePath = `tracks/${user.uid}/${trackRef.id}/audio`
  const audioRef = ref(firebaseStorage, storagePath)
  const uploadTask = uploadBytesResumable(audioRef, file, { contentType: file.type })
  const downloadUrl = await new Promise((resolve, reject) => {
    uploadTask.on('state_changed',
      (snapshot) => onProgress?.(snapshot.bytesTransferred / snapshot.totalBytes),
      reject,
      async () => {
        try {
          resolve(await getDownloadURL(uploadTask.snapshot.ref))
        } catch (error) {
          reject(error)
        }
      },
    )
  })

  try {
    await setDoc(trackRef, {
      ownerId: user.uid,
      artist: profile.displayName,
      title: metadata.title.trim().slice(0, 100),
      album: metadata.album.trim().slice(0, 100),
      description: metadata.description.trim().slice(0, 500),
      genre: metadata.genre,
      image: metadata.image.trim(),
      duration: '—',
      audioUrl: downloadUrl,
      storagePath,
      status: 'published',
      allowOffline: metadata.allowOffline,
      rightsConfirmed: true,
      createdAt: serverTimestamp(),
      playCount: 0,
    })
  } catch (error) {
    try {
      await deleteObject(audioRef)
    } catch (cleanupError) {
      console.error('Could not remove the failed creator upload:', cleanupError)
    }
    throw error
  }
  return {
    id: trackRef.id,
    ...metadata,
    artist: profile.displayName,
    duration: '—',
    audioUrl: downloadUrl,
    source: 'creator',
    ownerId: user.uid,
    allowOffline: metadata.allowOffline,
  }
}

export async function toggleCreatorFollow(user, targetUid) {
  requireFirestore()
  if (!user || targetUid === user.uid) return
  const followRef = doc(firebaseDb, 'users', user.uid, 'following', targetUid)
  const existing = await getDoc(followRef)
  if (existing.exists()) {
    await deleteDoc(followRef)
    return false
  }
  await setDoc(followRef, { followedAt: serverTimestamp() })
  return true
}

export async function toggleCreatorLike(user, trackId) {
  requireFirestore()
  const likeRef = doc(firebaseDb, 'users', user.uid, 'likes', trackId)
  const existing = await getDoc(likeRef)
  if (existing.exists()) {
    await deleteDoc(likeRef)
    return false
  }
  await setDoc(likeRef, { trackId, createdAt: serverTimestamp() })
  return true
}

export async function addCreatorComment(user, trackId, profile, text) {
  requireFirestore()
  await addDoc(collection(firebaseDb, 'tracks', trackId, 'comments'), {
    userId: user.uid,
    displayName: profile?.displayName || user.email || 'V-MAX listener',
    text: text.trim().slice(0, 500),
    createdAt: serverTimestamp(),
  })
}

export async function loadCreatorComments(trackId) {
  requireFirestore()
  const snapshot = await getDocs(query(
    collection(firebaseDb, 'tracks', trackId, 'comments'),
    orderBy('createdAt', 'desc'),
    limit(50),
  ))
  return docsToObjects(snapshot).sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
}

export async function createCreatorPlaylist(user, title, description, tracks) {
  requireFirestore()
  if (!tracks.length) throw new Error('Publish at least one track before creating a playlist.')
  const playlist = {
    ownerId: user.uid,
    title: title.trim().slice(0, 80),
    description: description.trim().slice(0, 300),
    trackIds: tracks.slice(0, 30).map((track) => track.id),
    trackNames: tracks.slice(0, 30).map(({ id, title: trackTitle, artist, image }) => ({ id, title: trackTitle, artist, image })),
    visibility: 'public',
    createdAt: serverTimestamp(),
  }
  const created = await addDoc(collection(firebaseDb, 'playlists'), playlist)
  return { id: created.id, ...playlist }
}

export async function recordCreatorPlay(user, track) {
  requireFirestore()
  if (!user || track.source !== 'creator') return
  await addDoc(collection(firebaseDb, 'playEvents'), {
    ownerId: track.ownerId,
    trackId: track.id,
    listenerId: user.uid,
    createdAt: serverTimestamp(),
  })
}

export async function loadSharedCreatorPlaylist(playlistId) {
  requireFirestore()
  const playlistSnapshot = await getDoc(doc(firebaseDb, 'playlists', playlistId))
  if (!playlistSnapshot.exists() || playlistSnapshot.data().visibility !== 'public') {
    throw new Error('This public playlist could not be found.')
  }
  const playlist = { id: playlistSnapshot.id, ...playlistSnapshot.data() }
  const trackSnapshots = await Promise.all((playlist.trackIds ?? []).slice(0, 30).map((id) => getDoc(doc(firebaseDb, 'tracks', id))))
  return {
    ...playlist,
    tracks: trackSnapshots
      .filter((snapshot) => snapshot.exists() && snapshot.data().status === 'published')
      .map((snapshot) => ({ id: snapshot.id, ...snapshot.data(), source: 'creator' })),
  }
}
