# Hermes TUI Runtime — Analisi d'Impatto

> **Data:** 2026-06-28
> **Stato:** Solo analisi — nessuna modifica al codice
> **Obiettivo:** Valutare la fattibilità e l'impatto di aggiungere Hermes TUI come runtime alternativo ai nodi, in parallelo a pi CLI

---

## 1. Contesto e Domanda Chiave

**Domanda:** Un nodo può essere sia un terminale pi che un terminale Hermes TUI?

**Risposta breve:** Un singolo nodo deve essere **uno o l'altro** (runtime esclusivo per nodo), ma un **board** può contenere nodi misti — alcuni pi, altri Hermes — collegati da edge. Questo è il caso d'uso principale e il più utile.

**Motivo:** Ogni nodo rappresenta una singola sessione agente con un proprio prompt, stato e contesto. Due runtime sullo stesso nodo creerebbero conflitti irrisolvibili (chi possiede il PTY? chi gestisce l'handoff? quale output è canonico?). Il modello a grafo già permette di avere nodi di runtime diversi collegati da edge, che è la soluzione naturale.

---

## 2. Architettura Attuale — Accoppiamento Critico

### 2.1 Il cuore: PtyHub.ts (~750 righe)

`PtyHub` è una classe monolitica che gestisce **tutto** il ciclo di vita dei nodi, hardcoded su pi CLI:

```
PtyHub
  ├── spawn()         → pty.spawn("pi", [...args])
  ├── ensure()        → spawn se mancante
  ├── input()         → pty.write(data)
  ├── inject()        → bracketed paste + \r
  ├── resize()        → pty.resize(cols, rows)
  ├── kill()          → pty.kill()
  ├── restart()       → kill + spawn
  ├── markReady()     → flush coda inject
  ├── deliverCall()   → risolvi target + scheduleInject
  └── orchestraContext() → appendix per turn
```

**Accoppiamento diretto con pi CLI:**

| Elemento | Dove | Perché è specifico per pi |
|----------|------|--------------------------|
| `resolvePiCommand()` | PtyHub.ts:63-99 | Cerca il binario `pi` su PATH o in node_modules |
| `PI_BIN_NAMES` | PtyHub.ts:46 | `["pi"]` / `["pi.cmd", "pi.exe", ...]` su Windows |
| `EXTENSION_PATH` | PtyHub.ts:27 | Path a `call-agent.ts`, estensione pi-specifica |
| Argomenti CLI (`--tools`, `--session-id`, `--name`, `--system-prompt`, `--extension`) | PtyHub.ts:228-240 | API CLI di pi, non generica |
| Bracketed paste (`\x1b[200~...\x1b[201~`) | PtyHub.ts:385 | Meccanismo di input di pi TUI |
| `READY_SETTLE_MS` / `READY_FALLBACK_MS` | PtyHub.ts:14-18 | Timing legato al boot di pi |

### 2.2 L'extension: call-agent.ts (~320 righe)

File `backend/pi-extensions/call-agent.ts` — un'estensione che gira **dentro** il processo pi:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function handoffExtension(pi: ExtensionAPI) {
  pi.on("session_start", async () => { /* POST /internal/ready */ });
  pi.on("before_agent_start", async (event) => { /* GET /internal/orchestra-context */ });
  pi.on("agent_end", async (event) => { /* parse @@HANDOFF, deliverCall */ });
}
```

**Hook specifici di pi:**
- `session_start` → non esiste in Hermes
- `before_agent_start` → non esiste in Hermes
- `agent_end` → non esiste in Hermes
- `pi.sendUserMessage(msg, { deliverAs: "followUp" })` → API pi-specifica

### 2.3 Il protocollo di handoff

```
pi agent scrive @@HANDOFF:developer-1 nel suo output
  → call-agent.ts intercetta su agent_end
  → POST /internal/call-agent { fromNodeId, targetNodeId, message }
  → backend risolve il target
  → scheduleInject nel PTY del target
  → bracketed paste nel terminale pi del target
```

Questo protocollo è **testuale** (regex su output) — il che è un vantaggio: funziona con qualsiasi agente che scrive testo. Ma i meccanismi di intercettazione (extension hooks) sono pi-specifici.

---

## 3. Come Funziona Hermes TUI (dai documenti esistenti)

### 3.1 Architettura Hermes Desktop

```
Hermes Desktop (Electron shell)
  └── hermes dashboard backend (locale o remoto)
       └── Hermes Agent core (AIAgent, tools, sessions)
