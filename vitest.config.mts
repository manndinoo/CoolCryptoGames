import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      IP_HASH_PEPPER: 'test-pepper-value-at-least-32-characters-long',
      FINGERPRINT_PEPPER: 'test-fp-pepper-at-least-32-characters-long!!',
    },
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
})
