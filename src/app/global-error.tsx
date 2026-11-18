"use client";
import { useEffect } from "react";
import { esDesfaseDeVersion } from "@/lib/ui/version";

/** Último recurso si falla el propio diseño de la aplicación. */
export default function ErrorGlobal({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    if (!esDesfaseDeVersion(error)) return;
    try {
      if (sessionStorage.getItem("value_recargado_global")) return;
      sessionStorage.setItem("value_recargado_global", "1");
    } catch { /* se recarga igualmente */ }
    location.reload();
  }, [error]);
  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
        <p><b>Algo ha fallado.</b> Recarga la página para continuar.{error.digest ? ` Código: ${error.digest}` : ""}</p>
        <button onClick={() => location.reload()}>Recargar la página</button>
      </body>
    </html>
  );
}
