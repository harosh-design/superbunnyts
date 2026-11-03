import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir: './tests/browser', timeout: 45000, fullyParallel: false, workers: 1,
 use: { baseURL: process.env.BUNNY_TEST_URL ?? 'http://127.0.0.1:5173', viewport: { width: 1440, height: 900 },
  launchOptions: { executablePath: process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined },
  screenshot: 'only-on-failure', trace: 'retain-on-failure' },
 webServer: process.env.BUNNY_TEST_URL ? undefined : { command: 'npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: true }
});
