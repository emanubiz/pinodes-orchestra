# Hermes TUI Runtime — Piano Implementativo (Test-First, Cauto e Prudente)

> **Data:** 2026-06-28
> **Stato:** Solo piano — nessuna modifica al codice
> **Principio guida:** Ogni fase inizia con i test. Mai modificare il comportamento esistente senza prima avere test che lo catturano. Backward compatibility sempre garantita.

---

## Principi del Piano

1. **Test-first assoluto:** Prima di toccare qualsiasi codice di produzione, si scrivono test che catturano il comportamento attuale. Se un test fallisce dopo una modifica, si ferma tutto.
2. **Zero behavior change nei refactoring interni:** Le fasi di estrazione non devono cambiare nessun comportamento osservabile. I test esistenti devono passare identici.
3. **Feature flag per il nuovo runtime:** Hermes è dietro un flag (`PINODES_ORCHESTRA_HERMES`) finché non è maturo. Default: spento.
4. **Backward compatibility totale:** I grafi senza campo `runtime` funzionano come oggi (default `"pi"`).
5. **Commit piccoli e indipendenti:** Ogni sotto-fase è un commit separato, revertibile indipendentemente.
6. **Validazione continua:** Dopo ogni sotto-fase: `npm test --workspaces --if-present` + `npx tsc --noEmit -p backend` + `npx tsc --noEmit -p frontend`.

---

## Fase 0 — Estendere il Data Model (zero behavior change)

**Obiettivo:** Aggiungere il campo `runtime` ai tipi e al grafo senza cambiare nessun comportamento.
**Rischio:** 🟢 Basso
**Tempo stimato:** 2-3 giorni
**Dipendenze:** Nessuna

### 0.1 — Test: serializzazione grafi con runtime field

**File:** `backend/src/db/index.test.ts`

Aggiungere test che verificano:
- Un grafo con `runtime: "pi"` su ogni nodo si salva e si legge correttamente
- Un grafo con `runtime: "hermes"` su un nodo si salva e si legge correttamente
- Un grafo senza campo `runtime` (backward compat) si salva e si legge correttamente
- Un grafo misto (un nodo pi, un nodo hermes) si salva e si legge correttamente

### 0.2 — Test: validation con runtime field

**File:** `backend/src/orchestra/BoardManager.test.ts`

Aggiungere test che verificano:
- `addNode` con `runtime: "hermes"` accetta il campo e lo persiste
- `updateNode` con `runtime: "hermes"` aggiorna il campo
- `addNode` senza `runtime` funziona come oggi (default implicito)
- `validateGraph` non cambia comportamento con o senza runtime

### 0.3 — Test: API REST con runtime field

**File:** Nuovo test o estensione di test esistenti per `routes/orchestra.ts`

Verificare:
- `POST /boards/:id/nodes` accetta `runtime` nel body
- `PATCH /boards/:id/nodes/:nodeId` accetta `runtime` nel body
- `GET /boards/:id/graph` restituisce il campo `runtime` se presente
- `PUT /boards/:id/graph` preserva il campo `runtime`

### 0.4 — Implementazione: types.ts (backend + frontend)

**File:** `backend/src/types.ts`

```typescript
// AGGIUNGERE (non modificare nulla di esistente):
export type NodeRuntime = "pi" | "hermes";

// ESTENDERE WorkflowNode — campo opzionale:
// runtime?: NodeRuntime;        // default "pi" se assente
// runtimeConfig?: Record<string, unknown>;
```

**File:** `frontend/src/types.ts`

Stesse modifiche specularle.

### 0.5 — Implementazione: propagazione nei CRUD

**File:** `backend/src/orchestra/BoardManager.ts`

- `addNode()`: accetta e propaga `runtime` e `runtimeConfig`
- `updateNode()`: accetta e propaga `runtime` e `runtimeConfig`
- Nessun altro cambio

**File:** `backend/src/routes/orchestra.ts`

- Body schemas per POST/PATCH nodes: aggiungere campi opzionali `runtime`, `runtimeConfig`
- Nessun altro cambio

### 0.6 — Validazione

