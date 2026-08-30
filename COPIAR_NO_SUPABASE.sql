create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.site_settings (
  id boolean primary key default true check (id),
  couple_names text not null default 'Luiz Carlos & Daiana',
  event_timezone text not null default 'America/Sao_Paulo',
  ceremony_at timestamptz not null default '2026-11-28 15:00:00-03',
  rsvp_deadline timestamptz not null default '2026-10-25 23:59:59-03',
  music_url text,
  gallery_enabled boolean not null default false,
  gallery_visible_after timestamptz not null default '2026-11-28 20:00:00-03',
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_users (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid unique,
  email text not null unique,
  display_name text not null,
  role text not null default 'admin',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_users_role_check check (role in ('owner', 'admin', 'viewer')),
  constraint admin_users_email_check check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create table if not exists public.guests (
  id uuid primary key default extensions.gen_random_uuid(),
  display_name text not null,
  invitation_token_hash text not null unique,
  token_hint text,
  max_adults integer not null default 1,
  max_children integer not null default 0,
  active boolean not null default true,
  invitation_opened_at timestamptz,
  invitation_open_count integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guests_display_name_check check (char_length(trim(display_name)) between 2 and 180),
  constraint guests_max_adults_check check (max_adults >= 0),
  constraint guests_max_children_check check (max_children >= 0),
  constraint guests_total_limit_check check (max_adults + max_children >= 1),
  constraint guests_token_hash_check check (invitation_token_hash ~ '^[a-f0-9]{64}$')
);

create table if not exists public.rsvps (
  id uuid primary key default extensions.gen_random_uuid(),
  guest_id uuid not null unique references public.guests(id) on delete cascade,
  status text not null default 'pending',
  adults_count integer not null default 0,
  children_count integer not null default 0,
  companion_names text[] not null default '{}'::text[],
  dietary_restrictions text,
  phone text,
  message text,
  consent_at timestamptz,
  submitted_at timestamptz not null default now(),
  changed_at timestamptz,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rsvps_status_check check (status in ('pending', 'attending', 'declined')),
  constraint rsvps_counts_check check (adults_count >= 0 and children_count >= 0),
  constraint rsvps_revision_check check (revision >= 1)
);

create table if not exists public.guest_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  guest_id uuid not null unique references public.guests(id) on delete cascade,
  message text not null,
  status text not null default 'pending_moderation',
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  moderated_by uuid references public.admin_users(id) on delete set null,
  moderated_at timestamptz,
  constraint guest_messages_length_check check (char_length(trim(message)) between 3 and 1200),
  constraint guest_messages_status_check check (status in ('pending_moderation', 'approved', 'rejected'))
);

create table if not exists public.gallery_items (
  id uuid primary key default extensions.gen_random_uuid(),
  guest_id uuid not null references public.guests(id) on delete cascade,
  storage_bucket text not null default 'wedding-gallery',
  storage_path text not null unique,
  caption text,
  people text,
  content_type text,
  file_size_bytes bigint,
  status text not null default 'upload_requested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  moderated_by uuid references public.admin_users(id) on delete set null,
  moderated_at timestamptz,
  constraint gallery_items_bucket_check check (storage_bucket = 'wedding-gallery'),
  constraint gallery_items_path_check check (storage_path ~ '^[a-z0-9][a-z0-9/_-]*\.(jpg|jpeg|png|webp)$' and storage_path not like '%..%'),
  constraint gallery_items_content_type_check check (content_type is null or content_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint gallery_items_file_size_check check (file_size_bytes is null or (file_size_bytes > 0 and file_size_bytes <= 12582912)),
  constraint gallery_items_status_check check (status in ('upload_requested', 'pending_moderation', 'approved', 'rejected', 'deleted'))
);

create table if not exists public.audit_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  actor_user_id uuid,
  actor_email text,
  guest_id uuid references public.guests(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists guests_active_idx on public.guests(active);
create index if not exists guests_display_name_idx on public.guests using gin (to_tsvector('portuguese', display_name));
create index if not exists rsvps_status_idx on public.rsvps(status);
create index if not exists guest_messages_status_idx on public.guest_messages(status);
create index if not exists gallery_items_status_idx on public.gallery_items(status, created_at desc);
create index if not exists audit_logs_created_at_idx on public.audit_logs(created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists site_settings_set_updated_at on public.site_settings;
create trigger site_settings_set_updated_at before update on public.site_settings
for each row execute function public.set_updated_at();

drop trigger if exists admin_users_set_updated_at on public.admin_users;
create trigger admin_users_set_updated_at before update on public.admin_users
for each row execute function public.set_updated_at();

drop trigger if exists guests_set_updated_at on public.guests;
create trigger guests_set_updated_at before update on public.guests
for each row execute function public.set_updated_at();

drop trigger if exists rsvps_set_updated_at on public.rsvps;
create trigger rsvps_set_updated_at before update on public.rsvps
for each row execute function public.set_updated_at();

drop trigger if exists guest_messages_set_updated_at on public.guest_messages;
create trigger guest_messages_set_updated_at before update on public.guest_messages
for each row execute function public.set_updated_at();

drop trigger if exists gallery_items_set_updated_at on public.gallery_items;
create trigger gallery_items_set_updated_at before update on public.gallery_items
for each row execute function public.set_updated_at();

create or replace function public.hash_invitation_token(p_token text)
returns text
language sql
immutable
as $$
  select encode(extensions.digest(trim(coalesce(p_token, ''))::text, 'sha256'::text), 'hex');
$$;

create or replace function public.generate_invitation_token()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  loop
    v_token := translate(rtrim(encode(extensions.gen_random_bytes(24), 'base64'), '='), '+/', '-_');
    exit when not exists (
      select 1
      from public.guests
      where invitation_token_hash = public.hash_invitation_token(v_token)
    );
  end loop;
  return v_token;
end;
$$;

create or replace function public.current_user_is_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  return exists (
    select 1
    from public.admin_users au
    where au.active = true
      and (
        au.user_id = auth.uid()
        or lower(au.email) = v_email
      )
  );
end;
$$;

create or replace function public.current_admin_id()
returns uuid
language sql
security definer
set search_path = public
as $$
  select au.id
  from public.admin_users au
  where au.active = true
    and (au.user_id = auth.uid() or lower(au.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  order by au.role = 'owner' desc, au.created_at
  limit 1;
$$;

create or replace function public.write_audit(
  p_action text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_guest_id uuid default null,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (actor_user_id, actor_email, guest_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    lower(coalesce(auth.jwt() ->> 'email', '')),
    p_guest_id,
    p_action,
    p_entity_type,
    p_entity_id,
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

create or replace function public.public_settings_json()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'music_url', music_url,
    'gallery_enabled', gallery_enabled,
    'gallery_visible_after', gallery_visible_after,
    'attire', content ->> 'attire',
    'parking', content ->> 'parking',
    'arrival', content ->> 'arrival',
    'accessibility', content ->> 'accessibility',
    'important_info', content ->> 'important_info',
    'confirmation_message', content ->> 'confirmation_message',
    'story_chapters', coalesce(content -> 'story_chapters', '[]'::jsonb),
    'faqs', coalesce(content -> 'faqs', '[]'::jsonb)
  )
  from public.site_settings
  where id = true;
$$;

create or replace function public.admin_settings_json()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.public_settings_json() || jsonb_build_object(
    'pix_key', coalesce(content ->> 'pix_key', ''),
    'pix_copy_paste', coalesce(content ->> 'pix_copy_paste', ''),
    'pix_receiver', coalesce(content ->> 'pix_receiver', 'Luiz Carlos e Daiana'),
    'pix_bank', coalesce(content ->> 'pix_bank', ''),
    'pix_message', coalesce(content ->> 'pix_message', '')
  )
  from public.site_settings
  where id = true;
$$;

insert into public.site_settings (id, content)
values (
  true,
  jsonb_build_object(
    'attire', 'Conteúdo provisório: definir traje sugerido no painel administrativo.',
    'pix_key', '',
    'pix_copy_paste', '',
    'pix_receiver', 'Luiz Carlos e Daiana',
    'pix_bank', '',
    'pix_message', 'Obrigado por celebrar conosco. O PIX aparece apenas para convidados com presença confirmada.',
    'parking', 'Conteúdo provisório: incluir orientações de estacionamento.',
    'arrival', 'Conteúdo provisório: incluir orientações de chegada.',
    'accessibility', 'Conteúdo provisório: informar acessibilidade.',
    'important_info', 'Conteúdo provisório: adicionar informações importantes.',
    'confirmation_message', 'Sua resposta foi recebida com carinho.',
    'story_chapters', jsonb_build_array(
      jsonb_build_object('title', 'O nosso início', 'text', 'Daiana e Bassani se conheceram em junho de 2017. Naquele momento, Daiana já era mãe do Davi, e desde o início Bassani criou com ele um vínculo muito especial. Os dois se gostavam muito e construíram uma relação cheia de carinho.', 'image_url', 'assets/historia/familia-01.jpg'),
      jsonb_build_object('title', 'A chegada do Matteo', 'text', 'Em 2020, a família cresceu com a chegada do Matteo. Davi e Matteo tinham quase nove anos de diferença. Apesar de o Davi ter o seu jeitinho muito particular de ver e se relacionar com o mundo, ainda assim os dois construíram uma relação bonita, cada um à sua maneira, cheia de carinho e cumplicidade.', 'image_url', 'assets/historia/familia-04.jpg'),
      jsonb_build_object('title', 'Uma família cheia de amor', 'text', 'Ao longo dos anos, os quatro viveram muitos momentos felizes juntos e construíram uma família cheia de amor.', 'image_url', 'assets/historia/familia-03.jpg'),
      jsonb_build_object('title', 'Sempre perto, sempre amado', 'text', 'Hoje, Davi não está mais fisicamente presente, mas continua sendo parte dessa família e dessa história. Está presente nas lembranças, no coração de todos e, principalmente, no amor que deixou. Matteo ainda fala do irmão, conta que ele mora no céu e carrega consigo esse vínculo tão especial.', 'image_url', 'assets/historia/familia-02.jpg'),
      jsonb_build_object('title', 'Um novo capítulo', 'text', 'E é assim que essa família chega a um novo capítulo: depois de tantos anos juntos, Daiana e Bassani celebram o amor que construíram, a família que formaram e a história que continuam escrevendo juntos. Com a fé que os sustenta e a certeza de que Deus esteve presente em cada passo dessa caminhada, eles seguem para esse novo capítulo confiantes de que Davi também estará presente, de alguma forma, nesse momento tão especial — sempre perto, sempre amado e para sempre parte dessa família.' || chr(10) || chr(10) || 'Agora, é hora de celebrar o amor, a família e a vida, com o coração cheio de gratidão por tudo o que viveram e por tudo o que ainda está por vir.', 'image_url', 'assets/historia/familia-05.jpg')
    ),
    'faqs', jsonb_build_array(
      jsonb_build_object('question', 'Posso levar acompanhante?', 'answer', 'Conteúdo provisório. O limite aparece no seu convite.'),
      jsonb_build_object('question', 'Crianças são convidadas?', 'answer', 'Conteúdo provisório. A quantidade autorizada aparece na sua área do convidado.'),
      jsonb_build_object('question', 'Qual o traje?', 'answer', 'Conteúdo provisório. Os noivos poderão definir no painel.'),
      jsonb_build_object('question', 'Onde estacionar?', 'answer', 'Conteúdo provisório. As orientações serão adicionadas antes do evento.'),
      jsonb_build_object('question', 'Como alterar a confirmação?', 'answer', 'Volte ao seu link personalizado e edite sua resposta até 25 de outubro de 2026.'),
      jsonb_build_object('question', 'Como faço para presentear os noivos?', 'answer', 'Não haverá catálogo de compra. Após confirmar presença, o código PIX dos noivos aparece na área privada do convite.'),
      jsonb_build_object('question', 'Até quando posso confirmar presença?', 'answer', 'Até 25 de outubro de 2026.')
    )
  )
)
on conflict (id) do update
set content = excluded.content,
    updated_at = now();

alter table public.site_settings enable row level security;
alter table public.admin_users enable row level security;
alter table public.guests enable row level security;
alter table public.rsvps enable row level security;
alter table public.guest_messages enable row level security;
alter table public.gallery_items enable row level security;
alter table public.audit_logs enable row level security;

revoke all on public.site_settings from anon, authenticated;
revoke all on public.admin_users from anon, authenticated;
revoke all on public.guests from anon, authenticated;
revoke all on public.rsvps from anon, authenticated;
revoke all on public.guest_messages from anon, authenticated;
revoke all on public.gallery_items from anon, authenticated;
revoke all on public.audit_logs from anon, authenticated;

drop policy if exists "Admins can read site settings" on public.site_settings;
create policy "Admins can read site settings" on public.site_settings
for select to authenticated
using (public.current_user_is_admin());

drop policy if exists "Admins can manage admin users" on public.admin_users;
create policy "Admins can manage admin users" on public.admin_users
for all to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Admins can manage guests" on public.guests;
create policy "Admins can manage guests" on public.guests
for all to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Admins can manage rsvps" on public.rsvps;
create policy "Admins can manage rsvps" on public.rsvps
for all to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Admins can manage guest messages" on public.guest_messages;
create policy "Admins can manage guest messages" on public.guest_messages
for all to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Admins can manage gallery items" on public.gallery_items;
create policy "Admins can manage gallery items" on public.gallery_items
for all to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Admins can read audit logs" on public.audit_logs;
create policy "Admins can read audit logs" on public.audit_logs
for select to authenticated
using (public.current_user_is_admin());

create or replace function public.resolve_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest public.guests%rowtype;
begin
  select *
    into v_guest
  from public.guests
  where invitation_token_hash = public.hash_invitation_token(p_token)
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid', 'message', 'Convite não encontrado.');
  end if;

  if v_guest.active is false then
    return jsonb_build_object('ok', false, 'reason', 'inactive', 'message', 'Este convite está desativado.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'guest', jsonb_build_object(
      'display_name', v_guest.display_name,
      'max_adults', v_guest.max_adults,
      'max_children', v_guest.max_children
    ),
    'settings', public.public_settings_json()
  );
end;
$$;

create or replace function public.register_invitation_open(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest public.guests%rowtype;
begin
  update public.guests
  set invitation_opened_at = coalesce(invitation_opened_at, now()),
      invitation_open_count = invitation_open_count + 1
  where invitation_token_hash = public.hash_invitation_token(p_token)
    and active = true
  returning * into v_guest;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'Convite não encontrado.');
  end if;

  insert into public.audit_logs (guest_id, action, entity_type, entity_id)
  values (v_guest.id, 'invitation_opened', 'guest', v_guest.id);

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.get_guest_area(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest public.guests%rowtype;
  v_rsvp public.rsvps%rowtype;
begin
  select *
    into v_guest
  from public.guests
  where invitation_token_hash = public.hash_invitation_token(p_token)
    and active = true
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'Convite não encontrado.');
  end if;

  select *
    into v_rsvp
  from public.rsvps r
  where r.guest_id = v_guest.id;

  return jsonb_build_object(
    'ok', true,
    'guest', jsonb_build_object(
      'id', v_guest.id,
      'display_name', v_guest.display_name,
      'max_adults', v_guest.max_adults,
      'max_children', v_guest.max_children,
      'active', v_guest.active,
      'invitation_opened_at', v_guest.invitation_opened_at,
      'invitation_open_count', v_guest.invitation_open_count
    ),
    'rsvp', case when v_rsvp.id is null then null else to_jsonb(v_rsvp) end,
    'pix', case
      when v_rsvp.status = 'attending' then coalesce((
        select jsonb_build_object(
          'available', true,
          'key', coalesce(content ->> 'pix_key', ''),
          'copy_paste', coalesce(content ->> 'pix_copy_paste', ''),
          'receiver', coalesce(content ->> 'pix_receiver', 'Luiz Carlos e Daiana'),
          'bank', coalesce(content ->> 'pix_bank', ''),
          'message', coalesce(content ->> 'pix_message', '')
        )
        from public.site_settings
        where id = true
      ), jsonb_build_object('available', true))
      else jsonb_build_object('available', false)
    end,
    'messages', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.updated_at desc)
      from public.guest_messages m
      where m.guest_id = v_guest.id
    ), '[]'::jsonb),
    'gallery_items', coalesce((
      select jsonb_agg(to_jsonb(gi) order by gi.created_at desc)
      from public.gallery_items gi
      where gi.guest_id = v_guest.id
        and gi.status <> 'deleted'
    ), '[]'::jsonb),
    'settings', public.public_settings_json()
  );
end;
$$;

create or replace function public.upsert_rsvp(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest public.guests%rowtype;
  v_rsvp public.rsvps%rowtype;
  v_settings public.site_settings%rowtype;
  v_status text := lower(coalesce(p_payload ->> 'status', ''));
  v_adults integer := coalesce(nullif(p_payload ->> 'adults_count', '')::integer, 0);
  v_children integer := coalesce(nullif(p_payload ->> 'children_count', '')::integer, 0);
  v_names text[] := '{}'::text[];
  v_existing_revision integer := 0;
begin
  select * into v_settings from public.site_settings where id = true;

  if now() > v_settings.rsvp_deadline then
    return jsonb_build_object('ok', false, 'message', 'O prazo de confirmação já encerrou.');
  end if;

  select *
    into v_guest
  from public.guests
  where invitation_token_hash = public.hash_invitation_token(p_token)
    and active = true
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'Convite não encontrado.');
  end if;

  if v_status not in ('attending', 'declined') then
    return jsonb_build_object('ok', false, 'message', 'Escolha uma resposta para o convite.');
  end if;

  if coalesce((p_payload ->> 'consent')::boolean, false) is false then
    return jsonb_build_object('ok', false, 'message', 'O consentimento é obrigatório para salvar a confirmação.');
  end if;

  if v_status = 'declined' then
    v_adults := 0;
    v_children := 0;
  else
    if v_adults + v_children < 1 then
      return jsonb_build_object('ok', false, 'message', 'Informe ao menos uma pessoa confirmada.');
    end if;
    if v_adults > v_guest.max_adults or v_children > v_guest.max_children then
      return jsonb_build_object('ok', false, 'message', 'A quantidade informada ultrapassa o limite deste convite.');
    end if;

    select coalesce(array_agg(trim(value)), '{}'::text[])
      into v_names
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(p_payload -> 'companion_names') = 'array' then p_payload -> 'companion_names'
        else '[]'::jsonb
      end
    ) as names(value)
    where trim(value) <> '';
  end if;

  select revision into v_existing_revision from public.rsvps where guest_id = v_guest.id;

  insert into public.rsvps (
    guest_id,
    status,
    adults_count,
    children_count,
    companion_names,
    dietary_restrictions,
    phone,
    message,
    consent_at,
    submitted_at,
    changed_at,
    revision
  )
  values (
    v_guest.id,
    v_status,
    v_adults,
    v_children,
    v_names,
    nullif(trim(coalesce(p_payload ->> 'dietary_restrictions', '')), ''),
    nullif(trim(coalesce(p_payload ->> 'phone', '')), ''),
    nullif(trim(coalesce(p_payload ->> 'message', '')), ''),
    now(),
    now(),
    null,
    1
  )
  on conflict (guest_id) do update
  set status = excluded.status,
      adults_count = excluded.adults_count,
      children_count = excluded.children_count,
      companion_names = excluded.companion_names,
      dietary_restrictions = excluded.dietary_restrictions,
      phone = excluded.phone,
      message = excluded.message,
      consent_at = coalesce(public.rsvps.consent_at, excluded.consent_at),
      changed_at = now(),
      revision = public.rsvps.revision + 1
  returning * into v_rsvp;

  insert into public.audit_logs (guest_id, action, entity_type, entity_id, details)
  values (
    v_guest.id,
    case when v_existing_revision > 0 then 'rsvp_updated' else 'rsvp_created' end,
    'rsvp',
    v_rsvp.id,
    jsonb_build_object('status', v_status, 'adults', v_adults, 'children', v_children)
  );

  return jsonb_build_object('ok', true, 'rsvp', to_jsonb(v_rsvp));
end;
$$;

create or replace function public.submit_guest_message(p_token text, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest public.guests%rowtype;
  v_message public.guest_messages%rowtype;
  v_text text := nullif(trim(coalesce(p_message, '')), '');
begin
  if v_text is null or char_length(v_text) < 3 then
    return jsonb_build_object('ok', false, 'message', 'Escreva uma mensagem um pouco maior.');
  end if;

  select *
    into v_guest
  from public.guests
  where invitation_token_hash = public.hash_invitation_token(p_token)
    and active = true
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'Convite não encontrado.');
  end if;

  insert into public.guest_messages (guest_id, message, status, submitted_at)
  values (v_guest.id, left(v_text, 1200), 'pending_moderation', now())
  on conflict (guest_id) do update
  set message = excluded.message,
      status = 'pending_moderation',
      updated_at = now(),
      moderated_by = null,
      moderated_at = null
  returning * into v_message;

  insert into public.audit_logs (guest_id, action, entity_type, entity_id)
  values (v_guest.id, 'guest_message_submitted', 'guest_message', v_message.id);

  return jsonb_build_object('ok', true, 'message', to_jsonb(v_message));
end;
$$;

create or replace function public.request_gallery_upload(p_token text, p_metadata jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest public.guests%rowtype;
  v_settings public.site_settings%rowtype;
  v_content_type text := lower(coalesce(p_metadata ->> 'content_type', ''));
  v_file_size bigint := coalesce(nullif(p_metadata ->> 'file_size', '')::bigint, 0);
  v_ext text;
  v_item public.gallery_items%rowtype;
begin
  select * into v_settings from public.site_settings where id = true;
  if v_settings.gallery_enabled is false and now() < v_settings.gallery_visible_after then
    return jsonb_build_object('ok', false, 'message', 'A galeria ainda não está ativa.');
  end if;

  if v_content_type not in ('image/jpeg', 'image/png', 'image/webp') then
    return jsonb_build_object('ok', false, 'message', 'Formato de imagem não permitido.');
  end if;

  if v_file_size <= 0 or v_file_size > 12582912 then
    return jsonb_build_object('ok', false, 'message', 'A foto precisa ter até 12 MB.');
  end if;

  select *
    into v_guest
  from public.guests
  where invitation_token_hash = public.hash_invitation_token(p_token)
    and active = true
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'Convite não encontrado.');
  end if;

  v_ext := case
    when v_content_type = 'image/png' then 'png'
    when v_content_type = 'image/webp' then 'webp'
    else 'jpg'
  end;

  insert into public.gallery_items (
    guest_id,
    storage_bucket,
    storage_path,
    caption,
    people,
    content_type,
    file_size_bytes,
    status
  )
  values (
    v_guest.id,
    'wedding-gallery',
    'guests/' || v_guest.id::text || '/' || extensions.gen_random_uuid()::text || '.' || v_ext,
    nullif(trim(coalesce(p_metadata ->> 'caption', '')), ''),
    nullif(trim(coalesce(p_metadata ->> 'people', '')), ''),
    v_content_type,
    v_file_size,
    'upload_requested'
  )
  returning * into v_item;

  return jsonb_build_object(
    'ok', true,
    'bucket', v_item.storage_bucket,
    'storage_path', v_item.storage_path,
    'item', to_jsonb(v_item)
  );
end;
$$;

create or replace function public.confirm_gallery_upload(p_token text, p_gallery_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest public.guests%rowtype;
  v_item public.gallery_items%rowtype;
begin
  select *
    into v_guest
  from public.guests
  where invitation_token_hash = public.hash_invitation_token(p_token)
    and active = true
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'Convite não encontrado.');
  end if;

  update public.gallery_items
  set status = 'pending_moderation'
  where id = p_gallery_id
    and guest_id = v_guest.id
    and status = 'upload_requested'
  returning * into v_item;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'Envio não encontrado.');
  end if;

  insert into public.audit_logs (guest_id, action, entity_type, entity_id)
  values (v_guest.id, 'gallery_uploaded', 'gallery_item', v_item.id);

  return jsonb_build_object('ok', true, 'item', to_jsonb(v_item));
end;
$$;

create or replace function public.admin_get_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'Usuário não autorizado para o painel administrativo.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'ok', true,
    'totals', jsonb_build_object(
      'invitations_created', (select count(*) from public.guests),
      'invitations_opened', (select count(*) from public.guests where invitation_opened_at is not null),
      'rsvps_received', (select count(*) from public.rsvps where status in ('attending', 'declined')),
      'attending', (select count(*) from public.rsvps where status = 'attending'),
      'declined', (select count(*) from public.rsvps where status = 'declined'),
      'pending', (select count(*) from public.guests g where not exists (select 1 from public.rsvps r where r.guest_id = g.id and r.status in ('attending', 'declined'))),
      'adults', coalesce((select sum(adults_count) from public.rsvps where status = 'attending'), 0),
      'children', coalesce((select sum(children_count) from public.rsvps where status = 'attending'), 0),
      'pix_unlocked', (select count(*) from public.rsvps where status = 'attending'),
      'messages', (select count(*) from public.guest_messages),
      'gallery_items', (select count(*) from public.gallery_items where status <> 'deleted'),
      'dietary_notes', (select count(*) from public.rsvps where nullif(trim(coalesce(dietary_restrictions, '')), '') is not null)
    ),
    'guests', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', g.id,
          'display_name', g.display_name,
          'token_hint', g.token_hint,
          'max_adults', g.max_adults,
          'max_children', g.max_children,
          'active', g.active,
          'invitation_opened_at', g.invitation_opened_at,
          'invitation_open_count', g.invitation_open_count,
          'created_at', g.created_at,
          'rsvp', to_jsonb(r)
        )
        order by g.display_name
      )
      from public.guests g
      left join public.rsvps r on r.guest_id = g.id
    ), '[]'::jsonb),
    'rsvps', coalesce((select jsonb_agg(to_jsonb(r) order by r.updated_at desc) from public.rsvps r), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(
        to_jsonb(m) || jsonb_build_object('guest', jsonb_build_object('id', g.id, 'display_name', g.display_name))
        order by m.updated_at desc
      )
      from public.guest_messages m
      join public.guests g on g.id = m.guest_id
    ), '[]'::jsonb),
    'gallery_items', coalesce((
      select jsonb_agg(
        to_jsonb(gi) || jsonb_build_object('guest', jsonb_build_object('id', g.id, 'display_name', g.display_name))
        order by gi.created_at desc
      )
      from public.gallery_items gi
      join public.guests g on g.id = gi.guest_id
      where gi.status <> 'deleted'
    ), '[]'::jsonb),
    'settings', public.admin_settings_json()
  );
