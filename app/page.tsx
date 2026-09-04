"use client";

// フレグランス手帖 — メイン画面。すべて端末内(localStorage + IndexedDB)で完結する。
// デザイン世界観「Sillage — 調香卓の液面アポセカリ」。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DeleteResult,
  Fragrance,
  FamilyId,
  SaveResult,
} from "../lib/types";
import { FAMILIES } from "../lib/families";
import {
  STORAGE_KEY,
  loadFragrances,
  sweepOrphanPhotos,
  updateFragrances,
} from "../lib/db";
import {
  emptyDraft,
  mergeFragranceEdit,
  normalizeFragrance,
} from "../lib/model";
import { serializeBackup, parseBackup } from "../lib/backup";
import { ML_PER_SPRAY, daysUntilEmpty, todaysPick } from "../lib/suggest";
import { toISODate } from "../lib/format";
import { Icon, SpectrumRibbon } from "../components/visuals";
import { VialCard } from "../components/VialCard";
import { TodaysPick } from "../components/TodaysPick";
import { BottleForm } from "../components/BottleForm";
import { DetailSheet } from "../components/DetailSheet";
import { ConfirmDialog } from "../components/ConfirmDialog";

type ThemeMode = "light" | "dark";
/** 利用者が選んだ配色。null = まだ選んでいない(OS の設定に従う)。 */
type ThemeChoice = ThemeMode | null;

/** 「つけた」の書き込み結果。書けなかったときは理由まで伝える。 */
type WearOutcome = "written" | "gone" | "empty";

const THEME_KEY = "fragrance-techo:theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

// 「適用」と「保存」を分ける。OS の配色から導いただけの初期値まで保存すると、
// 以後は利用者が一度も切り替えていないのに保存値が優先され、OS をダークにしても
// ライトのまま戻らなくなる（= CSS の prefers-color-scheme フォールバックへ二度と
// 戻れない）。保存するのは切替ボタンを押したときだけ。
//
// 同じ理由で、選んでいないときは data-theme を「付けない」。globals.css の
// :root[data-theme="light"] / [data-theme="dark"] は @media (prefers-color-scheme)
// のフォールバックより後に置かれていて必ず勝つため、OS 由来の値を属性として
// 書き込んだ時点で配色は固定される。PWA も含めて画面は開いたまま使われるので、
// その後に OS の配色が切り替わっても古いほうのまま戻らなくなる。
// 属性を付けなければ、OS の切り替えには CSS がそのまま追随する。
function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === null) root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

function rememberTheme(mode: ThemeMode) {
  try {
    window.localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* ignore */
  }
}

// サイトデータがブロックされている環境では getItem すら SecurityError を投げる。
// ここは初期化 effect の途中で走るため、素通しすると ready にたどり着けず画面が
// 「ひらいています…」のまま固まる。読めないときは「選んでいない」扱いにする。
function readThemeChoice(): ThemeChoice {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* 保存済みの選択は読めない。OS の設定に従う。 */
  }
  return null;
}

