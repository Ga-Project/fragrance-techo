// フレグランス手帖 — ドメインロジックのテスト(node:test・追加依存なし)。
// 実行: pnpm test (= node --experimental-strip-types --test)
// .ts を直接 import する。型ストリップが既定で有効なのは Node 22.18 以降なので、
// 対応下限の Node 22.13 でも走るよう明示的に指定する(既定で有効な版でも有効な指定)。
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  seasonOf,
  consumptionMlPerDay,
  remainingMl,
  daysUntilEmpty,
  predictEmptyDate,
  todaysPick,
  scoreForToday,
  duplicateWarnings,
  nameSimilarity,
  ML_PER_SPRAY,
} from "../lib/suggest.ts";
import { serializeBackup, parseBackup } from "../lib/backup.ts";
import {
  normalizeFragrance,
  emptyDraft,
  mergeFragranceEdit,
} from "../lib/model.ts";
import {
  addDays,
  clampPct,
  daysBetween,
  humanizeDays,
  isISODate,
  parseISODate,
} from "../lib/format.ts";

const NOW = "2026-08-04";

function make(over = {}) {
  return normalizeFragrance(
    {
      id: over.id ?? "a",
      name: "テスト",
      brand: "Brand",
      family: "woody",
      volumeMl: 50,
      remainingPct: 100,
      sprayPerUse: 2,
      usesPerWeek: 7,
      seasons: [],
      scenes: [],
      wearLog: [],
      ...over,
    },
    NOW,
  );
}

test("seasonOf: 月から季節を判定", () => {
  assert.equal(seasonOf("2026-04-01"), "spring");
  assert.equal(seasonOf("2026-07-15"), "summer");
  assert.equal(seasonOf("2026-10-31"), "autumn");
  assert.equal(seasonOf("2026-01-02"), "winter");
});

test("remainingMl / consumption: 目安からの消費速度", () => {
  const f = make({
    volumeMl: 50,
    remainingPct: 50,
    usesPerWeek: 7,
    sprayPerUse: 2,
  });
  assert.equal(remainingMl(f), 25);
  // 7回/週 × 2プッシュ × 0.1ml ÷ 7日 = 0.2 ml/日
  assert.ok(Math.abs(consumptionMlPerDay(f, NOW) - 0.2) < 1e-9);
  assert.equal(ML_PER_SPRAY, 0.1);
});

test("daysUntilEmpty / predictEmptyDate", () => {
  const f = make({
    volumeMl: 50,
    remainingPct: 50,
    usesPerWeek: 7,
    sprayPerUse: 2,
  });
  // 25ml ÷ 0.2 = 125 日
  assert.equal(daysUntilEmpty(f, NOW), 125);
  assert.equal(predictEmptyDate(f, NOW), addDays(NOW, 125));
});

test("空ボトルは予測不能(null)", () => {
  const f = make({ remainingPct: 0 });
  assert.equal(daysUntilEmpty(f, NOW), null);
  assert.equal(predictEmptyDate(f, NOW), null);
});

test("消費ゼロは予測不能(null)", () => {
  const f = make({ usesPerWeek: 0, wearLog: [] });
  assert.equal(daysUntilEmpty(f, NOW), null);
});

test("wearLog 実績があれば実測から消費速度", () => {
  // 直近10日間(今日まで)で5回、各3プッシュ = 15プッシュ×0.1 = 1.5ml / 10日 = 0.15 ml/日
  const f = make({
    sprayPerUse: 3,
    wearLog: [
      "2026-07-25",
      "2026-07-28",
      "2026-07-30",
      "2026-08-02",
      "2026-08-04",
    ],
  });
  assert.equal(daysBetween("2026-07-25", NOW), 10);
  assert.ok(Math.abs(consumptionMlPerDay(f, NOW) - 0.15) < 1e-9);
});

