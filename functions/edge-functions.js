// ═══════════════════════════════════════════════════════════════
// MOVEMENT LAB BCN · FASE 3
// Supabase Edge Functions
//
// ESTRUCTURA DE CARPETAS (en tu repo):
//   supabase/
//     functions/
//       create-payment/index.ts     ← esta función
//       stripe-webhook/index.ts     ← esta función
//       send-reminder/index.ts      ← esta función
//
// DEPLOY:
//   npx supabase functions deploy create-payment
//   npx supabase functions deploy stripe-webhook
//   npx supabase functions deploy send-reminder
//
// VARIABLES DE ENTORNO (Supabase Dashboard > Settings > Edge Functions):
//   STRIPE_SECRET_KEY        = sk_live_...  (o sk_test_... para pruebas)
//   STRIPE_WEBHOOK_SECRET    = whsec_...    (del endpoint de Stripe Dashboard)
//   RESEND_API_KEY           = re_...
//   SUPABASE_URL             = https://xxx.supabase.co
//   SUPABASE_SERVICE_KEY     = eyJ...  (service_role key, NO la anon)
//   CENTRO_EMAIL             = info@movementlabbcn.com
//   CENTRO_NOMBRE            = Movement Lab Bcn
//   CENTRO_TELEFONO          = +34 XXX XXX XXX
//   CENTRO_DIRECCION         = Carrer Exemple 42, Barcelona
// ═══════════════════════════════════════════════════════════════


// ───────────────────────────────────────────────────────────────
// FUNCIÓN 1: create-payment
// Llamada desde el frontend antes de mostrar el formulario de tarjeta.
// Crea un PaymentIntent en Stripe y una cita en estado "pendiente_pago".
// Devuelve el clientSecret para que Stripe Elements complete el pago.
// ───────────────────────────────────────────────────────────────

// supabase/functions/create-payment/index.ts
/*
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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const {
      servicioId, profId, fecha, hora, horaFin, durMin,
      pacienteNombre, pacienteEmail, pacienteTel, nota,
      usuarioId  // null si es invitado
    } = body;

    // 1. Validar campos obligatorios
    if (!servicioId || !profId || !fecha || !hora || !pacienteNombre || !pacienteEmail) {
      return new Response(JSON.stringify({ error: "Faltan campos obligatorios" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    // 2. Obtener precio del servicio
    const { data: servicio, error: servErr } = await supabase
      .from("servicios")
      .select("precio, nombre")
      .eq("id", servicioId)
      .single();
    if (servErr || !servicio) throw new Error("Servicio no encontrado");

    // 3. Comprobar que el slot sigue libre (doble check crítico)
    const { data: conflictos } = await supabase
      .from("citas")
      .select("id")
      .eq("prof_id", profId)
      .eq("fecha", fecha)
      .neq("estado", "cancelada")
      .gte("hora", hora)     // simplificado — en producción usar overlap SQL
      .lt("hora", horaFin);

    if (conflictos && conflictos.length > 0) {
      return new Response(JSON.stringify({
        error: "Este horario ya no está disponible. Por favor elige otro."
      }), { status: 409, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // 4. Crear PaymentIntent en Stripe
    const importeCentimos = Math.round(Number(servicio.precio) * 100);
    const paymentIntent = await stripe.paymentIntents.create({
      amount: importeCentimos,
      currency: "eur",
      automatic_payment_methods: { enabled: true },
      metadata: {
        servicioId, profId, fecha, hora, horaFin,
        pacienteNombre, pacienteEmail, durMin: String(durMin),
        // Estos metadatos viajan al webhook para crear la cita confirmada
      },
      description: `${servicio.nombre} - ${pacienteNombre} - ${fecha} ${hora}`,
      receipt_email: pacienteEmail,
    });

    // 5. Crear cita en estado pendiente_pago con referencia temporal
    const ref = "MLB-" + Date.now().toString(36).toUpperCase().slice(-6);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

    const { data: cita, error: citaErr } = await supabase
      .from("citas")
      .insert({
        ref,
        usuario_id: usuarioId || null,
        prof_id: profId,
        servicio_id: servicioId,
        fecha,
        hora,
        hora_fin: horaFin,
        dur_min: durMin,
        estado: "pendiente_pago",
        paciente_nombre: pacienteNombre,
        paciente_email: pacienteEmail,
        paciente_tel: pacienteTel || null,
        nota: nota || null,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (citaErr) throw new Error("Error creando cita: " + citaErr.message);

    // 6. Crear registro de pago pendiente
    await supabase.from("pagos").insert({
      cita_id: cita.id,
      stripe_payment_intent_id: paymentIntent.id,
      importe: importeCentimos,
      moneda: "eur",
      estado: "pendiente",
    });

    // 7. Actualizar metadata del PaymentIntent con el cita_id real
    await stripe.paymentIntents.update(paymentIntent.id, {
      metadata: { ...paymentIntent.metadata, citaId: cita.id, citaRef: ref }
    });

    return new Response(JSON.stringify({
      clientSecret: paymentIntent.client_secret,
      citaRef: ref,
      importe: importeCentimos,
      servicio: servicio.nombre,
    }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("create-payment error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
});
*/


