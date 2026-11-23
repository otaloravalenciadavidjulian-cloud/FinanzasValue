import { NextResponse, type NextRequest } from "next/server";

/** Sin cookie de sesión, todo redirige al inicio de sesión. La sesión se valida después en el servidor. */
export function middleware(req: NextRequest) {
  const libre = req.nextUrl.pathname === "/login" || req.nextUrl.pathname === "/login/recuperar" || req.nextUrl.pathname === "/configuracion-inicial";
  if (!libre && !req.cookies.get("value_sesion")) return NextResponse.redirect(new URL("/login", req.url));
  const res = NextResponse.next();
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "same-origin");
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|marca/).*)"] };
