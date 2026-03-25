# Movement Lab Bcn · Supabase Edge Functions
# Guía de despliegue cuando tengas las claves de Stripe y Resend

## Estructura de carpetas (ya creada)

```
supabase/
├── config.toml
└── functions/
    ├── create-payment/
    │   └── index.ts      ← Crea PaymentIntent + cita pendiente
    ├── stripe-webhook/
    │   └── index.ts      ← Confirma citas (único punto de confianza)
    └── send-reminder/
        └── index.ts      ← Cron job diario de recordatorios
```

## Paso 1 — Instalar Supabase CLI (una sola vez)

```bash
npm install -g supabase
supabase login
supabase link --project-ref czehgzjlcoipectnqtsw
```

## Paso 2 — Configurar variables de entorno en Supabase Dashboard

Ve a: **Supabase Dashboard → Settings → Edge Functions → Secrets**

Añade estas variables (una por una):

| Variable               | Valor                                   |
|------------------------|------------------------------------------|
| `STRIPE_SECRET_KEY`    | `sk_test_...` (de Stripe Dashboard)     |
| `STRIPE_WEBHOOK_SECRET`| `whsec_...` (del webhook endpoint)      |
| `RESEND_API_KEY`       | `re_...` (de Resend Dashboard)          |
| `SUPABASE_URL`         | `https://czehgzjlcoipectnqtsw.supabase.co` |
| `SUPABASE_SERVICE_KEY` | La **service_role** key (NO la anon)    |
| `CENTRO_EMAIL`         | `info@movementlabbcn.com`               |
| `CENTRO_NOMBRE`        | `Movement Lab Bcn`                      |
| `CENTRO_TELEFONO`      | `+34 XXX XXX XXX`                       |
| `CENTRO_DIRECCION`     | `Carrer Exemple 42, Barcelona`          |

## Paso 3 — Desplegar las funciones

Ejecuta desde la raíz del proyecto (`movement-bcn-/`):

```bash
npx supabase functions deploy create-payment --project-ref czehgzjlcoipectnqtsw
npx supabase functions deploy stripe-webhook --project-ref czehgzjlcoipectnqtsw
npx supabase functions deploy send-reminder --project-ref czehgzjlcoipectnqtsw
```

## Paso 4 — Configurar el webhook en Stripe

1. Ve a **Stripe Dashboard → Developers → Webhooks → Add endpoint**
2. URL del endpoint:
   ```
   https://czehgzjlcoipectnqtsw.supabase.co/functions/v1/stripe-webhook
   ```
3. Selecciona estos eventos:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `charge.refunded`
4. Copia el **Signing secret** (`whsec_...`) y añádelo como `STRIPE_WEBHOOK_SECRET` en el paso 2.

## Paso 5 — Configurar el cron job de recordatorios

En **Supabase Dashboard → Edge Functions → send-reminder → Schedule**:
- Cron expression: `0 8 * * *` (cada día a las 08:00 UTC)

## Paso 6 — Poner la Stripe publishable key en el wizard

En `html_files/reservar-v3.html`, línea ~393:
```javascript
STRIPE_PK: 'pk_test_...',  // ← sustituir con tu publishable key de Stripe
```

---

## URLs de las funciones desplegadas

| Función          | URL                                                                              |
|------------------|-----------------------------------------------------------------------------------|
| create-payment   | `https://czehgzjlcoipectnqtsw.supabase.co/functions/v1/create-payment`          |
| stripe-webhook   | `https://czehgzjlcoipectnqtsw.supabase.co/functions/v1/stripe-webhook`          |
| send-reminder    | `https://czehgzjlcoipectnqtsw.supabase.co/functions/v1/send-reminder`           |