```bash
npm test --workspaces --if-present
npx tsc --noEmit -p backend
npx tsc --noEmit -p frontend
```

**Gate:** Tutti i test passano. Nessun cambio di comportamento. Il campo `runtime` è serializzato nel JSON ma ignorato dalla logica.

---

## Fase 1 — Test di Protezione per PtyHub (nessun cambio a PtyHub)

**Obiettivo:** Scrivere test che catturano il comportamento attuale di PtyHub in modo più granulare, così da avere una rete di sicurezza per il refactoring della Fase 2.
**Rischio:** 🟢 Basso (solo test, nessun cambio codice produzione)
**Tempo stimato:** 2-3 giorni
**Dipendenze:** Fase 0 completata

### 1.1 — Test aggiuntivi per PtyHub

**File:** `backend/src/pty/PtyHub.test.ts`

Test da aggiungere (se non già coperti):

**Spawn:**
- `spawn` invoca `pty.spawn` con gli argomenti corretti (`--tools`, `--session-id`, `--name`, `--system-prompt`, `--extension`)
- `spawn` imposta le env vars corrette (`PINODES_ORCHESTRA_URL`, `PINODES_ORCHESTRA_BOARD`, `PINODES_ORCHESTRA_NODE`, `PINODES_ORCHESTRA_FALLBACK_APPENDIX`)
- `spawn` con token imposta `PINODES_ORCHESTRA_TOKEN` nell'env
- `spawn` senza token non imposta `PINODES_ORCHESTRA_TOKEN`
- `spawn` broadcasta `node_status: running` e `pty_size`

**Lifecycle:**
- `kill` rimuove la sessione, broadcasta `pty_exit` e `node_status: idle`
- `restart` kill + respawn, la nuova sessione ha un PTY fresco
- Dopo `kill`, `isNodeRunning` restituisce false
- Dopo `kill`, `isReady` restituisce false

**I/O:**
- `input` scrive dati nel PTY della sessione
- `input` su nodo non running è un no-op (non throwa)
- `resize` aggiorna le dimensioni e broadcasta `pty_size`
- `resize` su nodo non running è un no-op

**Ready + Inject:**
- `injectTask` prima di `markReady` → messaggio in coda
- `markReady` flusha la coda dopo `READY_SETTLE_MS`
- `injectTask` dopo `markReady` → inject immediato
- `restart` cancella lo stato ready → prossimo inject va in coda
- Fallback timeout inietta dopo `READY_FALLBACK_MS` se ready non arriva

**Buffer:**
- Il buffer accumula output fino a `MAX_BUFFER` (256KB)
- Oltre `MAX_BUFFER`, i dati più vecchi vengono troncati
- L'attach con replay restituisce il buffer corrente

**Handoff:**
- `deliverCall` risolve il target per handle
- `deliverCall` risolve il target per UUID
- `deliverCall` risolve il target per label univoca
- `deliverCall` su target non risolvibile restituisce errore e nudges il sender
- `deliverCall` su target risolvibile fa `scheduleInject`

### 1.2 — Test per il PTY output lifecycle

Verificare che `term.onData` accumula nel buffer e broadcasta, e che `term.onExit` fa cleanup completo.

### 1.3 — Validazione

```bash
cd backend && npx vitest run src/pty/PtyHub.test.ts
```

**Gate:** Tutti i nuovi test passano. Il codice di PtyHub non è stato toccato.

---

## Fase 2 — Estrarre l'Interfaccia INodeRuntime (refactoring interno)

**Obiettivo:** Estrarre le operazioni runtime-specifiche da PtyHub in un'interfaccia `INodeRuntime` e una classe `PiRuntime`, senza cambiare nessun comportamento.
**Rischio:** 🟡 Medio — è il passo più delicato
**Tempo stimato:** 1 settimana
**Dipendenze:** Fase 1 completata (test di protezione in place)

### 2.1 — Definire l'interfaccia INodeRuntime

**File Nuovo:** `backend/src/pty/runtime/INodeRuntime.ts`

