import { getFirestore } from '@firebase/firestore'
import { getStorage } from '@firebase/storage'
import { firebaseApp } from './firebase.js'

const storageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim() ?? ''

export const firebaseDb = firebaseApp ? getFirestore(firebaseApp) : null
export const firebaseStorage = firebaseApp && storageBucket
  ? getStorage(firebaseApp, `gs://${storageBucket}`)
  : null
