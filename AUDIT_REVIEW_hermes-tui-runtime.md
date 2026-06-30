# Audit Review — `feat/multi-runtime` vs `main`

> **Data originale:** 2026-06-29 (branch `feat/hermes-tui-runtime`)
> **Aggiornato:** 2026-07-01 (merge in `feat/multi-runtime`, commit `eb7d17d`)
> **Scopo:** Rendere PtyHub runtime-agnostic, aggiungendo il supporto a `hermes --tui` come alternativa a `pi` per i nodi della orchestra.
> **Verifica pipeline:** Typecheck backend ✅ · Typecheck frontend ✅ · 205 test (167 backend + 39 frontend) ✅ · Build ✅

---

## Tabella riassuntiva

| # | Issue | Severità | File | Stato |
|---|-------|----------|------|-------|
| 1 | `runtimeConfig` mai usato dai runtime | 🟠 Alta | `HermesRuntime.ts`, `PiRuntime.ts` | Ancora aperto — Da implementare o rimuovere |
| 2 | Plugin non auto-installato | 🟠 Alta | `HermesRuntime.ts`, docs | **Mitigato** — `setup-hermes-plugin.sh` aggiunto |
| 3 | HTTP senza timeout nel plugin | 🟡 Media | `__init__.py` | Ancora aperto |
| 4 | `onReady` dead code | 🟡 Bassa | `INodeRuntime.ts` | **Risolto** — rimosso in `4e478d7` |
| 5 | Test watchdog tautologici | 🟡 Media | `PtyHub.test.ts` | Ancora aperto |
| 6 | `pre_llm_call` context → user msg vs system prompt | 🟡 Bassa | `__init__.py` | Ancora aperto — da documentare |
| 7 | `ctx` shadowed | 🟢 Trivia | `__init__.py` | **Risolto** — `orchestra_ctx` in `eb7d17d` |

---

## Scoreboard

| Dimensione | Score | Note |
|-----------|-------|------|
| **Architettura** | 9/10 | Refactor clean, separazione ottima, pattern Strategy corretto |
| **Code Quality** | 8/10 | Codice solido, dead code rimosso, 1 bug fix applicato |
| **Testing** | 8.5/10 | Coverage eccellente, ma test con assert deboli su un path critico |
| **Security** | 7/10 | `runtimeConfig` non sanitizzato, plugin Python senza timeout HTTP |
| **Doc↔Code Coherence** | 8.5/10 | Docs aggiornate, setup script aggiunto, gap residuo su runtimeConfig |

**Overall: 8.5/10** — Refactoring strutturalmente eccellente, 3 issue aperte (1 alta, 2 medie) ma nessuna bloccante per test manuale.

---

## Architettura del branch

Il branch introduce un refactor strutturale in 6 fasi (Phase 0-6):

| Fase | Commit | Contenuto |
|------|--------|-----------|
| 0 | `15abfc7` | Data model: `NodeRuntime` type + `runtime`/`runtimeConfig` su `WorkflowNode` |
| 1 | `45bb2f9` | Protection tests per PtyHub (409 nuove righe di test **prima** del refactor) |
| 2 | `dbea545` | Extract: `INodeRuntime` interface + `PiRuntime` estratti da PtyHub |
| 3 | `053e260` | `HermesRuntime` + `PtyRuntime` base class + feature flag |
| 4 | `2e4790b` | Plugin Hermes `orchestra` + endpoint `/internal/turn-ended` + UI runtime |
| 5-6 | `00eda72` | E2E tests + docs update |
| cleanup | `4e478d7` | Drop dead `onReady` hook, unused imports, align docs |
| prep | `eb7d17d` | Smoke test, setup script, checklist, review fix (ctx shadowing) |

### Flusso architetturale

```
┌─────────────────────┐     WebSocket      ┌──────────────────────┐
│   Frontend (React)  │ ◄────────────────► │   Backend (Fastify)  │
│   xterm.js + React  │                    │   /api/v1/orchestra  │
│   Flow + Kanban     │                    │   /internal/*        │
└─────────────────────┘                    └────────┬─────────────┘
                                                    │
                                          ┌─────────┴─────────┐
                                          │     PtyHub         │
                                          │  (runtime-agnostic)│
                                          └────────┬───────────┘
                                                   │
                              ┌────────────────────┼────────────────────┐
                              │                    │                    │
                     ┌────────┴────────┐  ┌───────┴────────┐         ...
                     │   PiRuntime     │  │ HermesRuntime  │
                     │  (pi CLI + PTY) │  │(hermes --tui    │
                     │  + call-agent   │  │  + PTY + plugin)│
                     └─────────────────┘  └────────────────┘
```

