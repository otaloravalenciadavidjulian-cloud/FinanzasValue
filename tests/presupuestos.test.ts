import { describe, expect, it } from "vitest";
import { comparar, PARTIDAS, proponerDesdeReal, type Valores } from "@/lib/presupuestos/presupuesto";

const vacio = (): Valores => Object.fromEntries(PARTIDAS.map((p) => [p.codigo, Array(12).fill(0)]));

describe("presupuestos", () => {
  it("compara hasta el mes indicado y marca las desviaciones desfavorables", () => {
    const pres = vacio(), real = vacio();
    pres.ingresos = Array(12).fill(100000); pres.alquileres = Array(12).fill(20000);
    real.ingresos[0] = 90000; real.ingresos[1] = 120000; real.ingresos[2] = 500000; // marzo queda fuera
    real.alquileres[0] = 20000; real.alquileres[1] = 25000;
    real.publicidad[1] = 3000; // sin presupuesto
    const { filas, resultado } = comparar(pres, real, 2);
    const f = Object.fromEntries(filas.map((x) => [x.partida, x]));
    expect(f.ingresos).toMatchObject({ presupuestoCent: 200000, realCent: 210000, desviacionCent: 10000, ejecucionPct: 105, desfavorable: false, presupuestoAnualCent: 1200000 });
    expect(f.alquileres).toMatchObject({ presupuestoCent: 40000, realCent: 45000, desfavorable: true, ejecucionPct: 112.5 });
    expect(f.publicidad).toMatchObject({ presupuestoCent: 0, realCent: 3000, ejecucionPct: null, desfavorable: true });
    expect(f.seguros).toBeUndefined();
    expect(resultado).toEqual({ presupuestoCent: 160000, realCent: 210000 - 45000 - 3000 });
  });

  it("propone desde lo real con un ajuste, redondeando a euros", () => {
    const real = vacio(); real.ingresos[0] = 123456;
    expect(proponerDesdeReal(real, 10).ingresos[0]).toBe(135800);
  });
});