test("使っていない期間も観測期間に含める(放置ボトルの予測が早まらない)", () => {
  // 半年前に2日連続で使ったきり。観測を最後の使用日で打ち切ると「1日2回ペース」の
  // まま固定され、使い切り予測がいつまでも極端に早い日付になる。
  const f = make({ sprayPerUse: 2, wearLog: ["2026-02-01", "2026-02-02"] });
  const idleSpan = daysBetween("2026-02-01", NOW);
  const expected = (2 * 2 * ML_PER_SPRAY) / idleSpan;
  assert.ok(Math.abs(consumptionMlPerDay(f, NOW) - expected) < 1e-12);
  // 打ち切り実装なら 0.4ml/日。今日までを含めれば桁違いに小さい。
  assert.ok(consumptionMlPerDay(f, NOW) < 0.4 / 100);
  // 予測日も「まもなく」ではなく十分先になる。
  assert.ok(daysUntilEmpty(f, NOW) > 365);
});

test("todaysPick: 空は選ばず、同日は決定論的", () => {
  const list = [
    make({ id: "empty", remainingPct: 0 }),
    make({ id: "x", remainingPct: 80, seasons: ["summer"] }),
    make({ id: "y", remainingPct: 80, seasons: ["winter"] }),
  ];
  const p1 = todaysPick(list, "2026-08-04"); // 夏
  assert.ok(p1);
  assert.notEqual(p1.id, "empty");
  assert.equal(p1.id, "x"); // 夏タグが加点され勝つ
  const p2 = todaysPick(list, "2026-08-04");
  assert.equal(p1.id, p2.id); // 決定論的
});

test("todaysPick: 全部空なら null", () => {
  assert.equal(todaysPick([make({ remainingPct: 0 })], NOW), null);
  assert.equal(todaysPick([], NOW), null);
});

test("scoreForToday: 空は -Infinity", () => {
  assert.equal(
    scoreForToday(make({ remainingPct: 0 }), {
      todayISO: NOW,
      season: "summer",
    }),
    Number.NEGATIVE_INFINITY,
  );
});

test("nameSimilarity: 同名は1、無関係は0寄り", () => {
  assert.equal(nameSimilarity("Santal 33", "santal 33"), 1);
  assert.ok(nameSimilarity("Santal 33", "Rose 31") < 0.5);
});

test("duplicateWarnings: 同ブランド同香調は警告", () => {
  const list = [
    make({ id: "own", name: "サンタル", brand: "Le Labo", family: "woody" }),
  ];
  const w = duplicateWarnings(
    { name: "別の名前", brand: "Le Labo", family: "woody" },
    list,
  );
  assert.equal(w.length, 1);
  assert.ok(w[0].score >= 0.85);
});

test("duplicateWarnings: 自分自身は除外", () => {
  const list = [make({ id: "self", brand: "X", family: "citrus" })];
  const w = duplicateWarnings(
    { name: "テスト", brand: "X", family: "citrus", excludeId: "self" },
    list,
  );
  assert.equal(w.length, 0);
});

test("duplicateWarnings: 無関係は警告なし", () => {
  const list = [make({ brand: "A", family: "citrus", name: "レモン" })];
  const w = duplicateWarnings(
    { name: "バニラ", brand: "B", family: "gourmand" },
    list,
  );
  assert.equal(w.length, 0);
});

test("backup: 書き出し→取り込みで往復できる(写真は除外)", () => {
  const list = [make({ id: "a", photoIds: ["p1", "p2"] }), make({ id: "b" })];
  const text = serializeBackup(list, new Date(0).toISOString());
  const res = parseBackup(text, NOW);
  assert.equal(res.ok, true);
  assert.equal(res.fragrances.length, 2);
  assert.deepEqual(res.fragrances[0].photoIds, []); // 写真は含めない
});

test("parseBackup: 壊れた入力は理由付きで失敗", () => {
  assert.equal(parseBackup("not json", NOW).ok, false);
  assert.equal(parseBackup(JSON.stringify({ app: "other" }), NOW).ok, false);
  assert.equal(
    parseBackup(JSON.stringify({ app: "fragrance-techo" }), NOW).ok,
    false,
  );
});

