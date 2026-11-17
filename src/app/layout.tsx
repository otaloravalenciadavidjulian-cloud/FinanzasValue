import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "Value Finanzas", description: "Gestión financiera empresarial" };

const menu = [
  ["/", "Dashboard"], ["/facturas", "Ingresos y facturación"], ["/facturas/nueva", "Nueva factura"],
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <div className="app">
          <aside>
            <b>Value</b>
            <nav>{menu.map(([href, txt]) => <Link key={href} href={href}>{txt}</Link>)}</nav>
          </aside>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
