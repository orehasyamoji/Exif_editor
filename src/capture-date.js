// null/undefined means preserve the existing EXIF shooting date and time.
export function validateCaptureDate(value) {
  if (value == null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("撮影日は年月日を入力してください。");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    year < 1 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new Error("撮影日に存在する日付を入力してください。");
  return value;
}
export function formatCaptureDate(value) {
  return validateCaptureDate(value).replaceAll("-", ":") + "   :  :  ";
}
