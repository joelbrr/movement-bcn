// supabase/functions/create-payment/index.ts
// Deploy: npx supabase functions deploy create-payment
//
// Required env vars (Supabase Dashboard > Settings > Edge Functions > Secrets):
//   STRIPE_SECRET_KEY       = sk_test_... or sk_live_...
//   SUPABASE_URL            = https://czehgzjlcoipectnqtsw.supabase.co
//   SUPABASE_SERVICE_KEY    = eyJ... (service_role key, NOT anon)
//   RESEND_API_KEY          = re_... (from Resend.com)
//   CENTRO_EMAIL            = info@movementlabbcn.com
//   CENTRO_NOMBRE           = Movement Lab Bcn
//   CENTRO_TELEFONO         = +34 XXX XXX XXX
//   CENTRO_DIRECCION        = Carrer Exemple 42, Barcelona

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@13";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();
    const {
      servicioId,
      profId,
      fecha,
      hora,
      horaFin,
      durMin,
      pacienteNombre,
      pacienteEmail,
      pacienteTel,
      nota,
      usuarioId,
      metodoPago, // 'stripe' (default) o 'local'
    } = body;

    // 1. Validar campos obligatorios
    if (!servicioId || !profId || !fecha || !hora || !pacienteNombre || !pacienteEmail) {
      return new Response(JSON.stringify({ error: "Faltan campos obligatorios" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // 2. Obtener precio del servicio desde Supabase
    const { data: servicio, error: servErr } = await supabase
      .from("servicios")
      .select("precio, nombre")
      .eq("id", servicioId)
      .single();

    if (servErr || !servicio) {
      return new Response(JSON.stringify({ error: "Servicio no encontrado" }), {
        status: 404,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // 3. Comprobar que el slot sigue libre (doble check crítico contra race conditions)
    const { data: conflictos } = await supabase
      .from("citas")
      .select("id")
      .eq("prof_id", profId)
      .eq("fecha", fecha)
      .neq("estado", "cancelada")
      .gte("hora", hora)
      .lt("hora", horaFin);

    if (conflictos && conflictos.length > 0) {
      return new Response(
        JSON.stringify({ error: "Este horario ya no está disponible. Por favor elige otro." }),
        { status: 409, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const ref = "MLB-" + Date.now().toString(36).toUpperCase().slice(-6);
    const importeCentimos = Math.round(Number(servicio.precio) * 100);

    // --- FLUJO PAGO EN LOCAL ---
    if (metodoPago === "local") {
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
          dur_min: durMin ?? 60,
          estado: "confirmada", // Se confirma directamente
          paciente_nombre: pacienteNombre,
          paciente_email: pacienteEmail,
          paciente_tel: pacienteTel || null,
          nota: (nota ? nota + "\n" : "") + "[PAGO EN LOCAL]",
        })
        .select()
        .single();

      if (citaErr) throw new Error("Error creando cita local: " + citaErr.message);

      // --- NUEVO: PROGRAMAR RECORDATORIOS ---
      const citaDate = new Date(`${fecha}T${hora}`);
      const reminder24h = new Date(citaDate.getTime() - 24 * 60 * 60 * 1000);

      await supabase.from("recordatorios").insert([
        {
          cita_id: cita.id,
          tipo: "confirmacion",
          estado: "pendiente",
          scheduled_at: new Date().toISOString(),
        },
        {
          cita_id: cita.id,
          tipo: "recordatorio_24h",
          estado: "pendiente",
          scheduled_at: reminder24h.toISOString(),
        },
      ]);

      // --- NUEVO: ENVIAR EMAIL DE CONFIRMACIÓN ---
      try {
        const { data: fullCita } = await supabase
          .from("citas")
          .select("*, profesionales(nombre), servicios(nombre)")
          .eq("id", cita.id)
          .single();

        if (fullCita) {
          await sendConfirmationEmail(fullCita, ref);
        }
      } catch (e) {
        console.error("Error enviando email local:", e.message);
      }

      return new Response(
        JSON.stringify({
          citaRef: ref,
          importe: importeCentimos,
          servicio: servicio.nombre,
          metodo: "local",
        }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // --- FLUJO STRIPE (EXISTENTE) ---
    // 4. Crear PaymentIntent en Stripe
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const paymentIntent = await stripe.paymentIntents.create({
      amount: importeCentimos,
      currency: "eur",
      automatic_payment_methods: { enabled: true },
      metadata: {
        servicioId,
        profId,
        fecha,
        hora,
        horaFin,
        pacienteNombre,
        pacienteEmail,
        durMin: String(durMin ?? 60),
      },
      description: `${servicio.nombre} - ${pacienteNombre} - ${fecha} ${hora}`,
      receipt_email: pacienteEmail,
    });

    // 5. Crear cita en estado pendiente_pago (expira en 15 min si no se paga)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

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
        dur_min: durMin ?? 60,
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

    // 6. Registrar pago pendiente
    await supabase.from("pagos").insert({
      cita_id: cita.id,
      stripe_payment_intent_id: paymentIntent.id,
      importe: importeCentimos,
      moneda: "eur",
      estado: "pendiente",
    });

    // 7. Actualizar metadata del PaymentIntent con el ID real de la cita
    await stripe.paymentIntents.update(paymentIntent.id, {
      metadata: {
        ...paymentIntent.metadata,
        citaId: cita.id,
        citaRef: ref,
      },
    });

    return new Response(
      JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        citaRef: ref,
        importe: importeCentimos,
        servicio: servicio.nombre,
      }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("create-payment error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
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
    <p style="color:#6B7280;margin:0 0 20px">Tu cita ha sido confirmada. Aquí tienes los detalles:</p>
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
      from: `${Deno.env.get("CENTRO_NOMBRE") || "Movement Lab Bcn"} <${Deno.env.get("FROM_EMAIL") || "no-reply@movementlabbcn.com"}>`,
      to: [cita.paciente_email],
      bcc: [Deno.env.get("CENTRO_EMAIL")!],
      subject: `✓ Cita confirmada · ${fechaFormateada}`,
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Resend error:", err);
  }
}
