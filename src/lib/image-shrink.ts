/**
 * Browser-only. Re-encodes a large photo so the upload stays under the hosting request limit (Vercel refuses request
 * bodies above about 4.5 MB). Smaller files are returned untouched. The picture is scaled down and saved as JPEG on a
 * white background, so a transparent PNG loses its transparency: only files above `targetBytes` are ever touched.
 */
export async function shrinkImage(file: File, targetBytes = 3.5 * 1024 * 1024): Promise<File> {
  if (file.size <= targetBytes || typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { return file; }   // not decodable here: let the server judge it
  try {
    let edge = Math.min(2600, Math.max(bitmap.width, bitmap.height));
    for (let quality = 0.86, attempt = 0; attempt < 5; attempt++, quality -= 0.08, edge = Math.round(edge * 0.82)) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= targetBytes) return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    }
    return file;
  } finally {
    bitmap.close();
  }
}
