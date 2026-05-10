const { test, expect } =
  require("@playwright/test");

test(
  "CRM card loads correctly",
  async ({ page }) => {
    await page.goto(
      "http://localhost:3000"
    );

    const content =
      await page.textContent("body");

    expect(content).toContain(
      "Server is running"
    );
  }
);