import { describe, expect, it } from "vitest";

import { en } from "./messages/en.js";
import { caveatMessage } from "./index.js";
import { zh } from "./messages/zh.js";

describe("report messages", () => {
  it("has the same message keys in both locales", () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  it("keeps the playful name while explaining the action before optional AI", () => {
    expect(zh["home.title"]).toBe("给 GitHub 项目测测含水量");
    expect(zh["home.body"]).toContain("贴一个公开仓库地址");
    expect(en["home.title"]).toBe("A reality check for GitHub repos.");
    expect(en["home.body"]).toContain("Paste a public repository URL");
    expect(zh["home.submit"]).toBe("开始分析");
    expect(en["home.submit"]).toBe("Analyze repository");
    expect(zh["home.body"] + en["home.body"]).not.toContain("Copilot");
  });

  it("stores the approved risk labels", () => {
    expect([
      en["level.solid"],
      en["level.glossy"],
      en["level.showing"],
      en["level.heavy"],
      en["level.flood"],
    ]).toEqual(["Solid Ground", "A Little Glossy", "Hype Is Showing", "Heavy on Hype", "Flood Warning"]);
    expect([
      zh["level.solid"],
      zh["level.glossy"],
      zh["level.showing"],
      zh["level.heavy"],
      zh["level.flood"],
    ]).toEqual(["水位平稳", "有点包装，很正常", "水汽上来了", "海绵体质", "洪水预警"]);
    expect(Object.values(zh).join("\n")).not.toMatch(/维护真实性|实打实/);
  });

  it("localizes allowlisted caveats and hides unknown internal keys", () => {
    expect(caveatMessage("en", "bounded_activity_sample")).toBe("The community finding uses only a bounded sample of public interactions.");
    expect(caveatMessage("zh", "bounded_activity_sample")).toBe("社区判断只使用有限窗口内的公开互动样本。");
    expect(caveatMessage("en", "private_internal_key")).toBe("An additional conservative scoring condition applies to this finding.");
    expect(caveatMessage("zh", "private_internal_key")).toBe("这项发现应用了额外的保守判断条件。");
    expect(caveatMessage("en", "private_internal_key")).not.toContain("private_internal_key");
  });
});
