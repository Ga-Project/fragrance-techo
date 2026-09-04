// フレグランス手帖 — 端末内ストレージの保存結果テスト(node:test・追加依存なし)。
// 目的: localStorage への書き込みが失敗したときに「保存できた」と返さないこと。
//       ここが true を返すと UI が「保存しました」と表示し、リロードで記録が消える。
import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * localStorage の最小スタブ。
 *   fail     : setItem が例外を投げる(容量超過/ブロック相当)
 *   readFail : getItem が例外を投げる(サイトデータのブロック相当)
 */
function stubWindow({ fail = false, readFail = false } = {}) {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => {
        if (readFail) throw new Error("SecurityError");
        return store.has(k) ? store.get(k) : null;
      },
      setItem: (k, v) => {
        if (fail) throw new Error("QuotaExceededError");
        store.set(k, v);
      },
      removeItem: (k) => store.delete(k),
    },
  };
  return store;
}

const {
  saveFragrances,
  loadFragrances,
  readFragrances,
  readStoredCollection,
  readReferencedPhotoIds,
  updateFragrances,
  stagePhoto,
  unstagePhotos,
  sweepOrphanPhotos,
  liveStagingSessions,
  orphanPhotoIds,
  STORAGE_KEY,
} = await import("../lib/db.ts");

/**
 * Web Locks の最小スタブ。
 *   onAcquire : ロックを取った直後(= コールバックが走る直前)に呼ばれる。
 *               「順番待ちの間に別タブが書いた」状況を作るのに使う。
 *   fail      : request が同期的に例外を投げる(非セキュアコンテキスト相当)
 *   reject    : request が拒否される(コールバックは走らない)
 * Node の navigator は getter 定義なので、代入ではなく defineProperty で差し替える。
 */
function stubLocks({ onAcquire, fail = false, reject = false } = {}) {
  const calls = [];
  const prev = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: {
      locks: {
        request(name, cb) {
          calls.push(name);
          if (fail) throw new Error("SecurityError");
          if (reject) return Promise.reject(new Error("NotSupportedError"));
          return Promise.resolve().then(() => {
            onAcquire?.();
            return cb({ name });
          });
        },
      },
    },
    configurable: true,
    writable: true,
  });
  return {
    calls,
    restore() {
      if (prev) Object.defineProperty(globalThis, "navigator", prev);
      else delete globalThis.navigator;
    },
  };
}

const NOW = "2026-08-06";
const sample = [
  {
    id: "a",
    name: "テスト",
    brand: "Brand",
    family: "woody",
    volumeMl: 50,
    remainingPct: 80,
  },
];

test("saveFragrances: 書き込めたら true を返し、読み戻せる", () => {
  stubWindow();
  assert.equal(saveFragrances(sample), true);
  const back = loadFragrances(NOW);
  assert.equal(back.length, 1);
  assert.equal(back[0].id, "a");
  delete globalThis.window;
});

test("saveFragrances: 書き込みに失敗したら false を返す(成功と偽らない)", () => {
  stubWindow({ fail: true });
  assert.equal(saveFragrances(sample), false);
  delete globalThis.window;
});

test("saveFragrances: window が無い環境(SSR)では false", () => {
  delete globalThis.window;
  assert.equal(saveFragrances(sample), false);
});

test("loadFragrances: 壊れた JSON でも落ちず空配列", () => {
  const store = stubWindow();
  store.set(STORAGE_KEY, "{壊れている");
  assert.deepEqual(loadFragrances(NOW), []);
  delete globalThis.window;
});

test("readFragrances: 未保存・壊れた JSON は null(空の保存と区別する)", () => {
  const store = stubWindow();
  assert.equal(readFragrances(NOW), null);
  store.set(STORAGE_KEY, "[]");
  assert.deepEqual(readFragrances(NOW), []); // 「空を保存済み」は空配列
  store.set(STORAGE_KEY, "{壊れている");
  assert.equal(readFragrances(NOW), null);
  delete globalThis.window;
});

