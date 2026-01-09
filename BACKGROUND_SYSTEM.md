# 🔄 Background System - OnSite Timekeeper

> Documentação do sistema de monitoramento em background.
> Este sistema permite que o app detecte entrada/saída de geofences mesmo com a tela desligada.

---

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Arquitetura do Sistema](#arquitetura-do-sistema)
3. [Os 3 Pilares do Background](#os-3-pilares-do-background)
4. [Fluxo de Funcionamento](#fluxo-de-funcionamento)
5. [Heartbeat System](#heartbeat-system)
6. [Arquivos Envolvidos](#arquivos-envolvidos)
7. [Configurações Necessárias](#configurações-necessárias)
8. [Troubleshooting](#troubleshooting)

---

## Visão Geral

O OnSite Timekeeper é um app de **automação** - ele deve registrar entrada e saída do trabalho **automaticamente**, sem interação do usuário, mesmo quando:

- ✅ App está em background
- ✅ Tela está desligada
- ✅ App foi "morto" pelo sistema
- ✅ Celular foi reiniciado

```
┌─────────────────────────────────────────────────────────────────┐
│                         CENÁRIO DE USO                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  07:55 - Usuário sai de casa com app fechado                   │
│  08:00 - Chega no trabalho (entra na geofence)                 │
│          → App detecta ENTRY automaticamente ✅                 │
│          → Cria sessão de trabalho                              │
│          → Envia notificação "Entrada registrada"               │
│                                                                 │
│  12:00 - Usuário almoça (continua na geofence)                 │
│          → Heartbeat verifica: ainda dentro ✅                  │
│                                                                 │
│  17:30 - Sai do trabalho (sai da geofence)                     │
│          → App detecta EXIT automaticamente ✅                  │
│          → Finaliza sessão                                      │
│          → Envia notificação "Saída registrada: 9h30min"        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Arquitetura do Sistema

```
┌─────────────────────────────────────────────────────────────────┐
│                    ARQUITETURA BACKGROUND                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐   │
│  │   GEOFENCE    │    │   LOCATION    │    │   HEARTBEAT   │   │
│  │     TASK      │    │     TASK      │    │     TASK      │   │
│  │  (entry/exit) │    │  (position)   │    │  (verify)     │   │
│  └───────┬───────┘    └───────┬───────┘    └───────┬───────┘   │
│          │                    │                    │            │
│          ▼                    ▼                    ▼            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    TaskManager                           │   │
│  │                  (expo-task-manager)                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Operating System                       │   │
│  │              (Android / iOS native APIs)                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Por que 3 sistemas?

| Sistema | Função | Limitação |
|---------|--------|-----------|
| **Geofence** | Detecção primária | Pode ter delay de 1-3 min |
| **Location** | Updates de posição | Consome mais bateria |
| **Heartbeat** | Safety net | Executa apenas a cada ~15 min |

Juntos, eles garantem **confiabilidade** mesmo em cenários adversos.

---

## Os 3 Pilares do Background

### 1️⃣ GEOFENCE TASK

**O que faz**: Detecta quando o usuário cruza a borda de uma cerca geográfica.

**Como funciona**:
1. App registra regiões circulares (lat, lng, radius) no OS
2. OS monitora GPS em baixa frequência
3. Quando cruza a borda → OS acorda o app e executa a task

```typescript
// Registro das regiões
await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, [
  {
    identifier: 'location-uuid-123',
    latitude: -23.5505,
    longitude: -46.6333,
    radius: 100, // metros
    notifyOnEnter: true,
    notifyOnExit: true,
  }
]);
```

**Task Definition**:
```typescript
TaskManager.defineTask(GEOFENCE_TASK_NAME, async ({ data, error }) => {
  const { eventType, region } = data;
  
  if (eventType === Location.GeofencingEventType.Enter) {
    // Criar sessão de trabalho
    await createEntryRecord({ ... });
  } else {
    // Finalizar sessão
    await registerExit({ ... });
  }
});
```

**Características**:
- ✅ Funciona com app fechado
- ✅ Baixo consumo de bateria
- ⚠️ Pode ter delay de 1-3 minutos
- ⚠️ iOS limita a 20 regiões simultâneas

---

### 2️⃣ LOCATION TASK

**O que faz**: Recebe updates de posição em background.

**Como funciona**:
1. App solicita location updates contínuos
2. OS envia posição a cada X metros ou Y segundos
3. No Android, requer **Foreground Service** com notificação

```typescript
await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
  accuracy: Location.Accuracy.Balanced,
  distanceInterval: 50,        // a cada 50m
  timeInterval: 60000,         // ou a cada 1 min
  foregroundService: {
    notificationTitle: 'OnSite Timekeeper',
    notificationBody: 'Tracking work hours',
    notificationColor: '#F7B324',
  },
});
```

**Task Definition**:
```typescript
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data }) => {
  const { locations } = data;
  const location = locations[0];
  
  // Atualizar posição atual
  // Pode ser usado para verificação manual
});
```

**Características**:
- ✅ Updates mais frequentes
- ✅ Necessário para foreground service (Android)
- ⚠️ Consome mais bateria
- ⚠️ iOS pode limitar em background

---

### 3️⃣ HEARTBEAT TASK

**O que faz**: Verificação periódica de consistência.

**Por que existe**: 
- Geofencing pode falhar silenciosamente
- GPS indoor pode ser impreciso
- App pode ter sido "morto" durante um evento

**Como funciona**:
1. OS agenda execução a cada ~15 minutos
2. Task acorda, pega GPS atual
3. Verifica: "Estou dentro de alguma cerca?"
4. Compara com sessão ativa
5. Corrige inconsistências

```typescript
TaskManager.defineTask(HEARTBEAT_TASK_NAME, async () => {
  // 1. Pegar posição atual
  const location = await Location.getCurrentPositionAsync();
  
  // 2. Verificar se está dentro de alguma cerca
  const { isInside, fence } = checkInsideFence(location);
  
  // 3. Pegar sessão ativa
  const activeSession = await getGlobalActiveSession(userId);
  
  // 4. Detectar inconsistências
  if (isInside && !activeSession) {
    // MISSED ENTRY! Criar sessão
    await createEntryRecord({ ... });
  }
  
  if (!isInside && activeSession) {
    // MISSED EXIT! Finalizar sessão
    await registerExit({ ... });
  }
  
  return BackgroundFetch.BackgroundFetchResult.NewData;
});
```

**Características**:
- ✅ Safety net para eventos perdidos
- ✅ Baixo consumo (executa raramente)
- ⚠️ Intervalo mínimo ~15 min (controlado pelo OS)
- ⚠️ iOS pode não executar se app nunca foi aberto

---

## Fluxo de Funcionamento

### Inicialização

```
┌─────────────────────────────────────────────────────────────────┐
│                    FLUXO DE INICIALIZAÇÃO                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. App abre                                                    │
│     │                                                           │
│     ▼                                                           │
│  2. _layout.tsx importa backgroundTasks.ts                      │
│     │  └─ TaskManager.defineTask() é executado                  │
│     │  └─ Tasks são registradas no TaskManager                  │
│     │                                                           │
│     ▼                                                           │
│  3. locationStore.initialize() é chamado                        │
│     │  └─ Carrega locations do banco                            │
│     │  └─ Verifica permissões                                   │
│     │  └─ Configura callbacks                                   │
│     │                                                           │
│     ▼                                                           │
│  4. Auto-start monitoring (se conditions met)                   │
│     │  └─ startGeofencing() → registra regiões no OS            │
│     │  └─ startBackgroundLocation() → inicia foreground service │
│     │  └─ startHeartbeat() → agenda background fetch            │
│     │                                                           │
│     ▼                                                           │
│  5. App pronto - monitoramento ativo ✅                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Detecção de Entry

```
┌─────────────────────────────────────────────────────────────────┐
│                    FLUXO DE ENTRY                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Usuário entra na área da geofence                              │
│     │                                                           │
│     ▼                                                           │
│  OS detecta cruzamento de borda                                 │
│     │                                                           │
│     ▼                                                           │
│  OS acorda o app e executa GEOFENCE_TASK                        │
│     │                                                           │
│     ▼                                                           │
│  Task recebe: { eventType: 'Enter', region: { id: '...' } }     │
│     │                                                           │
│     ▼                                                           │
│  handleGeofenceEvent() é chamado                                │
│     │  └─ Verifica se já tem sessão ativa (evita duplicata)     │
│     │  └─ Cria registro: createEntryRecord()                    │
│     │  └─ Salva audit GPS: recordEntryAudit()                   │
│     │  └─ Atualiza estado: set({ activeSession })               │
│     │                                                           │
│     ▼                                                           │
│  Sessão iniciada ✅                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Detecção de Exit

```
┌─────────────────────────────────────────────────────────────────┐
│                    FLUXO DE EXIT                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Usuário sai da área da geofence                                │
│     │                                                           │
│     ▼                                                           │
│  OS detecta cruzamento de borda                                 │
│     │                                                           │
│     ▼                                                           │
│  OS acorda o app e executa GEOFENCE_TASK                        │
│     │                                                           │
│     ▼                                                           │
│  Task recebe: { eventType: 'Exit', region: { id: '...' } }      │
│     │                                                           │
│     ▼                                                           │
│  handleGeofenceEvent() é chamado                                │
│     │  └─ Busca sessão ativa para esta location                 │
│     │  └─ Salva audit GPS: recordExitAudit()                    │
│     │  └─ Finaliza: registerExit()                              │
│     │  └─ Calcula duração                                       │
│     │  └─ Atualiza estado                                       │
│     │                                                           │
│     ▼                                                           │
│  Sessão finalizada ✅                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Heartbeat System

### Conceito

O Heartbeat é um "safety net" que verifica periodicamente se o estado do app está consistente com a realidade física do usuário.

```
┌─────────────────────────────────────────────────────────────────┐
│                    HEARTBEAT LOGIC                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Situação Física    │  Sessão Ativa?  │  Ação                  │
│  ──────────────────────────────────────────────────────────────│
│  Dentro da cerca    │  SIM            │  ✅ OK, nada a fazer   │
│  Dentro da cerca    │  NÃO            │  ⚠️ MISSED ENTRY!     │
│  Fora da cerca      │  NÃO            │  ✅ OK, nada a fazer   │
│  Fora da cerca      │  SIM            │  ⚠️ MISSED EXIT!      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Hysteresis (Anti Ping-Pong)

Para evitar que o usuário na borda da cerca fique entrando/saindo repetidamente:

```
┌─────────────────────────────────────────────────────────────────┐
│                    HYSTERESIS                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    ┌───────────────┐                            │
│                    │    GEOFENCE   │                            │
│                    │   radius=100m │                            │
│                    └───────────────┘                            │
│                                                                 │
│  ENTRY: usa radius normal (100m)                                │
│  EXIT:  usa radius × 1.3 (130m)                                 │
│                                                                 │
│  Isso significa:                                                │
│  - Usuário entra quando cruza 100m                              │
│  - Usuário só SAI quando passa de 130m                          │
│  - Entre 100-130m, mantém estado atual                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

```typescript
const HYSTERESIS_ENTRY = 1.0;  // Entry usa raio normal
const HYSTERESIS_EXIT = 1.3;   // Exit usa raio × 1.3

function checkInsideFence(lat, lng, userId, useHysteresis) {
  for (const fence of fences) {
    const distance = calculateDistance(lat, lng, fence.lat, fence.lng);
    const effectiveRadius = useHysteresis 
      ? fence.radius * HYSTERESIS_EXIT 
      : fence.radius;
    
    if (distance <= effectiveRadius) {
      return { isInside: true, fence };
    }
  }
  return { isInside: false, fence: null };
}
```

### Skip Location Today

Permite que o usuário "pule" uma location por hoje (ex: dia de folga):

```typescript
// Usuário clica "Skip today" na UI
await addToSkippedToday(locationId);

// No heartbeat, verifica antes de criar entry
if (await isLocationSkippedToday(fence.id)) {
  logger.info('heartbeat', `😴 Location "${fence.name}" skipped today`);
  return; // Não cria sessão
}
```

---

## Arquivos Envolvidos

### Estrutura

```
src/
├── lib/
│   ├── backgroundTasks.ts   ← Definição das 3 tasks
│   ├── location.ts          ← Funções de GPS e geofencing
│   ├── logger.ts            ← Logging estruturado
│   └── database/
│       ├── records.ts       ← createEntryRecord, registerExit
│       ├── locations.ts     ← getLocations
│       └── audit.ts         ← recordEntryAudit, recordExitAudit
│
├── stores/
│   └── locationStore.ts     ← Orquestra tudo, auto-start
│
app/
└── _layout.tsx              ← Importa backgroundTasks PRIMEIRO
```

### Arquivo: `backgroundTasks.ts`

**Propósito**: Define as 3 background tasks.

**Exports principais**:
```typescript
// Task names
export const HEARTBEAT_TASK_NAME = 'onsite-heartbeat-task';

// Control functions
export function setGeofenceCallback(cb): void;
export function setHeartbeatCallback(cb): void;
export function updateActiveFences(fences): void;
export async function startHeartbeat(): Promise<boolean>;
export async function stopHeartbeat(): Promise<void>;

// User ID persistence (for background use)
export async function setBackgroundUserId(userId): Promise<void>;
export async function clearBackgroundUserId(): Promise<void>;

// Skip location feature
export async function addToSkippedToday(locationId): Promise<void>;
export async function removeFromSkippedToday(locationId): Promise<void>;

// Status checks
export async function getTasksStatus(): Promise<{...}>;
```

### Arquivo: `location.ts`

**Propósito**: Wrapper do expo-location com funções de alto nível.

**Exports principais**:
```typescript
// Task names
export const LOCATION_TASK_NAME = 'onsite-background-location';
export const GEOFENCE_TASK_NAME = 'onsite-geofence';

// Permissions
export async function requestAllPermissions(): Promise<PermissionsStatus>;
export async function checkPermissions(): Promise<PermissionsStatus>;

// Current location
export async function getCurrentLocation(): Promise<LocationResult | null>;

// Geofencing
export async function startGeofencing(regions): Promise<boolean>;
export async function stopGeofencing(): Promise<void>;
export async function isGeofencingActive(): Promise<boolean>;

// Background location
export async function startBackgroundLocation(): Promise<boolean>;
export async function stopBackgroundLocation(): Promise<void>;
```

### Arquivo: `locationStore.ts`

**Propósito**: Orquestra todo o sistema, gerencia estado.

**Funções críticas**:
```typescript
// Inicialização com auto-start
initialize: async () => {
  // ... setup ...
  
  // AUTO-START MONITORING
  if (shouldMonitor && hasPermission && hasLocations) {
    await get().startMonitoring();
  }
}

// Inicia os 3 sistemas
startMonitoring: async () => {
  await startGeofencing(regions);      // Pilar 1
  await startBackgroundLocation();     // Pilar 2
  await startHeartbeat();              // Pilar 3
  await saveMonitoringState(true);
}

// Para os 3 sistemas
stopMonitoring: async () => {
  await stopGeofencing();
  await stopBackgroundLocation();
  await stopHeartbeat();
  await saveMonitoringState(false);
}

// Handler para eventos de geofence
handleGeofenceEvent: async (event) => {
  if (event.type === 'enter') {
    await createEntryRecord(...);
    await recordEntryAudit(...);
  } else {
    await recordExitAudit(...);
    await registerExit(...);
  }
}
```

### Arquivo: `_layout.tsx`

**Propósito**: Entry point do app.

**CRÍTICO**: O import de `backgroundTasks.ts` DEVE ser o primeiro!

```typescript
// ✅ CORRETO
import '../src/lib/backgroundTasks';  // PRIMEIRO!

import React, { useEffect, ... } from 'react';
import { View, ... } from 'react-native';
// ... outros imports

// ❌ ERRADO
import React, { useEffect, ... } from 'react';
import { View, ... } from 'react-native';
import '../src/lib/backgroundTasks';  // Muito tarde!
```

**Por quê?** `TaskManager.defineTask()` precisa executar ANTES de qualquer outra coisa. Se não for o primeiro, as tasks podem não ser registradas corretamente.

---

## Configurações Necessárias

### `app.json`

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "UIBackgroundModes": [
          "location",
          "fetch",
          "remote-notification"
        ],
        "NSLocationAlwaysAndWhenInUseUsageDescription": "...",
        "NSLocationAlwaysUsageDescription": "..."
      }
    },
    "android": {
      "permissions": [
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
        "FOREGROUND_SERVICE",
        "FOREGROUND_SERVICE_LOCATION",
        "RECEIVE_BOOT_COMPLETED",
        "WAKE_LOCK"
      ]
    },
    "plugins": [
      [
        "expo-location",
        {
          "isAndroidBackgroundLocationEnabled": true,
          "isAndroidForegroundServiceEnabled": true
        }
      ]
    ]
  }
}
```

### Permissões Android

| Permissão | Propósito |
|-----------|-----------|
| `ACCESS_FINE_LOCATION` | GPS preciso |
| `ACCESS_BACKGROUND_LOCATION` | GPS com app fechado |
| `FOREGROUND_SERVICE` | Serviço em primeiro plano |
| `FOREGROUND_SERVICE_LOCATION` | Serviço de localização |
| `RECEIVE_BOOT_COMPLETED` | Reiniciar após boot |
| `WAKE_LOCK` | Manter CPU acordada |

### Permissões iOS

| Chave | Propósito |
|-------|-----------|
| `NSLocationAlwaysAndWhenInUseUsageDescription` | Permissão "sempre" |
| `UIBackgroundModes: location` | Location updates em background |
| `UIBackgroundModes: fetch` | Background fetch para heartbeat |

---

## Troubleshooting

### Background não funciona no Expo Go

**Problema**: Background tasks não funcionam.

**Causa**: Expo Go não suporta background tasks nativas.

**Solução**: Use EAS Build para criar um APK/IPA de desenvolvimento.

```bash
eas build --profile development --platform android
```

### Geofencing não detecta entry/exit

**Checklist**:
1. ✅ Permissão "Always" foi concedida?
2. ✅ `startMonitoring()` foi chamado?
3. ✅ Locations existem no banco?
4. ✅ Raio da geofence é >= 100m?
5. ✅ GPS do device está ligado?

**Debug**:
```typescript
const status = await getTasksStatus();
console.log(status);
// {
//   geofencing: true,
//   location: true,
//   heartbeat: true,
//   activeFences: 2,
//   backgroundFetchStatus: 'Available',
//   hasUserId: true
// }
```

### Heartbeat não executa

**Problema**: Heartbeat nunca é chamado.

**Causas possíveis**:
1. OS está limitando background fetch
2. App nunca foi aberto (iOS)
3. Battery saver ativo

**Solução Android**: Desabilitar otimização de bateria para o app.

**Solução iOS**: Abrir o app periodicamente.

### Sessions duplicadas

**Problema**: Duas entries para a mesma location.

**Causa**: Race condition entre geofence e heartbeat.

**Solução**: O código já verifica `existingSession` antes de criar:

```typescript
const existingSession = await getOpenSession(userId, location.id);
if (existingSession) {
  logger.info('geofence', 'Session already active, ignoring entry');
  return;
}
```

### Notificação do Android não aparece

**Problema**: Foreground service sem notificação visível.

**Causa**: Configuração incorreta ou canal de notificação bloqueado.

**Solução**: Verificar `foregroundService` config em `startBackgroundLocation()`.

---

## Referências

- [expo-location Documentation](https://docs.expo.dev/versions/latest/sdk/location/)
- [expo-task-manager Documentation](https://docs.expo.dev/versions/latest/sdk/task-manager/)
- [expo-background-fetch Documentation](https://docs.expo.dev/versions/latest/sdk/background-fetch/)
- [Android Geofencing](https://developer.android.com/develop/sensors-and-location/location/geofencing)
- [iOS Core Location](https://developer.apple.com/documentation/corelocation)

---

*Documentação gerada em Janeiro 2025*
