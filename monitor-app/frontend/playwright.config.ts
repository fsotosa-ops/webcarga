import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './scripts',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    video: 'on',
    viewport: { width: 1280, height: 800 },
  },
  reporter: [['html', { open: 'never' }]],
})