```typescript
export interface INodeRuntime {
  /**
   * Spawn a new session for the given node. Must call lifecycle callbacks:
   * - onOutput(data) when the PTY/process emits output
   * - onExit(code) when the session terminates
   * - onReady() when the session is ready for input
   */
  spawn(config: RuntimeSpawnConfig): void;

  /** Write raw input data to the session (keystrokes). */
  write(data: string): void;

  /** Inject a message as a task (bracketed paste or equivalent). */
  inject(message: string): void;

  /** Resize the terminal dimensions. May be a no-op for some runtimes. */
  resize(cols: number, rows: number): void;

  /** Kill the session. */
  kill(): void;

  /** Whether the session is currently alive. */
  isRunning(): boolean;

  /** Whether the session has reported ready for input. */
  isReady(): boolean;

  /** Current terminal dimensions, if known. */
  size(): { cols: number; rows: number } | undefined;
}

export interface RuntimeSpawnConfig {
  boardId: string;
  nodeId: string;
  label: string;
  cwd: string;
  cols: number;
  rows: number;
  systemPrompt: string;
  appendix: string;
  // Callbacks — il runtime li chiama quando succede qualcosa
  onOutput: (data: string) => void;
  onExit: (code: number | null) => void;
  onReady: () => void;
  onError: (message: string) => void;
}
```

### 2.2 — Estrarre PiRuntime

**File Nuovo:** `backend/src/pty/runtime/PiRuntime.ts`

Spostare TUTTA la logica pi-specifica da PtyHub in questa classe:
- `resolvePiCommand()` e `PI_BIN_NAMES`
- `EXTENSION_PATH`
- Il blocco `pty.spawn(...)` con tutti gli argomenti CLI
- Il bracketed paste in `inject()`
- `READY_SETTLE_MS` / `READY_FALLBACK_MS`

**Principio:** Spostare codice, non riscriverlo. Ogni riga deve essere identica al comportamento attuale.

### 2.3 — Refactoring di PtyHub

**File:** `backend/src/pty/PtyHub.ts`

- PtyHub crea `PiRuntime` per ogni sessione (default)
- I metodi `spawn`, `input`, `inject`, `resize`, `kill`, `isReady` delegano all'`INodeRuntime`
- I metodi `deliverCall`, `orchestraContext`, `handles`, `connectionsAppendix`, `setGraph`, `scheduleInject`, `markReady` restano in PtyHub (sono runtime-agnostic)
- `Session` interface diventa `{ runtime: INodeRuntime; buffer: string; ... }`

### 2.4 — Test: comportamento identico

**File:** `backend/src/pty/PtyHub.test.ts`

- TUTTI i test esistenti devono passare senza modifica
- I nuovi test della Fase 1 devono passare senza modifica
- Il mock di `node-pty` deve funzionare con il nuovo PiRuntime

### 2.5 — Test: PiRuntime isolato

**File Nuovo:** `backend/src/pty/runtime/PiRuntime.test.ts`

Testare PiRuntime in isolazione:
- `spawn` invoca `pty.spawn` con gli argomenti corretti
- `write` scrive nel PTY
- `inject` fa bracketed paste
- `kill` termina il PTY
- `resize` ridimensiona il PTY
- Il callback `onReady` NON viene invocato automaticamente (deve arrivare da `markReady` esterno)
- Il callback `onExit` viene invocato quando il PTY esce

### 2.6 — Validazione

```bash
npm test --workspaces --if-present
npx tsc --noEmit -p backend
npx tsc --noEmit -p frontend
```

**Gate:** TUTTI i test passano. Nessun cambio di comportamento osservabile. PtyHub è più piccolo ma funziona identicamente.

---

## Fase 3 — Implementare HermesRuntime (dietro feature flag)

**Obiettivo:** Implementare `HermesRuntime` che si connette al TUI gateway di Hermes, senza abilitarlo nella UI.
**Rischio:** 🟡 Medio
**Tempo stimato:** 1-2 settimane
**Dipendenze:** Fase 2 completata

### 3.1 — Ricerca API Hermes TUI Gateway

