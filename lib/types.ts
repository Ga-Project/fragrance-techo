// フレグランス手帖 — ドメイン型。
// すべて端末内(IndexedDB)に保存する。サーバへは一切送らない。

/** 香調(オルファクティブ・ファミリー)の識別子。families.ts に定義順が対応する。 */
export type FamilyId =
  | "citrus"
  | "green"
  | "aromatic"
  | "floral"
  | "fruity"
  | "gourmand"
  | "woody"
  | "oriental";

/** 季節タグ。 */
export type Season = "spring" | "summer" | "autumn" | "winter";

/** 使用シーン(TPO)タグ。 */
export type Scene = "daily" | "office" | "date" | "formal" | "relax";

/** 香りのピラミッド(トップ/ミドル/ラスト)。自由記述。 */
export type Pyramid = {
  top: string;
  heart: string;
  base: string;
};

/** 所持ボトル1本。 */
export type Fragrance = {
  id: string;
  name: string;
  brand: string;
  family: FamilyId;
  /** 総容量(ml)。 */
  volumeMl: number;
  /** 残量(0–100%)。 */
  remainingPct: number;
  /** 1回に噴霧するプッシュ数(使い切り予測に使う)。 */
  sprayPerUse: number;
  /** 週あたりの使用回数の目安(実績が無い間の予測フォールバック)。 */
  usesPerWeek: number;
  seasons: Season[];
  scenes: Scene[];
  pyramid: Pyramid;
  notes: string;
  /** 購入日(ISO yyyy-mm-dd)。 */
  purchaseDate: string;
  /** 価格(円)。未入力は 0。 */
  price: number;
  /** IndexedDB に格納した写真のキー。 */
  photoIds: string[];
  /** 使用した日(ISO yyyy-mm-dd)の履歴。新しい順ではなく追加順。 */
  wearLog: string[];
  createdAt: string;
  updatedAt: string;
};

/** バックアップの JSON 形状(写真は含めないメタのみ / 含める版は別)。 */
export type BackupPayload = {
  app: "fragrance-techo";
  version: 1;
  exportedAt: string;
  fragrances: Fragrance[];
};

/**
 * 保存経路の結果。
 *
 * 失敗の理由は1つではない(端末に書けない / 別タブが先にそのボトルを手放していた)。
 * 真偽値だけを返すと、どの理由でも同じ「空き容量をご確認ください」を出すことになり、
 * 利用者は直しようのない案内を読まされる。理由に応じた文言まで返す。
 * message が無い失敗は、呼び出し側の既定文言(保存できない環境の案内)で表示する。
 */
export type SaveResult = { ok: true } | { ok: false; message?: string };

/**
 * 手放す経路の結果。
 *
 * 成功時は「実際に消えた記録が参照していた写真」を返す。フォームが抱えている写しは
 * 編集を開いた時点のもので、開いている間に別タブが同じボトルへ足した写真を知らない。
 * 呼び出し側がその写しだけを見て実体(IndexedDB の Blob)を回収すると、後から足された
 * 写真だけが誰からも辿れないまま端末に残り続ける。回収対象は保存側が確定させる。
 */
export type DeleteResult = { ok: false } | { ok: true; photoIds: string[] };

/** 重複購入ガードの警告1件。 */
export type DuplicateWarning = {
  id: string;
  name: string;
  brand: string;
  /** 類似の理由(人間可読)。 */
  reason: string;
  /** 0–1。高いほど似ている。 */
  score: number;
};
