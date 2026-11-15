// Signs the test customer in once; every journey reuses the session.
import { credentials, expect, test } from "e2e";

test.setup("the test customer signs in", { sessions: ["tester"] }, async ({ app, screen, session }) => {
  const tester = credentials.user("tester");
  await app.open("/beta/login");
  await screen.getByLabel("Email").fill(tester.username);
  await screen.getByLabel("Password").fill(tester.password);
  await screen.getByRole("button", "Sign in").tap();
  await expect(screen.getByRole("heading", "Accounts")).toBeVisible();
  await session.save("tester");
});
