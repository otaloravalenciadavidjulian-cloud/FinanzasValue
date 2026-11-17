/** Reduce en el navegador las fotos grandes antes de subirlas (el servidor admite hasta 4 MB). */
const LADO_MAXIMO = 2400;
const DIRECTOS = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export async function prepararArchivo(archivo: File): Promise<File> {
  const esImagen = archivo.type.startsWith("image/");
  if (!esImagen || (DIRECTOS.includes(archivo.type) && archivo.size <= 1.5 * 1024 * 1024)) return archivo;
  try {
    const img = await createImageBitmap(archivo);
    const escala = Math.min(1, LADO_MAXIMO / Math.max(img.width, img.height));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(img.width * escala);
    lienzo.height = Math.round(img.height * escala);
    lienzo.getContext("2d")!.drawImage(img, 0, 0, lienzo.width, lienzo.height);
    const blob = await new Promise<Blob | null>((r) => lienzo.toBlob(r, "image/jpeg", 0.85));
    if (!blob) return archivo;
    return new File([blob], archivo.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return archivo; // formato que el navegador no sabe abrir: se manda tal cual y el servidor decide
  }
}

/** Sustituye en el FormData el archivo elegido por su versión reducida. */
export async function conArchivoPreparado(f: FormData): Promise<FormData> {
  const a = f.get("archivo");
  if (a instanceof File && a.size > 0) f.set("archivo", await prepararArchivo(a));
  return f;
}
