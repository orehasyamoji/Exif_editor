// Display-only thumbnails. Neither these blobs nor this canvas enter EXIF export.
// Decode at most one original at a time, and only for near-visible grid cells.
export function createThumbnails(root) {
  let generation = 0,
    queue = Promise.resolve();
  const records = new Map(),
    bindings = new WeakMap();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) {
          observer.unobserve(entry.target);
          const { file, record } = bindings.get(entry.target);
          if (record.url) {
            entry.target.src = record.url;
            continue;
          }
          if (record.pending) continue;
          record.pending = true;
          const epoch = generation;
          queue = queue.then(async () => {
            if (epoch !== generation) return;
            let source, bitmap;
            try {
              source = URL.createObjectURL(file);
              const image = new Image();
              image.src = source;
              await image.decode();
              if (epoch !== generation) return;
              const scale = Math.min(
                1,
                480 / Math.max(image.naturalWidth, image.naturalHeight),
              );
              const canvas = document.createElement("canvas");
              canvas.width = Math.max(
                1,
                Math.round(image.naturalWidth * scale),
              );
              canvas.height = Math.max(
                1,
                Math.round(image.naturalHeight * scale),
              );
              canvas
                .getContext("2d")
                .drawImage(image, 0, 0, canvas.width, canvas.height);
              bitmap = await new Promise((resolve) =>
                canvas.toBlob(resolve, "image/jpeg", 0.8),
              );
              canvas.width = canvas.height = 0;
              image.removeAttribute("src");
              if (epoch !== generation || !bitmap) return;
              record.url = URL.createObjectURL(bitmap);
              for (const img of record.images) {
                img.src = record.url;
                img.closest(".photo-preview").classList.add("loaded");
              }
            } catch {
              record.failed = true;
              for (const img of record.images)
                img.closest(".photo-preview").classList.add("unavailable");
            } finally {
              if (source) URL.revokeObjectURL(source);
            }
          });
        }
    },
    { root, rootMargin: "240px" },
  );
  return {
    observe(img, file) {
      let record = records.get(file);
      if (!record) {
        record = {
          images: new Set(),
          url: null,
          pending: false,
          failed: false,
        };
        records.set(file, record);
      }
      record.images.add(img);
      bindings.set(img, { file, record });
      if (record.url) {
        img.src = record.url;
        img.closest(".photo-preview").classList.add("loaded");
      } else if (record.failed) {
        img.closest(".photo-preview").classList.add("unavailable");
      } else observer.observe(img);
    },
    disconnect() {
      observer.disconnect();
      for (const r of records.values()) r.images.clear();
    },
    reset() {
      generation++;
      observer.disconnect();
      for (const r of records.values()) if (r.url) URL.revokeObjectURL(r.url);
      records.clear();
    },
  };
}
