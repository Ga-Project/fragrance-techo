// フレグランス手帖 — 端末内ストレージ。
// ボトルのメタ情報は localStorage(小さい・同期的)、写真の Blob は IndexedDB(大きい・バイナリ)。
// すべてブラウザ内で完結する。ネットワークへは一切送らない。

import type { Fragrance } from "./types";
// 拡張子付きで解決する(node --test の型ストリップから直接 import できるようにする)。
import { normalizeFragrance } from "./model.ts";

/** ボトル一覧の保存キー(タブ間の変更検知にも使う)。 */
export const STORAGE_KEY = "fragrance-techo:v1";
/**
 * 「保存が確定していない写真」の控え。編集中のタブが消えても回収できるようにする。
 *   { セッションid: { ids: 確保中の写真id[], ts: 最後に生存を示した時刻(ms) } }
 */
const STAGING_KEY = "fragrance-techo:photo-staging";
const IDB_NAME = "fragrance-techo";
const IDB_STORE = "photos";

/**
 * ボトル一覧の「読み直し〜書き戻し」を直列化するロックの名前。
 *
 * Web Locks は同一オリジンの全タブ・全ウィンドウ(および Worker)で共有される。
 * STORAGE_KEY を読んで加工して書き戻す経路は、必ずこのロックの中だけで行う。
 * 一部の経路がロックを通らなければ直列化は成立しないため、localStorage への
 * 書き込みは updateFragrances(= このロックの中)に集約している。
 * ※ 配色の保存(fragrance-techo:theme)は読み直しを伴わない単純な上書きなので対象外。
 */
const LOCK_NAME = "fragrance-techo:collection";

/** 写真の控え(STAGING_KEY)の読み直し〜書き戻しを直列化するロックの名前。 */
const STAGING_LOCK_NAME = "fragrance-techo:photo-staging";

/**
 * 編集セッションが生きている間だけ保持するロックの名前。
 *
 * このロックは「そのタブがまだ編集中か」を他のタブから確かめるためだけに取る。
 * リロード・別ページへの移動・タブの終了では、後始末のコードが走らなくても
 * ブラウザがロックを解放する。心拍(時刻)より確実に生死を判定できる。
 */
function photoSessionLockName(session: string): string {
  return `fragrance-techo:photo-session:${session}`;
}

/**
 * 心拍の間隔と、心拍が途絶えたと見なすまでの時間。
 *
 * Web Locks が使えない環境ではロックで生死を判定できないため、時刻で代用する。
 * ただし心拍の途絶は「タブが消えた」ことを意味しない。背面のタブはタイマーが
 * 間引かれるだけでなく、ブラウザの判断で丸ごと凍結される(タイマーが1つも動かない)。
 * 凍結は何時間も続き得るうえ、凍結されたタブと終了したタブを心拍から区別する方法は
 * 無い。短い猶予で「死んだ」と決めると、写真を1枚足したまま背面に置かれた編集画面の
 * 実体を掃除が消してしまう(戻ってきて保存すると、実体の無い参照だけが残る)。
 * 写真はバックアップにも入らず元に戻せないので、猶予は「その長さの凍結から復帰して
 * 続きを編集することは、まず無い」と言える幅まで取る。
 *
 * 代償は、Web Locks が使えない環境でタブが実際に終了したとき、その控えが指す実体の
 * 回収がこの猶予の分だけ遅れること。容量を一時的に食うだけで、いずれ必ず回収される
 * (誤って消せば二度と戻らないのとは釣り合わない)。
 * Web Locks が使える環境では、この時刻ではなくロックの保持で生死を判定する
 * (タブが消えればブラウザが即座に解放するので、猶予そのものが要らない)。
 */
export const STAGING_HEARTBEAT_MS = 30_000;
const STAGING_TTL_MS = 24 * 60 * 60_000;

const isBrowser = () => typeof window !== "undefined";

/**
 * 使える Web Locks を返す(使えなければ null)。
 *
 * Web Locks はセキュアコンテキスト限定で、非対応ブラウザや file:// では
 * navigator.locks 自体が存在しない。存在確認は毎回行う(実行環境を仮定しない)。
 */
function webLocks(): LockManager | null {
  if (!isBrowser()) return null;
  try {
    const locks = (globalThis as { navigator?: Navigator }).navigator?.locks;
    return locks && typeof locks.request === "function" ? locks : null;
  } catch {
    return null;
  }
}