// 取り込みは同じ id の記録を元に戻せない形で置き換える。将来版のファイルは項目が
// 増減している可能性があり、正規化で既定値へ丸めたまま取り込むと、書き出した時点より
// 劣化した内容で上書きしてしまう。版が一致するものだけを受け付ける。
test("parseBackup: 版が一致しないバックアップは取り込まない", () => {
  const body = { app: "fragrance-techo", exportedAt: NOW, fragrances: [] };
  assert.equal(parseBackup(JSON.stringify(body), NOW).ok, false); // version 無し
  assert.equal(
    parseBackup(JSON.stringify({ ...body, version: 2 }), NOW).ok,
    false, // 将来版
  );
  assert.equal(
    parseBackup(JSON.stringify({ ...body, version: 0 }), NOW).ok,
    false,
  );
  assert.equal(
    parseBackup(JSON.stringify({ ...body, version: "1" }), NOW).ok,
    false, // 版が数値でない
  );
  assert.equal(
    parseBackup(JSON.stringify({ ...body, version: 1 }), NOW).ok,
    true,
  );
});

// 正規化は欠けた項目を既定値で埋める(壊れた保存データから画面を復帰させるため)。
// 同じ寛容さを取り込みに持ち込むと、版が一致していても形をしていない記録が
// 「成功」として通り、同じ id の手元のボトルを名前も残量も履歴も空の既定値で
// 置き換えてしまう(取り込みは元に戻せない)。
test("parseBackup: 版が一致していても、形をしていない記録は取り込まない", () => {
  const good = normalizeFragrance({ id: "a", name: "A", family: "woody" }, NOW);
  const wrap = (fragrances) =>
    JSON.stringify({
      app: "fragrance-techo",
      version: 1,
      exportedAt: NOW,
      fragrances,
    });

  // 健全な記録だけなら通る(書き出し→取り込みの往復を壊さない)。
  assert.equal(parseBackup(wrap([good]), NOW).ok, true);

  // id しか無い記録: 通すと同じ id の手元のボトルが空の既定値で潰れる。
  const truncated = parseBackup(wrap([{ id: "a" }]), NOW);
  assert.equal(truncated.ok, false);
  assert.match(truncated.error, /1 件目/);

  // 型違い・列挙外・入れ子の欠落も受け付けない。
  for (const broken of [
    { ...good, name: 5 },
    { ...good, family: "bogus" },
    { ...good, volumeMl: "50" },
    { ...good, seasons: ["nope"] },
    { ...good, scenes: "date" },
    { ...good, pyramid: { top: "x", heart: "y" } },
    { ...good, photoIds: [1, 2] },
    { ...good, photoIds: ["p1"] }, // 実体の無い写真参照(下のテストを参照)
    { ...good, wearLog: null },
    { ...good, id: "" },
    { ...good, createdAt: "" },
    null,
    "文字列",
    [],
  ]) {
    assert.equal(
      parseBackup(wrap([broken]), NOW).ok,
      false,
      `受け付けてはいけない: ${JSON.stringify(broken)}`,
    );
  }

  // 1件でも壊れていれば全体を取り下げる(一部だけ置き換わる状態を作らない)。
  assert.equal(parseBackup(wrap([good, { id: "b" }]), NOW).ok, false);
});

// id はボトル1本を一意に指す。取り込みは id で突き合わせて置き換えるため、同じ id の
// 記録が2件あるファイルを通すと、後の1件が先の1件を黙って上書きしながら「2件を
// 取り込みました」と告げることになる(消えた側は元に戻せず、利用者は気付けない)。
test("parseBackup: id が重複するファイルは取り込まない", () => {
  const good = normalizeFragrance({ id: "a", name: "A", family: "woody" }, NOW);
  const other = normalizeFragrance(
    { id: "b", name: "B", family: "woody" },
    NOW,
  );
  const wrap = (fragrances) =>
    JSON.stringify({
      app: "fragrance-techo",
      version: 1,
      exportedAt: NOW,
      fragrances,
    });

  // 1件ずつは健全でも、重複していれば全体を取り下げる。
  const dup = parseBackup(wrap([good, other, { ...good, name: "A2" }]), NOW);
  assert.equal(dup.ok, false);
  assert.match(dup.error, /3 件目/);

  // 異なる id だけなら通る(書き出し→取り込みの往復を壊さない)。
  const ok = parseBackup(wrap([good, other]), NOW);
  assert.equal(ok.ok, true);
  assert.deepEqual(
    ok.fragrances.map((f) => f.id),
    ["a", "b"],
  );
});

