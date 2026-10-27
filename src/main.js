import "./style.css";
import { editJpeg, validateSettings } from "./exif.js";
import { createZip } from "./zip.js";
import { loadPresets, savePresets } from "./presets.js";
const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
let photos = [],
  presets = [],
  zipUrl = null,
  busy = false,
  controller = null;
const MAX = 256 * 1024 * 1024;
function message(s) {
  $("message").textContent = s;
  $("message").hidden = !s;
}
function invalidate() {
  if (zipUrl) {
    URL.revokeObjectURL(zipUrl);
    zipUrl = null;
  }
  $("download").hidden = true;
  $("download").removeAttribute("href");
  $("report").replaceChildren();
  $("progress").hidden = true;
  $("result").textContent = photos.length
    ? "設定を確認し、ZIPを作成してください。"
    : "写真を選択すると処理できます。";
}
const mode = () => document.querySelector("input[name=mode]:checked").value;
function exposureControl(label, type, value, onChange) {
  const wrap = el("label", label, "exposure-control"),
    select = el("select");
  select.setAttribute("aria-label", label + "の候補");
  const options =
    type === "f"
      ? [
          "1",
          "1.2",
          "1.4",
          "1.8",
          "2",
          "2.8",
          "4",
          "5.6",
          "8",
          "11",
          "16",
          "22",
          "32",
        ]
      : [
          "1/8000",
          "1/4000",
          "1/2000",
          "1/1000",
          "1/500",
          "1/250",
          "1/125",
          "1/60",
          "1/30",
          "1/15",
          "1/8",
          "1/4",
          "1/2",
          "1",
          "2",
          "4",
          "8",
          "15",
          "30",
        ];
  for (const [v, text] of [
    ["", "未設定"],
    ...options.map((x) => [x, type === "f" ? `f/${x}` : `${x} 秒`]),
    ["custom", "任意の値を入力…"],
  ]) {
    const o = el("option", text);
    o.value = v;
    select.append(o);
  }
  const input = el("input");
  input.type = "text";
  input.inputMode = type === "f" ? "decimal" : "text";
  input.placeholder = type === "f" ? "例：3.5" : "例：1/125 または 0.008";
  input.setAttribute("aria-label", label + "の任意の値");
  input.value = value;
  input.maxLength = 40;
  const sync = () => {
    select.value =
      value === "" ? "" : options.includes(value) ? value : "custom";
    input.hidden = select.value !== "custom";
  };
  sync();
  select.addEventListener("change", () => {
    if (select.value === "custom") {
      input.hidden = false;
      input.value = value;
      input.focus();
      return;
    }
    value = select.value;
    input.value = value;
    sync();
    onChange(value);
    invalidate();
  });
  input.addEventListener("input", () => {
    value = input.value;
    onChange(value);
    invalidate();
  });
  wrap.append(select, input);
  return wrap;
}
const batch = { f: "", time: "" };
$("batch-fields").append(
  exposureControl("F値", "f", "", (v) => (batch.f = v)),
  exposureControl("シャッタースピード", "time", "", (v) => (batch.time = v)),
);
function renderPhotos() {
  const list = $("photo-list");
  list.replaceChildren();
  if (!photos.length) {
    list.append(el("p", "まだ写真が選択されていません。", "empty"));
    return;
  }
  photos.forEach((p, i) => {
    const row = el("article", undefined, "photo"),
      top = el("div", undefined, "photo-top");
    top.append(
      el("span", String(i + 1).padStart(2, "0"), "photo-index"),
      el("span", p.file.name, "photo-name"),
      el("span", `${(p.file.size / 1048576).toFixed(1)} MiB`, "photo-size"),
    );
    row.append(top);
    if (mode() === "individual") {
      const fields = el("div", undefined, "fields two");
      fields.append(
        exposureControl(`${p.file.name} のF値`, "f", p.f, (v) => (p.f = v)),
        exposureControl(
          `${p.file.name} のシャッタースピード`,
          "time",
          p.time,
          (v) => (p.time = v),
        ),
      );
      row.append(fields);
    }
    list.append(row);
  });
}
function selection(files) {
  message("");
  invalidate();
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX || files.length > 200) {
    selection([]);
    message(
      "合計256 MiB・200枚以内で選択してください。iPadのメモリ保護のため、ロールを分けて処理できます。",
    );
    $("files").value = "";
    return;
  }
  photos = files
    .map((file) => ({ file, f: "", time: "" }))
    .sort((a, b) =>
      a.file.name.localeCompare(b.file.name, "ja", { numeric: true }),
    );
  $("file-count").textContent = `${photos.length} 枚`;
  $("file-size").textContent = photos.length
    ? `合計 ${(total / 1048576).toFixed(1)} MiB`
    : "未選択";
  $("process").disabled = !photos.length;
  renderPhotos();
  invalidate();
}
$("files").addEventListener("change", () =>
  selection(Array.from($("files").files)),
);
$("clear-files").addEventListener("click", () => {
  $("files").value = "";
  selection([]);
});
for (const radio of document.querySelectorAll("input[name=mode]"))
  radio.addEventListener("change", () => {
    $("batch-fields").hidden = mode() !== "batch";
    $("mode-hint").textContent =
      mode() === "unset"
        ? "F値とシャッタースピードの関連タグを削除します。ダミー値は書き込みません。"
        : "空欄・未設定の項目はタグを削除します。F値とシャッターは独立して設定できます。";
    renderPhotos();
    invalidate();
  });