// 「まだ一度も保存していない」と「読めない」は結果が正反対になる(前者は写真を
// 1枚も参照していないことが確か、後者は何を参照しているか分からない)。
test("readStoredCollection: 未保存・読み取り不能・空の保存を区別する", () => {
  const store = stubWindow();
  assert.equal(readStoredCollection(NOW).status, "missing");
  store.set(STORAGE_KEY, "[]");
  assert.deepEqual(readStoredCollection(NOW), { status: "ok", list: [] });
  store.set(STORAGE_KEY, "{壊れている");
  assert.equal(readStoredCollection(NOW).status, "unreadable");
  store.set(STORAGE_KEY, JSON.stringify({ notAnArray: true }));
  assert.equal(readStoredCollection(NOW).status, "unreadable");
  delete globalThis.window;
});

test("readStoredCollection: 読み取り自体が拒まれる環境は unreadable", () => {
  stubWindow({ readFail: true });
  assert.equal(readStoredCollection(NOW).status, "unreadable");
  delete globalThis.window;
});

// 画面向けの読み取りは項目の欠けを既定値で埋めて先へ進む(読めた分は見せる)。
// その寛容さのまま掃除の判断に使うと、参照を読み落としただけの写真を消してしまう。
test("readReferencedPhotoIds: 参照を読み取れない記録があれば unreadable", () => {
  const store = stubWindow();
  assert.equal(readReferencedPhotoIds().status, "missing");

  store.set(STORAGE_KEY, JSON.stringify([{ id: "a", photoIds: ["p1"] }]));
  assert.deepEqual(readReferencedPhotoIds(), { status: "ok", ids: ["p1"] });

  // photoIds が欠けている / 配列でない / 文字列でない要素を含む = 参照が読めない。
  for (const broken of [
    [{ id: "a" }],
    [{ id: "a", photoIds: "p1" }],
    [{ id: "a", photoIds: [1] }],
    [{ id: "a", photoIds: ["p1"] }, null],
    ["a"],
  ]) {
    store.set(STORAGE_KEY, JSON.stringify(broken));
    assert.equal(
      readReferencedPhotoIds().status,
      "unreadable",
      JSON.stringify(broken),
    );
  }

  // 同じ内容でも画面向けの読み取りは従来どおり読めた分を返す(空にしない)。
  store.set(STORAGE_KEY, JSON.stringify([{ id: "a", name: "A" }]));
  const shown = readStoredCollection(NOW);
  assert.equal(shown.status, "ok");
  assert.equal(shown.list.length, 1);
  delete globalThis.window;
});

// 中核: 別タブが後から書いた内容を踏み潰さないこと。
// 画面が抱えている一覧を基点に書き戻すと、こちらの読み込み後に別タブが加えた
// ボトルを見ないまま同じキーを上書きし、その追加は復元できないまま消える。
test("updateFragrances: 別タブが後から追加したボトルを消さない", async () => {
  const store = stubWindow();
  // このタブが読み込んだ時点の一覧(= 画面が抱えている状態)。
  const loaded = [{ id: "a", name: "A", family: "woody", volumeMl: 50 }];
  store.set(STORAGE_KEY, JSON.stringify(loaded));
  // 別タブがボトルを追加して保存した(こちらの画面はまだ知らない)。
  store.set(
    STORAGE_KEY,
    JSON.stringify([
      ...loaded,
      { id: "b", name: "B", family: "citrus", volumeMl: 30 },
    ]),
  );

  // こちらのタブで新しいボトルを1本足す。
  const res = await updateFragrances(
    (cur) => [...cur, { id: "c", name: "C", family: "floral", volumeMl: 100 }],
    () => loaded,
    NOW,
  );

  assert.equal(res.ok, true);
  assert.deepEqual(
    res.list.map((f) => f.id),
    ["a", "b", "c"],
  );
  const persisted = JSON.parse(store.get(STORAGE_KEY));
  assert.deepEqual(
    persisted.map((f) => f.id),
    ["a", "b", "c"],
  );
  delete globalThis.window;
});

