"use client";
import { useEffect } from "react";
import { esDesfaseDeVersion } from "@/lib/ui/version";

/**
 * Error en una página. Si la causa es que se ha publicado una versión nueva mientras la página estaba abierta
 * (los archivos de la versión anterior ya no existen), se recarga sola una vez. Si no, se explica y se ofrece reintentar.
 */
export default function ErrorPagina({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const desfase = esDesfaseDeVersion(error);
  useEffect(() => {
    if (!desfase) return;
    try {
      if (sessionStorage.getItem("value_recargado") === location.pathname) return;
      sessionStorage.setItem("value_recargado", location.pathname);
    } catch { /* sin almacenamiento, se recarga igualmente */ }
    location.reload();
  }, [desfase]);
  return (
    <div className="panel" style={{ display: "grid", gap: 10, maxWidth: 560 }}>
      <b>{desfase ? "Hay una versión nueva de Value" : "Algo ha fallado"}</b>
      <p className="muted" style={{ margin: 0 }}>
        {desfase ? "Recarga la página para continuar." : "No se ha podido completar la operación. Vuelve a intentarlo; si se repite, recarga la página."}
        {error.digest ? ` Código: ${error.digest}` : ""}
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        {!desfase && <button className="btn" onClick={() => reset()}>Reintentar</button>}
        <button className="btn secundario" onClick={() => location.reload()}>Recargar la página</button>
      </div>
    </div>
  );
}