// 版1のバックアップは「写真を含まないメタ情報だけ」で、書き出しは photoIds を必ず空にする。
// 写真の実体(IndexedDB の Blob)はファイルに入らないため、空でない photoIds は
// 実体の無い参照でしかない。取り込みで採ると、そのボトルの写真は表示できない参照になり、
// 置き換わる前の参照が指していた実体は誰からも辿れない孤児になる。空だけを受け付ける。
test("parseBackup: 実体の無い写真参照を持つファイルは取り込まない", () => {
  const good = normalizeFragrance({ id: "a", name: "A", family: "woody" }, NOW);
  const wrap = (fragrances) =>
    JSON.stringify({
      app: "fragrance-techo",
      version: 1,
      exportedAt: NOW,
      fragrances,
    });

  assert.deepEqual(good.photoIds, []); // 書き出しの形(空)は通る
  assert.equal(parseBackup(wrap([good]), NOW).ok, true);

  const withPhotos = parseBackup(wrap([{ ...good, photoIds: ["p1"] }]), NOW);
  assert.equal(withPhotos.ok, false);
  assert.match(withPhotos.error, /photoIds/);
});

// 使用日は「件数=使用回数」「最大値=最後に使った日」「間隔=消費速度」として使われる。
// 日付として読めない要素が混じると、回数には数えられるのに日付としては解釈できず、
// 使い切り予測もローテーション提案も狂う。取り込みは元に戻せないため、置き換える前に止める。
test("parseBackup: 日付として読めない使用日を含むファイルは取り込まない", () => {
  const good = normalizeFragrance({ id: "a", name: "A", family: "woody" }, NOW);
  const wrap = (fragrances) =>
    JSON.stringify({
      app: "fragrance-techo",
      version: 1,
      exportedAt: NOW,
      fragrances,
    });

  // 実在する日付だけなら通る(書き出し→取り込みの往復を壊さない)。
  assert.equal(
    parseBackup(wrap([{ ...good, wearLog: ["2026-08-01", "2026-08-04"] }]), NOW)
      .ok,
    true,
  );

  for (const wearLog of [
    ["2026-08-01", "not-a-date"], // 1件でも読めなければ取り下げる
    ["2026-02-30"], // 書式は合っているが暦に無い日(Date は 3/2 へ繰り上げる)
    ["2026-13-01"],
    ["2026-8-1"], // 0 詰めでない = 文字列比較で他の日付と順序が狂う
    ["2026-08-01T00:00:00.000Z"], // 時刻付きも使用日としては受け付けない
    [""],
    [5],
  ]) {
    const res = parseBackup(wrap([{ ...good, wearLog }]), NOW);
    assert.equal(
      res.ok,
      false,
      `受け付けてはいけない: ${JSON.stringify(wearLog)}`,
    );
    assert.match(res.error, /wearLog/);
  }
});

// 購入日・作成日時も同じ扱い。購入日は未入力(空文字)だけを例外として許す。
test("parseBackup: 購入日・作成日時も日付として読めなければ取り込まない", () => {
  const good = normalizeFragrance({ id: "a", name: "A", family: "woody" }, NOW);
  const wrap = (f) =>
    JSON.stringify({
      app: "fragrance-techo",
      version: 1,
      exportedAt: NOW,
      fragrances: [f],
    });

  assert.equal(parseBackup(wrap({ ...good, purchaseDate: "" }), NOW).ok, true);
  assert.equal(
    parseBackup(wrap({ ...good, purchaseDate: "2026-01-31" }), NOW).ok,
    true,
  );
  assert.equal(
    parseBackup(wrap({ ...good, purchaseDate: "きのう" }), NOW).ok,
    false,
  );
  assert.equal(
    parseBackup(wrap({ ...good, purchaseDate: "2026-02-31" }), NOW).ok,
    false,
  );

  // createdAt / updatedAt はこのアプリ自身が日付だけの形と時刻付きの形の両方で書く。
  // どちらも通し、日付として読めないものだけを弾く。
  assert.equal(
    parseBackup(wrap({ ...good, createdAt: "2026-08-04" }), NOW).ok,
    true,
  );
  assert.equal(
    parseBackup(wrap({ ...good, updatedAt: new Date(0).toISOString() }), NOW)
      .ok,
    true,
  );
  assert.equal(
    parseBackup(wrap({ ...good, createdAt: "いつか" }), NOW).ok,
    false,
  );
});

