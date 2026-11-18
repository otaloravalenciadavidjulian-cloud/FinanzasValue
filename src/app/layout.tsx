import type { Metadata } from "next";
import Link from "next/link";
import { sesionActual } from "@/lib/auth/sesion";
import { salir } from "./login/acciones";
import "./globals.css";

export const metadata: Metadata = { title: "Value Finanzas", description: "Gestión financiera empresarial" };

const menu = [
  ["/", "Dashboard"], ["/facturas", "Ingresos y facturación"], ["/facturas/nueva", "Nueva factura"], ["/clientes", "Clientes"],
  ["/gastos", "Gastos"], ["/gastos/nuevo", "Nuevo gasto"], ["/proveedores", "Proveedores"], ["/tesoreria", "Tesorería"], ["/impuestos", "Impuestos"], ["/contabilidad", "Contabilidad"],
] as const;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const s = await sesionActual();
  return (
    <html lang="es">
      <body>
        {s ? (
          <div className="app">
            <aside>
              <b>Value</b>
              <nav>{menu.map(([href, txt]) => <Link key={href} href={href}>{txt}</Link>)}</nav>
              <form action={salir} style={{ marginTop: 24, padding: "0 10px", fontSize: 12 }}>
                <div>{s.nombre}</div>
                <div style={{ opacity: 0.7 }}>{s.rol}</div>
                <button className="btn" style={{ marginTop: 8, padding: "4px 10px" }}>Cerrar sesión</button>
              </form>
            </aside>
            <main>{children}</main>
          </div>
        ) : (
          <main style={{ minHeight: "100vh", placeItems: "center" }}>{children}</main>
        )}
      </body>
    </html>
  );
}
