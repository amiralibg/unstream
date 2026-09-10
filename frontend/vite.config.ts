import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const SW_TEMPLATE = fileURLToPath(new URL('./sw.template.js', import.meta.url))

/** Emits sw.js with a version stamped from the built index.html.
 *
 *  Any app change alters index.html (hashed asset names), which alters the
 *  stamp, which makes sw.js byte-different — the browser then installs the
 *  new worker on its next update check and, thanks to skipWaiting +
 *  clients.claim in the worker, the new release takes over immediately. */
function pwaServiceWorker(): PluginOption {
  let outDir = ''
  return {
    name: 'unstream-pwa-sw',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const html = readFileSync(resolve(outDir, 'index.html'))
      const version = createHash('sha256').update(html).digest('hex').slice(0, 16)
      const sw = readFileSync(SW_TEMPLATE, 'utf8').replaceAll('__UNSTREAM_BUILD__', version)
      writeFileSync(resolve(outDir, 'sw.js'), sw)
    },
  }
}

/** Serves /config.js in dev and preview.
 *
 *  In production the frontend container generates this file from its
 *  environment (see frontend/docker-entrypoint.d/), which is what makes
 *  UNSTREAM_DEFAULT_LOCALE changeable without a rebuild. Serving the same
 *  shape here means `npm run dev` reads the same variable and there is no
 *  404 for a file that exists only once it's deployed. */
function runtimeConfig(): PluginOption {
  const serve = (middlewares: { use: (path: string, handler: Middleware) => void }) => {
    middlewares.use('/config.js', (_req, res) => {
      const config = { defaultLocale: process.env.UNSTREAM_DEFAULT_LOCALE ?? '' }
      res.setHeader('Content-Type', 'application/javascript')
      res.setHeader('Cache-Control', 'no-cache')
      res.end(`window.__UNSTREAM_CONFIG__ = ${JSON.stringify(config)}\n`)
    })
  }
  return {
    name: 'unstream-runtime-config',
    configureServer: (server) => serve(server.middlewares),
    configurePreviewServer: (server) => serve(server.middlewares),
  }
}

type Middleware = (
  req: unknown,
  res: { setHeader: (k: string, v: string) => void; end: (body: string) => void },
) => void

// Stamped into the bundle so the UI never carries a version literal of its
// own. The desktop shell reports its real version over `get_desktop_info`;
// this is what stands in until that call answers, and a release bump is the
// only thing that can change it.
const APP_VERSION = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
).version

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [react(), tailwindcss(), runtimeConfig(), pwaServiceWorker()],
  build: {
    rollupOptions: {
      output: {
        // React and the query client change on a dependency bump, the app
        // changes on every release. Splitting them means a release only
        // invalidates the app chunk — the service worker keeps the rest,
        // which is most of the bytes.
        manualChunks: (id: string) => {
          if (!id.includes('node_modules')) return
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react'
          if (id.includes('@tanstack')) return 'query'
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  // `npm run preview` serves the production build — the only way to test
  // the service worker locally — so it needs the same API proxy.
  preview: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
