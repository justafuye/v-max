import { useState } from 'react'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from '@firebase/auth'
import { firebaseAuth, firebaseConfigured } from './firebase.js'

const authErrorMessages = {
  'auth/email-already-in-use': 'An account already exists for this email. Try signing in instead.',
  'auth/invalid-credential': 'That email or password is incorrect.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/network-request-failed': 'Could not reach Firebase. Check your internet connection and try again.',
  'auth/too-many-requests': 'Too many attempts. Wait a little while, then try again.',
  'auth/weak-password': 'Choose a stronger password with at least 8 characters.',
}

export default function AuthDialog({ user, onClose }) {
  const [mode, setMode] = useState('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (!firebaseAuth) throw new Error('Firebase is not configured.')
      if (mode === 'sign-in') {
        await signInWithEmailAndPassword(firebaseAuth, email.trim(), password)
      } else {
        await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password)
      }
      onClose()
    } catch (requestError) {
      setError(authErrorMessages[requestError.code] ?? requestError.message ?? 'Authentication failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    setBusy(true)
    setError('')
    try {
      if (!firebaseAuth) throw new Error('Firebase is not configured.')
      await firebaseSignOut(firebaseAuth)
      onClose()
    } catch (requestError) {
      setError(requestError.message ?? 'Could not sign out. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop auth-backdrop" role="presentation" onClick={onClose}>
      <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close icon-button" aria-label="Close account panel" onClick={onClose}>×</button>
        <p className="eyebrow">V-MAX ACCOUNT</p>
        <h2 id="auth-dialog-title">{user ? 'Your account' : mode === 'sign-in' ? 'Welcome back' : 'Create your account'}</h2>
        {user ? (
          <div className="auth-signed-in">
            <p>Signed in as <strong>{user.email}</strong></p>
            <p className="auth-role-note">Admin access must be configured securely by the project owner.</p>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="primary-pill" disabled={busy} onClick={signOut}>{busy ? 'Signing out…' : 'Sign out'}</button>
          </div>
        ) : !firebaseConfigured ? (
          <div className="auth-setup">
            <p>Connect a Firebase web app to enable accounts. Add its web configuration to the root <code>.env.local</code> file, then restart V-MAX:</p>
            <pre>VITE_FIREBASE_API_KEY=your_api_key{'\n'}VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com{'\n'}VITE_FIREBASE_PROJECT_ID=your-project-id{'\n'}VITE_FIREBASE_APP_ID=your_app_id</pre>
            <p>Enable the Email/Password provider in Firebase Authentication. Firebase web configuration is intended for client apps; protect data with Firebase Security Rules.</p>
          </div>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            <label htmlFor="account-email">Email</label>
            <input id="account-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            <label htmlFor="account-password">Password</label>
            <input id="account-password" type="password" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="primary-pill" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}</button>
            <button className="auth-mode-toggle" type="button" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setError('') }}>
              {mode === 'sign-in' ? 'New to V-MAX? Create an account' : 'Already have an account? Sign in'}
            </button>
          </form>
        )}
      </section>
    </div>
  )
}