```

### 3.2 Protocolli Disponibili

| Protocollo | Trasporto | Adatto a Orchestra? |
|------------|-----------|---------------------|
| **ACP** (`hermes acp`) | JSON-RPC stdio | ❌ Sessione singola — stile IDE |
| **TUI gateway** | JSON-RPC stdio / WebSocket | ✅ Sessioni per-nodo: `prompt.submit`, `session.steer`, `session.interrupt`, eventi streaming |
| **API server** | HTTP OpenAI-compat | ⚠️ Meno controllo — no steer/approval fine-grained |
| **Dashboard `/api/ws`** | WebSocket JSON-RPC | ✅ Stesso del TUI gateway; alimenta la Chat tab |

### 3.3 Insight Critico

> **"Hermes Chat tab is literally the Ink TUI rendered via xterm.js through a PTY bridge to `tui_gateway`."**
> — docs/HERMES_DESKTOP.md

Questo significa che:
1. Hermes produce output ANSI/VT100 renderizzabile da xterm.js (come pi)
2. Il rendering lato frontend è **già compatibile** — nessun cambio a NodeTerminal/TerminalPanel
3. La differenza è nel **backend**: come si spawn una sessione, come si inietta input, come si intercettano gli eventi

### 3.4 Requisiti Operativi

- `hermes dashboard --tui` deve essere in esecuzione (`--tui` è obbligatorio, senza di esso `/api/ws` ritorna close code 4403)
- `HERMES_DASHBOARD_SESSION_TOKEN` in `.env` (si rigenera al restart del dashboard)
- Readiness probe: `GET /api/status` (più debole) vs `GET /api/ws` (reale)
- Remote: VPN (Tailscale) o OAuth — mai esposto `--insecure` su internet pubblico

---

## 4. Analisi d'Impatto — Componente per Componente

### 4.1 Backend — IMPATTO ALTO

#### `backend/src/pty/PtyHub.ts` — IL COMPONENTE CRITICO

**Stato attuale:** Monolitico, tutto hardcoded su pi CLI.
**Impatto:** Deve essere ristrutturato in modo da delegare le operazioni runtime-specifiche a un adapter.

Metodi che necessitano astrazione:

| Metodo | Operazione attuale (pi) | Operazione Hermes | Cambio necessario |
|--------|------------------------|-------------------|-------------------|
| `spawn()` | `pty.spawn(pi, args, opts)` | Connessione a tui_gateway WS/JSON-RPC | **Completo** — logica di spawn completamente diversa |
| `input()` | `pty.write(data)` | `prompt.submit` via JSON-RPC | **Completo** — protocollo diverso |
| `inject()` | Bracketed paste + `\r` | `prompt.submit` via JSON-RPC | **Completo** |
| `resize()` | `pty.resize(cols, rows)` | Potrebbe non essere necessario (gateway gestisce) | **Parziale** |
| `kill()` | `pty.kill()` | `session.interrupt` + chiusura connessione | **Completo** |
| `restart()` | `kill + spawn` | `session.interrupt` + nuova sessione | **Completo** |
| `markReady()` | Da `session_start` extension | Da evento WS gateway | **Parziale** — il meccanismo di flush coda è generico |
| `ensure()` | Controlla session + spawn | Stesso concetto, diverso spawn | **Minimo** |
| `deliverCall()` | Risolve target + scheduleInject | **Identico** — è runtime-agnostic | **Nessuno** |
| `orchestraContext()` | Legge grafo + edges | **Identico** | **Nessuno** |
| `handles()` | Genera handle da label | **Identico** | **Nessuno** |
| `connectionsAppendix()` | Testo per prompt | **Identico** | **Nessuno** |

**Metodi completamente invariati (runtime-agnostic):**
- `setGraph()`, `orchestraContext()`, `handles()`, `connectionsAppendix()`, `kanbanAppendix()`, `resolveOutgoingTarget()`, `deliverCall()`, `setBroadcast()`, `setKanbanTracked()`, `setEnforcement()`, `isEnforced()`, `enforcementOverrides()`, `getNodeStatuses()`, `getEdges()`, `waitForExit()`

**Metodi parzialmente invariati:**
- `ensure()` — la logica di pending e session check è generica, solo lo spawn è diverso
- `markReady()` — il meccanismo di flush coda è generico, solo il trigger è diverso
- `scheduleInject()` — la logica di coda/fallback è generica

**Stima:** ~60% del codice di PtyHub è runtime-agnostic e non deve cambiare. Il ~40% (spawn, input, inject, kill, resize) deve essere estratto.

#### `backend/pi-extensions/call-agent.ts` — IMPATTO ALTO

**Stato attuale:** Estensione pi-specifica, ~320 righe.
**Impatto:** Per Hermes serve un meccanismo equivalente.

**Opzioni:**

| Opzione | Descrizione | Pro | Contro |
|---------|-------------|-----|--------|
| **A. Hermes Skill** | Un tool Hermes (`orchestra_handoff`) che chiama `POST /internal/call-agent` | Nativo, pulito | Richiede che Hermes supporti custom skills/tools |
| **B. Stream parsing** | Il `HermesRuntime` intercetta gli eventi stream e fa regex `@@HANDOFF` | Nessun cambio in Hermes | Più fragile, duplica logica |
| **C. Mix** | Hermes Skill + fallback stream parsing | Robusto | Più complesso |

**Raccomandazione:** Opzione C — Hermes Skill come canale primario, stream parsing come fallback.

**Note:**
- Il protocollo `@@HANDOFF` come testo è **universale** — funziona con qualsiasi agente
- `POST /internal/call-agent`, `POST /internal/ready`, `GET /internal/orchestra-context` sono **già runtime-agnostic** — funzionano per qualsiasi runtime
- Solo l'intercettazione è runtime-specifica

#### `backend/src/types.ts` — IMPATTO MEDIO

Aggiunte necessarie al modello dati:

```typescript
// Nuovo tipo
type NodeRuntime = "pi" | "hermes";