### Struttura dei file introdotti

```
backend/src/pty/runtime/
├── INodeRuntime.ts       # Interfaccia: spawn, write, inject, resize, kill, markReady, isRunning, isReady, size
├── PtyRuntime.ts         # Base class astratta con logica PTY comune
├── PiRuntime.ts          # Concreto: spawn pi CLI con --tools, --system-prompt, --extension
├── HermesRuntime.ts      # Concreto: spawn hermes --tui con --toolsets, HERMES_EPHEMERAL_SYSTEM_PROMPT
├── findInPath.ts         # Utility: cerca eseguibile in PATH (estratta da PtyHub)
├── PiRuntime.test.ts     # 335 righe, 14 test
└── HermesRuntime.test.ts # 265 righe, 12 test

backend/hermes-plugins/orchestra/
├── __init__.py           # Plugin Hermes: hook lifecycle + tool handoff/card
└── plugin.yaml           # Manifest con requires_env

scripts/
├── smoke.mjs             # Sanity check REST API (1 comando)
└── setup-hermes-plugin.sh # Symlink idempotente plugin → ~/.hermes/plugins/

docs/
└── PRE_MERGE_TEST_CHECKLIST.md  # Checklist manuale con risultati attesi
```

---

## Punti di forza (con evidenza)

### 1. Refactor Strategy pattern con metodologia TDD

Le protection tests (Phase 1) sono state scritte **prima** del refactor (Phase 2), seguendo il pattern "characterization tests" classico. Il diff di `PtyHub.ts` mostra una rimozione pulita di ~200 righe di logica pi-specifica spostata in `PiRuntime`/`PtyRuntime`.

### 2. Backward compatibility perfetta

`runtime` è opzionale su `WorkflowNode`, assente = `"pi"`. Nessuna migrazione DB richiesta — il campo è opzionale nel JSON serializzato.

### 3. Feature flag valutato a spawn-time

`PINODES_ORCHESTRA_HERMES === "true"` è letto in `PtyHub.spawn()`, non a module-load. I test lo toggleano in `beforeEach`/`afterEach` e funzionano.

### 4. Ring-buffer scrollback O(1)

Il buffer usa `chunks: string[]` con `shift()` e `slice()` parziale — O(1) per chunk anziché O(n) per la concat+slice legacy. Test oracle verifica che il risultato è identico alla versione naive sotto carico pesante (500+ chunk).

---

## Problemi ancora aperti

### 🟠 1. `runtimeConfig` è accettato, passato a `spawn()`, ma mai usato

Il campo è definito, persistito, testato in CRUD, passato al runtime... ma **nessun runtime lo legge**. Il toolset è hardcodato `"read,bash,edit,write,grep"` in entrambi i runtime. L'utente può impostare `runtimeConfig: { toolsets: "read,bash" }` ma verrà ignorato.

**Fix consigliato:** Implementare la lettura di `runtimeConfig` in `HermesRuntime.spawn()` oppure rimuovere il campo dai tipi e aggiungerlo in un PR separato.

### 🟡 2. Plugin Python: HTTP senza timeout, errori silenziosi

`urllib.request.urlopen` **senza timeout** — se il backend Orchestra si blocca, la chiamata HTTP del plugin **blocca indefinitamente** il turno dell'agente Hermes. Tutti gli errori sono `except Exception: pass` senza log.

**Fix consigliato:** Aggiungere `timeout=5` a tutte le `urllib.request.urlopen` e sostituire `pass` con `logging.warning`.

### 🟡 3. Test watchdog non testano realmente il watchdog

Il test "non-final hermes node gets nudged" chiama `injectTask` direttamente — non chiama `/internal/turn-ended` e non verifica il contatore retry. Il test "final node not nudged" è una tautologia (non può fallire).

**Fix consigliato:** Riscrivere usando `app.inject({ method: "POST", url: "/internal/turn-ended" })`.

### 🟡 4. `pre_llm_call` appende context al user message, non al system prompt

Differenza semantica da pi (che refresha il system prompt). Funzionalmente va, ma potrebbe confondere il modello.

**Fix consigliato:** Documentare la differenza nel README.

---

## Verdetto

Il refactor architetturale è di alta qualità — TDD metodologico, backward compat perfetta, pattern Strategy pulito, ring-buffer O(1). Le 3 issue aperte (runtimeConfig, timeout HTTP, test watchdog) sono reali ma non bloccanti per il test manuale di domani. La struttura c'è tutta, l'implementazione dell'ultimo miglio (runtimeConfig) va completata in un PR dedicato.
