-- ============================================================
-- 020_auditoria_referencia.sql
-- ============================================================
-- Bloco 13.2, segunda parte. A 019 deixou a tela /logs sem como responder a
-- pergunta mais comum de auditoria — "o que aconteceu com a proposta P-123?":
-- evento de trigger não tem mensagem, e a busca só olhava mensagem e autor.
--
-- `referencia` é como a tela identifica o registro (número da proposta,
-- código da obra, nome do cliente), gravada no momento do evento. Fica
-- gravada e não é lida da tabela na hora de mostrar porque o registro pode
-- ter sido excluído — e é justamente na exclusão que a auditoria mais importa.
--
-- O trigger é o da 019 com uma linha a mais; a RPC ganha `p_referencia`, o
-- que muda a assinatura (drop + create, e os grants de novo).
-- ============================================================

begin;

alter table auditoria_eventos
  add column referencia text
    check (referencia is null or char_length(referencia) <= 200);

create or replace function auditar_mudanca()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_linha jsonb;
  v_campos jsonb := '{}'::jsonb;
  v_chave text;
  v_acao text;
  v_uid uuid := auth.uid();
  v_origem text;
  v_empresa uuid;
  v_referencia text;
begin
  begin
    if tg_op = 'INSERT' then
      v_new := to_jsonb(new);
      v_linha := v_new;
    elsif tg_op = 'DELETE' then
      v_old := to_jsonb(old);
      v_linha := v_old;
    else
      v_old := to_jsonb(old);
      v_new := to_jsonb(new);
      v_linha := v_new;
    end if;

    v_empresa := nullif(v_linha ->> 'empresa_id', '')::uuid;
    if v_empresa is null then
      return null;
    end if;

    if tg_op = 'UPDATE' then
      for v_chave in select jsonb_object_keys(v_new) loop
        -- updated_at muda em todo update; historico é o espelho do status, que
        -- já entra no diff pela própria coluna.
        continue when v_chave in ('updated_at', 'historico');
        if (v_old -> v_chave) is distinct from (v_new -> v_chave) then
          v_campos := v_campos || jsonb_build_object(
            v_chave,
            case
              -- O JSON da IA é grande e não se lê num diff: só diz que mudou.
              when v_chave = 'dados_extraidos' then
                jsonb_build_object('de', '[omitido]', 'para', '[omitido]')
              else
                jsonb_build_object('de', v_old -> v_chave, 'para', v_new -> v_chave)
            end
          );
        end if;
      end loop;

      if v_campos = '{}'::jsonb then
        return null;
      end if;
      v_acao := case when v_campos ? 'status' then 'status' else 'editar' end;
    else
      v_acao := case tg_op when 'INSERT' then 'criar' else 'excluir' end;
    end if;

    v_origem := auditoria_origem();

    -- Como a tela identifica o registro. Em itens o `numero` é a posição na
    -- proposta (3, 4, ...), que sozinha não diz nada: lá vale a descrição.
    v_referencia := left(nullif(trim(case
      when tg_table_name = 'itens' then v_linha ->> 'descricao'
      else coalesce(
        v_linha ->> 'numero', v_linha ->> 'codigo_obra',
        v_linha ->> 'nome', v_linha ->> 'descricao'
      )
    end), ''), 200);

    insert into auditoria_eventos (
      empresa_id, origem, entidade, registro_id, referencia, acao, resultado,
      autor_id, autor_descricao, detalhe
    ) values (
      v_empresa,
      v_origem,
      tg_table_name,
      nullif(v_linha ->> 'id', '')::uuid,
      v_referencia,
      v_acao,
      'sucesso',
      -- Sem sessão, o autor de uma criação é quem a linha diz que criou (a
      -- ingestão grava o profile de serviço em created_by). Num update ou
      -- delete sem sessão, created_by é o autor ORIGINAL, não quem mexeu agora
      -- — por isso não vale ali.
      coalesce(
        v_uid,
        case when tg_op = 'INSERT' then nullif(v_linha ->> 'created_by', '')::uuid end
      ),
      case when v_uid is null then coalesce(auth.jwt() ->> 'role', current_user) end,
      case
        when tg_op = 'UPDATE' then jsonb_build_object('campos', v_campos)
        else jsonb_build_object('linha', v_linha - 'dados_extraidos')
      end
    );
  exception when others then
    raise warning 'auditoria: não registrou % em %: %', tg_op, tg_table_name, sqlerrm;
  end;
  return null;
end;
$$;


drop function if exists registrar_evento(text, text, text, text, uuid, jsonb, uuid, text);

create or replace function registrar_evento(
  p_entidade text,
  p_acao text,
  p_resultado text,
  p_mensagem text default null,
  p_registro_id uuid default null,
  p_detalhe jsonb default null,
  p_empresa_id uuid default null,
  p_autor_descricao text default null,
  p_referencia text default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_empresa uuid;
  v_origem text := auditoria_origem();
  v_id bigint;
begin
  if v_uid is not null then
    v_empresa := current_empresa_id();
  elsif v_origem in ('automacao', 'banco') then
    v_empresa := p_empresa_id;
  end if;

  if v_empresa is null then
    raise exception using message = 'auditoria_sem_empresa';
  end if;

  insert into auditoria_eventos (
    empresa_id, origem, entidade, registro_id, referencia, acao, resultado,
    mensagem, autor_id, autor_descricao, detalhe
  ) values (
    v_empresa, v_origem, p_entidade, p_registro_id, left(p_referencia, 200),
    p_acao, p_resultado, left(p_mensagem, 4000),
    v_uid,
    case when v_uid is null then coalesce(p_autor_descricao, auth.jwt() ->> 'role', current_user) end,
    p_detalhe
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function registrar_evento(text, text, text, text, uuid, jsonb, uuid, text, text) from public, anon;
grant execute on function registrar_evento(text, text, text, text, uuid, jsonb, uuid, text, text) to authenticated, service_role;

commit;
