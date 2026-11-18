import type { Metadata } from "next";
import Link from "next/link";
import { sesionActual } from "@/lib/auth/sesion";
import { salir } from "./login/acciones";
import "./globals.css";

export const metadata: Metadata = { title: "vdn value · Finanzas", description: "Gestión financiera empresarial" };

const menu = [
  ["/", "Dashboard"], ["/facturas", "Ingresos y facturación"], ["/facturas/nueva", "Nueva factura"], ["/socios", "Socios y financiación"], ["/clientes", "Clientes"],
  ["/gastos", "Gastos"], ["/gastos/nuevo", "Nuevo gasto"], ["/proveedores", "Proveedores"], ["/tesoreria", "Tesorería"], ["/impuestos", "Impuestos"], ["/contabilidad", "Contabilidad"], ["/rentabilidad", "Rentabilidad"], ["/proyectos", "Proyectos"], ["/presupuestos", "Presupuestos"], ["/informes", "Informes"],
] as const;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const s = await sesionActual();
  return (
    <html lang="es">
      <body>
        {s ? (
          <div className="app">
            <aside>
              <Link href="/" className="marca" aria-label="Value, inicio"><img src="/marca/logo-blanco.png" alt="vdn value" width={160} height={34} /></Link>
              <nav>
                {menu.map(([href, txt]) => <Link key={href} href={href}>{txt}</Link>)}
                {s.rol !== "empleado" && <Link href="/empresa">Empresa</Link>}
                {s.rol === "administrador" && <Link href="/usuarios">Usuarios</Link>}
                <Link href="/cuenta">Mi cuenta</Link>
              </nav>
              <form action={salir} style={{ marginTop: 24, padding: "0 10px", fontSize: 12 }}>
                <div>{s.nombre}</div>
                <div style={{ opacity: 0.7 }}>{s.rol}</div>
                <button className="btn" style={{ marginTop: 8, padding: "4px 10px" }}>Cerrar sesión</button>
              </form>
            </aside>
            <main>{children}</main>
          </div>
        ) : (
          <div className="acceso">
            <section className="acceso-marca" aria-label="vdn value">
              <img className="acceso-logo" src="/marca/logo-blanco.png" alt="vdn value" width={260} height={56} />
              <div className="acceso-lema">
                <p className="acceso-titular">Las finanzas de tu empresa,<br />claras y al día.</p>
                <ul>
                  <li>Facturación conforme a la normativa española</li>
                  <li>Tesorería, impuestos y contabilidad en un solo lugar</li>
                  <li>Datos cifrados y aislados por empresa</li>
                </ul>
              </div>
              <p className="acceso-pie">vdn value · Gestión financiera</p>
            </section>
            <main className="acceso-lado">
              <img className="acceso-logo-movil" src="/marca/logo-negro.png" alt="vdn value" width={180} height={39} />
              {children}
            </main>
          </div>
        )}
      </body>
    </html>
  );
}
