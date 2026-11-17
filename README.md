# Value Finanzas

Plataforma web de gestión financiera empresarial para empresas españolas: facturación con
VERI*FACTU, ingresos, gastos, tesorería, impuestos, rentabilidad y presupuestos.

Este repositorio contiene la **fase 1**: la base técnica y el núcleo de facturación.

## Qué incluye

- **Facturación conforme al RD 1619/2012**: series por ejercicio, numeración correlativa sin huecos,
  desglose de base y cuota por tipo de IVA, retención de IRPF y rectificativas enlazadas a la original.
- **Registro de facturación VERI*FACTU (RD 1007/2023, Orden HAC/1177/2024)**: cada alta y cada
  anulación genera un registro con huella SHA-256 encadenada a la anterior. El cálculo está probado
  con el ejemplo oficial de la AEAT. Incluye la URL del QR tributario.
- **Inalterabilidad en la propia base de datos**: los disparadores de PostgreSQL impiden modificar o
  borrar facturas emitidas, sus líneas, los registros de facturación y la auditoría. Las correcciones
  se hacen con rectificativas o registros de anulación.
- **Aislamiento entre empresas** con Row Level Security: sin contexto de empresa no se ve ninguna fila.
- **Auditoría** de cada emisión y anulación.

Pendiente dentro de la fase 1: autenticación y roles, generación del XML y envío SOAP a la AEAT con
certificado, PDF con imagen corporativa y QR, y la declaración responsable del sistema.

## Normativa: fechas a 17/11/2026

| Obligación | Fecha | Norma |
| --- | --- | --- |
| VERI*FACTU, sociedades | 01/01/2027 | RDL 15/2025 |
| VERI*FACTU, resto de obligados | 01/07/2027 | RDL 15/2025 |
| Factura electrónica B2B, más de 8 M€ | 06/10/2027 | Ley 18/2022, RD 238/2026, Orden HAC/1028/2026 |
| Factura electrónica B2B, resto | 06/10/2028 | Ídem |

Hacienda anunció el 05/10/2026 un aplazamiento de VERI*FACTU a octubre de 2028 que aún no está en el
BOE. Comprobar en el BOE antes de pasar a producción.

## Puesta en marcha

Requisitos: Node.js 22 y PostgreSQL 16.

```bash
npm install
cp .env.example .env.local          # ajusta DATABASE_URL
npm run db:migrate
npm run db:seed                     # muestra EMPRESA_DEMO_ID; añádelo a .env.local
npm run dev
```

**Importante:** conecta la aplicación con un rol de PostgreSQL que no sea superusuario ni tenga
`BYPASSRLS`. Esos roles se saltan el aislamiento entre empresas, y la aplicación se niega a usarlos.

## Tests

```bash
npm test                                                     # tests unitarios
DATABASE_URL_TEST=postgres://… npm test                      # + tests contra PostgreSQL
```

Los tests de base de datos borran y recrean el esquema `public` de la base indicada: usa una base
exclusiva para tests.

## Estructura

```
db/migrations/          SQL: tablas, disparadores de inalterabilidad y políticas por empresa
src/lib/fiscal/         importes en céntimos, totales e IVA, validación de NIF
src/lib/verifactu/      huella encadenada y QR tributario
src/lib/facturacion/    emisión y anulación de facturas en una transacción
src/app/                pantallas (Next.js)
tests/                  tests unitarios y de base de datos
```

## Aviso

Value prepara datos fiscales pero no presenta declaraciones. Los cálculos de IVA deducible y
retenciones deben revisarse con un asesor fiscal antes de usarse en real.
