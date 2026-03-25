// supabase/functions/stripe-webhook/index.ts
// Deploy: npx supabase functions deploy stripe-webhook
//
// Required env vars:
//   STRIPE_SECRET_KEY       = sk_test_... or sk_live_...
//   STRIPE_WEBHOOK_SECRET   = whsec_... (from Stripe Dashboard > Webhooks)
//   SUPABASE_URL            = https://czehgzjlcoipectnqtsw.supabase.co
//   SUPABASE_SERVICE_KEY    = eyJ... (service_role key)
//   RESEND_API_KEY          = re_...
//   CENTRO_EMAIL            = info@movementlabbcn.com
//   CENTRO_NOMBRE           = Movement Lab Bcn
//   CENTRO_TELEFONO         = +34 XXX XXX XXX
//   CENTRO_DIRECCION        = Carrer Exemple 42, Barcelona
//
// IMPORTANT: In Stripe Dashboard, create a webhook endpoint pointing to:
//   https://czehgzjlcoipectnqtsw.supabase.co/functions/v1/stripe-webhook
// Listen for events: payment_intent.succeeded, payment_intent.payment_failed, charge.refunded

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@13";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_KEY")!
);

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  // ── CRÍTICO: verificar firma HMAC antes de procesar nada ──
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature!,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return new Response("Webhook signature invalid", { status: 400 });
  }

  // ── Procesar eventos ──
  try {
    switch (event.type) {

      // ── Pago completado con éxito ──
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const citaId = pi.metadata.citaId;
        const citaRef = pi.metadata.citaRef;
        if (!citaId) break;

        // Confirmar la cita — ÚNICA forma de pasar a "confirmada"
        await supabase
          .from("citas")
          .update({ estado: "confirmada", expires_at: null })
          .eq("id", citaId);

        // Marcar pago como completado
        await supabase
          .from("pagos")
          .update({
            estado: "completado",
            pagado_at: new Date().toISOString(),
            stripe_raw: pi,
          })
          .eq("stripe_payment_intent_id", pi.id);

        // Obtener datos completos de la cita para emails
        const { data: cita } = await supabase
          .from("citas")
          .select("*, profesionales(nombre), servicios(nombre)")
          .eq("id", citaId)
          .single();

        if (cita) {
          // Programar recordatorio 24h antes en la tabla recordatorios
          const citaDate = new Date(`${cita.fecha}T${cita.hora}`);
          const reminder24h = new Date(citaDate.getTime() - 24 * 60 * 60 * 1000);

          await supabase.from("recordatorios").insert([
            {
              cita_id: citaId,
              tipo: "confirmacion",
              estado: "pendiente",
              scheduled_at: new Date().toISOString(),
            },
            {
              cita_id: citaId,
              tipo: "recordatorio_24h",
              estado: "pendiente",
              scheduled_at: reminder24h.toISOString(),
            },
          ]);

          // Enviar email de confirmación inmediata
          await sendConfirmationEmail(cita, citaRef);
        }
        break;
      }

      // ── Pago fallido ──
      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const citaId = pi.metadata.citaId;
        if (!citaId) break;

        // Liberar el slot — cancelar la cita pendiente
        await supabase
          .from("citas")
          .update({ estado: "cancelada" })
          .eq("id", citaId)
          .eq("estado", "pendiente_pago");

        await supabase
          .from("pagos")
          .update({ estado: "fallido", stripe_raw: pi })
          .eq("stripe_payment_intent_id", pi.id);

        break;
      }

      // ── Reembolso desde Stripe Dashboard ──
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const piId = charge.payment_intent as string;

        const { data: pago } = await supabase
          .from("pagos")
          .select("cita_id")
          .eq("stripe_payment_intent_id", piId)
          .single();

        if (pago) {
          await supabase
            .from("citas")
            .update({ estado: "cancelada" })
            .eq("id", pago.cita_id);

          await supabase
            .from("pagos")
            .update({
              estado: "reembolsado",
              reembolsado_at: new Date().toISOString(),
            })
            .eq("stripe_payment_intent_id", piId);
        }
        break;
      }
    }

    // Siempre responder 200 para que Stripe no reintente
    return new Response(JSON.stringify({ received: true }), { status: 200 });

  } catch (error) {
    console.error("Webhook processing error:", error);
    // 200 igualmente — si devolvemos 5xx Stripe reintentará indefinidamente
    return new Response(JSON.stringify({ error: error.message }), { status: 200 });
  }
});

