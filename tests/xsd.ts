import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const hayXmllint = spawnSync("xmllint", ["--version"]).status === 0;

/** Valida un documento contra SuministroLR.xsd de la AEAT. Devuelve la salida de xmllint si falla. */
export function validarContraXSD(xml: string): string | null {
  const dir = mkdtempSync(join(tmpdir(), "value-xsd-"));
  const fichero = join(dir, "registro.xml");
  writeFileSync(fichero, xml);
  try {
    execFileSync("xmllint", ["--noout", "--nonet", "--schema", resolve("docs/aeat/xsd/SuministroLR.xsd"), fichero], { stdio: "pipe" });
    return null;
  } catch (e) {
    const err = e as { stderr?: Buffer };
    return err.stderr?.toString() ?? String(e);
  }
}