test("updateFragrances: 別タブの更新を基点に「つけた」を積む(上書きしない)", async () => {
  const store = stubWindow();
  const loaded = [
    { id: "a", name: "A", family: "woody", volumeMl: 50, wearLog: [] },
  ];
  // 別タブが同じボトルに記録を1件付けた。
  store.set(
    STORAGE_KEY,
    JSON.stringify([{ ...loaded[0], wearLog: ["2026-08-05"] }]),
  );

  const res = await updateFragrances(
    (cur) => cur.map((f) => ({ ...f, wearLog: [...f.wearLog, NOW] })),
    () => loaded,
    NOW,
  );

  assert.equal(res.ok, true);
  assert.deepEqual(res.list[0].wearLog, ["2026-08-05", NOW]);
  delete globalThis.window;
});

test("updateFragrances: 読み取れない環境でも手元の一覧を基点にする(全消去しない)", async () => {
  stubWindow({ readFail: true });
  const fallback = [{ id: "a", name: "A", family: "woody", volumeMl: 50 }];
  const res = await updateFragrances(
    (cur) => cur,
    () => fallback,
    NOW,
  );
  assert.equal(res.ok, true);
  assert.deepEqual(
    res.list.map((f) => f.id),
    ["a"],
  );
  delete globalThis.window;
});

// 「読めない」は「無い」ではない。保存値が壊れている / 読み取りを拒まれている状態で
// 手元の一覧を書き戻すと、読めなかっただけの保存値を丸ごと置き換えてしまう
// (起動直後の手元は空なので、最初の1操作で全部を失う)。しかも置き換えられた保存値が
// 参照していた写真は、次回起動の掃除が孤児として消す。書き込み自体を取り下げる。
test("updateFragrances: 保存値が読めないときは上書きしない", async () => {
  const store = stubWindow();
  store.set(STORAGE_KEY, "{壊れている");

  const res = await updateFragrances(
    (cur) => [...cur, { id: "a", name: "A", family: "woody", volumeMl: 50 }],
    () => [],
    NOW,
  );

  assert.equal(res.ok, false);
  assert.equal(res.reason, "unreadable");
  assert.equal(store.get(STORAGE_KEY), "{壊れている"); // 元の値はそのまま

  // 配列でない保存値も同じ(内容が分からない点は変わらない)。
  store.set(STORAGE_KEY, JSON.stringify({ notAnArray: true }));
  const res2 = await updateFragrances(
    (cur) => [...cur, { id: "a", name: "A", family: "woody", volumeMl: 50 }],
    () => [],
    NOW,
  );
  assert.equal(res2.ok, false);
  assert.equal(res2.reason, "unreadable");
  assert.deepEqual(JSON.parse(store.get(STORAGE_KEY)), { notAnArray: true });
  delete globalThis.window;
});

test("updateFragrances: 読み取りを拒まれる環境でも書き込みは取り下げる", async () => {
  stubWindow({ readFail: true });
  const fallback = [{ id: "a", name: "A", family: "woody", volumeMl: 50 }];
  const res = await updateFragrances(
    (cur) => cur.filter((f) => f.id !== "a"),
    () => fallback,
    NOW,
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, "unreadable");
  // 画面の状態は据え置き(空にして「全部手放した」ように見せない)。
  assert.deepEqual(
    res.list.map((f) => f.id),
    ["a"],
  );
  delete globalThis.window;
});

// 保存できないこと(容量超過等)と、保存値を読めないことは直しようが違う。
// 呼び出し側が同じ案内を出さないよう理由を分ける。
test("updateFragrances: 失敗の理由を書き込み失敗と読み取り不能で分ける", async () => {
  const store = stubWindow({ fail: true });
  store.set(STORAGE_KEY, JSON.stringify([]));
  const res = await updateFragrances(
    (cur) => [...cur, { id: "a", name: "A", family: "woody", volumeMl: 50 }],
    () => [],
    NOW,
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, "write-failed");
  delete globalThis.window;
});