Prima di scrivere codice, verificare con precisione:
- L'endpoint WebSocket del TUI gateway (formato, handshake, auth)
- I metodi JSON-RPC disponibili (`prompt.submit`, `session.steer`, `session.interrupt`, etc.)
- Il formato degli eventi di stream (output, tool calls, thinking)
- Il segnale di "session ready"
- Il segnale di "session exit"
- La gestione degli errori

**Azione:** Leggere la documentazione aggiornata di Hermes, possibilmente testare manualmente con `hermes dashboard --tui` e un client WS.

### 3.2 — Implementare HermesRuntime

**File Nuovo:** `backend/src/pty/runtime/HermesRuntime.ts`

Implementare `INodeRuntime`:

```typescript
export class HermesRuntime implements INodeRuntime {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  // ...

  spawn(config: RuntimeSpawnConfig): void {
    // 1. Connetti a hermes dashboard WS (configurazione da env o runtimeConfig)
    // 2. Crea una nuova sessione Hermes
    // 3. Sottometti il system prompt
    // 4. Registra handler per eventi stream → config.onOutput
    // 5. Registra handler per session ready → config.onReady
    // 6. Registra handler per session exit → config.onExit
  }

  write(data: string): void {
    // Forward keystrokes? O gestire solo inject via JSON-RPC?
    // Da verificare con l'API Hermes
  }

  inject(message: string): void {
    // prompt.submit via JSON-RPC
  }

  resize(cols: number, rows: number): void {
    // Potrebbe non essere necessario — da verificare
  }

  kill(): void {
    // session.interrupt + chiudi WS
  }
  // ...
}
```

### 3.3 — Integrazione con PtyHub (dietro flag)

**File:** `backend/src/pty/PtyHub.ts`

Modificare il punto di creazione runtime:

```typescript
// In spawn():
const runtime = node?.runtime === "hermes" && process.env.PINODES_ORCHESTRA_HERMES === "true"
  ? new HermesRuntime()
  : new PiRuntime();  // default
```

**Principio:** Il flag `PINODES_ORCHESTRA_HERMES` è spento per default. Se spento, il comportamento è identico a oggi anche se `runtime: "hermes"` è nel grafo.

### 3.4 — Handoff per Hermes

**File Nuovo:** `backend/src/pty/runtime/hermes-handoff.ts` (o dentro HermesRuntime)

Due strategie:

**A. Stream parsing (primario):**
- HermesRuntime intercetta gli eventi di stream dal gateway
- Cerca `@@HANDOFF:handle` nel testo dell'output
- Quando trovato, chiama il callback che porta a `deliverCall()` di PtyHub

**B. Hermes Skill (futuro, miglioramento):**
- Registra un tool Hermes `orchestra_handoff` che chiama `POST /internal/call-agent`
- Più robusto, ma richiede supporto custom skills in Hermes

### 3.5 — Ready protocol per Hermes

- HermesRuntime ascolta l'evento "session ready" dal gateway
- Quando ricevuto, invoca il callback `onReady` → PtyHub.markReady()
- Fallback timeout già implementato in PtyHub (READY_FALLBACK_MS)

### 3.6 — Test: HermesRuntime isolato

**File Nuovo:** `backend/src/pty/runtime/HermesRuntime.test.ts`

Mock del WebSocket gateway:
- `spawn` crea una connessione WS e invia il messaggio di creazione sessione
- `inject` invia `prompt.submit` via JSON-RPC
- `kill` invia `session.interrupt` e chiude la connessione
- Eventi stream vengono forwardati al callback `onOutput`
- Evento ready viene forwardato al callback `onReady`
- Evento exit viene forwardato al callback `onExit`
- Connessione persa → callback `onError` + `onExit`

### 3.7 — Test: integrazione con PtyHub

**File:** `backend/src/pty/PtyHub.test.ts`

Aggiungere test con HermesRuntime mockato:
- Un nodo con `runtime: "hermes"` usa HermesRuntime
- Un nodo con `runtime: "pi"` (o senza runtime) usa PiRuntime
- Grafi misti: nodo A è pi, nodo B è hermes, handoff A→B funziona
- Grafi misti: handoff B→A funziona