/**
 * ロックを取ってから run を実行する。ロックが使えない環境では素で実行する。
 *
 * ロックが取れないことを理由に書き込み自体を諦めると、非対応ブラウザでは記録が
 * 一切保存できなくなる。直列化を失う方が実害は小さいので、従来どおり実行する。
 * run が走った後の失敗はそのまま呼び出し側へ伝える(握りつぶして二重に実行しない)。
 */
async function withLock<T>(name: string, run: () => T): Promise<T> {
  const locks = webLocks();
  if (!locks) return run();
  let started = false;
  try {
    return await locks.request(name, () => {
      started = true;
      return run();
    });
  } catch (e) {
    if (started) throw e;
    return run();
  }
}

/**
 * 保存されているボトル一覧の読み取り結果。
 *   ok         : 保存されていて読めた(中身が空でも ok)
 *   missing    : まだ一度も保存していない(= どの写真も参照されていないことが確か)
 *   unreadable : 保存の有無すら分からない(サイトデータのブロック・壊れた内容)
 *
 * 「一度も保存していない」と「読めない」を同じ null にまとめると、掃除のように
 * 「読めないなら手を出さない」判断をする側が、前者でも手を出せなくなる。
 * 最初の1本を保存する前に取り込んだ写真は、参照する記録がこの先も現れないのに
 * 起動のたびに見送られ、端末の容量を食い続ける。
 */
export type StoredCollection =
  | { status: "ok"; list: Fragrance[] }
  | { status: "missing" }
  | { status: "unreadable" };

/** 保存値そのものの読み取り結果(JSON として読めたかまで)。 */
type StoredRaw =
  | { status: "ok"; value: unknown }
  | { status: "missing" }
  | { status: "unreadable" };

function readStoredRaw(): StoredRaw {
  if (!isBrowser()) return { status: "unreadable" };
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // サイトデータのブロック等。保存されているかどうかが分からない。
    return { status: "unreadable" };
  }
  // キー自体が無い = このブラウザでまだ一度も保存していない。
  if (raw === null) return { status: "missing" };
  try {
    return { status: "ok", value: JSON.parse(raw) };
  } catch {
    // 中身が壊れている。空だと決めつけない(参照中の写真を消しかねない)。
    return { status: "unreadable" };
  }
}

/**
 * 保存されているボトル一覧を、未保存・読み取り不能と区別して読む(寛容な読み取り)。
 *
 * 項目が欠けていても normalizeFragrance が既定値で埋めて先へ進める。画面は
 * 「一部が壊れていたから何も出さない」より「読めた分を出す」方が実害が小さい。
 *
 * ただしこの寛容さは **何かを消す判断には使えない**。写真の参照(photoIds)が
 * 欠けた記録も空配列に埋められて ok として返るため、これを根拠に掃除をすると
 * 「参照が読めなかっただけの写真」を孤児と見なして永久に消してしまう。
 * 掃除が見るのは readReferencedPhotoIds(下記・厳格)だけにする。
 */
export function readStoredCollection(now: string): StoredCollection {
  const raw = readStoredRaw();
  if (raw.status !== "ok") return raw;
  if (!Array.isArray(raw.value)) return { status: "unreadable" };
  return {
    status: "ok",
    list: raw.value.map((r) => normalizeFragrance(r, now)),
  };
}

/**
 * 参照されている写真 id の読み取り結果(掃除の判断材料)。
 *   ok         : 全ての記録から参照を確かに読み取れた
 *   missing    : まだ一度も保存していない(= どの写真も参照されていないことが確か)
 *   unreadable : 保存の有無が分からない / 参照を読み取れない記録がある
 */
export type ReferencedPhotos =
  | { status: "ok"; ids: string[] }
  | { status: "missing" }
  | { status: "unreadable" };

/**
 * 保存済みの記録が参照している写真 id を、厳格に読む(掃除専用)。
 *
 * 正規化を通さない。normalizeFragrance は photoIds が欠けていても配列でなくても
 * 黙って [] にするため、それを通した一覧は「写真を1枚も参照していない記録」と
 * 「参照を読み落とした記録」を区別できない。掃除はその区別が付かないまま実体を
 * 消すと二度と戻せないので、1件でも読み取れない記録があれば unreadable として
 * 何も消させない(参照が壊れた保存内容は、画面側の寛容な読み取りが従来どおり扱う)。
 */