// 別タブとの衝突で書き込みを取り下げる経路(編集中のボトルが既に手放されていた等)は、
// produce が受け取った配列をそのまま返す。ここで同じ内容を書き戻すと、保存できない環境で
// 「衝突」が「保存エラー」にすり替わる。書くことが無いときは localStorage に触れない。
test("updateFragrances: produce が現状をそのまま返したら書き込まない", async () => {
  const store = stubWindow({ fail: true }); // 書けば必ず失敗する環境
  const stored = [{ id: "a", name: "A", family: "woody", volumeMl: 50 }];
  store.set(STORAGE_KEY, JSON.stringify(stored));

  const res = await updateFragrances(
    (cur) => cur,
    () => [],
    NOW,
  );

  assert.equal(res.ok, true); // 書いていないので失敗しようがない
  assert.deepEqual(
    res.list.map((f) => f.id),
    ["a"],
  );
  delete globalThis.window;
});

test("updateFragrances: 書き込みに失敗したら ok:false・状態は据え置き", async () => {
  const store = stubWindow({ fail: true });
  const fallback = [{ id: "a", name: "A", family: "woody", volumeMl: 50 }];
  const res = await updateFragrances(
    () => [],
    () => fallback,
    NOW,
  );
  assert.equal(res.ok, false);
  assert.deepEqual(res.list, fallback);
  assert.equal(store.has(STORAGE_KEY), false);
  delete globalThis.window;
});

// ここからタブ間の直列化。読み直しと setItem は別々の操作で、同期的な JavaScript が
// 止めるのは自分のタブだけ。ほぼ同時に2つのタブが更新すると双方が同じ一覧を読み、
// 後から書いた方が先の書き込みを丸ごと踏み潰す(ボトルや記録が完全に失われる)。
// 読み直し〜書き戻しはロックを取ってから行う。
test("updateFragrances: 読み直しはロックを取ってから行う", async () => {
  const store = stubWindow();
  const a = { id: "a", name: "A", family: "woody", volumeMl: 50 };
  const b = { id: "b", name: "B", family: "citrus", volumeMl: 30 };
  store.set(STORAGE_KEY, JSON.stringify([a]));
  // 順番待ちの間に別タブが1本追加して保存した。ロックを取る前に読んでいると見逃す。
  const locks = stubLocks({
    onAcquire: () => store.set(STORAGE_KEY, JSON.stringify([a, b])),
  });

  const res = await updateFragrances(
    (cur) => [...cur, { id: "c", name: "C", family: "floral", volumeMl: 100 }],
    () => [],
    NOW,
  );

  assert.equal(res.ok, true);
  assert.deepEqual(
    res.list.map((f) => f.id),
    ["a", "b", "c"],
  );
  assert.equal(locks.calls.length, 1);
  locks.restore();
  delete globalThis.window;
});

// 同じキーを触る経路が別々の名前でロックを取ると直列化は成立しない。
// 書き込みは updateFragrances 一本に集約し、ロック名も1つであることを固定する。
test("updateFragrances: どの更新も同じ名前のロックを取る", async () => {
  const store = stubWindow();
  store.set(STORAGE_KEY, JSON.stringify([]));
  const locks = stubLocks();

  await updateFragrances(
    (cur) => [...cur, { id: "a", name: "A", family: "woody", volumeMl: 50 }],
    () => [],
    NOW,
  );
  await updateFragrances(
    (cur) => cur.map((f) => ({ ...f, wearLog: [NOW] })),
    () => [],
    NOW,
  );

  assert.equal(locks.calls.length, 2);
  assert.equal(new Set(locks.calls).size, 1);
  locks.restore();
  delete globalThis.window;
});