// ── Email de confirmación de cita ──
async function sendConfirmationEmail(cita: any, ref: string) {
  const fechaFormateada = new Date(cita.fecha + "T12:00:00").toLocaleDateString(
    "es-ES",
    { weekday: "long", year: "numeric", month: "long", day: "numeric" }
  );

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#111827;max-width:560px;margin:0 auto;padding:24px">
  <div style="background:#0B2240;padding:20px 24px;border-radius:12px 12px 0 0">
    <h1 style="color:white;font-size:1.3rem;margin:0">Reserva confirmada ✓</h1>
    <p style="color:rgba(255,255,255,.6);margin:4px 0 0;font-size:.85rem">${Deno.env.get("CENTRO_NOMBRE") || "Movement Lab Bcn"}</p>
  </div>
  <div style="background:#F2FAF7;border:1px solid #E8F5F1;padding:20px 24px">
    <p style="font-size:1rem;margin:0 0 16px">Hola <strong>${cita.paciente_nombre}</strong>,</p>
    <p style="color:#6B7280;margin:0 0 20px">Tu cita ha sido confirmada y el pago procesado. Aquí tienes los detalles:</p>
    <table style="width:100%;border-collapse:collapse">
      <tr style="border-bottom:1px solid #E8F5F1">
        <td style="padding:10px 0;color:#6B7280;font-size:.88rem">Servicio</td>
        <td style="padding:10px 0;font-weight:600;font-size:.88rem">${cita.servicios?.nombre || cita.servicio_id}</td>
      </tr>
      <tr style="border-bottom:1px solid #E8F5F1">
        <td style="padding:10px 0;color:#6B7280;font-size:.88rem">Profesional</td>
        <td style="padding:10px 0;font-weight:600;font-size:.88rem">${cita.profesionales?.nombre || cita.prof_id}</td>
      </tr>
      <tr style="border-bottom:1px solid #E8F5F1">
        <td style="padding:10px 0;color:#6B7280;font-size:.88rem">Fecha</td>
        <td style="padding:10px 0;font-weight:600;font-size:.88rem">${fechaFormateada}</td>
      </tr>
      <tr style="border-bottom:1px solid #E8F5F1">
        <td style="padding:10px 0;color:#6B7280;font-size:.88rem">Hora</td>
        <td style="padding:10px 0;font-weight:600;font-size:.88rem">${cita.hora} – ${cita.hora_fin}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;color:#6B7280;font-size:.88rem">Referencia</td>
        <td style="padding:10px 0;font-family:monospace;font-weight:600;color:#1A8C6E;font-size:.9rem">${ref}</td>
      </tr>
    </table>
  </div>
  <div style="background:white;border:1px solid #E5E8EF;border-top:none;padding:16px 24px;border-radius:0 0 12px 12px">
    <p style="font-size:.82rem;color:#6B7280;margin:0 0 6px">
      📍 ${Deno.env.get("CENTRO_DIRECCION") || "Dirección del centro"}
    </p>
    <p style="font-size:.82rem;color:#6B7280;margin:0">
      ¿Necesitas cancelar o cambiar tu cita? Llámanos al
      <strong>${Deno.env.get("CENTRO_TELEFONO") || "+34 XXX XXX XXX"}</strong>
      con al menos 24h de antelación.
    </p>
  </div>
</body>
</html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${Deno.env.get("CENTRO_NOMBRE") || "Movement Lab Bcn"} <no-reply@movementlabbcn.com>`,
      to: [cita.paciente_email],
      bcc: [Deno.env.get("CENTRO_EMAIL")!], // copia al centro
      subject: `✓ Cita confirmada · ${fechaFormateada}`,
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Resend error:", err);
  }
}
