import assert from "node:assert/strict";

export async function assertIconBounds(page, label) {
  const oversized = await page
    .locator('svg[aria-hidden="true"]')
    .evaluateAll((icons) =>
      icons.flatMap((icon) => {
        const box = icon.getBoundingClientRect();
        return box.width > 48 || box.height > 48
          ? [
              {
                context: icon.parentElement.textContent.trim().slice(0, 100),
                width: box.width,
                height: box.height,
              },
            ]
          : [];
      }),
    );
  assert.deepEqual(oversized, [], `Oversized interface icons: ${label}`);
}
