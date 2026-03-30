// supabase/functions/send-reminder/index.ts
// Deploy: npx supabase functions deploy send-reminder
//
// Schedule (Supabase Dashboard > Edge Functions > send-reminder > Schedule):
//   Cron: "0 8 * * *"  → runs daily at 08:00 UTC
//
// Required env vars:
//   SUPABASE_URL         = https://czehgzjlcoipectnqtsw.supabase.co
//   SUPABASE_SERVICE_KEY = eyJ... (service_role key)
//   RESEND_API_KEY       = re_...
//   CENTRO_NOMBRE        = Movement Lab Bcn
//   CENTRO_TELEFONO      = +34 XXX XXX XXX
//   CENTRO_DIRECCION     = Carrer Exemple 42, Barcelona

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_KEY")!
);

serve(async () => {
  const now = new Date();
  // Ventana de 23h–25h hacia adelante (el cron corre a las 8:00, busca citas de mañana)
  const in23h = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  // Buscar recordatorios pendientes dentro de la ventana
  const { data: pendientes, error } = await supabase
    .from("recordatorios")
    .select("*, citas(*, profesionales(nombre), servicios(nombre))")
    .eq("tipo", "recordatorio_24h")
    .eq("estado", "pendiente")
    .gte("scheduled_at", in23h.toISOString())
    .lte("scheduled_at", in25h.toISOString());

  if (error) {
    console.error("Error fetching reminders:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let enviados = 0;
  let fallidos = 0;

  for (const reminder of pendientes || []) {
    const cita = reminder.citas;
    if (!cita || !cita.paciente_email) continue;

    try {
      const fechaFormateada = new Date(cita.fecha + "T12:00:00").toLocaleDateString(
        "es-ES",
        { weekday: "long", day: "numeric", month: "long" }
      );

      const html = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
  <div style="background:#0B2240;padding:16px 20px;border-radius:10px 10px 0 0">
    <h2 style="color:white;margin:0;font-size:1.1rem">Recordatorio de tu cita</h2>
  </div>
  <div style="background:#F2FAF7;border:1px solid #E8F5F1;padding:20px;border-radius:0 0 10px 10px">
    <p>Hola <strong>${cita.paciente_nombre}</strong>,</p>
    <p style="color:#374151">Mañana tienes cita en <strong>${Deno.env.get("CENTRO_NOMBRE") || "Movement Lab Bcn"}</strong>:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr style="border-bottom:1px solid #E8F5F1">
        <td style="padding:8px 0;color:#6B7280;font-size:.88rem">Servicio</td>
        <td style="padding:8px 0;font-weight:600;font-size:.88rem">${cita.servicios?.nombre}</td>
      </tr>
      <tr style="border-bottom:1px solid #E8F5F1">
        <td style="padding:8px 0;color:#6B7280;font-size:.88rem">Profesional</td>
        <td style="padding:8px 0;font-weight:600;font-size:.88rem">${cita.profesionales?.nombre}</td>
      </tr>
      <tr style="border-bottom:1px solid #E8F5F1">
        <td style="padding:8px 0;color:#6B7280;font-size:.88rem">Fecha</td>
        <td style="padding:8px 0;font-weight:600;font-size:.88rem">${fechaFormateada}</td>
      </tr>
      <tr style="border-bottom:1px solid #E8F5F1">
        <td style="padding:8px 0;color:#6B7280;font-size:.88rem">Hora</td>
        <td style="padding:8px 0;font-weight:600;font-size:.88rem">${cita.hora}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#6B7280;font-size:.88rem">Referencia</td>
        <td style="padding:8px 0;font-family:monospace;color:#1A8C6E;font-weight:600">${cita.ref}</td>
      </tr>
    </table>
    <p style="color:#6B7280;font-size:.85rem;margin:0">
      Si no puedes venir, cancela con al menos 24h de antelación.<br>
      📞 <strong>${Deno.env.get("CENTRO_TELEFONO") || "+34 XXX XXX XXX"}</strong> · 
      📍 ${Deno.env.get("CENTRO_DIRECCION") || "Dirección del centro"}
    </p>
  </div>
</div>`;

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${Deno.env.get("CENTRO_NOMBRE") || "Movement Lab Bcn"} <${Deno.env.get("FROM_EMAIL") || "no-reply@movementlabbcn.com"}>`,
          to: [cita.paciente_email],
          subject: `Recordatorio: tu cita mañana ${fechaFormateada} a las ${cita.hora}`,
          html,
        }),
      });

      if (!res.ok) throw new Error(await res.text());

      // Marcar recordatorio como enviado
      await supabase
        .from("recordatorios")
        .update({ estado: "enviado", enviado_at: new Date().toISOString() })
        .eq("id", reminder.id);

      enviados++;
    } catch (err) {
      console.error(`Error sending reminder ${reminder.id}:`, err.message);
      await supabase
        .from("recordatorios")
        .update({ estado: "fallido", error_msg: err.message })
        .eq("id", reminder.id);
      fallidos++;
    }
  }

  console.log(`Recordatorios: ${enviados} enviados, ${fallidos} fallidos`);
  return new Response(
    JSON.stringify({ enviados, fallidos, total: (pendientes || []).length }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
