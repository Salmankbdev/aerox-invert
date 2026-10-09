import { resolve } from 'path'
import { defineConfig } from 'electron-vite'

const r = (p: string) => resolve(__dirname, p)

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': r('src/shared')
      }
    },
    build: {
      // node-hid is a native addon - never bundle it.
      rollupOptions: { external: ['node-hid'] }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': r('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': r('src/renderer/src'),
        '@shared': r('src/shared')
      }
    }
  }
})