export function readReferencedPhotoIds(): ReferencedPhotos {
  const raw = readStoredRaw();
  if (raw.status !== "ok") return raw;
  if (!Array.isArray(raw.value)) return { status: "unreadable" };
  const ids: string[] = [];
  for (const record of raw.value) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return { status: "unreadable" };
    }
    const refs = (record as { photoIds?: unknown }).photoIds;
    // 保存経路は必ず string[] を書く(normalizeFragrance が常に付ける)。
    // 欠けている・配列でない・文字列でない要素がある = 参照を読み落としている。
    if (!Array.isArray(refs)) return { status: "unreadable" };
    for (const id of refs) {
      if (typeof id !== "string") return { status: "unreadable" };
      ids.push(id);
    }
  }
  return { status: "ok", ids };
}

/**
 * 保存済みのボトル一覧を読む(壊れていても落ちないよう正規化)。
 *
 * 「保存が無い/読めない」と「保存されていて中身が空」を呼び分け側が区別できるよう、
 * 前者は null を返す。空配列に丸めてしまうと、読めなかっただけの状況を
 * 「利用者が全部手放した」と取り違え、その空配列を基点に書き戻して全消去になる。
 */
export function readFragrances(now: string): Fragrance[] | null {
  const res = readStoredCollection(now);
  return res.status === "ok" ? res.list : null;
}

/** ボトル一覧を読む。未保存・読み取り不能なら空。 */
export function loadFragrances(now: string): Fragrance[] {
  return readFragrances(now) ?? [];
}

/**
 * ボトル一覧を保存し、実際に永続化できたかを返す。
 *
 * localStorage は容量超過・プライベートモード・サイトデータのブロックで setItem が
 * 例外を投げる。ここで握りつぶすと呼び出し側が「保存しました」と表示してしまい、
 * ユーザーはリロードするまで記録が消えたことに気付けない。成否を必ず返す。
 */
export function saveFragrances(list: Fragrance[]): boolean {
  if (!isBrowser()) return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/**
 * 「保存されている最新の一覧」を読み直してから次の状態を作り、書き戻す。
 *
 * localStorage は同じ端末の全タブで共有される。画面が抱えている一覧を基点に
 * 書き戻すと、こちらが読み込んだ後に別タブが追加したボトルを見ないまま同じキーを
 * 上書きし、その追加は復元できないまま消える(バックアップにも入っていない)。
 *
 * 読み直しと setItem は別々の操作である。同期的な JavaScript が止めるのは自分の
 * タブだけで、別のタブは別の実行文脈として同時に動く。ほぼ同時に2つのタブが更新すると
 * 双方が同じ一覧を読み、それぞれ違う結果を作り、後から書いた方が先の書き込みを
 * 丸ごと上書きする(ボトル1本・記録1件が完全に失われる)。順序の保証は「同期だから」では
 * 得られないため、読み直し〜書き戻しを Web Locks で明示的に直列化する。
 *
 * fallback は保存値を基点にできないときの代わり。空配列に落とすと画面上の記録を
 * 全消去してしまうため、その場合は画面が持つ一覧を使う。
 * ロック待ちの間に画面側の一覧は変わりうるので、値ではなく「その時点の一覧を返す関数」で
 * 受け取り、ロックの中で評価する(待っている間に古くなった写しを基点にしない)。
 *
 * produce が受け取った配列をそのまま返したときは「書くことが無い」と見なし、
 * localStorage へは触れない。別タブと衝突して書き込みを取り下げる経路が、
 * 同じ内容の書き戻しで失敗して別の理由(保存エラー)にすり替わるのを防ぐ。
 *
 * 「まだ一度も保存していない(missing)」と「読めない(unreadable)」は分けて扱う。
 * 前者は保存値が存在しないことが確かなので、画面の一覧を基点に書き始めてよい。
 * 後者は保存値が「何であるか」が分からないだけで、消えたわけではない。そこへ
 * 手元の写しを書き込むと、読めなかっただけの保存値を丸ごと置き換えてしまう
 * (起動直後なら画面の一覧は空なので、最初の1操作で全部を失う)。しかもその
 * 保存値が参照していた写真は、置き換えた後は誰からも参照されない実体になり、
 * 次回起動の掃除が孤児として消す。読めないときは書き込み自体を取り下げる。
 */
export type UpdateFailure = "unreadable" | "write-failed";
export type UpdateResult =
  | { ok: true; list: Fragrance[] }
  | { ok: false; reason: UpdateFailure; list: Fragrance[] };

export function updateFragrances(
  produce: (current: Fragrance[]) => Fragrance[],
  fallback: () => Fragrance[],
  now: string,
): Promise<UpdateResult> {
  return withLock(LOCK_NAME, () => {
    const stored = readStoredCollection(now);
    const current = stored.status === "ok" ? stored.list : fallback();
    const next = produce(current);
    // 書くことが無いなら、読めない状態でも取り下げる必要はない(何も壊さない)。
    if (next === current) return { ok: true, list: current };
    if (stored.status === "unreadable") {
      return { ok: false, reason: "unreadable", list: current };
    }
    if (!saveFragrances(next)) {
      return { ok: false, reason: "write-failed", list: fallback() };
    }
    return { ok: true, list: next };
  });
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser() || !("indexedDB" in window)) {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const req = window.indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export async function putPhoto(id: string, blob: Blob): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getPhoto(id: string): Promise<Blob | null> {
  const db = await openDB();
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(id);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return blob;
}

export async function deletePhoto(id: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // 削除失敗は致命的でない(回収し損ねた実体は次回起動の掃除が拾う)。
  }
}

/** IndexedDB に実在する写真 id の一覧。読めない環境では空(= 何も消さない)。 */
export async function listPhotoIds(): Promise<string[]> {
  try {
    const db = await openDB();
    const keys = await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).getAllKeys();
      req.onsuccess = () =>
        resolve(
          (req.result as IDBValidKey[]).filter(
            (k): k is string => typeof k === "string",
          ),
        );
      req.onerror = () => reject(req.error);
    });
    db.close();
    return keys;
  } catch {
    return [];
  }
}

