/**
 * Empresa activa. Provisional hasta que llegue la autenticación (siguiente paso de la fase 1):
 * entonces saldrá de la sesión del usuario y de sus membresías.
 */
export function empresaActualId(): string {
  const id = process.env.EMPRESA_DEMO_ID;
  if (!id) throw new Error("Falta EMPRESA_DEMO_ID. Ejecuta `npm run db:seed` y copia el identificador que muestra.");
  return id;
}
