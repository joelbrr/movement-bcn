# movement-bcn

Aclaraciones

reservar-v3.html es el wizard actualizado con un 6º paso de pago. Integra Stripe Elements (el formulario de tarjeta oficial de Stripe, PCI-compliant), detecta automáticamente si Supabase está configurado y si no lo está funciona en modo demo simulando el flujo completo.
mi-cuenta.html es la pantalla de usuario con login por email+contraseña o "enlace mágico" (sin contraseña, más cómodo), registro, historial de citas propias y cancelación. También muestra un aviso de modo demo si Supabase no está configurado.
edge-functions.js contiene el código de las 3 funciones de servidor (están comentadas como TypeScript dentro de JS para que puedas leerlas): create-payment que crea el PaymentIntent y la cita en estado pendiente, stripe-webhook que es la única función que puede confirmar una cita, y send-reminder que es el cron job diario de recordatorios.
supabase-setup.sql es el esquema completo de base de datos con todas las tablas, Row Level Security, trigger de updated_at, función de limpieza de citas expiradas y los datos iniciales de servicios y profesionales.

Orden de activación (4 pasos):

Crear proyecto en Supabase → ejecutar supabase-setup.sql en el SQL Editor
Crear cuenta en Stripe y Resend → obtener las claves de API
Desplegar las Edge Functions de edge-functions.js con supabase functions deploy
Sustituir los valores TU_PROYECTO, eyJ... y pk_test_... en reservar-v3.html y mi-cuenta.html

El principio de diseño más importante: la cita nunca se confirma desde el navegador. Solo el webhook de Stripe, verificado con firma HMAC, puede cambiar el estado a confirmada. Si el servidor cae durante el pago, Stripe reintenta el webhook automáticamente durante 72 horas. La integridad de datos está garantizada.
