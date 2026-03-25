-- ═══════════════════════════════════════════════════════════
-- MOVEMENT LAB BCN · ADMIN PANEL · RLS PATCH
-- Ejecutar en Supabase SQL Editor (Dashboard > SQL Editor)
-- ═══════════════════════════════════════════════════════════
--
-- Este parche habilita al usuario administrador (autenticado con
-- Supabase Auth en admin.html) a leer y escribir todas las tablas.
--
-- PASO PREVIO (solo una vez):
--   1. Ve a Supabase Dashboard → Authentication → Users
--   2. Crea un usuario con email: joelbautista.bcn@gmail.com + contraseña segura
--   Las policies ya usan auth.email() directamente, no hace falta ningún UUID.

-- ── Citas: admin ve y gestiona TODAS ──────────────────────────
-- Eliminar la policy anterior si existe (basada en jwt role custom)
drop policy if exists "citas_admin_all" on citas;

-- Nueva policy: admin autenticado puede hacer todo
create policy "citas_admin_select" on citas for select
  using (
    usuario_id = auth.uid()                    -- usuario ve sus propias citas
    or auth.email() = 'joelbautista.bcn@gmail.com'  -- admin ve todas
  );

create policy "citas_admin_update" on citas for update
  using (auth.email() = 'joelbautista.bcn@gmail.com');

create policy "citas_admin_delete" on citas for delete
  using (auth.email() = 'joelbautista.bcn@gmail.com');

-- ── Pagos: admin ve todos ──────────────────────────────────────
drop policy if exists "pagos_admin_all" on pagos;

create policy "pagos_admin_select" on pagos for select
  using (auth.email() = 'joelbautista.bcn@gmail.com');

-- ── Bloqueos (RLS no estaba activo, añadirlo) ─────────────────
alter table bloqueos enable row level security;

create policy "bloqueos_admin_all" on bloqueos for all
  using (auth.email() = 'joelbautista.bcn@gmail.com');

create policy "bloqueos_public_read" on bloqueos for select
  using (true);  -- el wizard necesita leer bloqueos para calcular disponibilidad

-- ── Excepciones ───────────────────────────────────────────────
alter table excepciones enable row level security;

create policy "excepciones_admin_all" on excepciones for all
  using (auth.email() = 'joelbautista.bcn@gmail.com');

create policy "excepciones_public_read" on excepciones for select
  using (true);  -- el wizard también las necesita

-- ── Profesionales: admin puede actualizar horarios ────────────
drop policy if exists "profesionales_public_read" on profesionales;

create policy "profesionales_public_read" on profesionales for select
  using (true);

create policy "profesionales_admin_update" on profesionales for update
  using (auth.email() = 'joelbautista.bcn@gmail.com');