/** OS が指定している配色。分からなければライト。 */
function systemTheme(): ThemeMode {
  try {
    const mq = window.matchMedia?.(DARK_QUERY);
    return mq?.matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

// 別タブ(または別ウィンドウ)が先にそのボトルを手放していたときの案内。
// 「保存できませんでした・空き容量をご確認ください」と同じ文言で出すと、直しようのない
// 案内になる(容量の問題ではない)。何が起きたのかと、次にできることを書く。
const GONE_ON_SAVE =
  "このボトルは別のタブで手放されました。復活させないため、この編集は保存していません。残したい内容は控えたうえで、あらためて迎え直してください。";
const GONE_ON_WEAR =
  "このボトルは別のタブで手放されたため、今日の記録を付けられませんでした。";
const EMPTY_ON_WEAR =
  "このボトルは空です。残量を入れ直してから記録してください。";
const SAVE_FAILED =
  "保存できませんでした。端末の空き容量、またはブラウザのサイトデータ設定をご確認ください（このまま閉じると記録は残りません）。";
// 保存されている記録を読み取れないときは、上書きすると元の内容が失われる。
// 「空き容量をご確認ください」と案内しても直しようがないので、何が起きたのかを伝える。
const UNREADABLE_ON_SAVE =
  "この端末に保存されている記録を読み取れませんでした。上書きすると元の記録が失われるため、この変更は保存していません。ブラウザのサイトデータ設定をご確認のうえ、ページを開き直してからお試しください。";

/** 「いま」の日付(ローカル)。記録の書き込み時は必ずこれを読み直す。 */
function currentISODate(): string {
  return toISODate(new Date());
}

// PWA は開きっぱなしで日付をまたぐ。マウント時に一度読むだけだと、翌日に「つけた」を
// 押しても昨日の日付が記録され、季節・提案・使い切り予測も昨日のまま止まる。
// 0時ちょうどのタイマーに加えて、復帰(可視化/フォーカス)のたびに読み直す
// (端末スリープ中はタイマーが遅れて発火するため、タイマーだけでは足りない)。
function useToday(): string {
  const [today, setToday] = useState("");
  useEffect(() => {
    let timer = 0;

    function scheduleMidnight() {
      window.clearTimeout(timer);
      const now = new Date();
      const next = new Date(now);
      next.setHours(24, 0, 0, 500); // 翌日0時の直後
      timer = window.setTimeout(
        sync,
        Math.max(1000, next.getTime() - now.getTime()),
      );
    }

    function sync() {
      const iso = currentISODate();
      setToday((prev) => (prev === iso ? prev : iso));
      scheduleMidnight();
    }

    function onVisible() {
      if (document.visibilityState === "visible") sync();
    }

    sync();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", sync);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", sync);
    };
  }, []);
  return today;
}