### 3.8 — Validazione

```bash
npm test --workspaces --if-present
npx tsc --noEmit -p backend
npx tsc --noEmit -p frontend
```

**Gate:** Tutti i test passano. HermesRuntime è implementato ma dietro feature flag. Il sistema in produzione funziona come oggi (flag spento).

---

## Fase 4 — Frontend: Runtime Selector e Badge

**Obiettivo:** Aggiungere la UI per selezionare e visualizzare il runtime dei nodi.
**Rischio:** 🟢 Basso
**Tempo stimato:** 3-5 giorni
**Dipendenze:** Fase 0 completata (il campo `runtime` è nei tipi)

### 4.1 — Test: runtimeStore con runtime field

**File:** `frontend/src/stores/runtimeStore.test.ts`

Verificare:
- Il runtime è tracciato nel node status
- Il runtime è presente nei board snapshot

### 4.2 — NodeInspector: dropdown runtime

**File:** `frontend/src/components/NodeInspector.tsx`

Aggiungere:
- Dropdown per selezionare `runtime` ("pi" / "hermes") quando si modifica un nodo
- Mostrare il dropdown solo se `PINODES_ORCHESTRA_HERMES` è abilitato (o sempre, con "pi" come default)
- Campi di configurazione runtime-specifici (es. URL gateway per Hermes)

### 4.3 — AgentNode: badge runtime

**File:** `frontend/src/components/AgentNode.tsx`

Aggiungere:
- Piccolo badge/icona accanto al nome del nodo che indica il runtime
- Label "Restart pi…" → "Restart {runtime}…" dinamico

### 4.4 — TerminalPanel: label dinamica

**File:** `frontend/src/components/TerminalPanel.tsx`

- Header: label "pi" → "{runtime}" basato sul nodo selezionato
- Messaggio "pi session ended" → "{runtime} session ended"

### 4.5 — NodeTerminal: overlay dinamico

**File:** `frontend/src/components/NodeTerminal.tsx`

- "starting pi…" → "starting {runtime}…" basato sul `data.runtime` del nodo

### 4.6 — Validazione

```bash
npm test --workspaces --if-present
npx tsc --noEmit -p frontend
```

**Gate:** Tutti i test passano. La UI mostra il runtime solo se il campo è presente nel grafo.

---

## Fase 5 — Test End-to-End e Integrazione

**Obiettivo:** Verificare che l'intero sistema funzioni con grafi misti.
**Rischio:** 🟡 Medio
**Tempo stimato:** 3-5 giorni
**Dipendenze:** Fasi 2, 3, 4 completate

### 5.1 — Test E2E: grafo misto pi + hermes

Scenario di test:
1. Creare un board con 2 nodi: Architect (pi) e Developer (hermes)
2. Collegarli con un edge (Architect → Developer)
3. Avviare un task sull'Architect
4. Verificare che l'Architect (pi) funzioni come oggi
5. Verificare che l'Architect handoff al Developer (hermes)
6. Verificare che il Developer (hermes) riceva il task e lavori
7. Verificare che il Developer possa chiudere con @@DONE

### 5.2 — Test E2E: fallback graceful

Scenario:
1. Nodo Hermes con `hermes dashboard` NON attivo
2. Verificare che il nodo entra in stato `error` con messaggio chiaro
3. Verificare che gli altri nodi (pi) continuano a funzionare

### 5.3 — Test E2E: restart e kill

Scenario:
1. Nodo Hermes in running → restart → verificare nuova sessione
2. Nodo Hermes in running → stop → verificare cleanup
3. Board stop → verificare che tutti i nodi (pi e hermes) vengono fermati

### 5.4 — Test regression: pi-only (nessuna regressione)

Scenario:
1. Creare un board con solo nodi pi (come oggi)
2. Eseguire un flow completo con handoff
3. Verificare che tutto funziona esattamente come prima

### 5.5 — Validazione finale

```bash
npm test --workspaces --if-present
npx tsc --noEmit -p backend
npx tsc --noEmit -p frontend
npm run build
```

**Gate:** Tutti i test passano. Il build produce un artefatto funzionante. Nessuna regressione su nodi pi.

