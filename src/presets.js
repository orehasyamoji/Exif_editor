const KEY = "film-exif-presets-v1";
export function loadPresets(storage = localStorage) {
  const raw = storage.getItem(KEY);
  if (!raw) return [];
  const items = JSON.parse(raw);
  if (
    !Array.isArray(items) ||
    items.some(
      (p) =>
        !p ||
        ["id", "name", "make", "model", "lens"].some(
          (k) => typeof p[k] !== "string",
        ),
    )
  )
    throw new Error("プリセットの保存データを読み取れません。");
  return items;
}
export function savePresets(items, storage = localStorage) {
  storage.setItem(KEY, JSON.stringify(items));
}