// 端末に既に入っている壊れた保存データからの復帰経路。取り込みと違い「止める」相手が
// いないので、読めない使用日は落として先へ進める(件数にも最大値にも混ぜない)。
test("normalizeFragrance: 日付として読めない使用日は落とす", () => {
  const f = normalizeFragrance(
    {
      id: "a",
      wearLog: ["2026-08-04", "not-a-date", "2026-02-30", 7, "2026-08-01"],
    },
    NOW,
  );
  assert.deepEqual(f.wearLog, ["2026-08-01", "2026-08-04"]);
});

test("parseISODate / isISODate: 暦に無い日付は日付として扱わない", () => {
  assert.notEqual(parseISODate("2026-08-04"), null);
  assert.equal(parseISODate("2026-02-30"), null);
  assert.equal(parseISODate("2026-13-01"), null);
  assert.equal(daysBetween("2026-02-30", NOW), null);
  assert.equal(addDays("2026-02-30", 3), null);
  assert.equal(isISODate("2024-02-29"), true); // 閏年の 2/29 は実在する
  assert.equal(isISODate("2026-02-29"), false);
  assert.equal(isISODate("2026-08-04T10:00:00Z"), false);
  assert.equal(isISODate("2026-8-4"), false);
});

test("normalizeFragrance: 破損データを健全化", () => {
  const f = normalizeFragrance(
    { name: 5, remainingPct: 250, family: "bogus", seasons: "x", volumeMl: -3 },
    NOW,
  );
  assert.equal(f.name, "");
  assert.equal(clampPct(f.remainingPct), 100);
  assert.equal(f.family, "floral"); // 不正な香調はフォールバック
  assert.deepEqual(f.seasons, []);
  assert.ok(f.volumeMl >= 1);
  assert.ok(typeof f.id === "string" && f.id.length > 0);
});

test("normalizeFragrance: 容量0/空欄でも使い切り予測が止まらない", () => {
  // 容量入力を空にすると Number("") = 0 が届く。0 のまま通すと残量mlが常に0になり、
  // 残量%が残っていても予測が出せなくなる。
  for (const bad of [0, -3, "", "abc", null, undefined, NaN]) {
    const f = normalizeFragrance(
      { volumeMl: bad, remainingPct: 50, usesPerWeek: 7, sprayPerUse: 2 },
      NOW,
    );
    assert.ok(f.volumeMl >= 1, `volumeMl=${String(bad)} -> ${f.volumeMl}`);
    assert.ok(remainingMl(f) > 0);
    assert.ok(daysUntilEmpty(f, NOW) !== null);
  }
});

test("emptyDraft: 妥当な初期値", () => {
  const d = emptyDraft(NOW);
  assert.equal(d.remainingPct, 100);
  assert.equal(d.sprayPerUse, 3);
  assert.equal(d.wearLog.length, 0);
});

test("humanizeDays: 表現", () => {
  assert.equal(humanizeDays(null), "—");
  assert.equal(humanizeDays(0), "まもなく");
  assert.equal(humanizeDays(10), "あと約10日");
  assert.equal(humanizeDays(120), "約4か月");
});

// 編集シートは開いた瞬間のボトルを写し取って持ち続ける。保存時にそのボトルを丸ごと
// 差し替えると、開いている間に別タブが同じボトルへ書いた内容が古い写しへ巻き戻る。
// コレクション全体を読み直しても防げない(消えるのは同じボトルの中身)。
test("mergeFragranceEdit: フォームが触っていない項目は別タブの更新を残す", () => {
  const base = make({ remainingPct: 80, wearLog: [], notes: "" });
  // 別タブで「つけた」が押され、使用履歴が増えて残量が減った。
  const remote = make({
    remainingPct: 74,
    wearLog: ["2026-08-04"],
    notes: "",
  });
  // こちらのタブはメモだけ書き換えて保存した(残量スライダーは触っていない)。
  const local = make({
    remainingPct: 80,
    wearLog: [],
    notes: "褒められた",
    updatedAt: "2026-08-05",
  });

  const merged = mergeFragranceEdit(base, local, remote);
  assert.equal(merged.notes, "褒められた"); // 入力した項目は反映
  assert.deepEqual(merged.wearLog, ["2026-08-04"]); // 触っていない履歴は残る
  assert.equal(merged.remainingPct, 74); // 減った残量も戻さない
  assert.equal(merged.updatedAt, "2026-08-05");
});