// 読み取れない環境の基点(画面が持つ一覧)も、ロックを取る前の写しでは古い。
// 先に並んでいた保存が終わってから評価する。
test("updateFragrances: 読み取れない環境の基点もロックの中で評価する", async () => {
  stubWindow({ readFail: true });
  let fallback = [{ id: "a", name: "A", family: "woody", volumeMl: 50 }];
  const locks = stubLocks({
    onAcquire: () => {
      fallback = [
        ...fallback,
        { id: "b", name: "B", family: "citrus", volumeMl: 30 },
      ];
    },
  });

  const res = await updateFragrances(
    (cur) => cur,
    () => fallback,
    NOW,
  );

  assert.equal(res.ok, true);
  assert.deepEqual(
    res.list.map((f) => f.id),
    ["a", "b"],
  );
  locks.restore();
  delete globalThis.window;
});

// ロックは非対応ブラウザ・非セキュアコンテキストでは使えない。取れないことを理由に
// 書き込みを諦めると、その環境では記録が一切保存できなくなる。直列化は失っても保存はする。
// ただし produce を二度走らせない(同じ操作が二重に適用されるほうが危険)。
for (const [label, opts] of [
  ["request が例外を投げる", { fail: true }],
  ["request が拒否される", { reject: true }],
]) {
  test(`updateFragrances: ロックが使えない環境でも保存する(${label})`, async () => {
    const store = stubWindow();
    store.set(STORAGE_KEY, JSON.stringify([]));
    const locks = stubLocks(opts);
    let produced = 0;

    const res = await updateFragrances(
      (cur) => {
        produced += 1;
        return [...cur, { id: "a", name: "A", family: "woody", volumeMl: 50 }];
      },
      () => [],
      NOW,
    );

    assert.equal(res.ok, true);
    assert.equal(produced, 1);
    assert.deepEqual(
      JSON.parse(store.get(STORAGE_KEY)).map((f) => f.id),
      ["a"],
    );
    locks.restore();
    delete globalThis.window;
  });
}

// ---------------------------------------------------------------------------
// 写真の実体(IndexedDB)の回収。
//
// 実体は取り込んだ瞬間に書かれるが、その id がボトルのメタ情報に載るのは保存が
// 確定したときだけ。リロード・別ページへの移動・タブの終了は編集フォームの
// 後始末を通らないため、唯一の手掛かりごと消える。実体は誰からも参照されず
// 誰にも消せないまま容量を食い続け、やがて新しい写真が取り込めなくなる。
// ---------------------------------------------------------------------------

/**
 * IndexedDB の最小スタブ。写真 id の集合だけを持つ。
 * openDB → transaction → getAllKeys / delete の順で使われる。
 */
function stubIndexedDB(ids = []) {
  const keys = new Set(ids);
  const later = (fn) => queueMicrotask(fn);
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => {},
    close: () => {},
    transaction() {
      const tx = { oncomplete: null, onerror: null, error: null };
      tx.objectStore = () => ({
        getAllKeys() {
          const req = { result: [...keys], onsuccess: null, onerror: null };
          later(() => {
            req.onsuccess?.();
            tx.oncomplete?.();
          });
          return req;
        },
        delete(id) {
          keys.delete(id);
          const req = { onsuccess: null, onerror: null };
          later(() => {
            req.onsuccess?.();
            tx.oncomplete?.();
          });
          return req;
        },
      });
      return tx;
    },
  };
  globalThis.window.indexedDB = {
    open() {
      const req = {
        result: db,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      later(() => req.onsuccess?.());
      return req;
    },
  };
  return keys;
}

function seedCollection(store, photoIds) {
  store.set(
    STORAGE_KEY,
    JSON.stringify([
      { id: "a", name: "A", family: "woody", volumeMl: 50, photoIds },
    ]),
  );
}

