create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

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