// Estensione di WorkflowNode
interface WorkflowNode {
  // ... campi esistenti invariati
  runtime?: NodeRuntime;        // default "pi" per backward compat
  runtimeConfig?: Record<string, unknown>;  // config runtime-specifica
}
```

**Backward compatibility:** Il campo `runtime` è opzionale. Default `"pi"`. I grafi esistenti funzionano senza modifiche.

#### `backend/src/ws/handler.ts` — IMPATTO MEDIO

Il WebSocket handler instrada i messaggi a PtyHub. Cambi necessari:

| Messaggio WS | Cambio |
|--------------|--------|
| `load_graph` | Nessuno — passa il grafo a PtyHub come oggi |
| `attach_node` | PtyHub deve spawnare il runtime corretto (già gestito da PtyHub refactored) |
| `pty_input` | PtyHub deve usare il meccanismo corretto (PTY write vs JSON-RPC) |
| `inject_task` | Nessuno — passa a PtyHub |
| `restart_node` | PtyHub deve usare il meccanismo corretto |
| `abort_node` | PtyHub deve usare il meccanismo corretto |
| `pty_resize` | Potrebbe non servire per Hermes (da verificare) |

**Verdetto:** Il handler è già un thin layer verso PtyHub. Se PtyHub gestisce il dispatch, il handler non cambia quasi per niente.

#### `backend/src/orchestra/BoardManager.ts` — IMPATTO MEDIO

- `addNode()` / `updateNode()` devono propagare `runtime` e `runtimeConfig`
- `validateGraph()` potrebbe avere regole aggiuntive per nodi Hermes (es. validare config)
- `run()` → `injectTask()` è già generico (passa a PtyHub)

#### `backend/src/routes/orchestra.ts` — IMPATTO BASSO

- Body delle CRUD nodes devono accettare `runtime` e `runtimeConfig`
- `POST /flows` deve supportare grafi misti (automatico se il grafo include il campo)
- Nessun cambio strutturale

#### `backend/src/db/index.ts` — IMPATTO BASSO

- `boards.graph_data` è serializzato come JSON → il campo `runtime` entra naturalmente
- Nessun cambio schema SQL necessario (il JSON nel blob lo contiene)
- Opzionale: indice o colonna dedicata per query filtrate per runtime

### 4.2 Frontend — IMPATTO BASSO

#### Rendering terminale — IMPATTO QUASI NULO

**Questo è il punto più favorevole dell'intera analisi.**

Sia pi che Hermes TUI producono output ANSI/VT100. Il rendering avviene su xterm.js in entrambi i casi. I componenti:

- `NodeTerminal.tsx` (mini terminale read-only sul card)
- `TerminalPanel.tsx` (terminale interattivo nel pannello laterale)
- `ptyBus.ts` (pub/sub per eventi PTY)

...sono **completamente runtime-agnostic**. Non contengono nessun riferimento a "pi" nel rendering. Funzioneranno identicamente con Hermes.

**L'unica eccezione:** Il messaggio "starting pi…" nell'overlay di `NodeTerminal.tsx` — dovrebbe diventare "starting {runtime}…" dinamico.

#### `frontend/src/types.ts` — IMPATTO BASSO

```typescript
// Nuovo tipo
type NodeRuntime = "pi" | "hermes";

