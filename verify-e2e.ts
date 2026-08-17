/**
 * Post-restart end-to-end verification for DSH-Leisure-Games against the live
 * GUI (http://127.0.0.1:3080). Drives a real browser through the user flow:
 * sidebar button → three tabs → each game → settings → notifications wiring.
 *
 * Usage (from the deepseek-harness checkout):
 *   pnpm exec tsx "D:/AI应用和代码/应用/dsh-leisure-games/verify-e2e.ts" [url]
 */
// Playwright is resolved from the harness checkout's pnpm store (the script
// itself lives outside that workspace).
import { chromium } from 'C:/Users/nonam/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js'

async function main(): Promise<number> {
  const URL = process.argv[2] ?? 'http://127.0.0.1:3080'
  const results: string[] = []
  let failed = 0

  function ok(name: string, condition: boolean, detail = ''): void {
    if (condition) results.push(`✓ ${name}`)
    else {
      failed++
      results.push(`✗ ${name} ${detail}`)
    }
  }

  async function waitForText(page: import('playwright').Page, text: string, timeout = 15000): Promise<boolean> {
    try {
      await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout })
      return true
    } catch {
      return false
    }
  }

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (error) => { results.push(`  [pageerror] ${String(error)}`) })
  page.on('console', (message) => {
    if (message.type() === 'error') results.push(`  [console.error] ${message.text().slice(0, 200)}`)
  })

  try {
    await page.goto(URL, { waitUntil: 'load', timeout: 30000 })
    await page.waitForTimeout(2500)

    // 1. Sidebar button between 新会话 and 工作区.
    const button = page.getByRole('button', { name: 'DSH-Leisure-Games' })
    ok('sidebar button visible', await button.isVisible().catch(() => false))
    ok('新会话 exists', await waitForText(page, '新会话'))
    ok('工作区 exists', await waitForText(page, '工作区'))

    // 2. Open hub → four tabs + settings + exit.
    await button.click()
    ok('hub opens with four tabs', await waitForText(page, 'Tetris - 俄罗斯方块')
      && await waitForText(page, 'Nsnake - 贪吃蛇')
      && await waitForText(page, 'Leiting Wuziqi - 技能五子棋')
      && await waitForText(page, 'Minesweeper - 经典扫雷'))
    ok('settings + exit visible', await waitForText(page, '设置') && await waitForText(page, '退出游戏'))

    // 3. Snake: board renders, steers, pauses, exits (timer stops).
    await page.getByRole('button', { name: /Nsnake - 贪吃蛇/ }).click()
    ok('snake board canvas visible', await page.locator('canvas').first().isVisible().catch(() => false))
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(400)
    await page.keyboard.press('p')
    await page.waitForTimeout(200)
    ok('snake pause overlay', await waitForText(page, '暂停'))
    await page.getByRole('button', { name: /返回主页/ }).click()
    await page.waitForTimeout(200)
    ok('snake exit returns home', await waitForText(page, 'Tetris - 俄罗斯方块'))

    // 4. Gomoku: pick black, place a stone, AI replies.
    await page.getByRole('button', { name: /Leiting Wuziqi/ }).click()
    ok('gomoku color picker', await waitForText(page, '选择执子颜色'))
    await page.getByRole('button', { name: /执黑/ }).click()
    await page.waitForTimeout(200)
    ok('gomoku your turn', await waitForText(page, '轮到你落子'))
    ok('gomoku rule line', await waitForText(page, '规则：连续五子'))
    ok('gomoku ai persona', await waitForText(page, '你是一位高超的棋手'))
    await page.waitForTimeout(300)
    await page.mouse.click(400, 400) // a center-ish intersection
    await page.waitForTimeout(500)
    // Board geometry: the inner frame is square and the placed stone renders
    // as a square, centered on an intersection.
    const gomokuGeo = await page.evaluate(() => {
      const frame = document.querySelector('[class*="boardFrame"]') as HTMLElement | null
      const stone = document.querySelector('[class*="stone"]') as HTMLElement | null
      if (frame === null || stone === null) return { frame: false, square: false, stone: false }
      const rect = frame.getBoundingClientRect()
      const stoneRect = stone.getBoundingClientRect()
      const cell = stone.parentElement as HTMLElement | null
      const cellRect = cell === null ? null : cell.getBoundingClientRect()
      const centered = cellRect === null ? false
        : Math.abs((stoneRect.left + stoneRect.width / 2) - (cellRect.left + cellRect.width / 2)) < 2
          && Math.abs((stoneRect.top + stoneRect.height / 2) - (cellRect.top + cellRect.height / 2)) < 2
      return {
        frame: true,
        square: Math.abs(rect.width - rect.height) < 2,
        stone: stoneRect.width > 10 && Math.abs(stoneRect.width - stoneRect.height) < 2 && centered,
      }
    })
    ok('gomoku board square', gomokuGeo.frame && gomokuGeo.square)
    ok('gomoku stone on intersection', gomokuGeo.stone)
    await page.waitForTimeout(1200)
    ok('AI replied with a stone', await waitForText(page, '轮到你落子'))
    ok('skill panel visible', await waitForText(page, '点穴'))
    await page.getByRole('button', { name: /返回主页/ }).click()
    await page.waitForTimeout(200)

    // 5. Tetris: the game auto-starts; pieces spawn and keys steer.
    await page.getByRole('button', { name: /Tetris - 俄罗斯方块/ }).click()
    ok('tetris board canvas visible', await page.locator('canvas').first().isVisible().catch(() => false))
    ok('tetris running (score shown)', await waitForText(page, '得分'))
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('q')
    await page.waitForTimeout(200)
    ok('tetris exit returns home', await waitForText(page, 'Nsnake - 贪吃蛇'))

    // 5b. Minesweeper: 20×30 board, reveal + flag, exit.
    await page.getByRole('button', { name: /Minesweeper - 经典扫雷/ }).click()
    ok('minesweeper board visible', await waitForText(page, '扫雷进行中'))
    const mineGeo = await page.evaluate(() => {
      const boards = [...document.querySelectorAll<HTMLElement>('[class*="board"]')]
      const board = boards.find(el => el.style.getPropertyValue('--cols') !== '')
      if (board === undefined) return { cols: 0, rows: 0, cells: 0 }
      return {
        cols: Number(board.style.getPropertyValue('--cols').trim() ?? 0),
        rows: Number(board.style.getPropertyValue('--rows').trim() ?? 0),
        cells: board.querySelectorAll('button').length,
      }
    })
    ok('minesweeper default 20×30 shape', mineGeo.rows === 20 && mineGeo.cols === 30 && mineGeo.cells === 600)
    await page.locator('[class*="board"] button').first().click()
    await page.waitForTimeout(400)
    ok('minesweeper first reveal safe', !(await waitForText(page, '踩到地雷，游戏结束', 1500)))
    // Right-click an UNREVEALED (enabled) cell to plant a flag.
    const flagTarget = await page.evaluate(() => {
      const boards = [...document.querySelectorAll<HTMLElement>('[class*="board"]')]
      const board = boards.find(el => el.style.getPropertyValue('--cols') !== '')
      const buttons = [...(board?.querySelectorAll('button') ?? [])]
      return buttons.findIndex(button => !button.hasAttribute('data-revealed'))
    })
    if (flagTarget >= 0) {
      await page.locator('[class*="board"] button').nth(flagTarget).click({ button: 'right' })
      await page.waitForTimeout(300)
    }
    ok('minesweeper flag placed', (await page.locator('[data-flagged]').count()) > 0)
    await page.getByRole('button', { name: /返回主页/ }).click()
    await page.waitForTimeout(200)

    // 6. Settings: sections + exit.
    await page.getByRole('button', { name: '⚙ 设置' }).click()
    ok('settings panel', await waitForText(page, '游玩时长限制'))
    ok('snake settings section', await waitForText(page, '贪吃蛇设置'))
    ok('gomoku settings section', await waitForText(page, '技能五子棋设置'))
    ok('minesweeper settings section', await waitForText(page, '经典扫雷设置'))
    ok('minesweeper mine count setting', await waitForText(page, '雷的个数'))
    ok('appearance section', await waitForText(page, '菜单按钮颜色'))
    ok('game-entry text color setting', await waitForText(page, '游戏入口文字颜色'))
    ok('exit game in settings', await waitForText(page, '退出游戏'))
    // Customize the menu accent + game-entry text colors: the color inputs
    // must persist and the panel chrome must expose them as CSS variables.
    const colorInput = page.locator('input[type="color"]')
    if (await colorInput.count() >= 2) {
      await colorInput.nth(0).fill('#e2544a')
      await colorInput.nth(1).fill('#ffd54a')
      await page.waitForTimeout(400)
      const colorsApplied = await page.evaluate(() => {
        const styled = [...document.querySelectorAll<HTMLElement>('[style*="--leisure-accent"]')]
        const stored = JSON.parse(localStorage.getItem('dsh.leisure-games.v1') ?? '{}') as Record<string, unknown>
        const appearance = (stored.settings as { appearance?: { accent?: string; entryText?: string } })?.appearance
        return {
          accentVar: styled.some(el => el.style.getPropertyValue('--leisure-accent') === '#e2544a'),
          entryTextVar: styled.some(el => el.style.getPropertyValue('--leisure-entry-text') === '#ffd54a'),
          accentPersisted: appearance?.accent === '#e2544a',
          entryTextPersisted: appearance?.entryText === '#ffd54a',
        }
      })
      ok('accent color persisted', colorsApplied.accentPersisted)
      ok('accent color applied to chrome', colorsApplied.accentVar)
      ok('game-entry text color persisted', colorsApplied.entryTextPersisted)
      ok('game-entry text color applied to chrome', colorsApplied.entryTextVar)
    } else {
      ok('accent color persisted', false)
      ok('accent color applied to chrome', false)
      ok('game-entry text color persisted', false)
      ok('game-entry text color applied to chrome', false)
    }
    await page.getByRole('button', { name: /返回主页/ }).click()

    // 7. Exit the panel entirely → back to the chat UI.
    const exits = page.getByRole('button', { name: '退出游戏' })
    await exits.first().click()
    await page.waitForTimeout(200)
    ok('panel closed back to chat', !(await waitForText(page, 'Tetris - 俄罗斯方块', 2000)))
  } catch (error) {
    failed++
    results.push(`✗ fatal: ${String(error)}`)
  } finally {
    await browser.close()
  }

  for (const line of results) console.log(line)
  console.log(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`)
  return failed === 0 ? 0 : 1
}

void main().then((code) => { process.exit(code) })
