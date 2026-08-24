import { describe, expect, it } from "vitest";

import { parseRepositoryInput } from "./input.js";

describe("parseRepositoryInput", () => {
  it.each([
    "facebook/react",
    "https://github.com/facebook/react",
    "https://github.com/facebook/react.git",
    "  facebook/react  ",
  ])("normalizes %s", (input) => {
    expect(parseRepositoryInput(input)).toEqual({ owner: "facebook", repo: "react" });
  });

  it.each([
    "https://github.example/facebook/react",
    "http://github.com/facebook/react",
    "https://api.github.com/repos/facebook/react",
    "https://github.com/facebook/react/issues",
    "facebook",
    "facebook/react/extra",
    "facebook/react?tab=readme",
    "facebook//react",
  ])("rejects unsupported input %s", (input) => {
    expect(() => parseRepositoryInput(input)).toThrow();
  });
});