/* ---- 未保存の写真の控え(孤児の回収) ------------------------------------
 *
 * 写真の実体(Blob)は取り込んだ瞬間に IndexedDB へ書かれるが、その id がボトルの
 * メタ情報に載るのは保存が確定したときだけ。編集をやめれば当のフォームが実体を消す。
 * ところが、リロード・別ページへの移動・タブの終了はフォームの後始末を通らないため、
 * 唯一の手掛かり(画面が抱えていた id の一覧)ごと消える。実体は誰からも参照されず
 * 誰にも消せないまま IndexedDB の容量を食い続け、やがて新しい写真が保存できなくなる。
 *
 * そこで二段構えにする。
 *   ① 実体を書く前に id を端末(localStorage)へ控える。控えは端末に残るので、
 *      タブが不意に消えても次回の起動で在処が分かる。
 *   ② 起動時に「保存済みのボトルから参照されていない実体」をまとめて回収する。
 *      控えの取りこぼしや、以前の版が残した孤児もここで拾える。
 *
 * ②が編集中のタブの写真まで消さないよう、生きているセッションが確保中の id は
 * 回収対象から外す。生死の判定は Web Locks の保持状況(タブが消えれば自動で解放
 * される)を第一とし、使えない環境では心拍の新しさで代用する。
 */

/** 確保中の写真: セッションid → { 写真id[], 最後に生存を示した時刻(ms) }。 */
export type PhotoStaging = Record<string, { ids: string[]; ts: number }>;

/**
 * 控えの読み取り結果。
 *
 * 一覧と同じ理由で「控えが無い」と「控えを読めなかった」を区別する。控えは
 * 「まだ参照されていないが消してはいけない写真」の唯一の手掛かりなので、
 * 読めなかったことを「何も確保されていない」と取り違えると、いま編集中の
 * セッションが抱えている実体を孤児と見なして消してしまう。
 * 一部のセッションだけが壊れている場合も、失われたのが「守るべき id」である以上
 * 全体を読めなかったものとして扱う。
 */
type StagingRead = { status: "ok" | "unreadable"; map: PhotoStaging };

function readStagingResult(): StagingRead {
  if (!isBrowser()) return { status: "unreadable", map: {} };
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STAGING_KEY);
  } catch {
    return { status: "unreadable", map: {} };
  }
  // キーが無い = 確保中の写真は無い(読めなかったのではない)。
  if (raw === null) return { status: "ok", map: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { status: "unreadable", map: {} };
    }
    const out: PhotoStaging = {};
    let damaged = false;
    for (const [session, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      const entry = (value ?? {}) as { ids?: unknown; ts?: unknown };
      const rawIds = Array.isArray(entry.ids) ? entry.ids : null;
      const ids =
        rawIds?.filter((x): x is string => typeof x === "string") ?? [];
      // 控えは必ず1件以上の id を伴って書かれる(空になれば項目ごと消える)。
      // 読めない・欠けたのに素通しすると、その id を守れないまま掃除が走る。
      if (rawIds === null || ids.length === 0 || ids.length !== rawIds.length) {
        damaged = true;
        continue;
      }
      const ts =
        typeof entry.ts === "number" && Number.isFinite(entry.ts)
          ? entry.ts
          : 0;
      out[session] = { ids, ts };
    }
    return { status: damaged ? "unreadable" : "ok", map: out };
  } catch {
    return { status: "unreadable", map: {} };
  }
}

