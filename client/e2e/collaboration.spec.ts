import { test, expect, type APIRequestContext } from '@playwright/test';

const API_URL = process.env.E2E_API_URL || 'http://localhost:4000';

async function registerUser(request: APIRequestContext, name: string) {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `${name.toLowerCase()}-${uniqueSuffix}@e2e-test.com`;

  const res = await request.post(`${API_URL}/api/auth/register`, {
    data: { email, password: 'password123', name },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return { token: body.token as string, user: body.user };
}

test('two independent users see each other\'s edits and presence in real time', async ({
  browser,
  request,
}) => {
  // Two genuinely distinct accounts — not two tabs sharing one login, which
  // is the shortcut you'd reach for manually testing this in a single
  // browser (localStorage is shared per-origin across tabs). Each gets its
  // own isolated browser context below, so this is closer to "two different
  // people on two different computers" than manual testing usually is.
  const alice = await registerUser(request, 'Alice');
  const bob = await registerUser(request, 'Bob');

  const createRes = await request.post(`${API_URL}/api/documents`, {
    headers: { Authorization: `Bearer ${alice.token}` },
    data: { title: 'E2E Test Document' },
  });
  expect(createRes.ok()).toBeTruthy();
  const { document } = await createRes.json();

  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();

  // Seed each browser context's localStorage with its own JWT before any
  // page script runs, equivalent to "already logged in" — skips re-testing
  // the login form here, since Step 1/2 already cover that.
  await aliceContext.addInitScript((token) => {
    window.localStorage.setItem('token', token);
  }, alice.token);
  await bobContext.addInitScript((token) => {
    window.localStorage.setItem('token', token);
  }, bob.token);

  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await alicePage.goto(`/documents/${document.id}`);
  await bobPage.goto(`/documents/${document.id}`);

  await expect(alicePage.getByText('Synced')).toBeVisible();
  await expect(bobPage.getByText('Synced')).toBeVisible();

  // Online presence (Step 6): both should see two avatars once both have
  // joined, without either page needing to reload.
  await expect(alicePage.locator('.presence-avatar')).toHaveCount(2, { timeout: 10000 });
  await expect(bobPage.locator('.presence-avatar')).toHaveCount(2, { timeout: 10000 });

  // Alice types — Bob should see it appear live, with no reload on his side.
  await alicePage.locator('.monaco-editor').first().click();
  await alicePage.keyboard.type('Hello from Alice');

  await expect(bobPage.locator('.monaco-editor .view-lines')).toContainText(
    'Hello from Alice',
    { timeout: 10000 }
  );

  // And the reverse direction — Bob appends, Alice sees the merged result.
  await bobPage.locator('.monaco-editor').first().click();
  await bobPage.keyboard.press('End');
  await bobPage.keyboard.type(' and Bob');

  await expect(alicePage.locator('.monaco-editor .view-lines')).toContainText(
    'Hello from Alice and Bob',
    { timeout: 10000 }
  );

  await aliceContext.close();
  await bobContext.close();
});

test('a viewer cannot edit, but can see live edits from an editor', async ({
  browser,
  request,
}) => {
  const owner = await registerUser(request, 'Owner');
  const viewer = await registerUser(request, 'Viewer');

  const createRes = await request.post(`${API_URL}/api/documents`, {
    headers: { Authorization: `Bearer ${owner.token}` },
    data: { title: 'Viewer Permission Test' },
  });
  const { document } = await createRes.json();

  // Explicitly grant "viewer" (not editor) — this is the Step 7 permissions
  // path, distinct from the default link_access every document starts with.
  const inviteRes = await request.post(`${API_URL}/api/documents/${document.id}/collaborators`, {
    headers: { Authorization: `Bearer ${owner.token}` },
    data: { email: viewer.user.email, role: 'viewer' },
  });
  expect(inviteRes.ok()).toBeTruthy();

  const ownerContext = await browser.newContext();
  const viewerContext = await browser.newContext();

  await ownerContext.addInitScript((token) => {
    window.localStorage.setItem('token', token);
  }, owner.token);
  await viewerContext.addInitScript((token) => {
    window.localStorage.setItem('token', token);
  }, viewer.token);

  const ownerPage = await ownerContext.newPage();
  const viewerPage = await viewerContext.newPage();

  await ownerPage.goto(`/documents/${document.id}`);
  await viewerPage.goto(`/documents/${document.id}`);

  await expect(viewerPage.getByText('View only')).toBeVisible();

  // The real assertion: the owner types, and it shows up for the viewer —
  // but the viewer's own keystrokes never make it into the document.
  await ownerPage.locator('.monaco-editor').first().click();
  await ownerPage.keyboard.type('Owner wrote this.');
  await expect(viewerPage.locator('.monaco-editor .view-lines')).toContainText(
    'Owner wrote this.',
    { timeout: 10000 }
  );

  await viewerPage.locator('.monaco-editor').first().click();
  await viewerPage.keyboard.type('VIEWER_SHOULD_NOT_APPEAR');
  await viewerPage.waitForTimeout(1000); // give a real network round trip a chance to (not) happen

  await expect(ownerPage.locator('.monaco-editor .view-lines')).not.toContainText(
    'VIEWER_SHOULD_NOT_APPEAR'
  );
  await expect(viewerPage.locator('.monaco-editor .view-lines')).not.toContainText(
    'VIEWER_SHOULD_NOT_APPEAR'
  );

  await ownerContext.close();
  await viewerContext.close();
});
