import { test, expect } from '@playwright/test';

test('アプリ起動とUI要素の表示', async ({ page }) => {
  await page.goto('http://localhost:8080');
  await expect(page.locator('text=ダッシュボード')).toBeVisible();
  await expect(page.locator('text=監視ステータス')).toBeVisible();
  await expect(page.locator('text=設定を編集')).toBeVisible();
});