export default function Home() {
  const [ready, setReady] = useState(false);
  const today = useToday();
  const [list, setList] = useState<Fragrance[]>([]);
  // 保存は非同期経路（FileReader の onload など）からも走る。描画時に閉じ込めた list を
  // 元に次の状態を作ると、読み込み待ちの間に入った「つけた」/編集/別の取り込みを
  // まとめて巻き戻してしまう。次の状態は必ず ref が持つ最新のコレクションから作る。
  const listRef = useRef<Fragrance[]>([]);
  const [filter, setFilter] = useState<FamilyId | null>(null);
  const [editing, setEditing] = useState<{
    f: Fragrance;
    isNew: boolean;
  } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  // 配色は「利用者の選択」と「OS の設定」を別々に持つ。切替ボタンの表示は
  // 実際に見えている配色(= 選択 ?? OS)に合わせる必要があり、OS の設定は
  // 開いている間にも変わるため、片方だけでは表示がずれる。
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(null);
  const [systemMode, setSystemMode] = useState<ThemeMode>("light");
  const theme: ThemeMode = themeChoice ?? systemMode;
  // 通知は成功(status)と失敗(alert)を区別する。失敗を成功と同じ見た目で出すと、
  // 保存できていないことが伝わらない。
  const [notice, setNotice] = useState<{
    text: string;
    tone: "ok" | "error";
  } | null>(null);

  const importInputRef = useRef<HTMLInputElement>(null);
  // 取り込みは「置き換わる」ことを伝えてから実行する(押した瞬間に元へ戻せない)。
  const [pendingImport, setPendingImport] = useState<Fragrance[] | null>(null);
  // 書き込み中のボトル(「つけた」)。押した瞬間に印を付け、確定するまで受け付けない。
  const [wearing, setWearing] = useState<string[]>([]);
  // 表示用の wearing は再描画されるまで更新されない。連打の2回目が同じ描画の中で
  // 走っても弾けるよう、多重発火の判断は ref の「いま」の値で行う。
  const wearingRef = useRef<Set<string>>(new Set());
  // 取り込みの確定も同じ理由で ref で守る(同じ内容の取り込みが二重に走らないように)。
  const importingRef = useRef(false);

  // 初期ロード(クライアントのみ)。
  useEffect(() => {
    const loaded = loadFragrances(currentISODate());
    listRef.current = loaded;
    setList(loaded);
    const choice = readThemeChoice();
    setThemeChoice(choice);
    setSystemMode(systemTheme());
    // 選択があれば適用し、無ければ属性を外して OS の設定に委ねる(保存もしない)。
    applyTheme(choice);
    setReady(true);
    // どのボトルからも参照されていない写真の実体を回収する。編集の途中で
    // リロード・タブの終了が起きるとフォームの後始末が走らず、実体だけが
    // IndexedDB に取り残される(容量を食い続け、やがて取り込めなくなる)。
    // 編集中の別タブが確保している写真と、一覧が読めないときは対象外
    // (詳細は lib/db.ts の sweepOrphanPhotos)。
    void sweepOrphanPhotos();
  }, []);

  // localStorage は同じ端末の全タブで共有される。別タブの書き換えに追随しないと、
  // こちらの画面は古い一覧を映したままになり、そこからの操作(手放す・編集)が
  // 「別タブの追加が消えた」ように見える。書き込み自体は保存直前に読み直すので
  // 失われないが、見えている一覧も実体に合わせる。
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.storageArea && e.storageArea !== window.localStorage) return;
      // key === null はサイトデータの一括消去(clear)。両方を読み直す。
      if (e.key === null || e.key === STORAGE_KEY) {
        const fresh = loadFragrances(currentISODate());
        listRef.current = fresh;
        setList(fresh);
      }
      if (e.key === null || e.key === THEME_KEY) {
        const choice = readThemeChoice();
        setThemeChoice(choice);
        applyTheme(choice);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // OS の配色は、この画面を開いたままでも切り替わる(PWA として入れた場合は特に、
  // 何日も開きっぱなしになる)。選択が無いときの配色そのものは data-theme を
  // 付けないことで CSS が追随するが、切替ボタンの表示は state を更新しないと
  // 古いままになる。変更を購読して追いかける。
  useEffect(() => {
    let mq: MediaQueryList | undefined;
    try {
      mq = window.matchMedia?.(DARK_QUERY);
    } catch {
      return;
    }
    if (!mq) return;
    const target = mq;
    const onChange = () => setSystemMode(target.matches ? "dark" : "light");
    onChange(); // 初期化 effect との間に切り替わっていても取りこぼさない
    // 旧 Safari は addEventListener を持たず addListener だけを持つ。
    if (typeof target.addEventListener === "function") {
      target.addEventListener("change", onChange);
      return () => target.removeEventListener("change", onChange);
    }
    if (typeof target.addListener === "function") {
      target.addListener(onChange);
      return () => target.removeListener(onChange);
    }
  }, []);

  const say = useCallback(
    (text: string) => setNotice({ text, tone: "ok" as const }),
    [],
  );
  const warn = useCallback(
    (text: string) => setNotice({ text, tone: "error" as const }),
    [],
  );

  // 永続化に失敗したら「保存できた」ことにしない。失敗を必ず知らせて、呼び出し側には
  // 成功時だけ完了メッセージを出させる。
  //
  // 画面の状態(list)を書き換えるのは保存が確定してから。先に反映すると、保存できていない
  // 下書きがコレクションに載ったままになる。たとえば新規登録が失敗し(フォームは開いたまま)、
  // そのまま「やめる」を押すと、フォームはこの編集で取り込んだ写真の実体を消すのに
  // 下書きだけが list に残り、次に別の操作でたまたま保存が成功した時点で、
  // 取り消したはずのボトルが「存在しない写真を指した状態」で永続化されてしまう。
  // 入力そのものはフォームが自前の state で保持しているため、ここで反映しなくても失われない。
  //
  // 次の状態は「配列」ではなく「最新のコレクションを受け取って次を返す関数」で渡す。
  // こうしておくと、呼び出し側が古い list を閉じ込めたまま全体を上書きする書き方が
  // そもそもできない（非同期経路からの保存で他の操作を巻き戻す事故を構造的に防ぐ）。
  //
  // 「最新のコレクション」は画面が抱えている list ではなく、保存されている実体
  // (localStorage)を読み直したもの。同じ端末の別タブが後から追加したボトルは
  // この画面の list には載っていないため、list を基点に書き戻すとその追加を
  // 見ないまま同じキーを上書きして消してしまう(写真と違いバックアップにも無い)。
  //
  // 読み直し〜書き戻しは updateFragrances がタブ間ロックで直列化する(そのぶん非同期)。
  // 保存の完了を待ってから画面と通知を更新する。
  const persist = useCallback(
    async (
      produce: (current: Fragrance[]) => Fragrance[],
    ): Promise<boolean> => {
      const res = await updateFragrances(
        produce,
        () => listRef.current,
        currentISODate(),
      );
      if (!res.ok) {
        warn(res.reason === "unreadable" ? UNREADABLE_ON_SAVE : SAVE_FAILED);
        return false;
      }
      listRef.current = res.list;
      setList(res.list);
      return true;
    },
    [warn],
  );

  useEffect(() => {
    if (!notice) return;
    // 失敗は読み切れるよう長めに出す。
    const ms = notice.tone === "error" ? 7000 : 3200;
    const id = window.setTimeout(() => setNotice(null), ms);
    return () => window.clearTimeout(id);
  }, [notice]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of list) c[f.family] = (c[f.family] ?? 0) + 1;
    return c;
  }, [list]);

  const visible = useMemo(() => {
    const filtered = filter ? list.filter((f) => f.family === filter) : list;
    return [...filtered].sort((a, b) => {
      const ea = a.remainingPct <= 0 ? 1 : 0;
      const eb = b.remainingPct <= 0 ? 1 : 0;
      if (ea !== eb) return ea - eb; // 空は末尾
      const da = daysUntilEmpty(a, today) ?? Number.POSITIVE_INFINITY;
      const db = daysUntilEmpty(b, today) ?? Number.POSITIVE_INFINITY;
      return da - db; // 早く空になる順
    });
  }, [list, filter, today]);

  const pick = useMemo(
    () => (today ? todaysPick(list, today) : null),
    [list, today],
  );
  const detail = detailId
    ? (list.find((f) => f.id === detailId) ?? null)
    : null;

  function openNew() {
    setEditing({ f: emptyDraft(currentISODate()), isNew: true });
  }
  function openEdit(id: string) {
    const f = listRef.current.find((x) => x.id === id);
    if (f) setEditing({ f, isNew: false });
  }

  // 保存できたかを返す。フォーム側は成功したときだけ写真の実体削除を確定させる。
  // 失敗時はフォームを開いたままにする。閉じてしまうと、この編集で取り込み済みの
  // 写真の実体だけが IndexedDB に残り、参照するメタ情報が無い孤児になる。
  async function save(input: Fragrance): Promise<SaveResult> {
    // 数値入力の空欄で NaN が混ざらないよう保存経路で正規化する。
    const f = normalizeFragrance(input, currentISODate());
    // 編集を開いた時点のボトル。保存時に「フォームで変わった項目」だけを反映する
    // ための基準にする。コレクション全体を読み直しても、同じボトルを丸ごと
    // 差し替えてしまえば、開いている間に別タブが同じボトルへ書いた内容
    // (「つけた」の履歴・減った残量)は古い写しで上書きされて消える。
    const base = editing && !editing.isNew ? editing.f : null;
    let exists = false;
    let gone = false;
    const ok = await persist((cur) => {
      const stored = cur.find((x) => x.id === f.id);
      exists = stored !== undefined;
      if (!stored) {
        // 既存ボトルの編集なのに保存先から消えている = 開いている間に別タブが手放した。
        // ここで追加すると、手放したはずのボトルが古い下書きのまま復活する。しかも
        // 手放した側は写真の実体(IndexedDB)まで消しているため、復活した記録は
        // 存在しない写真を指す。追加ではなく衝突として扱い、何も書かずに取り下げる。
        if (base) {
          gone = true;
          return cur; // 同一参照 = 書き込み自体を行わない
        }
        return [...cur, f];
      }
      const merged = base ? mergeFragranceEdit(base, f, stored) : f;
      return cur.map((x) => (x.id === f.id ? merged : x));
    });
    if (!ok) return { ok: false }; // 失敗通知は persist が出す(成功メッセージで上書きしない)
    // 取り下げた場合もフォームは閉じない(入力と取り込み済みの写真を抱えたまま消さない)。
    if (gone) return { ok: false, message: GONE_ON_SAVE };
    setEditing(null);
    say(exists ? "保存しました" : `「${f.name || "無名"}」を棚に加えました`);
    return { ok: true };
  }

  // 削除も同様に、確定できたときだけ閉じる。
  //
  // 消える記録が参照していた写真は、フォームが持つ写し(編集を開いた時点)ではなく
  // 「消す瞬間に保存されている実体」から拾ってフォームへ返す。開いている間に別タブが
  // 同じボトルへ足した写真は写しに載っておらず、フォーム側の回収対象に入らないため、
  // 実体だけが IndexedDB に残って誰からも辿れなくなる。
  async function remove(id: string): Promise<DeleteResult> {
    let storedPhotoIds: string[] = [];
    const ok = await persist((cur) => {
      storedPhotoIds = cur.find((f) => f.id === id)?.photoIds ?? [];
      return cur.filter((f) => f.id !== id);
    });
    if (!ok) return { ok: false };
    setEditing(null);
    setDetailId(null);
    say("手放しました");
    return { ok: true, photoIds: storedPhotoIds };
  }

  function markWearing(id: string, on: boolean) {
    if (on) wearingRef.current.add(id);
    else wearingRef.current.delete(id);
    setWearing([...wearingRef.current]);
  }

  // 画面に映っているボトルは、押した瞬間には既に別タブで手放されている / 空になって
  // いることがある。書けなかったのに「記録しました」と出すと、記録が付いたと信じた
  // まま何度も押すことになる。書けなかった理由は理由として伝える。
  //
  // 書き込みは保存済みの一覧を読み直してから積むため、ロックの順番待ちを挟む。
  // その間に同じボトルの「つけた」をもう一度押せてしまうと、2回目は1回目の結果を
  // 読んでから同じ日付をもう1件足し、残量もさらに1回分減る(誤タップの1回で
  // 2回つけたことになる)。確定するまでそのボトルの操作は受け付けない。
  // 押せなくするのはそのボトルだけで、確定後は同じ日にもう一度つけた記録を残せる。
  async function wear(id: string) {
    if (wearingRef.current.has(id)) return;
    markWearing(id, true);
    try {
      await writeWear(id);
    } finally {
      markWearing(id, false);
    }
  }

  async function writeWear(id: string) {
    // 日付は押した瞬間に読み直す(日をまたいで開いたままでも昨日の日付を書かない)。
    const now = currentISODate();
    // 代入は persist に渡す関数の中で起きる。型注釈だけだと初期値の型に狭められて
    // しまうため、union のまま保持する。
    let outcome = "written" as WearOutcome;
    const ok = await persist((cur) => {
      const target = cur.find((f) => f.id === id);
      if (!target) {
        outcome = "gone";
        return cur; // 同一参照 = 書き込み自体を行わない
      }
      if (target.remainingPct <= 0) {
        outcome = "empty";
        return cur;
      }
      const usedPct =
        (target.sprayPerUse * ML_PER_SPRAY * 100) /
        Math.max(1, target.volumeMl);
      const updated: Fragrance = {
        ...target,
        remainingPct: Math.max(0, target.remainingPct - usedPct),
        wearLog: [...target.wearLog, now],
        updatedAt: now,
      };
      return cur.map((f) => (f.id === id ? updated : f));
    });
    if (!ok) return; // 失敗通知は persist が出す
    if (outcome === "gone") {
      warn(GONE_ON_WEAR);
      return;
    }
    if (outcome === "empty") {
      warn(EMPTY_ON_WEAR);
      return;
    }
    say("今日の香りを記録しました");
  }

  // バックアップは「画面に映っている一覧」ではなく「保存されている実体」を書き出す。
  //
  // 画面の list が実体と一致しているとは限らない。別タブの保存を知らせる storage
  // イベントは非同期で届くし、こちらのタブの「つけた」/編集も、コレクションのロック待ちの
  // 間はまだ list に反映されていない。その list を直列化すると、直前に増えたボトルや
  // 使用記録を含まないファイルを「書き出しました」と言って渡すことになる
  // (利用者はそれを唯一の控えとして保管する。欠けに気付けるのは復元したときだけ)。
  //
  // 読み直しは persist(= updateFragrances)経由で行い、コレクションのロックの中で
  // 実体を読む。保留中の書き込みがあれば、その完了を待ってから読むことになる。
  // 受け取った一覧をそのまま返すので、書き込みは発生しない。
  async function exportBackup() {
    let snapshot: Fragrance[] = [];
    const ok = await persist((cur) => {
      snapshot = cur;
      return cur; // 同一参照 = 読み直すだけで書き戻さない
    });
    if (!ok) return; // 失敗通知は persist が出す
    if (snapshot.length === 0) {
      warn(
        "書き出せる記録がありません（別のタブで全て手放された可能性があります）。",
      );
      return;
    }
    const text = serializeBackup(snapshot, new Date().toISOString());
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fragrance-techo-${currentISODate()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    say("バックアップを書き出しました");
  }

  function importBackup(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = parseBackup(
        String(reader.result ?? ""),
        new Date().toISOString(),
      );
      if (!res.ok) {
        warn(`取り込めませんでした: ${res.error}`);
        return;
      }
      // 取り込みは同じ id のボトルを丸ごと置き換える(残量も使用履歴も戻せない)。
      // ファイルを選んだだけで実行せず、何が起きるかを見せてから確定させる。
      setPendingImport(res.fragrances);
    };
    reader.onerror = () => warn("ファイルを読み込めませんでした");
    reader.readAsText(file);
  }

  async function applyImport(fragrances: Fragrance[]) {
    // バックアップ JSON は写真を持たない(メタ情報だけの形式で、photoIds は必ず空)。
    // したがって取り込みでは写真の参照を一切動かさない。
    //   手元にもあるボトル       → 写真の参照は手元のものをそのまま残す
    //   ファイルにしか無いボトル → 参照は空(実体がどこにも無いので当然)
    //
    // ファイル側の photoIds を採ると、実体の無い参照を持ったボトルができるうえ、
    // 置き換わる前の参照が指していた実体が誰からも辿れなくなる。手元の参照を必ず
    // 残すことで、この経路で写真が消えることも孤児が生まれることも構造的に起きない
    // (取り込みが実体を回収する必要もない)。ファイル側の空でない photoIds は
    // parseBackup が受け付けないが、ここでも参照は手元のものだけを使う。
    //
    // 突き合わせ相手は「ファイルを選んだ時点」ではなく「保存する時点」の最新の
    // コレクション。読み込み待ちや確認ダイアログの間に押された「つけた」や別タブの
    // 追加を巻き戻さないため、マージは persist に渡す関数の中で行う。
    if (importingRef.current) return;
    importingRef.current = true;
    try {
      const ok = await persist((cur) => {
        const byId = new Map(cur.map((f) => [f.id, f]));
        for (const f of fragrances) {
          const current = byId.get(f.id);
          byId.set(f.id, { ...f, photoIds: current ? current.photoIds : [] });
        }
        return [...byId.values()];
      });
      if (ok) say(`${fragrances.length} 件を取り込みました`);
    } finally {
      importingRef.current = false;
    }
  }

  return (
    <>
      <a href="#main" className="skip-link">
        本文へスキップ
      </a>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <span className="brand-drop" />
            </span>
            <span className="brand-text">
              <span className="brand-name">Sillage</span>
              <span className="brand-sub">フレグランス手帖</span>
            </span>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              onClick={() => {
                const next: ThemeMode = theme === "dark" ? "light" : "dark";
                setThemeChoice(next);
                applyTheme(next);
                // 明示的な切替だけを保存する（次回以降はこの選択を優先）。
                rememberTheme(next);
              }}
              aria-label={
                theme === "dark" ? "ライトモードへ" : "ダークモードへ"
              }
            >
              {theme === "dark" ? <Icon.sun /> : <Icon.moon />}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              onClick={() => void exportBackup()}
              aria-label="バックアップを書き出す"
              disabled={list.length === 0}
            >
              <Icon.download />
            </button>
            {/* ファイル選択は <label> ではなくボタンから開く。
                label は Tab で到達できず、中の input は hidden でフォーカスも
                受けないため、キーボードのみの利用者が取り込みを実行できない。 */}
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              aria-label="バックアップを取り込む"
              onClick={() => importInputRef.current?.click()}
            >
              <Icon.upload />
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              hidden
              tabIndex={-1}
              onChange={(e) => {
                importBackup(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="btn btn--primary"
              onClick={openNew}
            >
              <Icon.plus size={18} /> 迎える
            </button>
          </div>
        </header>

        {notice && (
          <div
            className={`notice${notice.tone === "error" ? " notice--error" : ""}`}
            role={notice.tone === "error" ? "alert" : "status"}
          >
            {notice.text}
          </div>
        )}

        <main className="main" id="main">
          {!ready ? (
            <p className="loading">調香卓をひらいています…</p>
          ) : list.length === 0 ? (
            <EmptyState onAdd={openNew} />
          ) : (
            <>
              {pick && (
                <TodaysPick
                  f={pick}
                  todayISO={today}
                  onWear={wear}
                  onOpen={setDetailId}
                  wearing={wearing.includes(pick.id)}
                />
              )}

              <section id="collection" className="collection">
                <div className="collection-head">
                  <h2 className="section-title">コレクション</h2>
                  <span className="collection-count">{list.length} 本</span>
                </div>
                <SpectrumRibbon
                  active={filter}
                  counts={counts}
                  onSelect={setFilter}
                />
                {visible.length === 0 ? (
                  <p className="filter-empty">
                    この香調のボトルはまだありません。
                    <button
                      type="button"
                      className="linklike"
                      onClick={() => setFilter(null)}
                    >
                      すべて表示
                    </button>
                  </p>
                ) : (
                  <div className="grid">
                    {visible.map((f) => (
                      <VialCard
                        key={f.id}
                        f={f}
                        todayISO={today}
                        onOpen={setDetailId}
                        onWear={wear}
                        onEdit={openEdit}
                        wearing={wearing.includes(f.id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </main>

        <footer className="foot">
          <p>
            香水の記録はすべてこの端末の中だけに保存されます。アカウント不要・広告なし。
            大切な記録はときどきバックアップを書き出してください。
            （サイト改善のため、匿名・cookieless
            のページ閲覧数のみ計測しています。）
          </p>
        </footer>
      </div>

      {editing && (
        <BottleForm
          initial={editing.f}
          existing={list}
          isNew={editing.isNew}
          onSave={save}
          onCancel={() => setEditing(null)}
          onDelete={remove}
        />
      )}
      {pendingImport && (
        <ConfirmDialog
          title={`${pendingImport.length} 件を取り込みますか？`}
          body="同じボトルの記録は、取り込んだ内容に置き換わります。いまの残量や使用履歴は元に戻せません（バックアップに無いボトルはそのまま残ります）。写真はバックアップに含まれないため、この端末の写真はそのまま残ります。"
          confirmLabel="取り込む"
          cancelLabel="やめる"
          onConfirm={() => {
            const incoming = pendingImport;
            setPendingImport(null);
            void applyImport(incoming);
          }}
          onCancel={() => setPendingImport(null)}
        />
      )}
      {detail && (
        <DetailSheet
          f={detail}
          todayISO={today}
          wearing={wearing.includes(detail.id)}
          onClose={() => setDetailId(null)}
          onEdit={(id) => {
            setDetailId(null);
            openEdit(id);
          }}
          onWear={wear}
        />
      )}
    </>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <section className="empty">
      <div className="empty-organ" aria-hidden="true">
        {FAMILIES.map((f) => (
          <span
            key={f.id}
            className="empty-vial"
            style={{ background: f.hue }}
          />
        ))}
      </div>
      <h2 className="empty-title">調香卓は、まだ空です</h2>
      <p className="empty-lead">
        最初のボトルを迎えましょう。香調・残量・季節を書き留めれば、
        「今日の1本」提案や使い切り予測、重複購入ガードが動き始めます。
      </p>
      <button
        type="button"
        className="btn btn--primary btn--lg"
        onClick={onAdd}
      >
        <Icon.plus size={18} /> 最初の1本を迎える
      </button>
    </section>
  );
}
