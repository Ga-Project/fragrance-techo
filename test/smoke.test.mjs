// フレグランス手帖 — smoke test（node:test 標準ランナー・追加依存なし）。
// 香調タクソノミーの最小整合を確認する（詳細は logic.test.mjs）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { FAMILIES, familyOf } from "../lib/families.ts";

test("香調は8つ・id は一意・色は妥当な16進", () => {
  assert.equal(FAMILIES.length, 8);
  const ids = new Set(FAMILIES.map((f) => f.id));
  assert.equal(ids.size, 8);
  for (const f of FAMILIES) {
    assert.match(f.hue, /^#[0-9a-f]{6}$/i);
    assert.ok(f.label.length > 0);
  }
});

test("familyOf は id を引ける・未知はフォールバック", () => {
  assert.equal(familyOf("woody").id, "woody");
  assert.equal(familyOf("nope").id, FAMILIES[0].id); // 未知はフォールバック
});
