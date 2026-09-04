"use client";

// フレグランス手帖 — ボトルの登録/編集フォーム(ボトムシート)。登録前に重複購入を警告する。

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type {
  DeleteResult,
  Fragrance,
  FamilyId,
  SaveResult,
  Scene,
  Season,
} from "../lib/types";
import { FAMILIES, SCENES, SEASONS, familyOf } from "../lib/families";
import { duplicateWarnings } from "../lib/suggest";
import { clampPct, toISODate } from "../lib/format";
import { newId } from "../lib/model";
import {
  STAGING_HEARTBEAT_MS,
  deletePhoto,
  holdPhotoSession,
  keepStagingAlive,
  putPhoto,
  stagePhoto,
  unstagePhotos,
} from "../lib/db";
import { downscaleImage } from "../lib/photo";
import { Icon } from "./visuals";
import { PhotoThumb } from "./photos";
import { useDialog } from "./useDialog";
import { ConfirmDialog } from "./ConfirmDialog";

export function BottleForm({
  initial,
  existing,
  isNew,
  onSave,
  onCancel,
  onDelete,
}: {
  initial: Fragrance;
  existing: Fragrance[];
  isNew: boolean;
  /**
   * 保存できたら ok:true。ok:false のときは写真の実体を消してはいけない。
   * 失敗の理由(端末に書けない / 別タブが先に手放していた)は message で受け取る。
   */
  onSave: (f: Fragrance) => Promise<SaveResult>;
  onCancel: () => void;
  /**
   * 手放せたら ok:true。そのとき「実際に消えた記録が参照していた写真」を受け取る
   * (このフォームの写しには、開いている間に別タブが足した写真が載っていない)。
   */
  onDelete: (id: string) => Promise<DeleteResult>;
}) {
  const [d, setD] = useState<Fragrance>(initial);
  const [busy, setBusy] = useState(false);
  // 保存/手放すはタブ間ロックの順番待ちを挟むため、結果が返るまでに間がある。
  // その間に「やめる」「閉じる」が通ると、まだ確定していない保存の裏で
  // この編集で取り込んだ写真の実体が消され、確定した記録が存在しない写真を指す。
  // 実行中は取り消し経路も含めて操作を受け付けない。
  const [saving, setSaving] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [saveError, setSaveError] = useState("");
  // 写真の実体(IndexedDB の Blob)は、メタ情報の保存が確定するまで消さない/残さない。
  //   pendingDeletes: 「外す」を押した既存写真。保存が成功して初めて削除する。
  //   sessionAdded  : この編集中に取り込んだ写真。保存せず閉じたら孤児になるので消す。
  const [pendingDeletes, setPendingDeletes] = useState<string[]>([]);
  const sessionAdded = useRef<string[]>([]);
  // この編集の識別子。sessionAdded は画面の中にしか無い記録なので、リロード・
  // 別ページへの移動・タブの終了では後始末ごと消える(取り込んだ実体だけが
  // IndexedDB に残り、誰も参照できず誰も消せない)。同じ id を端末にも控え、
  // 次回の起動でこのセッションが死んでいれば実体を回収できるようにする。
  const [session] = useState(newId);
  const photoInputRef = useRef<HTMLInputElement>(null);
  // このフォームの後始末が済んだ(= もう写真を増やしてはいけない)ことを示す。
  // 取り込みは非同期なので、閉じた後に走り続けたループが Blob を書き足すと、
  // 誰も参照できず誰も消せない孤児になる。閉じた後の書き込みは即座に回収する。
  const closed = useRef(false);
  // 実行中フラグの「いま」の値。saving(state)は再描画されるまで false のままなので、
  // 連打の2回目が同じ描画の中で走ると素通りする(保存も手放すも二重に走る)。
  // 画面の見た目は saving、多重発火の判断はこの ref で行う。
  const running = useRef(false);
  // 取り消せない操作(手放す / 入力の破棄)の前に挟む確認。
  const [confirming, setConfirming] = useState<null | "delete" | "discard">(
    null,
  );

  // 編集中であることをロックで示し、控えの心拍を打ち続ける。
  // ロックはタブが消えた時点でブラウザが解放するため、他のタブの掃除は
  // 「まだ編集中の写真」と「取り残された写真」を取り違えない。
  useEffect(() => {
    const release = holdPhotoSession(session);
    const timer = window.setInterval(() => {
      void keepStagingAlive(session);
    }, STAGING_HEARTBEAT_MS);
    return () => {
      window.clearInterval(timer);
      release();
    };
  }, [session]);

  // 保存せずに閉じる経路(閉じるボタン / やめる / スクリム / Escape)は必ずここを通す。
  function cancel() {
    closed.current = true;
    for (const id of sessionAdded.current) void deletePhoto(id);
    sessionAdded.current = [];
    void unstagePhotos(session);
    onCancel();
  }

  // 破棄されるのは入力だけではない。この編集で取り込んだ写真の実体も一緒に消える
  // (バックアップJSONに写真は入らないので戻せない)。スクリムの誤タップや Escape で
  // それが起きないよう、書きかけがあるときだけ確認を挟む。
  // 何も触っていなければ確認は出さない(意味のない確認は読まれなくなる)。
  function requestCancel() {
    // 保存/手放すの結果待ち中は閉じない(Escape・スクリムからもここを通る)。
    if (running.current || saving) return;
    const dirty =
      JSON.stringify(d) !== JSON.stringify(initial) ||
      sessionAdded.current.length > 0;
    if (dirty) {
      setConfirming("discard");
      return;
    }
    cancel();
  }

  const dialogRef = useDialog(requestCancel);

  const set = <K extends keyof Fragrance>(k: K, v: Fragrance[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));

  const warnings = useMemo(
    () =>
      duplicateWarnings(
        { name: d.name, brand: d.brand, family: d.family, excludeId: d.id },
        existing,
      ),
    [d.name, d.brand, d.family, d.id, existing],
  );

  function toggle<T>(arr: T[], v: T): T[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }

  async function onPickPhoto(files: FileList | null) {
    if (!files || files.length === 0 || closed.current) return;
    setBusy(true);
    setPhotoError("");
    // 途中で失敗しても、そこまでに取り込めた分は確定させる(握りつぶさず理由も出す)。
    const added: string[] = [];
    try {
      for (const file of Array.from(files).slice(0, 4)) {
        if (closed.current) break; // 閉じられた: これ以上は書かない
        const blob = await downscaleImage(file);
        if (closed.current) break;
        const id = newId();
        // 実体を書く前に控える。書いている最中にタブが落ちても、次回の起動が
        // この id を「保存されなかった写真」として回収できる。
        await stagePhoto(session, id);
        await putPhoto(id, blob);
        // 書き込みの最中に閉じられた場合、この id は cancel/del の回収対象に入らない。
        // 自分で消してから抜ける(sessionAdded にも下書きにも載せない)。
        if (closed.current) {
          void deletePhoto(id);
          break;
        }
        added.push(id);
        sessionAdded.current.push(id);
      }
    } catch {
      if (!closed.current) {
        setPhotoError(
          "写真を取り込めませんでした。画像形式か、端末の空き容量をご確認ください。",
        );
      }
    } finally {
      // 同じ写真をもう一度選んでも onChange が起きるよう選択状態を戻す
      // (FileList は Array.from で確定済みなので、ここで消しても取り込みに影響しない)。
      if (photoInputRef.current) photoInputRef.current.value = "";
      if (!closed.current) {
        if (added.length > 0) {
          setD((prev) => ({ ...prev, photoIds: [...prev.photoIds, ...added] }));
        }
        setBusy(false);
      }
    }
  }

  // 下書きから外すだけ。実体の削除は保存が成功してから(閉じれば元のまま残る)。
  function removePhoto(id: string) {
    setD((prev) => ({
      ...prev,
      photoIds: prev.photoIds.filter((p) => p !== id),
    }));
    setPendingDeletes((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }

  async function submit() {
    // 二重送信を防ぐ。押し直すたびに保存が積まれると、通知も結果も二重になる。
    if (running.current || closed.current) return;
    running.current = true;
    // 日付は押した瞬間のローカル日付。UTC 切り出しだと日本時間の朝に前日となり、
    // 画面の他の日付(記録日・今日の1本)と1日ずれる。
    const now = toISODate(new Date());
    setSaveError("");
    setSaving(true);
    try {
      const saved = await onSave({
        ...d,
        name: d.name.trim(),
        brand: d.brand.trim(),
        remainingPct: clampPct(d.remainingPct),
        updatedAt: now,
      });
      // 保存が確定した後にだけ実体を消す。失敗時に消すと、参照元(旧メタ情報)だけが残る。
      // 失敗時はフォームも開いたまま(呼び出し側が閉じない)。取り込み済みの写真を
      // 抱えたまま消えると回収できなくなるうえ、入力もやり直しになる。
      if (!saved.ok) {
        setSaveError(
          saved.message ??
            "保存できませんでした。端末の空き容量、またはブラウザのサイトデータ設定をご確認ください。",
        );
        return;
      }
      closed.current = true;
      for (const id of pendingDeletes) void deletePhoto(id);
      setPendingDeletes([]);
      sessionAdded.current = [];
      // 取り込んだ写真はメタ情報から参照されるようになった。確保を解いてよい
      // (解くのは保存が確定してから。先に解くと、確定前に他のタブの掃除が拾う)。
      void unstagePhotos(session);
    } finally {
      running.current = false;
      setSaving(false);
    }
  }

  async function del() {
    // ボトルを手放すと、そのボトルが参照していた写真はどこからも辿れなくなる。
    // 実体を残すと IndexedDB の容量だけを食い続け、いずれ新しい写真が保存できなくなるため、
    // 削除が確定した時点で「このボトルに紐づく全ての写真」を回収する。
    //   d.photoIds        : 現在の下書きが参照している写真(= 既存写真を含む)
    //   pendingDeletes    : この編集で外した既存写真(まだ実体は残っている)
    //   sessionAdded      : この編集で取り込んだ写真(保存されないまま孤児になる)
    //   deleted.photoIds  : 消える直前に保存されていた実体が参照していた写真
    //
    // 最後の1つが要る。この下書きは編集を開いた時点の写しなので、開いている間に
    // 別タブが同じボトルへ足した写真を知らない。手元の3つだけで回収すると、
    // その写真の実体だけが IndexedDB に残り、参照元(メタ情報)は今まさに消えるため
    // 誰からも辿れず誰にも消せなくなる。回収対象は保存側が確定した内容から取る。
    if (running.current || closed.current) return;
    running.current = true;
    setSaveError("");
    setSaving(true);
    try {
      const deleted = await onDelete(d.id);
      if (!deleted.ok) {
        setSaveError(
          "手放せませんでした。端末の空き容量、またはブラウザのサイトデータ設定をご確認ください。",
        );
        return;
      }
      const orphans = new Set([
        ...d.photoIds,
        ...pendingDeletes,
        ...sessionAdded.current,
        ...deleted.photoIds,
      ]);
      // 取り込み中のループが残っていても、ここから先の書き込みは自分で回収される。
      closed.current = true;
      for (const id of orphans) void deletePhoto(id);
      setPendingDeletes([]);
      sessionAdded.current = [];
      void unstagePhotos(session);
    } finally {
      running.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <div
        className="sheet-scrim"
        onClick={(e) => {
          if (e.target === e.currentTarget) requestCancel();
        }}
      >
        <div
          className="sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="form-title"
          ref={dialogRef}
          tabIndex={-1}
        >
          <header className="sheet-head">
            <h2 id="form-title">
              {isNew ? "ボトルを迎える" : "ボトルを編める"}
            </h2>
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              onClick={requestCancel}
              disabled={saving}
              aria-label="閉じる"
            >
              <Icon.close />
            </button>
          </header>

          {/* 保存/手放すの結果待ちの間は入力そのものを止める。
              submit は押した瞬間の下書き(d)を送っており、待っている間に入れた変更は
              その書き込みに入らない。保存が成功するとフォームはそのまま閉じられるため、
              入力できたのに黙って捨てられる(利用者からは「入力が消えた」ようにしか
              見えない)。footer のボタンだけを止めても、本文の入力欄・スライダー・
              チップ・写真の「外す」は触れたままなので、ここごと不活性にする。 */}
          <div
            className={`sheet-body${saving ? " is-locked" : ""}`}
            inert={saving}
          >
            <label className="field">
              <span className="field-label">香水名</span>
              <input
                className="input"
                value={d.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="例: サンタル 33"
                autoComplete="off"
              />
            </label>

            <label className="field">
              <span className="field-label">ブランド</span>
              <input
                className="input"
                value={d.brand}
                onChange={(e) => set("brand", e.target.value)}
                placeholder="例: Le Labo"
                autoComplete="off"
              />
            </label>

            {warnings.length > 0 && (
              <div className="dupe" role="status">
                <p className="dupe-head">
                  <Icon.alert size={16} /> 似た香りを既にお持ちかもしれません
                </p>
                <ul>
                  {warnings.slice(0, 3).map((w) => (
                    <li key={w.id}>
                      <b>{w.name || "無名"}</b>
                      <span className="dupe-brand">{w.brand}</span>
                      <span className="dupe-reason">{w.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <fieldset className="field">
              <legend className="field-label">香調</legend>
              <div className="chips">
                {FAMILIES.map((fam) => (
                  <button
                    type="button"
                    key={fam.id}
                    className={`chip${d.family === fam.id ? " is-on" : ""}`}
                    style={{ ["--chue" as string]: fam.hue } as CSSProperties}
                    aria-pressed={d.family === fam.id}
                    onClick={() => set("family", fam.id as FamilyId)}
                  >
                    <span className="chip-dot" aria-hidden="true" />
                    {fam.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="grid2">
              <label className="field">
                <span className="field-label">容量 (ml)</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={d.volumeMl}
                  onChange={(e) => set("volumeMl", Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span className="field-label">
                  残量{" "}
                  <b className="field-num">
                    {Math.round(clampPct(d.remainingPct))}%
                  </b>
                </span>
                <input
                  className="range"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={clampPct(d.remainingPct)}
                  onChange={(e) => set("remainingPct", Number(e.target.value))}
                  style={
                    {
                      ["--pos" as string]: `${clampPct(d.remainingPct)}%`,
                    } as CSSProperties
                  }
                />
              </label>
            </div>

            <div className="grid2">
              <label className="field">
                <span className="field-label">1回のプッシュ数</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={d.sprayPerUse}
                  onChange={(e) => set("sprayPerUse", Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span className="field-label">週の使用回数(目安)</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={d.usesPerWeek}
                  onChange={(e) => set("usesPerWeek", Number(e.target.value))}
                />
              </label>
            </div>

            <fieldset className="field">
              <legend className="field-label">季節</legend>
              <div className="chips">
                {SEASONS.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    className={`chip chip--plain${d.seasons.includes(s.id) ? " is-on" : ""}`}
                    aria-pressed={d.seasons.includes(s.id)}
                    onClick={() =>
                      set("seasons", toggle<Season>(d.seasons, s.id))
                    }
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="field">
              <legend className="field-label">シーン (TPO)</legend>
              <div className="chips">
                {SCENES.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    className={`chip chip--plain${d.scenes.includes(s.id) ? " is-on" : ""}`}
                    aria-pressed={d.scenes.includes(s.id)}
                    onClick={() => set("scenes", toggle<Scene>(d.scenes, s.id))}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="field">
              <legend className="field-label">香りのピラミッド</legend>
              <div className="pyr-inputs">
                <label>
                  <span>トップ</span>
                  <input
                    className="input"
                    value={d.pyramid.top}
                    onChange={(e) =>
                      set("pyramid", { ...d.pyramid, top: e.target.value })
                    }
                    placeholder="例: ベルガモット"
                  />
                </label>
                <label>
                  <span>ミドル</span>
                  <input
                    className="input"
                    value={d.pyramid.heart}
                    onChange={(e) =>
                      set("pyramid", { ...d.pyramid, heart: e.target.value })
                    }
                    placeholder="例: アイリス"
                  />
                </label>
                <label>
                  <span>ラスト</span>
                  <input
                    className="input"
                    value={d.pyramid.base}
                    onChange={(e) =>
                      set("pyramid", { ...d.pyramid, base: e.target.value })
                    }
                    placeholder="例: サンダルウッド"
                  />
                </label>
              </div>
            </fieldset>

            <fieldset className="field">
              <legend className="field-label">写真</legend>
              <div className="photos">
                {d.photoIds.map((pid) => (
                  <div className="photo-item" key={pid}>
                    <PhotoThumb
                      id={pid}
                      alt="登録した写真"
                      className="photo-img"
                    />
                    <button
                      type="button"
                      className="photo-del"
                      onClick={() => removePhoto(pid)}
                      aria-label="この写真を外す"
                    >
                      <Icon.close size={14} />
                    </button>
                  </div>
                ))}
                {/* <label> は Tab で到達できず、中の input も hidden でフォーカスを
                  受けない。キーボードだけでも写真を追加できるようボタンから開く。 */}
                <button
                  type="button"
                  className={`photo-add${busy ? " is-busy" : ""}`}
                  onClick={() => photoInputRef.current?.click()}
                  disabled={busy || saving}
                >
                  <Icon.camera size={20} />
                  <span>{busy ? "取り込み中…" : "追加"}</span>
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  tabIndex={-1}
                  onChange={(e) => void onPickPhoto(e.target.files)}
                />
              </div>
              {photoError && (
                <p className="field-error" role="alert">
                  {photoError}
                </p>
              )}
            </fieldset>

            <div className="grid2">
              <label className="field">
                <span className="field-label">購入日</span>
                <input
                  className="input"
                  type="date"
                  value={d.purchaseDate}
                  onChange={(e) => set("purchaseDate", e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">価格 (円)</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={d.price || ""}
                  onChange={(e) => set("price", Number(e.target.value))}
                />
              </label>
            </div>

            <label className="field">
              <span className="field-label">メモ</span>
              <textarea
                className="input textarea"
                rows={3}
                value={d.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="つけたときの気分、褒められた話など"
              />
            </label>

            {/* 保存失敗はこのシートの中でも知らせる。画面上部の通知はシートの
              背面にあり、フォームを開いたままだと読めないため。 */}
            {saveError && (
              <p className="field-error" role="alert">
                {saveError}
              </p>
            )}
          </div>

          <footer className="sheet-foot">
            {!isNew && (
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => setConfirming("delete")}
                disabled={saving}
              >
                <Icon.trash size={16} /> 手放す
              </button>
            )}
            <span className="sheet-spacer" />
            <button
              type="button"
              className="btn btn--ghost"
              onClick={requestCancel}
              disabled={saving}
            >
              やめる
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void submit()}
              disabled={busy || saving}
            >
              {saving ? "保存中…" : isNew ? "棚に加える" : "保存する"}
            </button>
          </footer>
        </div>
      </div>

      {confirming === "delete" && (
        <ConfirmDialog
          title={`「${d.name.trim() || "無名のボトル"}」を手放しますか？`}
          body="このボトルの記録と、登録した写真がこの端末から消えます。書き出したバックアップに写真は含まれないため、元に戻せません。"
          confirmLabel="手放す"
          cancelLabel="やめる"
          onConfirm={() => {
            setConfirming(null);
            void del();
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
      {confirming === "discard" && (
        <ConfirmDialog
          title="編集をやめますか？"
          body="入力した内容は保存されません。この編集で取り込んだ写真も端末から消えます。"
          confirmLabel="やめる"
          cancelLabel="編集に戻る"
          onConfirm={() => {
            setConfirming(null);
            cancel();
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  );
}