test("sweepOrphanPhotos: どのボトルからも参照されていない実体を回収する", async () => {
  const store = stubWindow();
  seedCollection(store, ["p1"]);
  const keys = stubIndexedDB(["p1", "p2"]);

  const removed = await sweepOrphanPhotos();

  assert.equal(removed, 1);
  assert.deepEqual([...keys], ["p1"]); // 参照中の実体は残る
  delete globalThis.window;
});

// 一覧が配列として読めても、記録から写真の参照を読み取れなければ「参照されていない」
// とは言えない。正規化が欠けた photoIds を [] に埋めた結果を鵜呑みにすると、
// その記録が参照していた実体を孤児と見なして永久に消してしまう。
test("sweepOrphanPhotos: 参照を読み取れない記録があるときは何も消さない", async () => {
  const store = stubWindow();
  store.set(
    STORAGE_KEY,
    JSON.stringify([{ id: "a", name: "A", family: "woody", volumeMl: 50 }]),
  );
  const keys = stubIndexedDB(["p1", "p2"]);
  const restore = stubLockEnv([]);

  assert.equal(await sweepOrphanPhotos(), 0);
  assert.deepEqual([...keys], ["p1", "p2"]);
  restore();
  delete globalThis.window;
});

// 読めないことを「1本も持っていない」と取り違えると、全ての写真を消してしまう。
test("sweepOrphanPhotos: 一覧が読めないときは何も消さない", async () => {
  stubWindow({ readFail: true });
  const keys = stubIndexedDB(["p1", "p2"]);

  const removed = await sweepOrphanPhotos();

  assert.equal(removed, 0);
  assert.deepEqual([...keys], ["p1", "p2"]);
  delete globalThis.window;
});

/**
 * Web Locks の環境を固定する(実行する Node の版で navigator.locks の有無が変わるため)。
 *   held: 保持中のロック名の配列 → query が使える環境
 *   held: null                   → Web Locks 自体が無い環境
 */
function stubLockEnv(held) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const value =
    held === null
      ? {}
      : {
          locks: {
            request: (name, cb) => Promise.resolve().then(() => cb({ name })),
            query: () =>
              Promise.resolve({ held: held.map((name) => ({ name })) }),
          },
        };
  Object.defineProperty(globalThis, "navigator", {
    value,
    configurable: true,
    writable: true,
  });
  return () => {
    if (prev) Object.defineProperty(globalThis, "navigator", prev);
    else delete globalThis.navigator;
  };
}

// 保存前の写真は、まだどのボトルからも参照されていない。控えを見ずに掃除すると
// 別のタブで編集中の写真を消してしまう。編集中かどうかはロックの保持で分かる
// (タブが消えればブラウザが解放するので、後始末が走らなくても正しく判定できる)。
test("sweepOrphanPhotos: 編集中のセッションが確保中の実体は消さない", async () => {
  const store = stubWindow();
  seedCollection(store, []);
  const keys = stubIndexedDB(["p1"]);
  let restore = stubLockEnv(["fragrance-techo:photo-session:s1"]);
  await stagePhoto("s1", "p1");

  assert.equal(await sweepOrphanPhotos(), 0);
  assert.deepEqual([...keys], ["p1"]);

  // タブが消えた(ロックが解放された)ら、控えごと回収してよい。
  restore();
  restore = stubLockEnv([]);
  assert.equal(await sweepOrphanPhotos(), 1);
  assert.deepEqual([...keys], []);
  restore();
  delete globalThis.window;
});

test("sweepOrphanPhotos: 確保を解いた写真は回収する", async () => {
  const store = stubWindow();
  seedCollection(store, []);
  const keys = stubIndexedDB(["p1"]);
  const restore = stubLockEnv(["fragrance-techo:photo-session:s1"]);
  await stagePhoto("s1", "p1");
  // 保存せずに閉じた: フォームは実体を消し、確保も解く。
  await unstagePhotos("s1");

  assert.equal(await sweepOrphanPhotos(), 1);
  assert.deepEqual([...keys], []);
  restore();
  delete globalThis.window;
});

