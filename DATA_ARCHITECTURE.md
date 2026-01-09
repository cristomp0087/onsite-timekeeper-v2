# 📊 Data Architecture - OnSite Timekeeper V2

> Documentação da arquitetura de dados do OnSite Timekeeper.
> Última atualização: Janeiro 2025

---

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [5 Esferas de Dados](#5-esferas-de-dados)
3. [Schema Local (SQLite)](#schema-local-sqlite)
4. [Schema Cloud (Supabase)](#schema-cloud-supabase)
5. [Sistema de Sincronização](#sistema-de-sincronização)
6. [Arquivos do Projeto](#arquivos-do-projeto)
7. [Perguntas que os Dados Respondem](#perguntas-que-os-dados-respondem)

---

## Visão Geral

O OnSite Timekeeper V2 utiliza uma arquitetura **offline-first** com sincronização para a nuvem:

```
┌─────────────────┐         ┌─────────────────┐
│   SQLite Local  │ ──sync──▶│    Supabase     │
│   (expo-sqlite) │ ◀──sync──│    (Postgres)   │
└─────────────────┘         └─────────────────┘
        │                           │
        ▼                           ▼
   App funciona              Dashboard admin
   100% offline              Analytics globais
```

### Princípios

- **Offline-first**: App funciona sem internet
- **Privacy-first**: Dados mínimos necessários
- **Event-driven**: GPS só em entry/exit (não contínuo)
- **Agregado por dia**: Métricas consolidadas, não raw events

---

## 5 Esferas de Dados

```
┌─────────────────────────────────────────────────────────────────────┐
│                         5 ESFERAS DE DADOS                          │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────────┤
│  IDENTITY   │  BUSINESS   │   PRODUCT   │    DEBUG    │  METADATA   │
│  (Quem)     │  (Valor)    │   (UX)      │   (Bugs)    │  (Context)  │
├─────────────┼─────────────┼─────────────┼─────────────┼─────────────┤
│ user_id     │ locations   │ app_opens   │ error_type  │ app_version │
│ device_id   │ records     │ features_   │ error_msg   │ os          │
│ plan_type   │ sessions_   │ used        │ sync_fails  │ os_version  │
│ created_at  │ count       │ notif_rate  │ geofence_   │ device_model│
│             │ total_min   │             │ accuracy    │             │
└─────────────┴─────────────┴─────────────┴─────────────┴─────────────┘
```

### 1️⃣ IDENTITY (Quem é o usuário)

**Propósito**: Segmentação, cohort analysis, churn prediction

| Campo | Fonte | Por quê |
|-------|-------|---------|
| `user_id` | Supabase Auth | Identificação única |
| `device_id` | App | Multi-device tracking |
| `plan_type` | Supabase (futuro) | free/pro/enterprise |
| `created_at` | Supabase Auth | Cohort analysis |

### 2️⃣ BUSINESS (Valor gerado)

**Propósito**: KPIs, revenue decisions, feature value

| Campo | Tabela | Por quê |
|-------|--------|---------|
| `locations` | locations | Core data |
| `records` | records | Core data |
| `sessions_count` | analytics_daily | Uso real |
| `total_minutes` | analytics_daily | Valor entregue |
| `manual_entries` | analytics_daily | Confiança no geofence |
| `auto_entries` | analytics_daily | Automação funcionando |

### 3️⃣ PRODUCT (Melhorar UX)

**Propósito**: Decisões de produto, priorização de features

| Campo | Tabela | Por quê |
|-------|--------|---------|
| `app_opens` | analytics_daily | Engajamento |
| `features_used` | analytics_daily | Quais features usam |
| `notifications_shown` | analytics_daily | Push engagement |
| `notifications_actioned` | analytics_daily | Push effectiveness |

### 4️⃣ DEBUG (Controle de bugs)

**Propósito**: Estabilidade, fix rápido, prevenção

| Campo | Tabela | Por quê |
|-------|--------|---------|
| `error_type` | error_log | Categorização |
| `error_message` | error_log | Diagnóstico |
| `error_stack` | error_log | Where exactly |
| `sync_failures` | analytics_daily | Health check |
| `geofence_accuracy` | analytics_daily | Hardware issues |

### 5️⃣ METADATA (Contexto técnico)

**Propósito**: Reproduzir bugs, decisões de suporte

| Campo | Tabela | Por quê |
|-------|--------|---------|
| `app_version` | analytics_daily, error_log | Qual versão |
| `os` | analytics_daily, error_log | iOS/Android |
| `os_version` | error_log | Compatibilidade |
| `device_model` | analytics_daily, error_log | Hardware issues |

---

## Schema Local (SQLite)

### Tabelas Ativas

```sql
-- Core: Geofences do usuário
CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  radius INTEGER DEFAULT 100,
  color TEXT DEFAULT '#3B82F6',
  status TEXT DEFAULT 'active',  -- active|deleted|pending_delete
  deleted_at TEXT,
  last_seen_at TEXT,
  created_at TEXT,
  updated_at TEXT,
  synced_at TEXT
);

-- Core: Sessões de trabalho
CREATE TABLE records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  location_name TEXT,
  entry_at TEXT NOT NULL,
  exit_at TEXT,
  type TEXT DEFAULT 'automatic',  -- automatic|manual
  manually_edited INTEGER DEFAULT 0,
  edit_reason TEXT,
  integrity_hash TEXT,
  color TEXT,
  device_id TEXT,
  pause_minutes INTEGER DEFAULT 0,
  created_at TEXT,
  synced_at TEXT
);

-- Analytics: Métricas agregadas por dia
CREATE TABLE analytics_daily (
  date TEXT NOT NULL,
  user_id TEXT NOT NULL,
  
  -- Business
  sessions_count INTEGER DEFAULT 0,
  total_minutes INTEGER DEFAULT 0,
  manual_entries INTEGER DEFAULT 0,
  auto_entries INTEGER DEFAULT 0,
  locations_created INTEGER DEFAULT 0,
  locations_deleted INTEGER DEFAULT 0,
  
  -- Product
  app_opens INTEGER DEFAULT 0,
  app_foreground_seconds INTEGER DEFAULT 0,
  notifications_shown INTEGER DEFAULT 0,
  notifications_actioned INTEGER DEFAULT 0,
  features_used TEXT DEFAULT '[]',  -- JSON array
  
  -- Debug
  errors_count INTEGER DEFAULT 0,
  sync_attempts INTEGER DEFAULT 0,
  sync_failures INTEGER DEFAULT 0,
  geofence_triggers INTEGER DEFAULT 0,
  geofence_accuracy_sum REAL DEFAULT 0,
  geofence_accuracy_count INTEGER DEFAULT 0,
  
  -- Metadata
  app_version TEXT,
  os TEXT,
  device_model TEXT,
  
  created_at TEXT,
  synced_at TEXT,
  
  PRIMARY KEY (date, user_id)
);

-- Debug: Erros estruturados
CREATE TABLE error_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  error_context TEXT,  -- JSON
  app_version TEXT,
  os TEXT,
  os_version TEXT,
  device_model TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT,
  synced_at TEXT
);

-- Audit: GPS proof apenas em entry/exit
CREATE TABLE location_audit (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT,
  event_type TEXT NOT NULL,  -- entry|exit|dispute|correction
  location_id TEXT,
  location_name TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy REAL,
  occurred_at TEXT NOT NULL,
  created_at TEXT,
  synced_at TEXT
);
```

### Tabelas Removidas (V1 → V2)

| Tabela | Motivo da Remoção |
|--------|-------------------|
| `heartbeat_log` | Battery drain, substituído por location_audit |
| `geopoints` | Over-collection, substituído por location_audit |
| `sync_log` | Overengineered, removido |
| `telemetry_daily` | Renomeado para analytics_daily |

---

## Schema Cloud (Supabase)

### Tabelas

| Tabela | Sync Direction | Propósito |
|--------|----------------|-----------|
| `locations` | ↑↓ bidirectional | Multi-device sync |
| `records` | ↑↓ bidirectional | Multi-device sync |
| `analytics_daily` | ↑ upload only | Dashboard/Analytics |
| `error_log` | ↑ upload only | Debug/Monitoring |
| `location_audit` | ↑ upload only | Compliance/Disputes |

### Row Level Security (RLS)

Todas as tabelas têm RLS habilitado:

```sql
-- Exemplo: users só veem seus próprios dados
CREATE POLICY "Users see own data" ON locations
  FOR ALL USING (auth.uid() = user_id);
```

---

## Sistema de Sincronização

### Estratégia

```
┌─────────────────────────────────────────────────────────────┐
│                    SYNC STRATEGY                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  QUANDO SINCRONIZA:                                         │
│  • App init (se online)                                     │
│  • Meia-noite (daily cleanup)                               │
│  • Após criar location                                      │
│  • Após finalizar sessão                                    │
│  • Manual (botão sync)                                      │
│                                                             │
│  O QUE NÃO FAZ MAIS:                                        │
│  • Sync a cada 5 minutos (battery drain)                    │
│  • Heartbeat contínuo                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Fluxo de Sync

```
syncNow()
  │
  ├─▶ 1. Upload locations (pending)
  ├─▶ 2. Upload records (pending)
  ├─▶ 3. Upload analytics_daily (pending)
  ├─▶ 4. Upload error_log (pending)
  ├─▶ 5. Upload location_audit (pending)
  │
  ├─▶ 6. Download locations (from server)
  ├─▶ 7. Download records (from server)
  │
  └─▶ 8. Cleanup old data (synced + old)
```

### Cleanup Policy

| Tabela | Retention | Condição |
|--------|-----------|----------|
| `analytics_daily` | 30 dias | Após sync |
| `error_log` | 14 dias | Após sync |
| `location_audit` | 90 dias | Após sync |

---

## Arquivos do Projeto

### Database Layer

```
src/lib/database/
├── core.ts          # SQLite instance, types, helpers
├── index.ts         # Re-exports (API pública)
├── locations.ts     # CRUD locations + sync
├── records.ts       # CRUD records + sync
├── analytics.ts     # Métricas agregadas
├── errors.ts        # Error tracking
├── audit.ts         # Location audit trail
└── debug.ts         # Stats e reset
```

### Stores (Zustand)

```
src/stores/
├── authStore.ts      # Auth state + Supabase session
├── locationStore.ts  # Locations + geofencing state
├── recordStore.ts    # Records + active session
├── syncStore.ts      # Sync orchestration
├── workSessionStore.ts # UI state for sessions
└── settingsStore.ts  # User preferences
```

### Background Tasks

```
src/lib/
├── backgroundTasks.ts  # Geofence + heartbeat tasks
├── location.ts         # Location permissions + tracking
├── logger.ts           # Structured logging
└── supabase.ts         # Supabase client + types
```

### Principais Funções por Arquivo

#### `core.ts`
- `initDatabase()` - Inicializa SQLite
- `generateUUID()` - Gera IDs
- `calculateDistance()` - Haversine formula
- `calculateDuration()` - Duração em minutos

#### `analytics.ts`
- `trackMetric(userId, field, increment)` - Incrementa métrica
- `trackGeofenceTrigger(userId, accuracy)` - Track com accuracy
- `trackFeatureUsed(userId, feature)` - Track feature usage
- `trackSessionMinutes(userId, minutes, isManual)` - Track sessão
- `getAnalyticsSummary(userId, start, end)` - Relatório agregado

#### `errors.ts`
- `captureError(error, type, context)` - Log erro estruturado
- `captureErrorAuto(error, context)` - Auto-detect type
- `captureSyncError()`, `captureGeofenceError()` - Shortcuts

#### `audit.ts`
- `recordEntryAudit(...)` - GPS ao entrar
- `recordExitAudit(...)` - GPS ao sair
- `getSessionProof(sessionId)` - Prova para disputes

#### `syncStore.ts`
- `syncNow()` - Sync completo
- `syncLocationsOnly()` - Sync apenas locations
- `runCleanup()` - Limpa dados antigos

---

## Perguntas que os Dados Respondem

### 📈 Business

| Pergunta | Query |
|----------|-------|
| Quantas horas os usuários trackam por semana? | `SUM(total_minutes) / 60 FROM analytics_daily` |
| Qual % usa manual vs automático? | `SUM(manual_entries) / SUM(auto_entries)` |
| Quantos locations o usuário médio tem? | `AVG(COUNT(*)) FROM locations GROUP BY user_id` |
| Qual o tempo médio de sessão? | `AVG(total_minutes / sessions_count)` |

### 🎨 Product

| Pergunta | Query |
|----------|-------|
| Qual feature é mais usada? | `jsonb_array_elements(features_used)` |
| As notificações estão sendo ignoradas? | `notifications_actioned / notifications_shown` |
| Quantas vezes o app é aberto por dia? | `AVG(app_opens)` |

### 🐛 Debug

| Pergunta | Query |
|----------|-------|
| Qual versão tem mais erros? | `GROUP BY app_version ORDER BY COUNT(*)` |
| Sync está falhando em qual device? | `GROUP BY device_model WHERE sync_failures > 0` |
| Geofence accuracy está ruim em qual modelo? | `AVG(geofence_accuracy_avg) GROUP BY device_model` |

### 👥 Cohort

| Pergunta | Query |
|----------|-------|
| Usuários do mês X ainda estão ativos? | Join auth.users + analytics_daily |
| Quanto tempo até o primeiro session? | `MIN(entry_at) - user.created_at` |
| Retention por semana? | Cohort analysis em analytics_daily |

---

## Migrations

### V1 → V2 (Janeiro 2025)

**Removido:**
- `heartbeat_log` - Battery drain
- `geopoints` - Over-collection
- `sync_log` - Overengineered
- Nomes em português (locais, registros)

**Adicionado:**
- `analytics_daily` - Métricas unificadas
- `error_log` - Erros estruturados
- `location_audit` - GPS apenas em entry/exit

**Renomeado:**
- `locais` → `locations`
- `registros` → `records`

---

## Contato

- **Projeto**: OnSite Club
- **App**: OnSite Timekeeper
- **Stack**: React Native + Expo + SQLite + Supabase

---

*Documentação gerada em Janeiro 2025*
