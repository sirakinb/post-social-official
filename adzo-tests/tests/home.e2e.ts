import { test, expect } from 'e2e';

// A first check that the app answers at all. Ask Adzo to write real ones:
// "write a test: a creator schedules a post".
test('the home page loads', async ({ app, browser }) => {
  await app.open('/');
  await expect(browser).toHaveTitle(/\S/);
});
