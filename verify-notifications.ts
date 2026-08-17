/**
 * E2E: AI-agent notification path. Loads the built-in `?fixture` mode (which
 * ships a pending approval for session fx-alpha plus completed sessions),
 * opens the games hub, and checks the top-left approval card: project name,
 * detail, command, and the 运行/不运行 actions; answering resolves it.
 *
 * The fixture's beta-notice dialog cannot be dismissed (its persist RPC is
 * unavailable there), so the panel and its buttons are driven with
 * programmatic clicks, which the notice's mask cannot intercept.
 */
import { chromium } from 'C:/Users/nonam/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js'

async function main(): Promise<void> {
  const URL = process.argv[2] ?? 'http://127.0.0.1:3080'
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors: string[] = []
  page.on('pageerror', error => { errors.push(String(error).slice(0, 300)) })
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 300))
  })
  const results: string[] = []
  let failed = 0
  const ok = (name: string, condition: boolean): void => {
    if (condition) results.push(`✓ ${name}`)
    else { failed++; results.push(`✗ ${name}`) }
  }
  const clickByLabel = async (label: string): Promise<void> => {
    await page.evaluate((text) => {
      const buttons = [...document.querySelectorAll('button')]
      const target = buttons.find(b => (b.getAttribute('aria-label') ?? b.textContent ?? '').includes(text))
      if (target instanceof HTMLButtonElement) target.click()
    }, label)
  }
  await page.goto(`${URL}?fixture`, { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(4000)
  // The beta notice may cover the app; programmatic clicks ignore its mask.
  await clickByLabel('DSH-Leisure-Games')
  await page.waitForTimeout(1500)
  ok('approval card title visible', await page.getByText('AI 请求批准操作').first().isVisible().catch(() => false))
  ok('project name visible', await page.getByText('项目', { exact: false }).first().isVisible().catch(() => false))
  ok('detail section visible', await page.getByText('详细信息').first().isVisible().catch(() => false))
  ok('run action visible', await page.getByText('运行', { exact: true }).first().isVisible().catch(() => false))
  ok('deny action visible', await page.getByText('不运行', { exact: true }).first().isVisible().catch(() => false))
  // Answer the approval: the card must disappear once resolved.
  await clickByLabel('运行')
  await page.waitForTimeout(1500)
  ok('approval resolved (card gone)', !(await page.getByText('AI 请求批准操作').first().isVisible().catch(() => false)))
  for (const line of results) console.log(line)
  for (const line of errors) console.log('  [error]', line)
  console.log(failed === 0 ? 'NOTIFICATION CHECKS PASSED' : `${failed} FAILED`)
  await browser.close()
  process.exit(failed === 0 ? 0 : 1)
}

void main()