end;
$$;

create or replace function public.admin_save_guest(
  p_guest_id uuid default null,
  p_display_name text default null,
  p_max_adults integer default 1,
  p_max_children integer default 0,
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest public.guests%rowtype;
  v_token text;
  v_name text := nullif(trim(coalesce(p_display_name, '')), '');
begin
  if not public.current_user_is_admin() then
    raise exception 'Usuário não autorizado.' using errcode = '42501';
  end if;

  if v_name is null then
    return jsonb_build_object('ok', false, 'message', 'Informe o nome do convidado.');
  end if;

  if coalesce(p_max_adults, 0) + coalesce(p_max_children, 0) < 1 then
    return jsonb_build_object('ok', false, 'message', 'O convite precisa permitir ao menos uma pessoa.');
  end if;

  if p_guest_id is null then
    v_token := public.generate_invitation_token();
    insert into public.guests (
      display_name,
      invitation_token_hash,
      token_hint,
      max_adults,
      max_children,
      active
    )
    values (
      v_name,
      public.hash_invitation_token(v_token),
      right(v_token, 8),
      greatest(coalesce(p_max_adults, 0), 0),
      greatest(coalesce(p_max_children, 0), 0),
      coalesce(p_active, true)
    )
    returning * into v_guest;
    perform public.write_audit('admin_guest_created', 'guest', v_guest.id, v_guest.id, jsonb_build_object('display_name', v_name));
  else
    update public.guests
    set display_name = v_name,
        max_adults = greatest(coalesce(p_max_adults, 0), 0),
        max_children = greatest(coalesce(p_max_children, 0), 0),
        active = coalesce(p_active, true)
    where id = p_guest_id
    returning * into v_guest;

    if not found then
      return jsonb_build_object('ok', false, 'message', 'Convidado não encontrado.');
    end if;
    perform public.write_audit('admin_guest_updated', 'guest', v_guest.id, v_guest.id, jsonb_build_object('display_name', v_name));
  end if;

  return jsonb_build_object('ok', true, 'guest', to_jsonb(v_guest), 'plain_token', v_token);
end;
$$;

create or replace function public.admin_regenerate_guest_token(p_guest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest public.guests%rowtype;
  v_token text;
begin
  if not public.current_user_is_admin() then
    raise exception 'Usuário não autorizado.' using errcode = '42501';
  end if;

  v_token := public.generate_invitation_token();

  update public.guests
  set invitation_token_hash = public.hash_invitation_token(v_token),
      token_hint = right(v_token, 8)
  where id = p_guest_id
  returning * into v_guest;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'Convidado não encontrado.');
  end if;

  perform public.write_audit('admin_guest_token_regenerated', 'guest', v_guest.id, v_guest.id);
  return jsonb_build_object('ok', true, 'guest', to_jsonb(v_guest), 'plain_token', v_token);
end;
$$;

create or replace function public.admin_deactivate_guest(p_guest_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'Usuário não autorizado.' using errcode = '42501';
  end if;

  update public.guests set active = coalesce(p_active, false) where id = p_guest_id;
  perform public.write_audit('admin_guest_active_changed', 'guest', p_guest_id, p_guest_id, jsonb_build_object('active', p_active));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_save_site_settings(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.site_settings%rowtype;
begin
  if not public.current_user_is_admin() then
    raise exception 'Usuário não autorizado.' using errcode = '42501';
  end if;

  update public.site_settings
  set music_url = nullif(trim(coalesce(p_settings ->> 'music_url', '')), ''),
      gallery_enabled = coalesce((p_settings ->> 'gallery_enabled')::boolean, false),
      gallery_visible_after = coalesce(nullif(p_settings ->> 'gallery_visible_after', '')::timestamptz, gallery_visible_after),
      content = jsonb_strip_nulls(
        jsonb_build_object(
          'pix_key', p_settings ->> 'pix_key',
          'pix_copy_paste', p_settings ->> 'pix_copy_paste',
          'pix_receiver', p_settings ->> 'pix_receiver',
          'pix_bank', p_settings ->> 'pix_bank',
          'pix_message', p_settings ->> 'pix_message',
          'attire', p_settings ->> 'attire',
          'parking', p_settings ->> 'parking',
          'arrival', p_settings ->> 'arrival',
          'accessibility', p_settings ->> 'accessibility',
          'important_info', p_settings ->> 'important_info',
          'confirmation_message', p_settings ->> 'confirmation_message',
          'story_chapters', coalesce(p_settings -> 'story_chapters', '[]'::jsonb),
          'faqs', coalesce(p_settings -> 'faqs', '[]'::jsonb)
        )
      )
  where id = true
  returning * into v_settings;

  perform public.write_audit('admin_site_settings_saved', 'site_settings', null);
  return jsonb_build_object('ok', true, 'settings', public.admin_settings_json());
end;
$$;

create or replace function public.admin_moderate_message(p_message_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.current_admin_id();
begin
  if not public.current_user_is_admin() then
    raise exception 'Usuário não autorizado.' using errcode = '42501';
  end if;

  if p_status not in ('approved', 'rejected', 'pending_moderation') then
    return jsonb_build_object('ok', false, 'message', 'Status inválido.');
  end if;

  update public.guest_messages
  set status = p_status,
      moderated_by = v_admin,
      moderated_at = now()
  where id = p_message_id;

  perform public.write_audit('admin_message_moderated', 'guest_message', p_message_id, null, jsonb_build_object('status', p_status));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_moderate_gallery_item(p_gallery_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.current_admin_id();
begin
  if not public.current_user_is_admin() then
    raise exception 'Usuário não autorizado.' using errcode = '42501';
  end if;

  if p_status not in ('approved', 'rejected', 'pending_moderation', 'deleted') then
    return jsonb_build_object('ok', false, 'message', 'Status inválido.');
  end if;

  update public.gallery_items
  set status = p_status,
      moderated_by = v_admin,
      moderated_at = now()
  where id = p_gallery_id;

  perform public.write_audit('admin_gallery_moderated', 'gallery_item', p_gallery_id, null, jsonb_build_object('status', p_status));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.can_upload_gallery_object(p_name text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.gallery_items gi
    where gi.storage_bucket = 'wedding-gallery'
      and gi.storage_path = p_name
      and gi.status = 'upload_requested'
      and gi.created_at > now() - interval '30 minutes'
  );
$$;

insert into public.guests (
  display_name,
  invitation_token_hash,
  token_hint,
  max_adults,
  max_children,
  active
)
values (
  'Lucas e Fernanda',
  public.hash_invitation_token('lucas-fernanda-demo'),
  'demo',
  2,
  1,
  true
)
on conflict (invitation_token_hash) do update
set display_name = excluded.display_name,
    max_adults = excluded.max_adults,
    max_children = excluded.max_children,
    active = true,
    updated_at = now();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wedding-gallery',
  'wedding-gallery',
  false,
  12582912,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admins can manage wedding gallery objects" on storage.objects;
create policy "Admins can manage wedding gallery objects"
on storage.objects
for all
to authenticated
using (bucket_id = 'wedding-gallery' and public.current_user_is_admin())
with check (bucket_id = 'wedding-gallery' and public.current_user_is_admin());

drop policy if exists "Guests can upload requested gallery object" on storage.objects;
create policy "Guests can upload requested gallery object"
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'wedding-gallery' and public.can_upload_gallery_object(name));

revoke all on function public.hash_invitation_token(text) from public;
revoke all on function public.generate_invitation_token() from public;
revoke all on function public.current_user_is_admin() from public;
revoke all on function public.current_admin_id() from public;
revoke all on function public.write_audit(text, text, uuid, uuid, jsonb) from public;
revoke all on function public.public_settings_json() from public;
revoke all on function public.admin_settings_json() from public;
revoke all on function public.resolve_invitation(text) from public;
revoke all on function public.register_invitation_open(text) from public;
revoke all on function public.get_guest_area(text) from public;
revoke all on function public.upsert_rsvp(text, jsonb) from public;
revoke all on function public.submit_guest_message(text, text) from public;
revoke all on function public.request_gallery_upload(text, jsonb) from public;
revoke all on function public.confirm_gallery_upload(text, uuid) from public;
revoke all on function public.admin_get_dashboard() from public;
revoke all on function public.admin_save_guest(uuid, text, integer, integer, boolean) from public;
revoke all on function public.admin_regenerate_guest_token(uuid) from public;
revoke all on function public.admin_deactivate_guest(uuid, boolean) from public;
revoke all on function public.admin_save_site_settings(jsonb) from public;
revoke all on function public.admin_moderate_message(uuid, text) from public;
revoke all on function public.admin_moderate_gallery_item(uuid, text) from public;
revoke all on function public.can_upload_gallery_object(text) from public;

grant execute on function public.resolve_invitation(text) to anon, authenticated;
grant execute on function public.register_invitation_open(text) to anon, authenticated;
grant execute on function public.get_guest_area(text) to anon, authenticated;
grant execute on function public.upsert_rsvp(text, jsonb) to anon, authenticated;
grant execute on function public.submit_guest_message(text, text) to anon, authenticated;
grant execute on function public.request_gallery_upload(text, jsonb) to anon, authenticated;
grant execute on function public.confirm_gallery_upload(text, uuid) to anon, authenticated;
grant execute on function public.can_upload_gallery_object(text) to anon, authenticated;
grant execute on function public.current_user_is_admin() to authenticated;
grant execute on function public.admin_get_dashboard() to authenticated;
grant execute on function public.admin_save_guest(uuid, text, integer, integer, boolean) to authenticated;
grant execute on function public.admin_regenerate_guest_token(uuid) to authenticated;
grant execute on function public.admin_deactivate_guest(uuid, boolean) to authenticated;
grant execute on function public.admin_save_site_settings(jsonb) to authenticated;
grant execute on function public.admin_moderate_message(uuid, text) to authenticated;
grant execute on function public.admin_moderate_gallery_item(uuid, text) to authenticated;