test("mergeFragranceEdit: 入力した項目は別タブより優先する", () => {
  const base = make({ remainingPct: 80, wearLog: [] });
  const remote = make({ remainingPct: 74, wearLog: ["2026-08-04"] });
  // 残量スライダーを動かして保存した = 「いまこの値にする」という明示の指定。
  const local = make({ remainingPct: 20, wearLog: [] });

  const merged = mergeFragranceEdit(base, local, remote);
  assert.equal(merged.remainingPct, 20);
  assert.deepEqual(merged.wearLog, ["2026-08-04"]); // 履歴は依然として残る
});

test("mergeFragranceEdit: 別タブに変化が無ければフォームの内容がそのまま残る", () => {
  const base = make({ notes: "", seasons: [] });
  const local = make({ notes: "夏向け", seasons: ["summer"] });
  const merged = mergeFragranceEdit(base, local, base);
  assert.equal(merged.notes, "夏向け");
  assert.deepEqual(merged.seasons, ["summer"]);
});

// 写真の参照は双方のタブが同時に増やせる。local で丸ごと置き換えると、後から保存した
// 側が知らない写真 id がメタ情報から消え、実体(IndexedDB の Blob)だけがどちらの
// 回収対象にも入らないまま残る(誰からも辿れず誰にも消せない)。
test("mergeFragranceEdit: 別タブが足した写真を消さない(加除をマージする)", () => {
  const base = make({ photoIds: ["p0"] });
  // 別タブが同じボトルに写真を1枚足して保存した。
  const remote = make({ photoIds: ["p0", "pB"] });
  // こちらのフォームは(base を写した状態から)別の写真を1枚足して保存する。
  const local = make({ photoIds: ["p0", "pA"] });

  const merged = mergeFragranceEdit(base, local, remote);
  assert.deepEqual(merged.photoIds, ["p0", "pB", "pA"]);
});

test("mergeFragranceEdit: フォームで外した写真は別タブの内容にも反映する", () => {
  const base = make({ photoIds: ["p0", "p1"] });
  const remote = make({ photoIds: ["p0", "p1", "pB"] }); // 別タブが1枚追加
  const local = make({ photoIds: ["p0"] }); // こちらは p1 を外した

  const merged = mergeFragranceEdit(base, local, remote);
  assert.deepEqual(merged.photoIds, ["p0", "pB"]); // 外した分だけ消え、追加は残る
});

test("mergeFragranceEdit: 別タブが外した写真は復活させない", () => {
  const base = make({ photoIds: ["p0", "p1"] });
  const remote = make({ photoIds: ["p0"] }); // 別タブが p1 を外した(実体も削除済み)
  const local = make({ photoIds: ["p0", "p1"] }); // こちらは写真を触っていない

  const merged = mergeFragranceEdit(base, local, remote);
  assert.deepEqual(merged.photoIds, ["p0"]);
});

test("mergeFragranceEdit: 配列・入れ子も中身で比較する(参照違いで誤上書きしない)", () => {
  const base = make({ photoIds: ["p1"], pyramid: { top: "ベルガモット" } });
  // 別タブが写真を1枚外した。こちらは写真もピラミッドも触っていない。
  const remote = make({ photoIds: [], pyramid: { top: "ベルガモット" } });
  const local = make({ photoIds: ["p1"], pyramid: { top: "ベルガモット" } });
  const merged = mergeFragranceEdit(base, local, remote);
  assert.deepEqual(merged.photoIds, []);
  assert.equal(merged.pyramid.top, "ベルガモット");
});