for (const b of document.querySelectorAll("[data-iso]"))
  b.addEventListener("click", () => {
    $("iso").value = b.dataset.iso;
    invalidate();
  });
for (const id of ["make", "model", "lens", "iso"])
  $(id).addEventListener("input", invalidate);
function renderPresets(selected = "") {
  $("preset").replaceChildren(new Option("新しい機材を入力", ""));
  presets.forEach((p) => $("preset").append(new Option(p.name, p.id)));
  $("preset").value = selected;
  $("delete-preset").disabled = $("update-preset").disabled = !selected;
}
try {
  presets = loadPresets();
} catch (e) {
  $("preset-status").textContent =
    `保存領域を読み込めません：${e.message}（EXIF編集は利用できます）`;
}
renderPresets();
$("preset").addEventListener("change", () => {
  const p = presets.find((p) => p.id === $("preset").value);
  $("delete-preset").disabled = $("update-preset").disabled = !p;
  if (p) {
    for (const k of ["make", "model", "lens"]) $(k).value = p[k];
    $("preset-name").value = p.name;
  } else $("preset-name").value = "";
  invalidate();
});
function persist(next, selected, notice) {
  try {
    savePresets(next);
    presets = next;
    renderPresets(selected);
    $("preset-status").textContent = notice;
  } catch (e) {
    message(
      `プリセットを保存できません。ブラウザの保存領域を確認してください：${e.message}`,
    );
  }
}
function save(update) {
  const name = $("preset-name").value.trim();
  if (!name) {
    message("プリセット名を入力してください。");
    $("preset-name").focus();
    return;
  }
  const id = update ? $("preset").value : crypto.randomUUID();
  if (!id) return;
  const p = {
    id,
    name,
    make: $("make").value,
    model: $("model").value,
    lens: $("lens").value,
  };
  const next = update
    ? presets.map((x) => (x.id === id ? p : x))
    : [...presets, p];
  message("");
  persist(next, id, "プリセットを保存しました。");
}
$("save-preset").addEventListener("click", () => save(false));
$("update-preset").addEventListener("click", () => save(true));
$("delete-preset").addEventListener("click", () => {
  const p = presets.find((x) => x.id === $("preset").value);
  if (p && confirm(`プリセット「${p.name}」を削除しますか？`)) {
    persist(
      presets.filter((x) => x.id !== p.id),
      "",
      "プリセットを削除しました。",
    );
    $("preset-name").value = "";
  }
});
function lock(yes) {
  busy = yes;
  for (const node of $("editor").querySelectorAll("input,select,button")) {
    if (yes) {
      node.dataset.wasDisabled = String(node.disabled);
      node.disabled = true;
    } else node.disabled = node.dataset.wasDisabled === "true";
  }
  $("cancel").hidden = !yes;
  $("cancel").disabled = false;
}
$("cancel").addEventListener("click", () => controller?.abort());
function report(name, status, warnings = []) {
  const detail = el("details");
  detail.append(el("summary", `${status} · ${name}`));
  warnings.forEach((w) => detail.append(el("p", w)));
  if (status === "失敗") {
    detail.className = "failure";
    detail.open = true;
  }
  $("report").append(detail);
}
$("editor").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !photos.length) return;
  message("");
  invalidate();
  const common = {
    make: $("make").value.trim(),
    model: $("model").value.trim(),
    lens: $("lens").value.trim(),
    iso: $("iso").value,
  };
  let settings;
  try {
    settings = photos.map((p) => {
      try {
        return validateSettings({
          ...common,
          ...(mode() === "batch"
            ? batch
            : mode() === "individual"
              ? p
              : { f: "", time: "" }),
        });
      } catch (e) {
        throw new Error(`${p.file.name}：${e.message}`);
      }
    });
  } catch (e) {
    message(e.message);
    return;
  }
  // validateSettings is pure validation; editJpeg expects textual exposures.
  settings = photos.map((p) => ({
    ...common,
    ...(mode() === "batch"
      ? batch
      : mode() === "individual"
        ? { f: p.f, time: p.time }
        : { f: "", time: "" }),
  }));
  lock(true);
  controller = new AbortController();
  const signal = controller.signal;
  const output = [];
  let success = 0,
    failed = 0,
    warned = 0;
  $("progress").hidden = false;
  $("progress").max = photos.length * 2;
  try {
    for (let i = 0; i < photos.length; i++) {
      signal.throwIfAborted();
      const p = photos[i];
      $("result").textContent =
        `EXIF編集中 ${i + 1} / ${photos.length} · ${p.file.name}`;
      try {
        const result = editJpeg(
          new Uint8Array(await p.file.arrayBuffer()),
          settings[i],
        );
        output.push({ name: p.file.name, blob: result.blob });
        success++;
        if (result.warnings.length) warned++;
        report(
          p.file.name,
          result.warnings.length ? "成功・警告あり" : "成功",
          result.warnings,
        );
      } catch (e) {
        failed++;
        report(p.file.name, "失敗", [e.message]);
      }
      $("progress").value = i + 1;
      await new Promise((r) => setTimeout(r, 0));
    }
    signal.throwIfAborted();
    if (output.length) {
      const zip = await createZip(
        output,
        (done, total) => {
          $("progress").value = photos.length + done;
          $("result").textContent =
            `ZIP作成中 ${done} / ${total} · 成功 ${success}・失敗 ${failed}`;
        },
        signal,
      );
      signal.throwIfAborted();
      zipUrl = URL.createObjectURL(zip);
      $("download").href = zipUrl;
      $("download").download =
        `film-exif-${new Date().toISOString().slice(0, 10)}.zip`;
      $("download").hidden = false;
    }
    $("progress").value = $("progress").max;
    $("result").textContent =
      `完了：成功 ${success} 枚・失敗 ${failed} 枚・警告 ${warned} 枚。${success ? "「ZIPを保存」で成功した写真を保存できます。" : "ファイルごとのエラーを確認してください。"}`;
  } catch (e) {
    $("result").textContent =
      e.name === "AbortError"
        ? "中止しました。途中結果は破棄しました。"
        : `ZIPの作成に失敗しました：${e.message}`;
  } finally {
    lock(false);
    controller = null;
  }
});
async function offlineSetup() {
  const status = $("offline-status");
  if (!("serviceWorker" in navigator)) {
    status.textContent =
      "この環境ではオフライン保存を利用できません。HTTPSまたはlocalhostで開いてください。";
    status.classList.add("warn");
    return;
  }
  if (import.meta.env.DEV) {
    status.textContent =
      "開発モード · オフライン検証は npm run build → npm run preview で行ってください。";
    return;
  }
  try {
    // Re-registering may wait for a network update when offline in Safari and
    // Chromium. Reuse the active registration; updates are nonblocking.
    const existing = await navigator.serviceWorker.getRegistration(
      import.meta.env.BASE_URL,
    );
    const registration = existing?.active
      ? existing
      : await navigator.serviceWorker.register(
          `${import.meta.env.BASE_URL}sw.js`,
          { scope: import.meta.env.BASE_URL },
        );
    if (existing?.active) registration.update().catch(() => {});
    await navigator.serviceWorker.ready;
    const check = () => {
      if (registration.waiting) {
        status.textContent =
          "新しい版があります。処理完了後、アプリをすべて閉じて開き直すと更新されます。";
      } else
        status.textContent =
          "オフライン準備完了 · 次回から接続なしで利用できます。Safariによるサイトデータ削除後は再接続が必要です。";
    };
    check();
    registration.addEventListener("updatefound", () =>
      registration.installing?.addEventListener("statechange", check),
    );
  } catch (e) {
    status.textContent = `オフライン保存に失敗しました。接続中は利用できます：${e.message}`;
    status.classList.add("warn");
  }
}
offlineSetup();
window.addEventListener("beforeunload", (event) => {
  if (busy) {
    event.preventDefault();
    event.returnValue = "";
  }
});
