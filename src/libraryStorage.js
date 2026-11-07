const DATABASE_NAME = 'vmax-personal-library'
const DATABASE_VERSION = 1
const AUDIO_STORE = 'audio-files'

function openLibraryDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(AUDIO_STORE)) {
        request.result.createObjectStore(AUDIO_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the personal music library.'))
  })
}

function runAudioStoreRequest(mode, operation) {
  return openLibraryDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(AUDIO_STORE, mode)
    const request = operation(transaction.objectStore(AUDIO_STORE))
    let result
    request.onsuccess = () => { result = request.result }
    request.onerror = () => {
      database.close()
      reject(request.error ?? new Error('Could not update the personal music library.'))
    }
    transaction.oncomplete = () => {
      database.close()
      resolve(result)
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error('Could not update the personal music library.'))
    }
    transaction.onabort = () => {
      database.close()
      reject(transaction.error ?? new Error('The personal music library update was cancelled.'))
    }
  }))
}

export function getSavedAudioFiles() {
  return runAudioStoreRequest('readonly', (store) => store.getAll())
}

export function saveAudioFile(track) {
  return runAudioStoreRequest('readwrite', (store) => store.put(track))
}

export function deleteAudioFile(id) {
  return runAudioStoreRequest('readwrite', (store) => store.delete(id))
}
