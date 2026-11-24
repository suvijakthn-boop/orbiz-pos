import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    hasTouch: true,
    deviceScaleFactor: 1,
    trace: 'off',
  },
  projects: [
    { name: 'ipad-landscape', use: { viewport: { width: 1180, height: 820 } } },
    { name: 'ipad-portrait', use: { viewport: { width: 820, height: 1180 } } },
    { name: 'ipad-mini-portrait', use: { viewport: { width: 744, height: 1133 } } },
    { name: 'ipad-pro-landscape', use: { viewport: { width: 1376, height: 1032 } } },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
