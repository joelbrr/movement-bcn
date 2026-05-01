import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    // Verify authentication
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      throw new Error("No autorizado");
    }

    const { citaIds } = await req.json();
    if (!citaIds || !Array.isArray(citaIds) || citaIds.length === 0) {
      throw new Error("Se requieren citaIds");
    }

    // Usar SERVICE_ROLE para poder consultar las citas completas (por si RLS lo bloquea aunque el admin pueda actualizar)
    // El admin tiene permisos para actualizar, pero usar service_role asegura que el envío de email no falle por permisos de lectura.
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
    );

    // Fetch citas details
    const { data: citas, error: fetchErr } = await serviceClient
      .from("citas")
      .select("*, profesionales(nombre), servicios(nombre)")
      .in("id", citaIds);

    if (fetchErr) throw new Error("Error obteniendo citas: " + fetchErr.message);

    // Update to 'cancelada'
    const { error: updateErr } = await serviceClient
      .from("citas")
      .update({ estado: "cancelada" })
      .in("id", citaIds);

    if (updateErr) throw new Error("Error cancelando citas: " + updateErr.message);

    // Send emails
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev";

    if (resendApiKey) {
      for (const cita of citas) {
        if (!cita.paciente_email) continue;

        const fechaFormateada = new Date(cita.fecha + "T12:00:00").toLocaleDateString(
          "es-ES",
          { weekday: "long", year: "numeric", month: "long", day: "numeric" }
        );

        const html = `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#111827;max-width:560px;margin:0 auto;padding:24px">
  <div style="background:#dc2626;padding:20px 24px;border-radius:12px 12px 0 0">
    <h1 style="color:white;font-size:1.3rem;margin:0">Cita Cancelada por el Centro</h1>
    <p style="color:rgba(255,255,255,.8);margin:4px 0 0;font-size:.85rem">${Deno.env.get("CENTRO_NOMBRE") || "Movement Lab Bcn"}</p>
  </div>
  <div style="background:#fef2f2;border:1px solid #fee2e2;padding:20px 24px">
    <p style="font-size:1rem;margin:0 0 16px">Hola <strong>${cita.paciente_nombre}</strong>,</p>
    <p style="color:#6B7280;margin:0 0 20px">Lamentamos informarte que por motivos de agenda del profesional, tu cita programada ha sido <strong>cancelada</strong>.</p>
    <table style="width:100%;border-collapse:collapse">
      <tr style="border-bottom:1px solid #fee2e2">
        <td style="padding:10px 0;color:#6B7280;font-size:.88rem">Servicio</td>
        <td style="padding:10px 0;font-weight:600;font-size:.88rem">${cita.servicios?.nombre || cita.servicio_id}</td>
      </tr>
      <tr style="border-bottom:1px solid #fee2e2">
        <td style="padding:10px 0;color:#6B7280;font-size:.88rem">Profesional</td>
        <td style="padding:10px 0;font-weight:600;font-size:.88rem">${cita.profesionales?.nombre || cita.prof_id}</td>
      </tr>
      <tr style="border-bottom:1px solid #fee2e2">
        <td style="padding:10px 0;color:#6B7280;font-size:.88rem">Fecha</td>
        <td style="padding:10px 0;font-weight:600;font-size:.88rem;text-decoration:line-through">${fechaFormateada}</td>
      </tr>
      <tr style="border-bottom:1px solid #fee2e2">
        <td style="padding:10px 0;color:#6B7280;font-size:.88rem">Hora</td>
        <td style="padding:10px 0;font-weight:600;font-size:.88rem;text-decoration:line-through">${cita.hora} – ${cita.hora_fin}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;color:#6B7280;font-size:.88rem">Referencia</td>
        <td style="padding:10px 0;font-family:monospace;font-weight:600;color:#b91c1c;font-size:.9rem">${cita.ref}</td>
      </tr>
    </table>
  </div>
  <div style="background:white;border:1px solid #E5E8EF;border-top:none;padding:16px 24px;border-radius:0 0 12px 12px">
    <p style="font-size:.85rem;color:#4b5563;margin:0 0 12px">
      Sentimos las molestias que esto pueda ocasionar. Por favor, accede a nuestra web para reservar una nueva fecha que te convenga.
    </p>
    <a href="${Deno.env.get("WEBSITE_URL") || "https://movement-bcn.vercel.app"}/reservar-v3.html" style="display:inline-block;padding:10px 16px;background:#1A8C6E;color:white;text-decoration:none;border-radius:6px;font-weight:600;font-size:.85rem">Reservar nueva cita</a>
    <p style="font-size:.82rem;color:#6B7280;margin:16px 0 0">
      Si tienes alguna duda, puedes contactarnos al <strong>${Deno.env.get("CENTRO_TELEFONO") || "+34 XXX XXX XXX"}</strong>.
    </p>
  </div>
</body>
</html>`;

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: `Movement Lab Bcn <${fromEmail}>`,
            to: cita.paciente_email,
            subject: "Tu cita ha sido cancelada - Movement Lab Bcn",
            html: html,
          }),
        });
      }
    }

    return new Response(JSON.stringify({ success: true, count: citas.length }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("cancel-citas error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