// Web Locks が無い環境では心拍で代用する。タブが不意に消えると後始末は走らず、
// 心拍も途絶える。控えだけが端末に残るので、次の起動が回収する。
test("sweepOrphanPhotos: 心拍が途絶えたセッションの控えは回収する", async () => {
  const store = stubWindow();
  seedCollection(store, []);
  const keys = stubIndexedDB(["p1"]);
  const restore = stubLockEnv(null);
  await stagePhoto("s1", "p1");

  // 心拍が新しいうちは編集中とみなして残す。
  assert.equal(await sweepOrphanPhotos(), 0);
  assert.deepEqual([...keys], ["p1"]);

  // 控えの時刻を十分に古くする(タブが消えたまま猶予を超えて時間が経った状態)。
  // 数時間程度では回収しない(凍結された背面のタブと区別が付かないため)。
  const stagingKey = [...store.keys()].find((k) => k !== STORAGE_KEY);
  const staged = JSON.parse(store.get(stagingKey));
  staged.s1.ts = Date.now() - 6 * 60 * 60 * 1000;
  store.set(stagingKey, JSON.stringify(staged));
  assert.equal(await sweepOrphanPhotos(), 0);
  assert.deepEqual([...keys], ["p1"]);

  staged.s1.ts = Date.now() - 48 * 60 * 60 * 1000;
  store.set(stagingKey, JSON.stringify(staged));

  assert.equal(await sweepOrphanPhotos(), 1);
  assert.deepEqual([...keys], []);
  assert.equal(store.has(stagingKey), false); // 用済みの控えも残さない
  restore();
  delete globalThis.window;
});

// 一覧のキーが一度も書かれていない = まだ1本も保存していない。ここで掃除を諦めると、
// 最初の1本を保存する前に取り込んだ写真は、参照する記録がこの先も現れないのに
// 起動のたびに見送られ、端末に残り続ける。
test("sweepOrphanPhotos: 最初の1本を保存する前でも取り残された実体を回収する", async () => {
  stubWindow(); // 一覧のキーは一度も書かれていない
  const keys = stubIndexedDB(["p1"]);
  let restore = stubLockEnv(["fragrance-techo:photo-session:s1"]);
  await stagePhoto("s1", "p1");

  // 編集中(ロックを保持している)の写真は、参照が無くても消さない。
  assert.equal(await sweepOrphanPhotos(), 0);
  assert.deepEqual([...keys], ["p1"]);

  // 保存せずにタブが消えた: この実体を参照する記録はこの先も現れない。
  restore();
  restore = stubLockEnv([]);
  assert.equal(await sweepOrphanPhotos(), 1);
  assert.deepEqual([...keys], []);
  restore();
  delete globalThis.window;
});

// 一覧を最初に読むと、その後に別タブが保存を確定させた写真を「参照されていない」と
// 判定してしまう(控えは保存の確定後に解かれるので、そちらにも残っていない)。
// 一覧の読み直しから削除までは、一覧の書き戻しと同じロックの中で行う。
test("sweepOrphanPhotos: 掃除の最中に保存が確定した写真は消さない", async () => {
  const store = stubWindow();
  seedCollection(store, []); // まだどのボトルも写真を参照していない
  const keys = stubIndexedDB(["p1"]);
  const prev = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: {
      locks: {
        request: (name, cb) =>
          Promise.resolve().then(() => {
            // ロックの順番待ちの間に、別タブが p1 を参照する保存を確定させた。
            if (name === "fragrance-techo:collection") {
              seedCollection(store, ["p1"]);
            }
            return cb({ name });
          }),
        query: () => Promise.resolve({ held: [] }),
      },
    },
    configurable: true,
    writable: true,
  });

  assert.equal(await sweepOrphanPhotos(), 0);
  assert.deepEqual([...keys], ["p1"]);

  if (prev) Object.defineProperty(globalThis, "navigator", prev);
  else delete globalThis.navigator;
  delete globalThis.window;
});