// ───────────────────────────────────────────────────────────────
// FUNCIÓN 2: stripe-webhook
// Recibe eventos de Stripe. ÚNICA función que puede confirmar citas.
// Verifica la firma HMAC antes de hacer nada.
// ───────────────────────────────────────────────────────────────

// supabase/functions/stripe-webhook/index.ts
/*
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

  // ── CRÍTICO: verificar firma antes de procesar NADA ──
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEventAsync
      ? await stripe.webhooks.constructEventAsync(
          body,
          signature!,
          Deno.env.get("STRIPE_WEBHOOK_SECRET")!
        )
      : stripe.webhooks.constructEvent(
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

      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const citaId = pi.metadata.citaId;
        const citaRef = pi.metadata.citaRef;
        if (!citaId) break;

        // Confirmar la cita
        await supabase
          .from("citas")
          .update({ estado: "confirmada", expires_at: null })
          .eq("id", citaId);

        // Actualizar pago
        await supabase
          .from("pagos")
          .update({
            estado: "completado",
            pagado_at: new Date().toISOString(),
            stripe_raw: pi,
          })
          .eq("stripe_payment_intent_id", pi.id);

        // Obtener datos de la cita para el email
        const { data: cita } = await supabase
          .from("citas")
          .select("*, profesionales(nombre), servicios(nombre)")
          .eq("id", citaId)
          .single();

        if (cita) {
          // Programar recordatorio 24h antes
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
            }
          ]);

          // Enviar email de confirmación inmediata
          await sendConfirmationEmail(cita, citaRef);
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const citaId = pi.metadata.citaId;
        if (!citaId) break;

        // Cancelar la cita — libera el slot
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

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const pi = charge.payment_intent as string;

        // Obtener cita asociada
        const { data: pago } = await supabase
          .from("pagos")
          .select("cita_id")
          .eq("stripe_payment_intent_id", pi)
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
            .eq("stripe_payment_intent_id", pi);
        }
        break;
      }
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });

  } catch (error) {
    console.error("Webhook processing error:", error);
    // Devolver 200 igualmente para que Stripe no reintente eventos ya procesados
    return new Response(JSON.stringify({ error: error.message }), { status: 200 });
  }
});

async function sendConfirmationEmail(cita: any, ref: string) {
  const emailBody = `
  <!DOCTYPE html>
  <html>
  <body style="font-family: sans-serif; color: #111827; max-width: 560px; margin: 0 auto; padding: 24px;">
    <div style="background: #0B2240; padding: 20px 24px; border-radius: 12px 12px 0 0;">
      <h1 style="color: white; font-size: 1.3rem; margin: 0;">Reserva confirmada</h1>
      <p style="color: rgba(255,255,255,.6); margin: 4px 0 0; font-size: .85rem;">Movement Lab Bcn</p>
    </div>
    <div style="background: #F2FAF7; border: 1px solid #E8F5F1; padding: 20px 24px;">
      <p style="font-size: 1rem; margin: 0 0 16px;">Hola <strong>${cita.paciente_nombre}</strong>,</p>
      <p style="color: #6B7280; margin: 0 0 20px;">Tu cita ha sido confirmada correctamente. Aquí tienes los detalles:</p>
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid #E8F5F1;">
          <td style="padding: 10px 0; color: #6B7280; font-size: .88rem;">Servicio</td>
          <td style="padding: 10px 0; font-weight: 600; font-size: .88rem;">${cita.servicios?.nombre || cita.servicio_id}</td>
        </tr>
        <tr style="border-bottom: 1px solid #E8F5F1;">
          <td style="padding: 10px 0; color: #6B7280; font-size: .88rem;">Profesional</td>
          <td style="padding: 10px 0; font-weight: 600; font-size: .88rem;">${cita.profesionales?.nombre || cita.prof_id}</td>
        </tr>
        <tr style="border-bottom: 1px solid #E8F5F1;">
          <td style="padding: 10px 0; color: #6B7280; font-size: .88rem;">Fecha</td>
          <td style="padding: 10px 0; font-weight: 600; font-size: .88rem;">${new Date(cita.fecha + 'T12:00:00').toLocaleDateString('es-ES', {weekday:'long', year:'numeric', month:'long', day:'numeric'})}</td>
        </tr>
        <tr style="border-bottom: 1px solid #E8F5F1;">
          <td style="padding: 10px 0; color: #6B7280; font-size: .88rem;">Hora</td>
          <td style="padding: 10px 0; font-weight: 600; font-size: .88rem;">${cita.hora} – ${cita.hora_fin}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; color: #6B7280; font-size: .88rem;">Referencia</td>
          <td style="padding: 10px 0; font-family: monospace; font-weight: 600; color: #1A8C6E; font-size: .9rem;">${ref}</td>
        </tr>
      </table>
    </div>
    <div style="background: white; border: 1px solid #E5E8EF; border-top: none; padding: 16px 24px; border-radius: 0 0 12px 12px;">
      <p style="font-size: .82rem; color: #6B7280; margin: 0 0 6px;">
        📍 ${Deno.env.get('CENTRO_DIRECCION') || 'Dirección del centro'}
      </p>
      <p style="font-size: .82rem; color: #6B7280; margin: 0;">
        ¿Necesitas cancelar o cambiar la cita? Llámanos al <strong>${Deno.env.get('CENTRO_TELEFONO') || '+34 XXX XXX XXX'}</strong>
        o responde a este email.
      </p>
    </div>
  </body>
  </html>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${Deno.env.get("CENTRO_NOMBRE")} <no-reply@movementlabbcn.com>`,
      to: [cita.paciente_email],
      bcc: [Deno.env.get("CENTRO_EMAIL")],  // el centro recibe copia de cada reserva
      subject: `✓ Cita confirmada · ${new Date(cita.fecha + 'T12:00:00').toLocaleDateString('es-ES', {weekday:'long', day:'numeric', month:'long'})}`,
      html: emailBody,
    }),
  });
}
*/


