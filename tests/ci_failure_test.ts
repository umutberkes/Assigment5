// Umut Berke Şenyayla, 2000002240
// Bonus 18 evidence only. This branch is intentionally red and is never merged into main.
import { assertEquals } from "@std/assert";
Deno.test("intentional failure demonstrates the CI test gate", () => {
  assertEquals(1 + 1, 3);
});
