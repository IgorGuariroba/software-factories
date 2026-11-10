import { describe, expect, it } from "vitest";
import { cumprimentar } from "../index.js";

describe("example (módulo profundo)", () => {
  it("cumprimenta pelo entry point público", () => {
    expect(cumprimentar("  Ana ")).toBe("Olá, Ana!");
  });
});