// ───────────────────────────────────────────────────────────────
// FUNCIÓN 3: send-reminder
// Cron job diario. Envía recordatorios 24h antes de cada cita.
// Configurar en Supabase: Dashboard > Edge Functions > Schedule
// Cron: "0 8 * * *" (todos los días a las 8:00)
// ───────────────────────────────────────────────────────────────

// supabase/functions/send-reminder/index.ts
/*
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_KEY")!
);

serve(async () => {
  const now = new Date();
  const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000);
  const in23h = new Date(now.getTime() + 23 * 60 * 60 * 1000);

  // Buscar recordatorios pendientes de enviar en esta ventana
  const { data: pendientes, error } = await supabase
    .from("recordatorios")
    .select("*, citas(*, profesionales(nombre), servicios(nombre))")
    .eq("tipo", "recordatorio_24h")
    .eq("estado", "pendiente")
    .gte("scheduled_at", in23h.toISOString())
    .lte("scheduled_at", in25h.toISOString());

  if (error) {
    console.error("Error fetching reminders:", error);
    return new Response("error", { status: 500 });
  }

  let enviados = 0;
  let fallidos = 0;

  for (const reminder of pendientes || []) {
    const cita = reminder.citas;
    if (!cita || !cita.paciente_email) continue;

    try {
      const fechaFormateada = new Date(cita.fecha + 'T12:00:00')
        .toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${Deno.env.get("CENTRO_NOMBRE")} <no-reply@movementlabbcn.com>`,
          to: [cita.paciente_email],
          subject: `Recordatorio: tu cita mañana ${fechaFormateada} a las ${cita.hora}`,
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
              <h2 style="color:#0B2240">Recordatorio de tu cita</h2>
              <p>Hola <strong>${cita.paciente_nombre}</strong>, te recordamos que mañana tienes cita en Movement Lab Bcn:</p>
              <ul style="color:#374151;line-height:2">
                <li><strong>Servicio:</strong> ${cita.servicios?.nombre}</li>
                <li><strong>Profesional:</strong> ${cita.profesionales?.nombre}</li>
                <li><strong>Fecha:</strong> ${fechaFormateada}</li>
                <li><strong>Hora:</strong> ${cita.hora}</li>
                <li><strong>Referencia:</strong> <code>${cita.ref}</code></li>
              </ul>
              <p style="color:#6B7280;font-size:.88rem">
                Si no puedes venir, cancela con al menos 24h de antelación.<br>
                Llámanos al <strong>${Deno.env.get('CENTRO_TELEFONO')}</strong> o responde a este email.
              </p>
              <p style="color:#6B7280;font-size:.82rem">📍 ${Deno.env.get('CENTRO_DIRECCION')}</p>
            </div>`,
        }),
      });

      await supabase
        .from("recordatorios")
        .update({ estado: "enviado", enviado_at: new Date().toISOString() })
        .eq("id", reminder.id);

      enviados++;
    } catch (err) {
      await supabase
        .from("recordatorios")
        .update({ estado: "fallido", error_msg: err.message })
        .eq("id", reminder.id);
      fallidos++;
    }
  }

  console.log(`Recordatorios: ${enviados} enviados, ${fallidos} fallidos`);
  return new Response(JSON.stringify({ enviados, fallidos }), { status: 200 });
});
*/