// 控えは「まだ参照されていないが消してはいけない写真」の唯一の手掛かり。
// 読めなかったことを「何も確保されていない」と取り違えると、編集中の写真を消す。
test("sweepOrphanPhotos: 控えが読めないときは何も消さない", async () => {
  const store = stubWindow();
  seedCollection(store, []);
  store.set("fragrance-techo:photo-staging", "{壊れている");
  const keys = stubIndexedDB(["p1"]);
  const restore = stubLockEnv([]);

  assert.equal(await sweepOrphanPhotos(), 0);
  assert.deepEqual([...keys], ["p1"]);
  // 読めない控えを掃除の側から書き潰さない(読めた分だけ書き戻すと守るべき id が消える)。
  assert.equal(store.get("fragrance-techo:photo-staging"), "{壊れている");
  restore();
  delete globalThis.window;
});

// 掃除だけでなく、書き込み側も読めない控えを置き換えない。読めた分を基点に
// 書き戻すと、読み落とした項目が守っていた id ごと消え、その実体は次の掃除に
// 「誰も確保していない」と見なされて消える(写真は元に戻せない)。
test("stagePhoto: 控えが読めないときは書き戻さない", async () => {
  const store = stubWindow();
  seedCollection(store, []);
  store.set("fragrance-techo:photo-staging", "{壊れている");
  const keys = stubIndexedDB(["p1"]);
  const restore = stubLockEnv([]);

  await stagePhoto("s1", "p2");
  assert.equal(store.get("fragrance-techo:photo-staging"), "{壊れている");
  // 控えが読めない間は掃除も動かないので、実体は消えない。
  assert.equal(await sweepOrphanPhotos(), 0);
  assert.deepEqual([...keys], ["p1"]);

  // 確保を解く経路・心拍も同じ(読めない控えを valid な値で塗り潰さない)。
  await unstagePhotos("s1");
  assert.equal(store.get("fragrance-techo:photo-staging"), "{壊れている");
  restore();
  delete globalThis.window;
});

test("liveStagingSessions: ロックが分かる環境では保持の有無で生死を決める", () => {
  const map = {
    alive: { ids: ["p1"], ts: 0 }, // 心拍は古いが、ロックは保持している
    gone: { ids: ["p2"], ts: Date.now() },
  };
  const held = new Set(["fragrance-techo:photo-session:alive"]);
  const res = liveStagingSessions(map, held, Date.now());
  assert.deepEqual(res.live, ["alive"]);
  assert.deepEqual(res.dead, ["gone"]);
});

test("liveStagingSessions: ロックが使えない環境では心拍の新しさで代用する", () => {
  const now = Date.now();
  const map = {
    fresh: { ids: ["p1"], ts: now - 1000 },
    stale: { ids: ["p2"], ts: now - 48 * 60 * 60 * 1000 },
  };
  const res = liveStagingSessions(map, null, now);
  assert.deepEqual(res.live, ["fresh"]);
  assert.deepEqual(res.dead, ["stale"]);
});

// 背面のタブは丸ごと凍結され、心拍のタイマーが何時間も動かないことがある。
// 数分〜数時間の途絶を「死んだ」と扱うと、編集中の写真の実体を掃除が消してしまう
// (戻って保存すると、実体の無い参照だけが残る)。既定の猶予はそこまで短くしない。
test("liveStagingSessions: 凍結されたタブの数時間の途絶では死んだ扱いにしない", () => {
  const now = Date.now();
  const map = { frozen: { ids: ["p1"], ts: now - 6 * 60 * 60 * 1000 } };
  const res = liveStagingSessions(map, null, now);
  assert.deepEqual(res.live, ["frozen"]);
  assert.deepEqual(res.dead, []);
});

test("orphanPhotoIds: 参照中・確保中のどちらでもない実体だけを返す", () => {
  assert.deepEqual(orphanPhotoIds(["p1", "p2", "p3"], ["p1"], ["p2"]), ["p3"]);
});