function writeStaging(map: PhotoStaging): void {
  if (!isBrowser()) return;
  try {
    if (Object.keys(map).length === 0) {
      window.localStorage.removeItem(STAGING_KEY);
      return;
    }
    window.localStorage.setItem(STAGING_KEY, JSON.stringify(map));
  } catch {
    // 控えを残せない環境(容量超過・サイトデータのブロック)。記録の保存自体も
    // できない状態なので、写真の取り込みだけを止めても利用者の得にならない。
  }
}

/**
 * 控えを読み直して書き戻す(タブ間で直列化する)。
 * 失敗しても呼び出し側の操作は止めない。控えは保護のための補助であって、
 * ここで例外を投げると写真の取り込みそのものが失敗したように見えてしまう。
 *
 * 読めない控えには書き戻さない。読めた分だけを基点にすると、読み落とした項目が
 * 守っていた id ごと消え、その実体を次の掃除が「誰も確保していない」と見なして
 * 消してしまう(写真は元に戻せない)。掃除は控えが読めない間は何も消さないので、
 * ここで書き戻さないほうが安全側に倒れる(実体が残り続けるだけで、失われない)。
 */
async function updateStaging(
  produce: (current: PhotoStaging) => PhotoStaging,
): Promise<void> {
  try {
    await withLock(STAGING_LOCK_NAME, () => {
      const current = readStagingResult();
      if (current.status !== "ok") return;
      writeStaging(produce(current.map));
    });
  } catch {
    /* 控えられないだけ。取り込み・保存は続行する。 */
  }
}

/** 実体を書く前に「このセッションが確保中」として控える。 */
export function stagePhoto(session: string, id: string): Promise<void> {
  return updateStaging((cur) => {
    const ids = cur[session]?.ids ?? [];
    return {
      ...cur,
      [session]: {
        ids: ids.includes(id) ? ids : [...ids, id],
        ts: Date.now(),
      },
    };
  });
}

/** セッションが生きていることを示す(Web Locks が使えない環境の生死判定用)。 */
export function keepStagingAlive(session: string): Promise<void> {
  return updateStaging((cur) => {
    const entry = cur[session];
    if (!entry) return cur;
    return { ...cur, [session]: { ids: entry.ids, ts: Date.now() } };
  });
}

/** 確保を解く(保存が確定した / 実体を自分で消した)。 */
export function unstagePhotos(session: string): Promise<void> {
  return updateStaging((cur) => {
    if (!(session in cur)) return cur;
    const next = { ...cur };
    delete next[session];
    return next;
  });
}

/**
 * 編集セッションの生死を判定する(純関数)。
 *   heldLocks が分かる環境 → ロックを保持しているセッションだけが生きている
 *   分からない環境         → 心拍が新しいセッションだけが生きている
 * 時計が進んだ端末で控えの時刻が未来になっても「生きている」側に倒す。
 * 判定を誤って死んだ扱いにすると、編集中の写真の実体を消してしまう。
 */
export function liveStagingSessions(
  map: PhotoStaging,
  heldLocks: Set<string> | null,
  nowMs: number,
  ttlMs: number = STAGING_TTL_MS,
): { live: string[]; dead: string[] } {
  const live: string[] = [];
  const dead: string[] = [];
  for (const [session, entry] of Object.entries(map)) {
    const alive =
      heldLocks !== null
        ? heldLocks.has(photoSessionLockName(session))
        : nowMs - entry.ts < ttlMs;
    (alive ? live : dead).push(session);
  }
  return { live, dead };
}

/** 回収してよい写真 id(純関数)。参照中・確保中のどちらでもないものだけ。 */
export function orphanPhotoIds(
  stored: string[],
  referenced: string[],
  staged: string[],
): string[] {
  const keep = new Set([...referenced, ...staged]);
  return stored.filter((id) => !keep.has(id));
}

/**
 * このタブが編集中であることを、フォームが開いている間だけロックで示す。
 * 返り値を呼ぶと解放する(タブごと消えた場合はブラウザが解放する)。
 */