---

## Fase 6 — Abilitazione e Documentazione

**Obiettivo:** Rendere il runtime Hermes disponibile agli utenti.
**Rischio:** 🟢 Basso
**Tempo stimato:** 2-3 giorni
**Dipendenze:** Fase 5 completata

### 6.1 — Rimuovere il feature flag (o renderlo opt-in nella UI)

- Opzione A: Mantenere `PINODES_ORCHESTRA_HERMES` come env var, documentare nel README
- Opzione B: Aggiungere un toggle nella UI (Settings)
- Raccomandazione: Opzione A inizialmente, B in un secondo momento

### 6.2 — Aggiornare la documentazione

- `README.md`: aggiungere sezione "Hermes runtime nodes"
- `ARCHITECTURE.md`: aggiornare la sezione "Runtime types" (Hermes da 🔜 a ✅)
- `docs/HERMES_DESKTOP.md`: aggiornare le fasi H1/H2/H3
- `docs/PROGRAMMATIC_API.md`: aggiornare la sezione "node runtime field"
- `EXTENSIONS_ROADMAP.md`: aggiornare la roadmap

### 6.3 — Validazione

```bash
npm test --workspaces --if-present
npm run build
```

---

## Riepilogo Temporale

| Fase | Descrizione | Tempo | Rischio |
|------|------------|-------|---------|
| **0** | Data model (types, DB, API) | 2-3 gg | 🟢 Basso |
| **1** | Test di protezione per PtyHub | 2-3 gg | 🟢 Basso |
| **2** | Estrazione INodeRuntime + PiRuntime | 1 sett | 🟡 Medio |
| **3** | HermesRuntime + handoff + ready | 1-2 sett | 🟡 Medio |
| **4** | Frontend: selector, badge, label | 3-5 gg | 🟢 Basso |
| **5** | Test E2E e regression | 3-5 gg | 🟡 Medio |
| **6** | Abilitazione e docs | 2-3 gg | 🟢 Basso |
| **Totale** | | **~4-6 settimane** | **🟡 Medio** |

---

## Checklist di Sicurezza (per ogni fase)

- [ ] Tutti i test esistenti passano (`npm test --workspaces --if-present`)
- [ ] Typecheck backend passa (`npx tsc --noEmit -p backend`)
- [ ] Typecheck frontend passa (`npx tsc --noEmit -p frontend`)
- [ ] Build produce artefatto (`npm run build`)
- [ ] Nessun cambio di comportamento osservabile (per fasi 0-2)
- [ ] Feature flag spento = comportamento identico a oggi (per fasi 3-5)
- [ ] Commit piccolo e revertibile
- [ ] Ogni sotto-fase ha i propri test PRIMA dell'implementazione

---

## Rischi e Mitigazioni

| Rischio | Probabilità | Impatto | Mitigazione |
|---------|-------------|---------|-------------|
| Refactoring PtyHub rompe pi | Media | Alto | Fase 1: test di protezione PRIMA del refactoring. Fase 2: spostare codice, non riscriverlo |
| API Hermes TUI gateway instabile | Media | Medio | Feature flag: Hermes è opzionale, pi funziona sempre |
| Hermes non attivo → nodi bloccati | Alta | Basso | Fallback graceful con messaggio errore chiaro |
| Complessità operativa (due runtime) | Bassa | Medio | Documentazione chiara, setup separato per ogni runtime |
| Performance: doppio runtime | Bassa | Basso | Ogni runtime è indipendente, nessuna contention |

---

## Cosa NON Fare

1. **Non riscrivere PtyHub da zero** — spostare codice, non riscriverlo
2. **Non rimuovere call-agent.ts** — resta per i nodi pi, Hermes ha il suo meccanismo
3. **Non cambiare il protocollo @@HANDOFF** — è universale e funziona già
4. **Non cambiare la WebSocket protocol** — i messaggi esistenti sono invariati
5. **Non abilitare Hermes per default** — feature flag spento fino a maturità
6. **Non implementare tutto in un colpo solo** — fasi incrementali, ognuna revertibile
