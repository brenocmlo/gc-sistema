export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      acordo_parcelas: {
        Row: {
          acordo_id: string
          created_at: string | null
          data_vencimento: string
          empresa_id: string
          id: string
          numero_parcela: number
          obra_id: string
          observacao: string | null
          status: string
          updated_at: string | null
          valor_previsto: number
        }
        Insert: {
          acordo_id: string
          created_at?: string | null
          data_vencimento: string
          empresa_id: string
          id?: string
          numero_parcela: number
          obra_id: string
          observacao?: string | null
          status?: string
          updated_at?: string | null
          valor_previsto: number
        }
        Update: {
          acordo_id?: string
          created_at?: string | null
          data_vencimento?: string
          empresa_id?: string
          id?: string
          numero_parcela?: number
          obra_id?: string
          observacao?: string | null
          status?: string
          updated_at?: string | null
          valor_previsto?: number
        }
        Relationships: [
          {
            foreignKeyName: "acordo_parcelas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcela_acordo_fk"
            columns: ["acordo_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "acordos_pagamento"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
        ]
      }
      acordos_pagamento: {
        Row: {
          anexos: Json | null
          contrato_id: string | null
          created_at: string | null
          created_by: string | null
          data_abertura: string
          data_encerramento: string | null
          descricao: string
          empresa_id: string
          id: string
          motivo: string | null
          nf_convertida_id: string | null
          obra_id: string
          observacao: string | null
          periodo_ref: string | null
          proposta_id: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          anexos?: Json | null
          contrato_id?: string | null
          created_at?: string | null
          created_by?: string | null
          data_abertura?: string
          data_encerramento?: string | null
          descricao: string
          empresa_id: string
          id?: string
          motivo?: string | null
          nf_convertida_id?: string | null
          obra_id: string
          observacao?: string | null
          periodo_ref?: string | null
          proposta_id?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          anexos?: Json | null
          contrato_id?: string | null
          created_at?: string | null
          created_by?: string | null
          data_abertura?: string
          data_encerramento?: string | null
          descricao?: string
          empresa_id?: string
          id?: string
          motivo?: string | null
          nf_convertida_id?: string | null
          obra_id?: string
          observacao?: string | null
          periodo_ref?: string | null
          proposta_id?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "acordo_contrato_fk"
            columns: ["contrato_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "contratos"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
          {
            foreignKeyName: "acordo_contrato_fk"
            columns: ["contrato_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "contratos_financeiro"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
          {
            foreignKeyName: "acordo_nf_convertida_fk"
            columns: ["nf_convertida_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "notas_fiscais"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
          {
            foreignKeyName: "acordo_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "acordo_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_com_valores"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "acordo_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_financeiro"
            referencedColumns: ["obra_id", "empresa_id"]
          },
          {
            foreignKeyName: "acordo_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "receitas_obra"
            referencedColumns: ["obra_id", "empresa_id"]
          },
          {
            foreignKeyName: "acordo_proposta_fk"
            columns: ["proposta_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "propostas"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
          {
            foreignKeyName: "acordo_proposta_fk"
            columns: ["proposta_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "propostas_financeiro"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
          {
            foreignKeyName: "acordos_pagamento_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acordos_pagamento_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      auditoria_eventos: {
        Row: {
          acao: string
          autor_descricao: string | null
          autor_id: string | null
          detalhe: Json | null
          em: string
          empresa_id: string
          entidade: string
          id: number
          mensagem: string | null
          origem: string
          referencia: string | null
          registro_id: string | null
          resultado: string
        }
        Insert: {
          acao: string
          autor_descricao?: string | null
          autor_id?: string | null
          detalhe?: Json | null
          em?: string
          empresa_id: string
          entidade: string
          id?: never
          mensagem?: string | null
          origem: string
          referencia?: string | null
          registro_id?: string | null
          resultado?: string
        }
        Update: {
          acao?: string
          autor_descricao?: string | null
          autor_id?: string | null
          detalhe?: Json | null
          em?: string
          empresa_id?: string
          entidade?: string
          id?: never
          mensagem?: string | null
          origem?: string
          referencia?: string | null
          registro_id?: string | null
          resultado?: string
        }
        Relationships: [
          {
            foreignKeyName: "auditoria_eventos_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auditoria_eventos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          cep: string | null
          cidade: string | null
          cnpj_cpf: string | null
          contato: string | null
          created_at: string | null
          created_by: string | null
          email: string | null
          empresa_id: string
          endereco: string | null
          id: string
          nome: string
          observacao: string | null
          telefone: string | null
          updated_at: string | null
        }
        Insert: {
          cep?: string | null
          cidade?: string | null
          cnpj_cpf?: string | null
          contato?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          empresa_id: string
          endereco?: string | null
          id?: string
          nome: string
          observacao?: string | null
          telefone?: string | null
          updated_at?: string | null
        }
        Update: {
          cep?: string | null
          cidade?: string | null
          cnpj_cpf?: string | null
          contato?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          empresa_id?: string
          endereco?: string | null
          id?: string
          nome?: string
          observacao?: string | null
          telefone?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      contatos_whatsapp: {
        Row: {
          canal: string
          created_at: string | null
          created_by: string | null
          empresa_id: string
          id: string
          numero_contrato: string | null
          obra_id: string | null
          telefone: string | null
          telegram_chat_id: string | null
          updated_at: string | null
        }
        Insert: {
          canal?: string
          created_at?: string | null
          created_by?: string | null
          empresa_id: string
          id?: string
          numero_contrato?: string | null
          obra_id?: string | null
          telefone?: string | null
          telegram_chat_id?: string | null
          updated_at?: string | null
        }
        Update: {
          canal?: string
          created_at?: string | null
          created_by?: string | null
          empresa_id?: string
          id?: string
          numero_contrato?: string | null
          obra_id?: string | null
          telefone?: string | null
          telegram_chat_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contatos_whatsapp_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contatos_whatsapp_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contatos_whatsapp_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "contatos_whatsapp_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_com_valores"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "contatos_whatsapp_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_financeiro"
            referencedColumns: ["obra_id", "empresa_id"]
          },
          {
            foreignKeyName: "contatos_whatsapp_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "receitas_obra"
            referencedColumns: ["obra_id", "empresa_id"]
          },
        ]
      }
      contratos: {
        Row: {
          anexos: Json | null
          condicoes_pagamento: string | null
          created_at: string | null
          created_by: string | null
          data_assinatura: string | null
          desconto: number
          descricao: string | null
          detalhe_rescisao: string | null
          empresa_id: string
          historico: Json
          id: string
          motivo_rescisao: string | null
          numero: string
          obra_id: string
          observacao: string | null
          pct_entrega_material: number | null
          pct_fd: number | null
          pct_medicao_instalacao: number | null
          pct_sinal: number | null
          prazo_execucao: string | null
          proposta_origem_id: string | null
          status: string
          updated_at: string | null
          valor_final: number | null
          valor_total: number
        }
        Insert: {
          anexos?: Json | null
          condicoes_pagamento?: string | null
          created_at?: string | null
          created_by?: string | null
          data_assinatura?: string | null
          desconto?: number
          descricao?: string | null
          detalhe_rescisao?: string | null
          empresa_id: string
          historico?: Json
          id?: string
          motivo_rescisao?: string | null
          numero: string
          obra_id: string
          observacao?: string | null
          pct_entrega_material?: number | null
          pct_fd?: number | null
          pct_medicao_instalacao?: number | null
          pct_sinal?: number | null
          prazo_execucao?: string | null
          proposta_origem_id?: string | null
          status?: string
          updated_at?: string | null
          valor_final?: number | null
          valor_total?: number
        }
        Update: {
          anexos?: Json | null
          condicoes_pagamento?: string | null
          created_at?: string | null
          created_by?: string | null
          data_assinatura?: string | null
          desconto?: number
          descricao?: string | null
          detalhe_rescisao?: string | null
          empresa_id?: string
          historico?: Json
          id?: string
          motivo_rescisao?: string | null
          numero?: string
          obra_id?: string
          observacao?: string | null
          pct_entrega_material?: number | null
          pct_fd?: number | null
          pct_medicao_instalacao?: number | null
          pct_sinal?: number | null
          prazo_execucao?: string | null
          proposta_origem_id?: string | null
          status?: string
          updated_at?: string | null
          valor_final?: number | null
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "contratos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "contratos_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_com_valores"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "contratos_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_financeiro"
            referencedColumns: ["obra_id", "empresa_id"]
          },
          {
            foreignKeyName: "contratos_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "receitas_obra"
            referencedColumns: ["obra_id", "empresa_id"]
          },
          {
            foreignKeyName: "contratos_proposta_fk"
            columns: ["proposta_origem_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "propostas"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
          {
            foreignKeyName: "contratos_proposta_fk"
            columns: ["proposta_origem_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "propostas_financeiro"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
        ]
      }
      documentos_processamento: {
        Row: {
          arquivo_url: string
          canal: string | null
          canal_chat_id: string | null
          contrato_criado_id: string | null
          created_at: string | null
          created_by: string | null
          dados_extraidos: Json | null
          empresa_id: string
          id: string
          motivo_revisao: string | null
          numero_contrato: string | null
          obra_id: string | null
          proposta_criada_id: string | null
          status: string
          tipo_documento: string
          updated_at: string | null
        }
        Insert: {
          arquivo_url: string
          canal?: string | null
          canal_chat_id?: string | null
          contrato_criado_id?: string | null
          created_at?: string | null
          created_by?: string | null
          dados_extraidos?: Json | null
          empresa_id: string
          id?: string
          motivo_revisao?: string | null
          numero_contrato?: string | null
          obra_id?: string | null
          proposta_criada_id?: string | null
          status?: string
          tipo_documento: string
          updated_at?: string | null
        }
        Update: {
          arquivo_url?: string
          canal?: string | null
          canal_chat_id?: string | null
          contrato_criado_id?: string | null
          created_at?: string | null
          created_by?: string | null
          dados_extraidos?: Json | null
          empresa_id?: string
          id?: string
          motivo_revisao?: string | null
          numero_contrato?: string | null
          obra_id?: string | null
          proposta_criada_id?: string | null
          status?: string
          tipo_documento?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documentos_processamento_contrato_criado_id_fkey"
            columns: ["contrato_criado_id"]
            isOneToOne: false
            referencedRelation: "contratos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_processamento_contrato_criado_id_fkey"
            columns: ["contrato_criado_id"]
            isOneToOne: false
            referencedRelation: "contratos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_processamento_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_processamento_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_processamento_obra_id_fkey"
            columns: ["obra_id"]
            isOneToOne: false
            referencedRelation: "obras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_processamento_obra_id_fkey"
            columns: ["obra_id"]
            isOneToOne: false
            referencedRelation: "obras_com_valores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_processamento_obra_id_fkey"
            columns: ["obra_id"]
            isOneToOne: false
            referencedRelation: "obras_financeiro"
            referencedColumns: ["obra_id"]
          },
          {
            foreignKeyName: "documentos_processamento_obra_id_fkey"
            columns: ["obra_id"]
            isOneToOne: false
            referencedRelation: "receitas_obra"
            referencedColumns: ["obra_id"]
          },
          {
            foreignKeyName: "documentos_processamento_proposta_criada_fk"
            columns: ["proposta_criada_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "propostas"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "documentos_processamento_proposta_criada_fk"
            columns: ["proposta_criada_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "propostas_financeiro"
            referencedColumns: ["id", "empresa_id"]
          },
        ]
      }
      empresas: {
        Row: {
          cep: string | null
          cidade: string | null
          cnpj: string | null
          created_at: string | null
          email: string | null
          endereco: string | null
          id: string
          inscricao_estadual: string | null
          inscricao_municipal: string | null
          logo_url: string | null
          nome: string
          razao_social: string
          telefone: string | null
          updated_at: string | null
        }
        Insert: {
          cep?: string | null
          cidade?: string | null
          cnpj?: string | null
          created_at?: string | null
          email?: string | null
          endereco?: string | null
          id?: string
          inscricao_estadual?: string | null
          inscricao_municipal?: string | null
          logo_url?: string | null
          nome: string
          razao_social: string
          telefone?: string | null
          updated_at?: string | null
        }
        Update: {
          cep?: string | null
          cidade?: string | null
          cnpj?: string | null
          created_at?: string | null
          email?: string | null
          endereco?: string | null
          id?: string
          inscricao_estadual?: string | null
          inscricao_municipal?: string | null
          logo_url?: string | null
          nome?: string
          razao_social?: string
          telefone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      execucao: {
        Row: {
          created_at: string | null
          empresa_id: string
          ent_data_atualizacao: string | null
          ent_data_fim: string | null
          ent_data_inicio: string | null
          ent_observacao: string | null
          ent_previsao_fim: string | null
          ent_qtd: number
          ent_responsavel: string | null
          ent_status: string | null
          evidencias: Json | null
          fab_data_atualizacao: string | null
          fab_data_fim: string | null
          fab_data_inicio: string | null
          fab_observacao: string | null
          fab_previsao_fim: string | null
          fab_qtd: number
          fab_responsavel: string | null
          fab_status: string | null
          foto_url: string | null
          id: string
          inst_data_atualizacao: string | null
          inst_data_fim: string | null
          inst_data_inicio: string | null
          inst_observacao: string | null
          inst_previsao_fim: string | null
          inst_qtd: number
          inst_responsavel: string | null
          inst_status: string | null
          item_id: string
          localizacao: string | null
          med_data_atualizacao: string | null
          med_data_fim: string | null
          med_data_inicio: string | null
          med_observacao: string | null
          med_previsao_fim: string | null
          med_qtd: number
          med_responsavel: string | null
          med_status: string | null
          quantidade_total: number
          sequencial: number
          updated_at: string | null
          valor_total: number | null
          valor_unit: number | null
        }
        Insert: {
          created_at?: string | null
          empresa_id: string
          ent_data_atualizacao?: string | null
          ent_data_fim?: string | null
          ent_data_inicio?: string | null
          ent_observacao?: string | null
          ent_previsao_fim?: string | null
          ent_qtd?: number
          ent_responsavel?: string | null
          ent_status?: string | null
          evidencias?: Json | null
          fab_data_atualizacao?: string | null
          fab_data_fim?: string | null
          fab_data_inicio?: string | null
          fab_observacao?: string | null
          fab_previsao_fim?: string | null
          fab_qtd?: number
          fab_responsavel?: string | null
          fab_status?: string | null
          foto_url?: string | null
          id?: string
          inst_data_atualizacao?: string | null
          inst_data_fim?: string | null
          inst_data_inicio?: string | null
          inst_observacao?: string | null
          inst_previsao_fim?: string | null
          inst_qtd?: number
          inst_responsavel?: string | null
          inst_status?: string | null
          item_id: string
          localizacao?: string | null
          med_data_atualizacao?: string | null
          med_data_fim?: string | null
          med_data_inicio?: string | null
          med_observacao?: string | null
          med_previsao_fim?: string | null
          med_qtd?: number
          med_responsavel?: string | null
          med_status?: string | null
          quantidade_total: number
          sequencial: number
          updated_at?: string | null
          valor_total?: number | null
          valor_unit?: number | null
        }
        Update: {
          created_at?: string | null
          empresa_id?: string
          ent_data_atualizacao?: string | null
          ent_data_fim?: string | null
          ent_data_inicio?: string | null
          ent_observacao?: string | null
          ent_previsao_fim?: string | null
          ent_qtd?: number
          ent_responsavel?: string | null
          ent_status?: string | null
          evidencias?: Json | null
          fab_data_atualizacao?: string | null
          fab_data_fim?: string | null
          fab_data_inicio?: string | null
          fab_observacao?: string | null
          fab_previsao_fim?: string | null
          fab_qtd?: number
          fab_responsavel?: string | null
          fab_status?: string | null
          foto_url?: string | null
          id?: string
          inst_data_atualizacao?: string | null
          inst_data_fim?: string | null
          inst_data_inicio?: string | null
          inst_observacao?: string | null
          inst_previsao_fim?: string | null
          inst_qtd?: number
          inst_responsavel?: string | null
          inst_status?: string | null
          item_id?: string
          localizacao?: string | null
          med_data_atualizacao?: string | null
          med_data_fim?: string | null
          med_data_inicio?: string | null
          med_observacao?: string | null
          med_previsao_fim?: string | null
          med_qtd?: number
          med_responsavel?: string | null
          med_status?: string | null
          quantidade_total?: number
          sequencial?: number
          updated_at?: string | null
          valor_total?: number | null
          valor_unit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "execucao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execucao_item_fk"
            columns: ["item_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "itens"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "execucao_item_fk"
            columns: ["item_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "itens_com_status"
            referencedColumns: ["id", "empresa_id"]
          },
        ]
      }
      fd: {
        Row: {
          codigo: string | null
          created_at: string | null
          created_by: string | null
          data_lancamento: string
          data_pagamento: string | null
          data_vencimento: string | null
          diferenca_favor: number | null
          empresa_id: string
          especificacao: string | null
          evidencias: Json | null
          fornecedor: string
          id: string
          item_parcela: string | null
          justificativa: string | null
          obra_id: string
          observacao: string | null
          pedido_documento: string | null
          preco_unitario: number | null
          quantidade: number | null
          unidade: string | null
          updated_at: string | null
          valor: number
          valor_descontar: number
        }
        Insert: {
          codigo?: string | null
          created_at?: string | null
          created_by?: string | null
          data_lancamento?: string
          data_pagamento?: string | null
          data_vencimento?: string | null
          diferenca_favor?: number | null
          empresa_id: string
          especificacao?: string | null
          evidencias?: Json | null
          fornecedor: string
          id?: string
          item_parcela?: string | null
          justificativa?: string | null
          obra_id: string
          observacao?: string | null
          pedido_documento?: string | null
          preco_unitario?: number | null
          quantidade?: number | null
          unidade?: string | null
          updated_at?: string | null
          valor?: number
          valor_descontar?: number
        }
        Update: {
          codigo?: string | null
          created_at?: string | null
          created_by?: string | null
          data_lancamento?: string
          data_pagamento?: string | null
          data_vencimento?: string | null
          diferenca_favor?: number | null
          empresa_id?: string
          especificacao?: string | null
          evidencias?: Json | null
          fornecedor?: string
          id?: string
          item_parcela?: string | null
          justificativa?: string | null
          obra_id?: string
          observacao?: string | null
          pedido_documento?: string | null
          preco_unitario?: number | null
          quantidade?: number | null
          unidade?: string | null
          updated_at?: string | null
          valor?: number
          valor_descontar?: number
        }
        Relationships: [
          {
            foreignKeyName: "fd_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fd_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fd_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "fd_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_com_valores"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "fd_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_financeiro"
            referencedColumns: ["obra_id", "empresa_id"]
          },
          {
            foreignKeyName: "fd_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "receitas_obra"
            referencedColumns: ["obra_id", "empresa_id"]
          },
        ]
      }
      itens: {
        Row: {
          acabamento: string | null
          altura: number | null
          area_m2: number | null
          contrato_id: string | null
          created_at: string | null
          created_by: string | null
          descricao: string | null
          empresa_id: string
          foto_url: string | null
          id: string
          largura: number | null
          linha: string | null
          localizacao: string | null
          numero: number | null
          obra_id: string
          observacao: string | null
          proposta_id: string | null
          quantidade: number | null
          tipo: string | null
          unidade: string | null
          updated_at: string | null
          valor_total: number | null
          valor_unit: number | null
          vidros: string | null
        }
        Insert: {
          acabamento?: string | null
          altura?: number | null
          area_m2?: number | null
          contrato_id?: string | null
          created_at?: string | null
          created_by?: string | null
          descricao?: string | null
          empresa_id: string
          foto_url?: string | null
          id?: string
          largura?: number | null
          linha?: string | null
          localizacao?: string | null
          numero?: number | null
          obra_id: string
          observacao?: string | null
          proposta_id?: string | null
          quantidade?: number | null
          tipo?: string | null
          unidade?: string | null
          updated_at?: string | null
          valor_total?: number | null
          valor_unit?: number | null
          vidros?: string | null
        }
        Update: {
          acabamento?: string | null
          altura?: number | null
          area_m2?: number | null
          contrato_id?: string | null
          created_at?: string | null
          created_by?: string | null
          descricao?: string | null
          empresa_id?: string
          foto_url?: string | null
          id?: string
          largura?: number | null
          linha?: string | null
          localizacao?: string | null
          numero?: number | null
          obra_id?: string
          observacao?: string | null
          proposta_id?: string | null
          quantidade?: number | null
          tipo?: string | null
          unidade?: string | null
          updated_at?: string | null
          valor_total?: number | null
          valor_unit?: number | null
          vidros?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "itens_contrato_fk"
            columns: ["contrato_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "contratos"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
          {
            foreignKeyName: "itens_contrato_fk"
            columns: ["contrato_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "contratos_financeiro"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
          {
            foreignKeyName: "itens_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "itens_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_com_valores"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "itens_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_financeiro"
            referencedColumns: ["obra_id", "empresa_id"]
          },
          {
            foreignKeyName: "itens_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "receitas_obra"
            referencedColumns: ["obra_id", "empresa_id"]
          },
          {
            foreignKeyName: "itens_proposta_fk"
            columns: ["proposta_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "propostas"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
          {
            foreignKeyName: "itens_proposta_fk"
            columns: ["proposta_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "propostas_financeiro"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
        ]
      }
      notas_fiscais: {
        Row: {
          chave_nfe: string | null
          contrato_id: string | null
          created_at: string | null
          created_by: string | null
          data_cancelamento: string | null
          data_emissao: string
          data_vencimento: string | null
          empresa_id: string
          id: string
          motivo_cancelamento: string | null
          numero: string
          obra_id: string
          observacao: string | null
          pdf_url: string | null
          proposta_id: string | null
          serie: string | null
          status: string
          tipo: string
          updated_at: string | null
          valor_total: number
          xml_url: string | null
        }
        Insert: {
          chave_nfe?: string | null
          contrato_id?: string | null
          created_at?: string | null
          created_by?: string | null
          data_cancelamento?: string | null
          data_emissao?: string
          data_vencimento?: string | null
          empresa_id: string
          id?: string
          motivo_cancelamento?: string | null
          numero: string
          obra_id: string
          observacao?: string | null
          pdf_url?: string | null
          proposta_id?: string | null
          serie?: string | null
          status?: string
          tipo: string
          updated_at?: string | null
          valor_total: number
          xml_url?: string | null
        }
        Update: {
          chave_nfe?: string | null
          contrato_id?: string | null
          created_at?: string | null
          created_by?: string | null
          data_cancelamento?: string | null
          data_emissao?: string
          data_vencimento?: string | null
          empresa_id?: string
          id?: string
          motivo_cancelamento?: string | null
          numero?: string
          obra_id?: string
          observacao?: string | null
          pdf_url?: string | null
          proposta_id?: string | null
          serie?: string | null
          status?: string
          tipo?: string
          updated_at?: string | null
          valor_total?: number
          xml_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nf_contrato_fk"
            columns: ["contrato_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "contratos"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
          {
            foreignKeyName: "nf_contrato_fk"
            columns: ["contrato_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "contratos_financeiro"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
          {
            foreignKeyName: "nf_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "nf_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_com_valores"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "nf_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_financeiro"
            referencedColumns: ["obra_id", "empresa_id"]
          },
          {
            foreignKeyName: "nf_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "receitas_obra"
            referencedColumns: ["obra_id", "empresa_id"]
          },
          {
            foreignKeyName: "nf_proposta_fk"
            columns: ["proposta_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "propostas"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
          {
            foreignKeyName: "nf_proposta_fk"
            columns: ["proposta_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "propostas_financeiro"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
          {
            foreignKeyName: "notas_fiscais_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notas_fiscais_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      obras: {
        Row: {
          cep: string | null
          cidade: string | null
          cliente_id: string
          codigo_obra: string
          created_at: string | null
          created_by: string | null
          data_inicio: string | null
          data_prevista_fim: string | null
          data_real_fim: string | null
          empresa_id: string
          endereco: string | null
          id: string
          nome: string
          observacao: string | null
          prazo_execucao: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          cep?: string | null
          cidade?: string | null
          cliente_id: string
          codigo_obra: string
          created_at?: string | null
          created_by?: string | null
          data_inicio?: string | null
          data_prevista_fim?: string | null
          data_real_fim?: string | null
          empresa_id: string
          endereco?: string | null
          id?: string
          nome: string
          observacao?: string | null
          prazo_execucao?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          cep?: string | null
          cidade?: string | null
          cliente_id?: string
          codigo_obra?: string
          created_at?: string | null
          created_by?: string | null
          data_inicio?: string | null
          data_prevista_fim?: string | null
          data_real_fim?: string | null
          empresa_id?: string
          endereco?: string | null
          id?: string
          nome?: string
          observacao?: string | null
          prazo_execucao?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "obras_cliente_fk"
            columns: ["cliente_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "obras_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obras_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamentos: {
        Row: {
          anexos: Json | null
          cliente_id: string
          created_at: string | null
          created_by: string | null
          data_decisao: string | null
          data_envio: string | null
          data_solicitacao: string
          descricao: string | null
          detalhe_rejeicao: string | null
          empresa_id: string
          escopo_resumo: string | null
          historico: Json
          id: string
          motivo_rejeicao: string | null
          numero: string | null
          obra_id: string | null
          observacao: string | null
          prazo_estimado: string | null
          responsavel: string | null
          status: string
          updated_at: string | null
          valor_estimado: number | null
        }
        Insert: {
          anexos?: Json | null
          cliente_id: string
          created_at?: string | null
          created_by?: string | null
          data_decisao?: string | null
          data_envio?: string | null
          data_solicitacao?: string
          descricao?: string | null
          detalhe_rejeicao?: string | null
          empresa_id: string
          escopo_resumo?: string | null
          historico?: Json
          id?: string
          motivo_rejeicao?: string | null
          numero?: string | null
          obra_id?: string | null
          observacao?: string | null
          prazo_estimado?: string | null
          responsavel?: string | null
          status?: string
          updated_at?: string | null
          valor_estimado?: number | null
        }
        Update: {
          anexos?: Json | null
          cliente_id?: string
          created_at?: string | null
          created_by?: string | null
          data_decisao?: string | null
          data_envio?: string | null
          data_solicitacao?: string
          descricao?: string | null
          detalhe_rejeicao?: string | null
          empresa_id?: string
          escopo_resumo?: string | null
          historico?: Json
          id?: string
          motivo_rejeicao?: string | null
          numero?: string | null
          obra_id?: string | null
          observacao?: string | null
          prazo_estimado?: string | null
          responsavel?: string | null
          status?: string
          updated_at?: string | null
          valor_estimado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orcamentos_cliente_fk"
            columns: ["cliente_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "orcamentos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "orcamentos_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_com_valores"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "orcamentos_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_financeiro"
            referencedColumns: ["obra_id", "empresa_id"]
          },
          {
            foreignKeyName: "orcamentos_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "receitas_obra"
            referencedColumns: ["obra_id", "empresa_id"]
          },
        ]
      }
      pagamentos: {
        Row: {
          anexo: string | null
          created_at: string | null
          created_by: string | null
          data_pagamento: string
          empresa_id: string
          forma: string | null
          id: string
          nota_id: string | null
          obra_id: string
          observacao: string | null
          origem: string
          parcela_acordo_id: string | null
          updated_at: string | null
          valor: number
        }
        Insert: {
          anexo?: string | null
          created_at?: string | null
          created_by?: string | null
          data_pagamento?: string
          empresa_id: string
          forma?: string | null
          id?: string
          nota_id?: string | null
          obra_id: string
          observacao?: string | null
          origem?: string
          parcela_acordo_id?: string | null
          updated_at?: string | null
          valor: number
        }
        Update: {
          anexo?: string | null
          created_at?: string | null
          created_by?: string | null
          data_pagamento?: string
          empresa_id?: string
          forma?: string | null
          id?: string
          nota_id?: string | null
          obra_id?: string
          observacao?: string | null
          origem?: string
          parcela_acordo_id?: string | null
          updated_at?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "pagamentos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_nota_fk"
            columns: ["nota_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "notas_fiscais"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
          {
            foreignKeyName: "pagamentos_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "pagamentos_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_com_valores"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "pagamentos_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_financeiro"
            referencedColumns: ["obra_id", "empresa_id"]
          },
          {
            foreignKeyName: "pagamentos_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "receitas_obra"
            referencedColumns: ["obra_id", "empresa_id"]
          },
          {
            foreignKeyName: "pagamentos_parcela_fk"
            columns: ["parcela_acordo_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "acordo_parcelas"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
        ]
      }
      profiles: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          email: string
          empresa_id: string
          id: string
          nome: string
          perfil: string
          telefone: string | null
          updated_at: string | null
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          email: string
          empresa_id: string
          id: string
          nome: string
          perfil: string
          telefone?: string | null
          updated_at?: string | null
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          email?: string
          empresa_id?: string
          id?: string
          nome?: string
          perfil?: string
          telefone?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      propostas: {
        Row: {
          anexos: Json | null
          condicoes_pagamento: string | null
          created_at: string | null
          created_by: string | null
          data_decisao: string | null
          data_emissao: string | null
          data_envio: string | null
          data_validade: string | null
          desconto: number
          descricao: string | null
          detalhe_rejeicao: string | null
          empresa_id: string
          historico: Json
          id: string
          motivo_rejeicao: string | null
          numero: string
          obra_id: string
          observacao: string | null
          pct_entrega_material: number | null
          pct_fd: number | null
          pct_medicao_instalacao: number | null
          pct_sinal: number | null
          status: string
          updated_at: string | null
          valor_final: number | null
          valor_total: number
        }
        Insert: {
          anexos?: Json | null
          condicoes_pagamento?: string | null
          created_at?: string | null
          created_by?: string | null
          data_decisao?: string | null
          data_emissao?: string | null
          data_envio?: string | null
          data_validade?: string | null
          desconto?: number
          descricao?: string | null
          detalhe_rejeicao?: string | null
          empresa_id: string
          historico?: Json
          id?: string
          motivo_rejeicao?: string | null
          numero: string
          obra_id: string
          observacao?: string | null
          pct_entrega_material?: number | null
          pct_fd?: number | null
          pct_medicao_instalacao?: number | null
          pct_sinal?: number | null
          status?: string
          updated_at?: string | null
          valor_final?: number | null
          valor_total?: number
        }
        Update: {
          anexos?: Json | null
          condicoes_pagamento?: string | null
          created_at?: string | null
          created_by?: string | null
          data_decisao?: string | null
          data_emissao?: string | null
          data_envio?: string | null
          data_validade?: string | null
          desconto?: number
          descricao?: string | null
          detalhe_rejeicao?: string | null
          empresa_id?: string
          historico?: Json
          id?: string
          motivo_rejeicao?: string | null
          numero?: string
          obra_id?: string
          observacao?: string | null
          pct_entrega_material?: number | null
          pct_fd?: number | null
          pct_medicao_instalacao?: number | null
          pct_sinal?: number | null
          status?: string
          updated_at?: string | null
          valor_final?: number | null
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "propostas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "propostas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "propostas_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "propostas_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_com_valores"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "propostas_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_financeiro"
            referencedColumns: ["obra_id", "empresa_id"]
          },
          {
            foreignKeyName: "propostas_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "receitas_obra"
            referencedColumns: ["obra_id", "empresa_id"]
          },
        ]
      }
    }
    Views: {
      contratos_financeiro: {
        Row: {
          anexos: Json | null
          condicoes_pagamento: string | null
          created_at: string | null
          created_by: string | null
          data_assinatura: string | null
          desconto: number | null
          descricao: string | null
          detalhe_rescisao: string | null
          empresa_id: string | null
          historico: Json | null
          id: string | null
          motivo_rescisao: string | null
          numero: string | null
          obra_id: string | null
          observacao: string | null
          pct_entrega_material: number | null
          pct_fd: number | null
          pct_medicao_instalacao: number | null
          pct_sinal: number | null
          prazo_execucao: string | null
          proposta_origem_id: string | null
          recebido_acordos: number | null
          recebido_nfs: number | null
          saldo_a_faturar: number | null
          status: string | null
          total_acordos: number | null
          total_nfs: number | null
          updated_at: string | null
          valor_final: number | null
          valor_total: number | null
        }
        Insert: {
          anexos?: Json | null
          condicoes_pagamento?: string | null
          created_at?: string | null
          created_by?: string | null
          data_assinatura?: string | null
          desconto?: number | null
          descricao?: string | null
          detalhe_rescisao?: string | null
          empresa_id?: string | null
          historico?: Json | null
          id?: string | null
          motivo_rescisao?: string | null
          numero?: string | null
          obra_id?: string | null
          observacao?: string | null
          pct_entrega_material?: number | null
          pct_fd?: number | null
          pct_medicao_instalacao?: number | null
          pct_sinal?: number | null
          prazo_execucao?: string | null
          proposta_origem_id?: string | null
          recebido_acordos?: never
          recebido_nfs?: never
          saldo_a_faturar?: never
          status?: string | null
          total_acordos?: never
          total_nfs?: never
          updated_at?: string | null
          valor_final?: number | null
          valor_total?: number | null
        }
        Update: {
          anexos?: Json | null
          condicoes_pagamento?: string | null
          created_at?: string | null
          created_by?: string | null
          data_assinatura?: string | null
          desconto?: number | null
          descricao?: string | null
          detalhe_rescisao?: string | null
          empresa_id?: string | null
          historico?: Json | null
          id?: string | null
          motivo_rescisao?: string | null
          numero?: string | null
          obra_id?: string | null
          observacao?: string | null
          pct_entrega_material?: number | null
          pct_fd?: number | null
          pct_medicao_instalacao?: number | null
          pct_sinal?: number | null
          prazo_execucao?: string | null
          proposta_origem_id?: string | null
          recebido_acordos?: never
          recebido_nfs?: never
          saldo_a_faturar?: never
          status?: string | null
          total_acordos?: never
          total_nfs?: never
          updated_at?: string | null
          valor_final?: number | null
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contratos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "contratos_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_com_valores"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "contratos_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_financeiro"
            referencedColumns: ["obra_id", "empresa_id"]
          },
          {
            foreignKeyName: "contratos_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "receitas_obra"
            referencedColumns: ["obra_id", "empresa_id"]
          },
          {
            foreignKeyName: "contratos_proposta_fk"
            columns: ["proposta_origem_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "propostas"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
          {
            foreignKeyName: "contratos_proposta_fk"
            columns: ["proposta_origem_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "propostas_financeiro"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
        ]
      }
      itens_com_status: {
        Row: {
          acabamento: string | null
          altura: number | null
          area_m2: number | null
          contrato_id: string | null
          created_at: string | null
          created_by: string | null
          data_entrega_concluida: string | null
          data_fabricacao_concluida: string | null
          data_instalacao_concluida: string | null
          data_medicao_concluida: string | null
          data_ultima_entrega: string | null
          data_ultima_fabricacao: string | null
          data_ultima_instalacao: string | null
          data_ultima_medicao: string | null
          descricao: string | null
          empresa_id: string | null
          etapa_atual: string | null
          evidencias_count: number | null
          foto_url: string | null
          id: string | null
          largura: number | null
          linha: string | null
          localizacao: string | null
          numero: number | null
          obra_id: string | null
          observacao: string | null
          progresso_etapas_pct: number | null
          progresso_pct: number | null
          proposta_id: string | null
          qtd_entregue: number | null
          qtd_fabricada: number | null
          qtd_instalada: number | null
          qtd_medida: number | null
          quantidade: number | null
          responsavel_entrega: string | null
          responsavel_fabricacao: string | null
          responsavel_instalacao: string | null
          responsavel_medicao: string | null
          status_atual: string | null
          status_entrega: string | null
          status_fabricacao: string | null
          status_instalacao: string | null
          status_medicao: string | null
          tipo: string | null
          unidade: string | null
          updated_at: string | null
          valor_total: number | null
          valor_unit: number | null
          vidros: string | null
        }
        Relationships: [
          {
            foreignKeyName: "itens_contrato_fk"
            columns: ["contrato_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "contratos"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
          {
            foreignKeyName: "itens_contrato_fk"
            columns: ["contrato_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "contratos_financeiro"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
          {
            foreignKeyName: "itens_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "itens_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_com_valores"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "itens_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_financeiro"
            referencedColumns: ["obra_id", "empresa_id"]
          },
          {
            foreignKeyName: "itens_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "receitas_obra"
            referencedColumns: ["obra_id", "empresa_id"]
          },
          {
            foreignKeyName: "itens_proposta_fk"
            columns: ["proposta_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "propostas"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
          {
            foreignKeyName: "itens_proposta_fk"
            columns: ["proposta_id", "empresa_id", "obra_id"]
            isOneToOne: false
            referencedRelation: "propostas_financeiro"
            referencedColumns: ["id", "empresa_id", "obra_id"]
          },
        ]
      }
      obras_com_valores: {
        Row: {
          cep: string | null
          cidade: string | null
          cliente_id: string | null
          codigo_obra: string | null
          condicoes_pagamento_calculado: string | null
          created_at: string | null
          created_by: string | null
          data_inicio: string | null
          data_prevista_fim: string | null
          data_real_fim: string | null
          desconto_calculado: number | null
          empresa_id: string | null
          endereco: string | null
          fonte_valores: string | null
          id: string | null
          nome: string | null
          observacao: string | null
          pct_entrega_material_calculado: number | null
          pct_fd_calculado: number | null
          pct_medicao_instalacao_calculado: number | null
          pct_sinal_calculado: number | null
          prazo_execucao: string | null
          progresso_itens_pct: number | null
          status: string | null
          updated_at: string | null
          valor_final_calculado: number | null
          valor_total_calculado: number | null
        }
        Relationships: [
          {
            foreignKeyName: "obras_cliente_fk"
            columns: ["cliente_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "obras_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obras_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      obras_financeiro: {
        Row: {
          codigo_obra: string | null
          empresa_id: string | null
          nome: string | null
          obra_id: string | null
          qtd_acordos: number | null
          qtd_fd: number | null
          qtd_nfs: number | null
          qtd_pagamentos: number | null
          total_acordos: number | null
          total_acordos_recebido: number | null
          total_faturado: number | null
          total_fd_aceito: number | null
          total_fd_bruto: number | null
          total_fd_diferenca_favor: number | null
          total_recebido_pagamentos: number | null
        }
        Insert: {
          codigo_obra?: string | null
          empresa_id?: string | null
          nome?: string | null
          obra_id?: string | null
          qtd_acordos?: never
          qtd_fd?: never
          qtd_nfs?: never
          qtd_pagamentos?: never
          total_acordos?: never
          total_acordos_recebido?: never
          total_faturado?: never
          total_fd_aceito?: never
          total_fd_bruto?: never
          total_fd_diferenca_favor?: never
          total_recebido_pagamentos?: never
        }
        Update: {
          codigo_obra?: string | null
          empresa_id?: string | null
          nome?: string | null
          obra_id?: string | null
          qtd_acordos?: never
          qtd_fd?: never
          qtd_nfs?: never
          qtd_pagamentos?: never
          total_acordos?: never
          total_acordos_recebido?: never
          total_faturado?: never
          total_fd_aceito?: never
          total_fd_bruto?: never
          total_fd_diferenca_favor?: never
          total_recebido_pagamentos?: never
        }
        Relationships: [
          {
            foreignKeyName: "obras_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      propostas_financeiro: {
        Row: {
          anexos: Json | null
          condicoes_pagamento: string | null
          created_at: string | null
          created_by: string | null
          data_decisao: string | null
          data_emissao: string | null
          data_envio: string | null
          data_validade: string | null
          desconto: number | null
          descricao: string | null
          detalhe_rejeicao: string | null
          empresa_id: string | null
          id: string | null
          motivo_rejeicao: string | null
          numero: string | null
          obra_id: string | null
          observacao: string | null
          pct_entrega_material: number | null
          pct_fd: number | null
          pct_medicao_instalacao: number | null
          pct_sinal: number | null
          recebido_acordos: number | null
          recebido_nfs: number | null
          status: string | null
          total_acordos: number | null
          total_nfs: number | null
          updated_at: string | null
          valor_final: number | null
          valor_total: number | null
        }
        Insert: {
          anexos?: Json | null
          condicoes_pagamento?: string | null
          created_at?: string | null
          created_by?: string | null
          data_decisao?: string | null
          data_emissao?: string | null
          data_envio?: string | null
          data_validade?: string | null
          desconto?: number | null
          descricao?: string | null
          detalhe_rejeicao?: string | null
          empresa_id?: string | null
          id?: string | null
          motivo_rejeicao?: string | null
          numero?: string | null
          obra_id?: string | null
          observacao?: string | null
          pct_entrega_material?: number | null
          pct_fd?: number | null
          pct_medicao_instalacao?: number | null
          pct_sinal?: number | null
          recebido_acordos?: never
          recebido_nfs?: never
          status?: string | null
          total_acordos?: never
          total_nfs?: never
          updated_at?: string | null
          valor_final?: number | null
          valor_total?: number | null
        }
        Update: {
          anexos?: Json | null
          condicoes_pagamento?: string | null
          created_at?: string | null
          created_by?: string | null
          data_decisao?: string | null
          data_emissao?: string | null
          data_envio?: string | null
          data_validade?: string | null
          desconto?: number | null
          descricao?: string | null
          detalhe_rejeicao?: string | null
          empresa_id?: string | null
          id?: string | null
          motivo_rejeicao?: string | null
          numero?: string | null
          obra_id?: string | null
          observacao?: string | null
          pct_entrega_material?: number | null
          pct_fd?: number | null
          pct_medicao_instalacao?: number | null
          pct_sinal?: number | null
          recebido_acordos?: never
          recebido_nfs?: never
          status?: string | null
          total_acordos?: never
          total_nfs?: never
          updated_at?: string | null
          valor_final?: number | null
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "propostas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "propostas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "propostas_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "propostas_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_com_valores"
            referencedColumns: ["id", "empresa_id"]
          },
          {
            foreignKeyName: "propostas_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "obras_financeiro"
            referencedColumns: ["obra_id", "empresa_id"]
          },
          {
            foreignKeyName: "propostas_obra_fk"
            columns: ["obra_id", "empresa_id"]
            isOneToOne: false
            referencedRelation: "receitas_obra"
            referencedColumns: ["obra_id", "empresa_id"]
          },
        ]
      }
      receitas_obra: {
        Row: {
          codigo_obra: string | null
          empresa_id: string | null
          obra_id: string | null
          obra_nome: string | null
          saldo_pendente: number | null
          total_a_receber: number | null
          total_acordos: number | null
          total_acordos_convertidos_arquivado: number | null
          total_acordos_recebido: number | null
          total_avulso_recebido: number | null
          total_nfs_emitidas: number | null
          total_nfs_recebido: number | null
          total_recebido: number | null
        }
        Insert: {
          codigo_obra?: string | null
          empresa_id?: string | null
          obra_id?: string | null
          obra_nome?: string | null
          saldo_pendente?: never
          total_a_receber?: never
          total_acordos?: never
          total_acordos_convertidos_arquivado?: never
          total_acordos_recebido?: never
          total_avulso_recebido?: never
          total_nfs_emitidas?: never
          total_nfs_recebido?: never
          total_recebido?: never
        }
        Update: {
          codigo_obra?: string | null
          empresa_id?: string | null
          obra_id?: string | null
          obra_nome?: string | null
          saldo_pendente?: never
          total_a_receber?: never
          total_acordos?: never
          total_acordos_convertidos_arquivado?: never
          total_acordos_recebido?: never
          total_avulso_recebido?: never
          total_nfs_emitidas?: never
          total_nfs_recebido?: never
          total_recebido?: never
        }
        Relationships: [
          {
            foreignKeyName: "obras_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      ajustar_valor_itens: {
        Args: { p_itens: string[]; p_percentual: number; p_proposta: string }
        Returns: number
      }
      ajustar_valor_itens_contrato: {
        Args: { p_contrato: string; p_itens: string[]; p_percentual: number }
        Returns: number
      }
      atualizar_parcelas_atrasadas: { Args: never; Returns: number }
      atualizar_status_nf_by_id: {
        Args: { p_nota_id: string }
        Returns: undefined
      }
      atualizar_status_parcela_by_id: {
        Args: { p_parcela_id: string }
        Returns: undefined
      }
      auditoria_origem: { Args: never; Returns: string }
      calcular_valores_obra: {
        Args: { p_obra_id: string }
        Returns: {
          condicoes_pagamento: string
          desconto: number
          fonte: string
          pct_entrega_material: number
          pct_fd: number
          pct_medicao_instalacao: number
          pct_sinal: number
          valor_final: number
          valor_total: number
        }[]
      }
      current_empresa_id: { Args: never; Returns: string }
      current_perfil: { Args: never; Returns: string }
      gerar_contrato_de_proposta: {
        Args: {
          p_confirmar_duplicado?: boolean
          p_contrato: Json
          p_copiar_itens?: boolean
          p_proposta: string
        }
        Returns: string
      }
      has_perfil: { Args: { perfis: string[] }; Returns: boolean }
      registrar_evento: {
        Args: {
          p_acao: string
          p_autor_descricao?: string
          p_detalhe?: Json
          p_empresa_id?: string
          p_entidade: string
          p_mensagem?: string
          p_referencia?: string
          p_registro_id?: string
          p_resultado: string
        }
        Returns: number
      }
      storage_empresa_id_from_path: { Args: { path: string }; Returns: string }
      trocar_numero_itens: {
        Args: { p_item_a: string; p_item_b: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
