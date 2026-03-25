-- ═══════════════════════════════════════════════════════════
-- MOVEMENT LAB BCN · FASE 3 · SUPABASE SETUP
-- Ejecutar en Supabase SQL Editor (Dashboard > SQL Editor)
-- ═══════════════════════════════════════════════════════════

-- ── 1. EXTENSIONES ──────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── 2. TABLA: profesionales ─────────────────────────────────
-- Esta tabla replica los datos que antes estaban en localStorage
create table if not exists profesionales (
  id          text primary key,
  nombre      text not null,
  iniciales   text not null,
  color       text not null default '#1A8C6E',
  rol         text not null,
  servicios   text[] not null default '{}',
  horario     jsonb not null default '{}',
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ── 3. TABLA: servicios ─────────────────────────────────────
create table if not exists servicios (
  id            text primary key,
  nombre        text not null,
  icono         text not null default '🦴',
  duracion_min  integer not null default 60,
  precio        decimal(10,2) not null default 0,
  prof_ids      text[] not null default '{}',
  activo        boolean not null default true
);

-- ── 4. TABLA: citas ─────────────────────────────────────────
-- estado puede ser: pendiente_pago | confirmada | cancelada | completada | no_show
create table if not exists citas (
  id                 uuid primary key default uuid_generate_v4(),
  ref                text unique not null,
  usuario_id         uuid references auth.users(id) on delete set null,
  prof_id            text not null references profesionales(id),
  servicio_id        text not null references servicios(id),
  fecha              date not null,
  hora               time not null,
  hora_fin           time not null,
  dur_min            integer not null,
  estado             text not null default 'pendiente_pago'
                       check (estado in ('pendiente_pago','confirmada','cancelada','completada','no_show')),
  pago_requerido     boolean not null default true,
  paciente_nombre    text not null,
  paciente_email     text,
  paciente_tel       text,
  nota               text,
  expires_at         timestamptz,  -- si no se paga antes de esto, se libera el slot
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ── 5. TABLA: pagos ─────────────────────────────────────────
-- estado puede ser: pendiente | completado | fallido | reembolsado
create table if not exists pagos (
  id                        uuid primary key default uuid_generate_v4(),
  cita_id                   uuid not null references citas(id) on delete cascade,
  stripe_payment_intent_id  text unique not null,
  stripe_customer_id        text,
  importe                   integer not null,  -- en céntimos (ej: 5500 = 55,00 €)
  moneda                    text not null default 'eur',
  estado                    text not null default 'pendiente'
                              check (estado in ('pendiente','completado','fallido','reembolsado')),
  stripe_raw                jsonb,  -- payload completo del webhook para auditoría
  pagado_at                 timestamptz,
  reembolsado_at            timestamptz,
  created_at                timestamptz not null default now()
);

-- ── 6. TABLA: bloqueos ──────────────────────────────────────
create table if not exists bloqueos (
  id        uuid primary key default uuid_generate_v4(),
  prof_id   text not null references profesionales(id) on delete cascade,
  fecha     date not null,
  hora_ini  time not null,
  hora_fin  time not null,
  motivo    text,
  created_at timestamptz not null default now()
);

-- ── 7. TABLA: excepciones ───────────────────────────────────
-- tipo puede ser: dia_libre | horario_especial | bloqueo_horas
create table if not exists excepciones (
  id        uuid primary key default uuid_generate_v4(),
  prof_id   text not null references profesionales(id) on delete cascade,
  fecha     date not null,
  tipo      text not null check (tipo in ('dia_libre','horario_especial','bloqueo_horas')),
  hora_ini  time,
  hora_fin  time,
  created_at timestamptz not null default now()
);

-- ── 8. TABLA: recordatorios ─────────────────────────────────
-- estado: pendiente | enviado | fallido
create table if not exists recordatorios (
  id            uuid primary key default uuid_generate_v4(),
  cita_id       uuid not null references citas(id) on delete cascade,
  tipo          text not null check (tipo in ('confirmacion','recordatorio_24h','cancelacion')),
  estado        text not null default 'pendiente' check (estado in ('pendiente','enviado','fallido')),
  scheduled_at  timestamptz not null,
  enviado_at    timestamptz,
  error_msg     text,
  created_at    timestamptz not null default now()
);

-- ── 9. PERFIL DE USUARIO (extiende auth.users) ──────────────
create table if not exists perfiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nombre     text,
  telefono   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 10. TRIGGER: updated_at automático ─────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger citas_updated_at before update on citas
  for each row execute function set_updated_at();
create trigger perfiles_updated_at before update on perfiles
  for each row execute function set_updated_at();

-- ── 11. CLEANUP: citas expiradas ────────────────────────────
-- Libera slots de citas en estado pendiente_pago que han expirado
create or replace function cleanup_expired_citas()
returns void as $$
begin
  update citas
  set estado = 'cancelada'
  where estado = 'pendiente_pago'
    and expires_at < now();
end;
$$ language plpgsql;

-- ── 12. ROW LEVEL SECURITY (RLS) ────────────────────────────
-- Activa RLS en todas las tablas con datos de usuarios
alter table citas enable row level security;
alter table pagos enable row level security;
alter table perfiles enable row level security;
alter table recordatorios enable row level security;

-- Profesionales y servicios son públicos (lectura)
alter table profesionales enable row level security;
alter table servicios enable row level security;

create policy "profesionales_public_read" on profesionales for select using (true);
create policy "servicios_public_read" on servicios for select using (true);

-- Citas: usuario solo ve las suyas. Admin lo ve todo.
create policy "citas_user_own" on citas for select
  using (usuario_id = auth.uid());

create policy "citas_insert_authenticated" on citas for insert
  with check (auth.uid() is not null or usuario_id is null); -- permite invitados

create policy "citas_admin_all" on citas for all
  using (auth.jwt() ->> 'role' = 'admin');

-- Pagos: solo el admin los ve en el panel
create policy "pagos_admin_all" on pagos for all
  using (auth.jwt() ->> 'role' = 'admin');

-- Perfil: cada usuario solo gestiona el suyo
create policy "perfiles_own" on perfiles for all
  using (id = auth.uid());

-- ── 13. DATOS INICIALES ─────────────────────────────────────
insert into servicios (id, nombre, icono, duracion_min, precio, prof_ids) values
  ('fisio',    'Fisioterapia',       '🦴', 60, 55.00, array['ana','carlos','maria','laura','pablo']),
  ('rehab',    'Rehabilitación',     '🔄', 60, 60.00, array['ana','carlos','laura']),
  ('prepfis',  'Preparación física', '💪', 60, 45.00, array['javier']),
  ('masaje',   'Masaje terapéutico', '✋', 45, 40.00, array['pablo','maria']),
  ('podologia','Podología',           '🦶', 45, 50.00, array['ana'])
on conflict (id) do nothing;

insert into profesionales (id, nombre, iniciales, color, rol, servicios, horario) values
  ('ana',    'Ana López',       'AL', '#1A4F8A', 'Fisioterapeuta · Directora',  array['fisio','rehab','podologia'],
    '{"lunes":{"ini":"08:00","fin":"17:00"},"martes":{"ini":"08:00","fin":"17:00"},"miercoles":{"ini":"08:00","fin":"17:00"},"jueves":{"ini":"08:00","fin":"17:00"},"viernes":{"ini":"08:00","fin":"14:00"}}'),
  ('carlos', 'Carlos Martín',   'CM', '#1A8C6E', 'Fisioterapeuta · Deportivo',  array['fisio','rehab'],
    '{"lunes":{"ini":"10:00","fin":"20:00"},"martes":{"ini":"10:00","fin":"20:00"},"miercoles":{"ini":"10:00","fin":"20:00"},"jueves":{"ini":"10:00","fin":"20:00"},"viernes":{"ini":"10:00","fin":"18:00"}}'),
  ('maria',  'María García',    'MG', '#5e4fa2', 'Fisio · Suelo Pélvico',       array['fisio','masaje'],
    '{"lunes":{"ini":"09:00","fin":"18:00"},"martes":{"ini":"09:00","fin":"18:00"},"miercoles":null,"jueves":{"ini":"09:00","fin":"18:00"},"viernes":{"ini":"09:00","fin":"18:00"}}'),
  ('javier', 'Javier Ruiz',     'JR', '#b06020', 'Preparador Físico',           array['prepfis'],
    '{"lunes":{"ini":"07:00","fin":"15:00"},"martes":{"ini":"07:00","fin":"15:00"},"miercoles":{"ini":"07:00","fin":"15:00"},"jueves":{"ini":"07:00","fin":"15:00"},"viernes":{"ini":"07:00","fin":"15:00"},"sabado":{"ini":"09:00","fin":"13:00"}}'),
  ('laura',  'Laura Fernández', 'LF', '#1a5c8a', 'Fisio · Neurológica',         array['fisio','rehab'],
    '{"martes":{"ini":"09:00","fin":"18:00"},"miercoles":{"ini":"09:00","fin":"18:00"},"jueves":{"ini":"09:00","fin":"18:00"},"viernes":{"ini":"09:00","fin":"18:00"},"sabado":{"ini":"09:00","fin":"13:00"}}'),
  ('pablo',  'Pablo Santos',    'PS', '#2a7a5a', 'Fisio · Masajes',             array['masaje','fisio'],
    '{"lunes":{"ini":"11:00","fin":"20:00"},"martes":{"ini":"11:00","fin":"20:00"},"miercoles":{"ini":"11:00","fin":"20:00"},"jueves":{"ini":"11:00","fin":"20:00"},"viernes":{"ini":"11:00","fin":"19:00"}}')
on conflict (id) do nothing;
