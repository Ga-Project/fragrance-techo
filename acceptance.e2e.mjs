// フレグランス手帖 — 受入E2E。
// items: 受入項目の機械実行版（check_items.key と対応）。
// designStates: デザイン確認用の画面（値が入った状態・ダーク）。

const LS_KEY = "fragrance-techo:v1";

const SEED = [
  {
    id: "s1",
    name: "ローズ 31",
    brand: "ル ラボ",
    family: "floral",
    volumeMl: 50,
    remainingPct: 64,
    sprayPerUse: 3,
    usesPerWeek: 4,
    seasons: ["spring", "summer"],
    scenes: ["date"],
    pyramid: { top: "ローズ", heart: "アイリス", base: "ムスク" },
    wearLog: ["2026-07-20", "2026-07-27"],
  },
  {
    id: "s2",
    name: "ベルガモット カローシュ",
    brand: "アトリエ",
    family: "citrus",
    volumeMl: 100,
    remainingPct: 88,
    sprayPerUse: 2,
    usesPerWeek: 6,
    seasons: ["summer"],
    scenes: ["daily", "office"],
    pyramid: { top: "ベルガモット", heart: "ネロリ", base: "シダー" },
    wearLog: ["2026-08-01"],
  },
  {
    id: "s3",
    name: "サンタル ボワ",
    brand: "メゾン",
    family: "woody",
    volumeMl: 30,
    remainingPct: 22,
    sprayPerUse: 2,
    usesPerWeek: 3,
    seasons: ["autumn", "winter"],
    scenes: ["relax"],
    pyramid: { top: "カルダモン", heart: "サンダルウッド", base: "アンバー" },
    wearLog: [],
  },
  {
    id: "s4",
    name: "バニラ ヴェール",
    brand: "パルファム",
    family: "gourmand",
    volumeMl: 50,
    remainingPct: 47,
    sprayPerUse: 3,
    usesPerWeek: 2,
    seasons: ["winter"],
    scenes: ["date", "relax"],
    pyramid: { top: "ペア", heart: "バニラ", base: "トンカ" },
    wearLog: ["2026-06-15"],
  },
];

async function seed(h) {
  await h.goto("/");
  await h.page.evaluate(
    (data) => {
      localStorage.setItem(data.key, JSON.stringify(data.list));
    },
    { key: LS_KEY, list: SEED },
  );
  await h.goto("/");
  await h.wait(300);
}

/**
 * コレクション(#collection)の中だけのテキスト。
 *
 * 「今日の1本」スポットライトはしぼり込みの対象外で、選ばれる香りは実行日で変わる。
 * 画面全文で判定すると、秋にウッディが選ばれた日だけしぼり込みが壊れて見える。
 * しぼり込みの検証は、しぼり込みの対象である範囲に限定する。
 */
async function collectionText(h) {
  const text = await h.page.evaluate(() => {
    const el = document.querySelector("#collection");
    return el ? el.innerText || "" : null;
  });
  if (text === null) throw new Error("コレクション(#collection)が見つかりません");
  return text;
}

async function clearAll(h) {
  await h.goto("/");
  await h.page.evaluate((key) => localStorage.removeItem(key), LS_KEY);
  await h.goto("/");
  await h.wait(200);
}

export const items = {
  // 空の状態から1本を登録すると、コレクションにカードとして現れる（中核機能）。
  "add-bottle": async (h) => {
    await clearAll(h);
    await h.expectText("調香卓は、まだ空です");
    await h.clickText("迎える");
    await h.expectSelector(".sheet");
    await h.fill('input[placeholder="例: サンタル 33"]', "テストの香り");
    await h.fill('input[placeholder="例: Le Labo"]', "テストメゾン");
    await h.clickText("棚に加える");
    await h.wait(300);
    await h.expectSelector(".card");
    await h.expectText("テストの香り");
  },

  // 登録済みのボトルから「今日の1本」が提案される。
  "todays-pick": async (h) => {
    await seed(h);
    await h.expectSelector(".spotlight");
    await h.expectText("今日の1本");
  },

  // 同じブランド・同じ香調を登録しようとすると重複購入を警告する。
  "duplicate-guard": async (h) => {
    await seed(h);
    await h.clickText("迎える");
    await h.expectSelector(".sheet");
    // 既定の香調はフローラル。seed の「ル ラボ / フローラル」と一致させる。
    await h.fill('input[placeholder="例: サンタル 33"]', "新しい香り");
    await h.fill('input[placeholder="例: Le Labo"]', "ル ラボ");
    await h.wait(300);
    await h.expectText("似た香りを既にお持ち");
  },

  // ボトルの詳細に使い切り予測が表示される。
  "prediction-shown": async (h) => {
    await seed(h);
    await h.clickText("ベルガモット カローシュ");
    await h.expectSelector(".sheet--detail");
    await h.expectText("使い切り予測");
  },

  // 香調スペクトル帯でコレクションをしぼり込める。
  "family-filter": async (h) => {
    await seed(h);
    await h.clickText("シトラス");
    await h.wait(300);
    await h.expectSelector("#collection");
    const shown = await collectionText(h);
    if (!shown.includes("ベルガモット カローシュ")) {
      throw new Error(
        "しぼり込み後のコレクションにシトラスの「ベルガモット カローシュ」がありません",
      );
    }
    if (shown.includes("サンタル ボワ")) {
      throw new Error(
        "しぼり込み後のコレクションにウッディの「サンタル ボワ」が残っています",
      );
    }
  },

  // レスポンシブ: 狭い画面でも横スクロールが出ない。
  "responsive-narrow": async (h) => {
    await h.viewport(390, 800);
    await seed(h);
    await h.expectNoHorizontalOverflow();
  },
};

export const designStates = {
  // 値が入って一覧・今日の1本が出ている状態（空では判定できない）。
  "main-populated": async (h) => {
    await seed(h);
    await h.wait(300);
  },
  // ダーク配色（切替UIはあるが data-theme を直接立てて確実にする）。
  dark: async (h) => {
    await seed(h);
    await h.page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await h.wait(400);
  },
};
