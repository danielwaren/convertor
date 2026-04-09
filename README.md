# WebP Convert — SaaS

Conversor de imágenes a WebP con modelo freemium. Procesamiento 100% en el navegador.

## Stack
- **Frontend**: Astro + React + Tailwind CSS
- **Auth**: Supabase (OAuth Google + GitHub)
- **DB**: Supabase PostgreSQL (usuarios y planes)
- **Rate limiting**: Vercel KV (Redis)
- **Pagos**: MercadoPago Checkout Pro
- **Hosting**: Vercel

## Variables de entorno necesarias

Crea un archivo `.env` en la raíz con:

```env
# Supabase
PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Vercel KV (se generan automáticamente al crear el KV store en Vercel)
KV_REST_API_URL=https://xxxx.kv.vercel-storage.com
KV_REST_API_TOKEN=xxxx

# MercadoPago
MP_ACCESS_TOKEN=APP_USR-xxxx          # Token de producción
MP_ACCESS_TOKEN_TEST=TEST-xxxx        # Token de pruebas
MP_WEBHOOK_SECRET=xxxx                # Lo defines tú, para validar webhooks

# URL pública del sitio (sin slash final)
PUBLIC_SITE_URL=https://tu-app.vercel.app
```

## Supabase — SQL inicial

Ejecuta esto en el SQL Editor de tu proyecto Supabase:

```sql
-- Tabla de usuarios con plan y contador
create table public.users (
  id uuid references auth.users on delete cascade primary key,
  email text,
  plan text default 'free' check (plan in ('free', 'pro')),
  plan_expires_at timestamptz,
  mp_payment_id text,
  created_at timestamptz default now()
);

-- RLS: cada usuario solo ve su fila
alter table public.users enable row level security;

create policy "Users can read own data"
  on public.users for select
  using (auth.uid() = id);

create policy "Users can update own data"
  on public.users for update
  using (auth.uid() = id);

-- Trigger: crear fila en users cuando se registra alguien
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

## Instalación local

```bash
npm install
npm run dev
```

## Deploy en Vercel

1. Push a GitHub
2. Importa el repo en Vercel
3. Agrega todas las variables de entorno
4. Crea un KV Store en Vercel → Storage y copia las vars
5. Configura el webhook de MercadoPago apuntando a:
   `https://tu-app.vercel.app/api/mp-webhook`

## Límites por plan

| Plan | Conversiones/día | Precio |
|------|-----------------|--------|
| Sin cuenta | 3 (por IP) | Gratis |
| Free (con cuenta) | 10 | Gratis |
| Pro | Ilimitado | $5 USD/mes |
