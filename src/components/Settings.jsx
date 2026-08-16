import { useState, useRef } from "react";
import { SET_SIZE_MIN, SET_SIZE_MAX, clampSetSize } from "../lib/settings.js";
import { exportDb, importDb } from "../lib/storage.js";

// ------------------------------------------------------------------
// 設定(T-24)。
//
// 置いてよいのは「量とテンポの調整」まで。
// バックログ枚数の表示・4択評価・受動モードは、設定項目としても提供しない
// (SPEC §8 / lib/settings.js の冒頭コメント)。原則3・4は設定経由でも緩めない。
//
// コレクション(§4-7 / T-26)もここに置く。ホームに一覧を出すと、
// 「全部やらなきゃ」を再導入してしまうため。
// ------------------------------------------------------------------

const label = { fontSize: 11, color: "var(--faint)", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 6 };
const card = { borderRadius: 14, border: "1px solid var(--edge)", background: "var(--card-2)", padding: 16, marginBottom: 12 };
const ghost = {
  padding: "10px 14px", borderRadius: 12, border: "1px solid var(--edge)", background: "transparent",
  color: "var(--dim)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
};

export default function Settings({
  db, settings, collections, activeCollectionId,
  onChange, onReplaceDb, onSelectCollection, onAddCollection, onRenameCollection, onBack,
}) {
  const [notice, setNotice] = useState(null);
  const [newName, setNewName] = useState("");
  const fileRef = useRef(null);

  const active = collections.find((c) => c.id === activeCollectionId);
  const alive = collections.filter((c) => !c.deletedAt);

  const download = () => {
    const blob = new Blob([exportDb(db)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `flow-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setNotice({ ok: true, text: "書き出しました" });
  };

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const next = importDb(await file.text());
      onReplaceDb(next);
      setNotice({ ok: true, text: `${next.cards.filter((c) => !c.deletedAt).length}枚を読み込みました` });
    } catch (err) {
      setNotice({ ok: false, text: `読み込めませんでした: ${err.message}` });
    }
    e.target.value = "";
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", animation: "riseIn .3s ease both", overflowY: "auto", minHeight: 0 }}>
      <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 16 }}>設定</div>

      {/* --- 学習中のコレクション (T-26) --- */}
      <div style={card}>
        <div style={label}>いま学んでいるもの</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {alive.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelectCollection(c.id)}
              style={{
                ...ghost,
                borderColor: c.id === activeCollectionId ? "var(--violet)" : "var(--edge)",
                color: c.id === activeCollectionId ? "var(--ink)" : "var(--dim)",
              }}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="新しいコレクション名"
            style={{
              flex: 1, borderRadius: 12, border: "1px solid var(--edge)", background: "var(--card)",
              color: "var(--ink)", padding: "10px 12px", fontSize: 13, fontFamily: "inherit", outline: "none",
            }}
          />
          <button
            onClick={() => {
              if (!newName.trim()) return;
              onAddCollection(newName.trim());
              setNewName("");
            }}
            style={ghost}
          >
            追加
          </button>
        </div>
        {active && (
          <div style={{ marginTop: 12 }}>
            <div style={label}>「{active.name}」の問いかけ</div>
            <input
              value={active.promptLabel}
              onChange={(e) => onRenameCollection(active.id, { promptLabel: e.target.value })}
              placeholder="英語で言うと?"
              style={{
                width: "100%", borderRadius: 12, border: "1px solid var(--edge)", background: "var(--card)",
                color: "var(--ink)", padding: "10px 12px", fontSize: 13, fontFamily: "inherit", outline: "none",
              }}
            />
            <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 6, lineHeight: 1.6 }}>
              カードの上に出る一言。英語なら「英語で言うと?」、資格試験なら「これは何?」。
            </div>
          </div>
        )}
      </div>

      {/* --- 1セットの枚数 --- */}
      <div style={card}>
        <div style={label}>1セットの枚数</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <input
            type="range"
            min={SET_SIZE_MIN}
            max={SET_SIZE_MAX}
            value={settings.setSize}
            onChange={(e) => onChange({ setSize: clampSetSize(e.target.value) })}
            style={{ flex: 1, accentColor: "var(--violet)" }}
          />
          <div style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: "tabular-nums", minWidth: 34, textAlign: "right" }}>
            {settings.setSize}
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 8, lineHeight: 1.6 }}>
          1回のセットで触るカードの枚数。多くするほど1セットが長くなる。
        </div>
      </div>

      {/* --- 同セット内の再出題 --- */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>落としたカードを同じセットで出し直す</div>
          <Toggle on={settings.relearnInSet} onClick={() => onChange({ relearnInSet: !settings.relearnInSet })} />
        </div>
        <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 8, lineHeight: 1.6 }}>
          オフのとき、落としたカードは短い間隔で期限が来て、次のセットで戻ってくる。
          オンにすると数枚後ろに差し戻され、正解するまでセットが終わらない。
        </div>
      </div>

      {/* --- バックアップ --- */}
      <div style={card}>
        <div style={label}>バックアップ</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={download} style={{ ...ghost, flex: 1 }}>書き出す</button>
          <button onClick={() => fileRef.current?.click()} style={{ ...ghost, flex: 1 }}>読み込む</button>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={upload} style={{ display: "none" }} />
        </div>
        {notice && (
          <div style={{ fontSize: 12, marginTop: 10, color: notice.ok ? "var(--mint)" : "var(--red)", lineHeight: 1.6 }}>
            {notice.text}
          </div>
        )}
        <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 8, lineHeight: 1.6 }}>
          読み込むと、いまのカードと履歴はすべて置き換わる。端末を移すときは先に書き出しておくこと。
        </div>
      </div>

      <button onClick={onBack} style={{
        marginTop: 4, padding: "14px 0", borderRadius: 14, border: "1px solid var(--edge)",
        background: "transparent", color: "var(--dim)", fontSize: 15, fontWeight: 700, cursor: "pointer",
      }}>
        戻る
      </button>
    </div>
  );
}

function Toggle({ on, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      style={{
        width: 48, height: 28, borderRadius: 14, border: "none", cursor: "pointer", flexShrink: 0,
        background: on ? "var(--violet)" : "#2b3040", position: "relative", transition: "background .2s",
      }}
    >
      <span style={{
        position: "absolute", top: 3, left: on ? 23 : 3, width: 22, height: 22, borderRadius: "50%",
        background: "#fff", transition: "left .2s",
      }} />
    </button>
  );
}
