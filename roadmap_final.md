# Hoja de Ruta Final: De Desarrollo a Producción 🚀

Esta lista detalla los pasos pendientes para que el sistema de reservas de **Movement Lab Bcn** esté 100% operativo y listo para ser entregado a los clientes.

---

### Fase 1: Configuración de Servicios (Backend)
- [ ] **Stripe (Pasarela de Pago)**:
    - [ ] Obtener claves **Live** del Dashboard de Stripe (sustituir las `sk_test` por `sk_live`).
    - [ ] Configurar el **Webhook Secret** en Supabase para validar los pagos reales.
- [ ] **Notificaciones (Correo electrónico)**:
    - [ ] Configurar cuenta en [Resend.com](https://resend.com).
    - [ ] Añadir `RESEND_API_KEY` en los secretos de Supabase.
    - [ ] Verificar el dominio del remitente (ej: `info@movementlabbcn.com`) en Resend.
- [ ] **Supabase (Core)**:
    - [ ] Asegurar que `SUPABASE_SERVICE_ROLE_KEY` está configurado como secreto.
    - [ ] Desplegar las funciones restantes: `stripe-webhook` y `send-reminder`.
    - [ ] Programar el **Cron Job** para los recordatorios diarios (Dato: `0 9 * * *`).

---

### Fase 2: Hosting y Dominio (Visibilidad)
- [ ] **Alojamiento (Hosting)**:
    - [ ] Crear cuenta en **Vercel** o **Netlify** (Gratis).
    - [ ] Subir la carpeta del proyecto (HTML, CSS, JS).
    - [ ] Obtener la URL provisional (ej: `movement-lab.vercel.app`).
- [ ] **Dominio Propio**:
    - [ ] Comprar el dominio (ej: `movementlabbcn.com`) en Namecheap/DonDominio.
    - [ ] Vincular el dominio al hosting siguiendo las instrucciones de DNS.
    - [ ] Esperar a que el certificado SSL (el candado verde 🔒) se active automáticamente.

---

### Fase 3: Contenidos y Aspectos Legales
- [ ] **Textos Legales**:
    - [ ] Redactar y añadir la **Política de Privacidad** (GDPR).
    - [ ] Redactar y añadir los **Términos y Condiciones** de reserva y cancelación.
- [ ] **SEO y Redes Sociales**:
    - [ ] Configurar etiquetas `<meta>` para que la web aparezca bien en Google y al compartir por WhatsApp.
    - [ ] Añadir links a las redes sociales reales en el pie de página.

---

### Fase 4: Pruebas Finales y Entrega
- [ ] **Cierre de Ciclo**:
    - [ ] Realizar una reserva real con tarjeta (pago mínimo de 1€) y confirmar recepción de email.
    - [ ] Verificar que el Admin puede ver y gestionar esa cita desde el panel.
- [ ] **Manual para Propietarios**:
    - [ ] Crear una breve guía en PDF sobre cómo entrar al panel, ver las citas y bloquear horarios.
- [ ] **Entrega Oficial**:
    - [ ] Entrega de credenciales y acceso al panel de administración.

---

> [!TIP]
> **Prioridad Actual**: El paso más importante ahora es configurar **Resend** para los emails, ya que sin eso los clientes no sabrán si su cita se ha confirmado.
