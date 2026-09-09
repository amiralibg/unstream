import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { trackPageView, watchInstall } from './lib/analytics.ts'

const queryClient = new QueryClient()

// The stats dashboard is the app's only other page, and it belongs to the
// owner rather than to visitors — so it gets a path check instead of a
// router dependency, and `lazy` keeps its code in a chunk that nobody
// arriving for music ever downloads.
const isAdmin = window.location.pathname.startsWith('/admin')
const Admin = lazy(() => import('./admin/Admin.tsx'))

// The desktop-app download page. Same treatment: a path, not a router, and
// its own chunk — the release metadata it fetches is useless weight on the
// landing page, and the landing's search code is useless weight here.
const isDownload = !isAdmin && window.location.pathname.startsWith('/download')
const DownloadPage = lazy(() => import('./components/DownloadPage.tsx'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {isAdmin ? (
        <Suspense fallback={null}>
          <Admin />
        </Suspense>
      ) : isDownload ? (
        <Suspense fallback={null}>
          <DownloadPage />
        </Suspense>
      ) : (
        <App />
      )}
    </QueryClientProvider>
  </StrictMode>,
)

// Counting the owner checking their own numbers would be a way to lie to
// yourself, so the dashboard is left out.
if (!isAdmin) {
  trackPageView()
  watchInstall()
}

// PWA: register the service worker (production only — in dev it would get
// in the way of HMR) and listen for release updates.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // True when this page loaded under an existing worker — i.e. a worker
  // activating mid-session is a genuine new release, not the first install.
  const hadController = !!navigator.serviceWorker.controller

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'unstream:update' || !hadController) return
    // Hidden tabs can reload invisibly; visible ones ask the user first
    // (a reload would clear in-memory download tracking).
    if (document.visibilityState === 'hidden') {
      window.location.reload()
    } else {
      window.dispatchEvent(new CustomEvent('unstream:update'))
    }
  })

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