export function holdPhotoSession(session: string): () => void {
  const locks = webLocks();
  if (!locks) return () => {};
  let release: (() => void) | null = null;
  let released = false;
  try {
    void locks
      .request(
        photoSessionLockName(session),
        () =>
          new Promise<void>((resolve) => {
            if (released) resolve();
            else release = resolve;
          }),
      )
      .catch(() => {});
  } catch {
    return () => {};
  }
  return () => {
    released = true;
    release?.();
    release = null;
  };
}

/** いま同一オリジンで保持されているロック名。分からなければ null。 */
async function heldLockNames(): Promise<Set<string> | null> {
  const locks = webLocks();
  if (!locks || typeof locks.query !== "function") return null;
  try {
    const snapshot = await locks.query();
    const names = new Set<string>();
    for (const info of snapshot.held ?? []) {
      if (info.name) names.add(info.name);
    }
    return names;
  } catch {
    return null;
  }
}

/**
 * どのボトルからも参照されていない写真の実体を回収する。回収した件数を返す。
 *
 * 起動時に一度だけ呼ぶ。写真は書き出したバックアップにも入らないため、
 * 一枚でも取り違えて消せば元に戻せない。判断の材料は次の順で読む。
 *
 *   ① 実体(IndexedDB) → ② 控え(未保存の写真) → ③ ボトル一覧(参照されている写真)
 *
 * 書き手は逆順に進む(控える → 実体を書く → 一覧に載せる → 控えを解く)。
 * 読み手が逆から読めば、どの瞬間に割り込まれても「控えにも一覧にも無い実体」を
 * 観測しない。順序を守らず一覧を最初に読むと、その後に別タブが保存を確定させた
 * 写真が、一覧には載っているのにこちらの写しには無く、控えも既に解かれているため
 * 孤児と判定されて消える。
 *
 * さらに、③の読み直しから削除までを一覧の書き戻しと同じロックの中で行う。
 * 読んでから消すまでの隙に保存が確定すると、いま参照されたばかりの実体を消すことになる。
 * ロックを握るのは実体が1件でもあるときだけで、握る時間も一覧の読み直しと
 * 回収した実体の削除の分に限る(起動のたびに他のタブの保存を長く待たせない)。
 *
 * 保存の有無すら分からないとき(サイトデータのブロック・壊れた内容)、および
 * 参照を読み取れない記録が1件でもあるときは何も消さない。読めないことを
 * 「1本も持っていない」と取り違えると、全ての写真を消してしまう。
 * まだ一度も保存していないときは、参照している記録が存在しないことが確かなので、
 * 通常どおり回収する(最初の1本を保存する前に取り込んだ写真も取り残さない)。
 */
export async function sweepOrphanPhotos(): Promise<number> {
  try {
    const stored = await listPhotoIds();
    const staging = readStagingResult();
    const { live, dead } = liveStagingSessions(
      staging.map,
      await heldLockNames(),
      Date.now(),
    );
    const staged = live.flatMap((session) => staging.map[session]?.ids ?? []);

    // 控えが読めないときは「守るべき写真」が分からない。実体には手を付けない。
    const canDelete = staging.status === "ok" && stored.length > 0;
    const removed = canDelete
      ? await withLock(LOCK_NAME, async () => {
          const collection = readReferencedPhotoIds();
          if (collection.status === "unreadable") return 0;
          const referenced = collection.status === "ok" ? collection.ids : []; // missing = まだ一本も保存していない
          const orphans = orphanPhotoIds(stored, referenced, staged);
          for (const id of orphans) await deletePhoto(id);
          return orphans.length;
        })
      : 0;

    // 控えが読めなかったときは書き戻しもしない。読めた分だけを書き戻すと、
    // 読めなかった項目が守っていた id ごと消えてしまう(次の掃除がその実体を
    // 「誰も確保していない」と見なす)。
    if (staging.status === "ok" && dead.length > 0) {
      // 判定に使った時刻と変わっていない控えだけを片付ける(この間に息を吹き返した
      // セッションの控えを消さない)。実体を消せたかどうかとは独立に片付けてよい
      // (死んだセッションは死んだまま。残った実体は次回以降この掃除が拾う)。
      await updateStaging((cur) => {
        const next = { ...cur };
        for (const session of dead) {
          if (next[session]?.ts === staging.map[session]?.ts) {
            delete next[session];
          }
        }
        return next;
      });
    }
    return removed;
  } catch {
    return 0;
  }
}
