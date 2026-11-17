import { redirect } from "next/navigation";
import { db } from "@/db/cliente";
import { Formulario } from "./formulario";

export const dynamic = "force-dynamic";

export default async function ConfiguracionInicial() {
  const [{ n }] = await db()<{ n: number }[]>`SELECT count(*)::int AS n FROM usuarios`;
  if (n > 0) redirect("/login");
  return <Formulario />;
}
