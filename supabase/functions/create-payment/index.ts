// supabase/functions/create-payment/index.ts
// Deploy: npx supabase functions deploy create-payment
//
// Required env vars (Supabase Dashboard > Settings > Edge Functions):
//   STRIPE_SECRET_KEY       = sk_test_... or sk_live_...
//   SUPABASE_URL            = https://czehgzjlcoipectnqtsw.supabase.co
//   SUPABASE_SERVICE_KEY    = eyJ... (service_role key, NOT anon)

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
      usuarioId, // null si reserva como invitado
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

    // 4. Crear PaymentIntent en Stripe
    const importeCentimos = Math.round(Number(servicio.precio) * 100);
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
    const ref = "MLB-" + Date.now().toString(36).toUpperCase().slice(-6);
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
