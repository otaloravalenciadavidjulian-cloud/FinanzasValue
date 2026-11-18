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

- **Inicio de sesión** con contraseña (scrypt), sesiones de 12 horas, bloqueo tras 5 intentos fallidos,
  registro de accesos y roles (administrador, dirección, contable, gestoría, empleado).
- **Configuración inicial** en `/configuracion-inicial`, protegida con `SETUP_TOKEN` y de un solo uso.
- **Clientes**: alta con validación de NIF/CIF.
- **Factura en PDF** (`/facturas/<id>/pdf`) con los datos del art. 6 del RD 1619/2012 y, al inicio,
  el QR tributario con la leyenda VERI*FACTU. En el entorno de pruebas lleva un aviso de que no tiene
  validez fiscal; las anuladas llevan una marca.
- **XML de los registros VERI*FACTU** (`/facturas/<id>/xml`) según `SuministroLR.xsd` y
  `SuministroInformacion.xsd` de la AEAT (copiados en `docs/aeat/xsd`). Se genera siempre a partir de
  lo guardado, comprueba que la huella corresponde a los datos y los tests lo validan contra el XSD.
  Incluye el sobre SOAP para el envío, que aún no se realiza.

- **Cobros** parciales de cada factura con estado (pendiente, cobro parcial, vencida, cobrada) y lo
  pendiente de cobro. Los cobros no se borran: se corrigen con un cobro de signo contrario.
- **Proveedores**: alta con validación de NIF. Un mismo tercero puede ser cliente y proveedor.
- **Gastos** (facturas recibidas y tickets): categorías ligadas a cuentas del PGC, varias bases por
  tipo de IVA, % de IVA deducible, retención, vencimiento y pagos parciales. Se rechaza registrar dos
  veces la misma factura de un proveedor y se avisa de posibles duplicados (mismo proveedor e importe en
  7 días). Sin justificante adjunto quedan marcados como pendientes de documentación. Nada se borra:
  van a una papelera con motivo y se pueden restaurar. El rol empleado solo ve sus propios gastos.
  Se pueden corregir: cada edición queda en la auditoría con el valor anterior y el nuevo, y en la
  ficha del gasto se ve su historial. El total no puede quedar por debajo de lo ya pagado.
- **Justificantes** (PDF, JPG, PNG o WEBP, hasta 4 MB; las fotos grandes se reducen en el navegador):
  se guardan en la propia base con su huella SHA-256, que se comprueba en cada descarga
  (`/documentos/<id>`). Un mismo archivo no puede justificar dos gastos activos. No se borran: van a la
  papelera con motivo, y el gasto vuelve a quedar pendiente si se queda sin ninguno.
- **Lectura de justificantes** al crear un gasto: se lee el QR tributario de la foto (gratis) y, si
  hay `ANTHROPIC_API_KEY`, el documento con IA. Solo propone datos: el usuario los revisa y guarda.
  Lo que no se lee con claridad queda vacío, el QR manda sobre lo impreso si no coinciden, se avisa
  si las bases y cuotas no suman el total, y si el NIF no está dado de alta se ofrece crearlo.

- **Tesorería**: cuentas bancarias con IBAN validado e importación de extractos en Norma 43
  (cuaderno 43 de la AEB, el que exportan todos los bancos españoles). Se comprueban los totales y el
  saldo del propio fichero, el mismo fichero no se importa dos veces y los movimientos repetidos de
  extractos solapados se ignoran. Los movimientos no se modifican ni se borran. Si el saldo calculado
  no coincide con el del último extracto, se avisa de que falta alguno.
- **Conciliación bancaria** (`/tesoreria/conciliar`): para cada movimiento se proponen, por importe,
  número de documento y nombre en el concepto, el cobro o pago ya registrado, o la factura o el gasto
  pendiente (y entonces se registra el cobro o pago y se concilia a la vez). Los movimientos sin
  factura se explican con una categoría (comisiones, impuestos, nóminas…). Una conciliación se deshace
  con motivo, nunca se borra.
- **Previsión de tesorería** (`/tesoreria/prevision`) a 13 semanas: saldo en bancos más cobros y
  menos pagos pendientes según su vencimiento (o los días de pago del tercero), con lo vencido aparte
  y los pagos recurrentes sin factura estimados con la media de los últimos 90 días conciliados.
  Avisa de la primera semana con saldo negativo.
- **Dashboard** con facturación y gastos del mes, saldo en bancos, previsión, cobros y pagos vencidos,
  movimientos por conciliar y gastos sin justificante.

Importe total del registro: en VERI*FACTU es base más cuotas; la retención de IRPF no se descuenta
(sí en el total a pagar del PDF). Las líneas al 0 % todavía no generan XML porque hay que indicar la
causa de exención o no sujeción.

Pendiente dentro de la fase 1: doble factor, gestión de usuarios, envío SOAP a la AEAT con el
certificado de la empresa, logotipo en el PDF, causas de exención y la declaración responsable del sistema.

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

## Despliegue en Netlify + Neon

1. En Neon, copia la cadena de conexión del proyecto (rol propietario, con `-pooler`).
2. En Netlify, importa este repositorio de GitHub. `netlify.toml` ya define la compilación.
3. En Netlify, en *Site configuration → Environment variables*, crea:
   - `DATABASE_OWNER_URL`: la cadena de Neon. Solo se usa para aplicar las migraciones al compilar.
   - `APP_DB_PASSWORD`: 24 caracteres aleatorios o más. Crea el rol `value_app`, con el que trabaja la aplicación.
   - `SETUP_TOKEN`: 16 caracteres aleatorios o más, para la configuración inicial.
   - `VERIFACTU_ENTORNO`: `pruebas`.
   - Opcional: `SIF_PRODUCTOR_NIF` y `SIF_PRODUCTOR_NOMBRE`, quien desarrolla el software. Sin ellas,
     el registro indica que la propia empresa es la productora del sistema.
   - Opcional: `ANTHROPIC_API_KEY`, para leer facturas y tickets de gasto con IA (Claude). Sin ella
     solo se lee el QR tributario de las fotos y el resto de datos se escriben a mano.
4. Despliega y abre `/configuracion-inicial` para crear la empresa y el administrador.

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
src/lib/verifactu/      huella encadenada, QR tributario y XML de los registros
src/lib/facturacion/    emisión y anulación en una transacción, PDF de la factura
src/lib/gastos/         facturas recibidas y tickets, categorías con su cuenta del PGC
src/lib/tesoreria/      cuentas bancarias, IBAN e importación de extractos Norma 43
src/lib/documentos/     justificantes (contenido y huella SHA-256) y su lectura por QR o IA
docs/aeat/xsd/          esquemas oficiales de la AEAT para validar el XML
src/app/                pantallas (Next.js)
tests/                  tests unitarios y de base de datos
```

## Aviso

Value prepara datos fiscales pero no presenta declaraciones. Los cálculos de IVA deducible y
retenciones deben revisarse con un asesor fiscal antes de usarse en real.
