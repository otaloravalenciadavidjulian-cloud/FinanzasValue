/**
 * Errores típicos de una pestaña abierta con una versión anterior de la aplicación: tras publicar, los archivos
 * JavaScript y las acciones de servidor de la versión vieja dejan de existir.
 */
export function esDesfaseDeVersion(error: { name?: string; message?: string }): boolean {
  const texto = `${error.name ?? ""} ${error.message ?? ""}`;
  return /ChunkLoadError|Loading (CSS )?chunk|Failed to find Server Action|Server Action .* not found|failed-to-find-server-action|dynamically imported module|Failed to fetch|NetworkError/i.test(texto);
}
