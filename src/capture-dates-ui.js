// Roll-local date candidates. Never persisted in equipment presets.
export function createCaptureDates(onChange) {
  const $ = (id) => document.getElementById(id);
  const candidates = [{ id: "date-1", value: "" }];
  const mode = () =>
    document.querySelector("input[name=date-mode]:checked").value;
  function renderCandidates() {
    $("date-candidates").replaceChildren();
    for (const [index, candidate] of candidates.entries()) {
      const label = document.createElement("label");
      label.textContent = `撮影日${index + 1}`;
      const input = document.createElement("input");
      input.type = "date";
      input.min = "0001-01-01";
      input.max = "9999-12-31";
      input.value = candidate.value;
      input.addEventListener("input", () => {
        candidate.value = input.value;
        onChange();
      });
      label.append(input);
      $("date-candidates").append(label);
    }
  }
  $("add-date").addEventListener("click", () => {
    candidates.push({ id: `date-${candidates.length + 1}`, value: "" });
    renderCandidates();
    onChange();
    $("date-candidates").lastElementChild.querySelector("input").focus();
  });
  for (const radio of document.querySelectorAll("input[name=date-mode]"))
    radio.addEventListener("change", () => {
      $("date-batch-fields").hidden = mode() !== "batch";
      $("date-individual-fields").hidden = mode() !== "individual";
      $("date-compatibility").hidden = mode() === "keep";
      onChange();
    });
  $("capture-date-batch").addEventListener("input", onChange);
  renderCandidates();
  return {
    forPhoto(photo) {
      if (mode() === "keep") return null;
      if (mode() === "batch") {
        if (!$("capture-date-batch").value)
          throw new Error("一括設定の撮影日を入力してください。");
        return $("capture-date-batch").value;
      }
      if (!photo.captureDateId) return null;
      const index = candidates.findIndex((c) => c.id === photo.captureDateId),
        candidate = candidates[index];
      if (!candidate?.value)
        throw new Error(`撮影日${index + 1}を入力してください。`);
      return candidate.value;
    },
    control(photo) {
      if (mode() === "keep") return null;
      if (mode() === "batch") {
        const caption = document.createElement("p");
        caption.className = "photo-date-summary";
        caption.textContent =
          ($("capture-date-batch").value.replaceAll("-", "/") || "日付を入力") +
          " · 時刻なし";
        return caption;
      }
      const label = document.createElement("label");
      label.className = "photo-date";
      label.textContent = "撮影日";
      const select = document.createElement("select");
      select.setAttribute("aria-label", photo.file.name + " の撮影日");
      select.append(new Option("元の撮影日を保持", ""));
      candidates.forEach((candidate, i) =>
        select.append(
          new Option(
            `撮影日${i + 1} · ${candidate.value.replaceAll("-", "/") || "日付を入力"}`,
            candidate.id,
          ),
        ),
      );
      select.value = photo.captureDateId || "";
      select.addEventListener("change", () => {
        photo.captureDateId = select.value;
        onChange();
      });
      label.append(select);
      return label;
    },
  };
}