// Estensione di WorkflowNodeData
interface WorkflowNodeData {
  // ... campi esistenti invariati
  runtime?: NodeRuntime;
  runtimeConfig?: Record<string, unknown>;
}
```

#### `frontend/src/components/AgentNode.tsx` — IMPATTO BASSO

- Badge/icona per indicare il runtime del nodo (es. "pi" / "H" / icona differenziata)
- Label "Restart pi…" → "Restart {runtime}…" dinamico
- Tooltip informativi aggiornati

#### `frontend/src/components/NodeInspector.tsx` — IMPATTO BASSO

- Dropdown per selezionare il runtime quando si crea/modifica un nodo
- Campi di configurazione runtime-specifici (es. URL gateway Hermes, session token)
- Il resto dell'inspector (prompt override, run, entry) è invariato

#### `frontend/src/stores/runtimeStore.ts` — IMPATTO BASSO

- Piccole aggiunte per tracciare `runtime` nel node status
- Nessun cambio strutturale allo store

#### `frontend/src/components/TerminalPanel.tsx` — IMPATTO BASSO

- Header: label "pi" → "{runtime}" dinamico
- Messaggio "pi session ended" → "{runtime} session ended"
- Il resto (xterm, fit, clipboard) è invariato

### 4.3 Test — IMPATTO MEDIO

I test esistenti devono essere estesi per coprire il nuovo runtime:

| Test file | Copertura attuale | Estensione necessaria |
|-----------|------------------|----------------------|
| `PtyHub.test.ts` | 9 test su spawn, inject, ready, orchestraContext | Test per Hermes spawn/inject/kill + grafi misti |
| `BoardManager.test.ts` | 37 test su CRUD grafi, run, stop, validation | Test per runtime field, validation Hermes |
| `handler.test.ts` | 2 test su load_graph | Test per messaggi WS con runtime diverso |
| `db/index.test.ts` | 5 test su CRUD boards | Test per serializzazione runtime in JSON |
| `runtimeStore.test.ts` | 1 test su overlay | Test per runtime tracking |

---

## 5. Protocollo di Handoff Cross-Runtime

### 5.1 Scenario: pi → Hermes

```
Nodo A (pi) scrive: @@HANDOFF:hermes-dev
  → call-agent.ts intercetta (agent_end)
  → POST /internal/call-agent { fromNodeId: A, targetNodeId: B, message: "..." }
  → PtyHub.deliverCall() risolve B
  → PtyHub.scheduleInject() per B
  → HermesRuntime.inject() → prompt.submit via JSON-RPC
```

**Funziona senza modifiche al protocollo.** L'handoff è testuale e il backend lo gestisce in modo runtime-agnostic.

### 5.2 Scenario: Hermes → pi

```
Nodo B (Hermes) scrive: @@HANDOFF:architect
  → Hermes Skill orchestra_handoff (o stream parsing)
  → POST /internal/call-agent { fromNodeId: B, targetNodeId: A, message: "..." }
  → PtyHub.deliverCall() risolve A
  → PtyHub.scheduleInject() per A
  → PiRuntime.inject() → bracketed paste
```

**Funziona allo stesso modo.** Il canale di delivery (`POST /internal/call-agent`) è già universale.

### 5.3 Scenario: Hermes → Hermes

```
Nodo B (Hermes) → @@HANDOFF → Nodo C (Hermes)
  → Stesso flusso, inject via JSON-RPC in entrambi i lati
