/**
 * Repro: a browser carrying the OLD (pre-minesweeper) persisted hub state
 * opens the panel and enters Minesweeper. Before the migration fix this
 * crashes the overlay entry (panel vanishes → back to the main UI).
 */
import { chromium } from 'C:/Users/nonam/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js'

const OLD_STATE = {
  open: false,
  view: 'home',
  limitEnabled: true,
  limitMinutes: 30,
  playedMs: 5000,
  sessionStartedAt: null,
  limitReachedAt: null,
  settings: {
    snake: { rows: 20, cols: 10, speedMs: 160, foodCount: 5, obstacleCount: 5, initialLength: 3, bgm: null, bgImage: null },
    gomoku: { rows: 15, cols: 15, aiStrength: 'medium', bgm: null, bgImage: null },
    tetris: { cols: 20, rows: 10, speedMs: 800, lockDelayMs: 500, pieceSet: 'classic', showGrid: true, showGhost: true, bgm: null, bgImage: null },
    // NOTE: no minesweeper key — the old shape.
  },
  progress: { snake: null, gomoku: null, tetris: null },
}

async function main(): Promise<void> {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors: string[] = []
  page.on('pageerror', error => { errors.push(String(error).slice(0, 300)) })
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 300))
  })
  await page.addInitScript((state) => {
    localStorage.setItem('dsh.leisure-games.v1', JSON.stringify(state))
  }, OLD_STATE)
  await page.goto('http://127.0.0.1:3080', { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'DSH-Leisure-Games' }).click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: /Minesweeper - 经典扫雷/ }).click()
  await page.waitForTimeout(2000)
  const state = await page.evaluate(() => {
    const layer = document.querySelector('[data-shell-overlay]')
    return {
      panelAlive: (layer?.querySelectorAll('*').length ?? 0) > 1,
      minesweeperText: document.body.textContent?.includes('扫雷进行中') ?? false,
      stored: localStorage.getItem('dsh.leisure-games.v1'),
    }
  })
  console.log('panelAlive:', state.panelAlive)
  console.log('minesweeperText:', state.minesweeperText)
  const stored = state.stored === null ? null : JSON.parse(state.stored) as Record<string, unknown>
  console.log('stored.settings.minesweeper:', JSON.stringify(stored?.settings?.minesweeper ?? 'MISSING'))
  for (const line of errors.slice(0, 4)) console.log('  [error]', line)
  await browser.close()
}

void main()