```

### 5.4 Il Per-Turn Context Refresh

Attualmente `call-agent.ts` fa `GET /internal/orchestra-context` ogni turno. Per Hermes:

| Opzione | Descrizione | Complessità |
|---------|-------------|-------------|
| **A. Hermes Skill** | Un tool che chiama lo stesso endpoint | Media — richiede custom skill |
| **B. Runtime adapter** | `HermesRuntime` inietta il context via `session.steer` | Media |
| **C. Baked-in fallback** | L'appendix è già in `PINODES_ORCHESTRA_FALLBACK_APPENDIX` | Già funzionante — degradazione graceful |

L'opzione C è già implementata e funzionante. Le opzioni A e B sono miglioramenti successivi.

---

## 6. Dipendenze e Requisiti Esterni

### 6.1 Requisiti per Runtime pi (attuale, invariato)

- `@earendil-works/pi-coding-agent` installato (globale o in node_modules)
- API keys in `~/.pi/agent/auth.json` o env vars
- Nessun servizio esterno richiesto — pi è self-contained

### 6.2 Requisiti per Runtime Hermes (nuovo)

- `hermes dashboard --tui` in esecuzione (obbligatorio)
- `HERMES_DASHBOARD_SESSION_TOKEN` configurato
- URL del gateway accessibile (default: `http://localhost:9119`)
- **Differenza critica:** Hermes non è self-contained — richiede un servizio esterno

### 6.3 Implicazione Operativa

Questo è un **rischio operativo significativo**. Se Hermes non è attivo, i nodi Hermes devono fallire gracefulmente con un messaggio chiaro. L'utente deve capire che serve un setup aggiuntivo.

---

## 7. Riepilogo Impatto

| Componente | Impatto | Rischio | Note |
|------------|---------|---------|------|
| `PtyHub.ts` | 🔴 Alto | 🔴 Alto | Cuore del sistema, refactoring critico |
| `call-agent.ts` | 🔴 Alto | 🟡 Medio | Nuovo meccanismo per Hermes, esistente per pi |
| `types.ts` (backend) | 🟡 Medio | 🟢 Basso | Campo opzionale, backward compatibile |
| `ws/handler.ts` | 🟡 Medio | 🟢 Basso | Thin layer, cambio minimo |
| `BoardManager.ts` | 🟡 Medio | 🟢 Basso | Propagazione campo runtime |
| `routes/orchestra.ts` | 🟢 Basso | 🟢 Basso | Body esteso, cambio minimo |
| `db/index.ts` | 🟢 Basso | 🟢 Basso | JSON blob, nessun cambio schema |
| Terminali frontend (xterm) | 🟢 Nulo | 🟢 Basso | Già runtime-agnostic |
| `types.ts` (frontend) | 🟢 Basso | 🟢 Basso | Campo opzionale |
| `AgentNode.tsx` | 🟢 Basso | 🟢 Basso | Badge/icona |
| `NodeInspector.tsx` | 🟢 Basso | 🟢 Basso | Dropdown runtime |
| `TerminalPanel.tsx` | 🟢 Basso | 🟢 Basso | Label dinamica |

**Rischio complessivo:** 🟡 **MEDIO** — il refactoring di PtyHub è il singolo punto più rischioso, ma la maggior parte del sistema è già runtime-agnostic.

---

## 8. Punti Favorevoli (già a posto)

1. **Il rendering xterm.js è universale** — sia pi che Hermes producono ANSI/VT100
2. **L'handoff è testuale** — `@@HANDOFF` funziona con qualsiasi agente
3. **Il backend API è già runtime-agnostic** — `/internal/call-agent`, `/internal/ready`, `/internal/orchestra-context` non sanno quale runtime ha il nodo
4. **Il ready-gate mechanism è generico** — basta che l'adapter chiami `markReady()`
5. **Il grafo JSON è estensibile** — il campo `runtime` entra senza cambio schema
6. **I doc sono già pronti** — `HERMES_DESKTOP.md`, `EXTENSIONS_ROADMAP.md`, `PROGRAMMATIC_API.md` descrivono il design target
7. **Il PROGRAMMATIC_API.md ha già il campo `runtime`** nel tipo `WorkflowNode` pianificato

---

## 9. Conclusioni

L'implementazione è **fattibile e ben supportata dall'architettura esistente**. Il rischio principale è concentrato in un singolo componente (`PtyHub.ts`) che deve essere ristrutturato con cura. Il resto del sistema è già progettato per essere estendibile.

La chiave del successo è un **approccio incrementale**: prima refactoring interno (zero behavior change), poi aggiunta del nuovo runtime dietro feature flag, infine abilitazione nella UI.

Vedere il documento di piano implementativo (`HERMES_TUI_IMPLEMENTATION_PLAN.md`) per i dettagli operativi.
