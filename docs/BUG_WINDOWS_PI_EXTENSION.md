# Bug: su Windows i nodi non si parlano (estensione `call-agent.ts` non caricata)

**Stato:** diagnosi confermata, fix proposta (non ancora applicata).
**Piattaforme:** ❌ Windows · ✅ Linux · (macOS da verificare, stesso meccanismo del lancio shim).
**Versione in cui è emerso:** 0.2.14 (ma la causa è indipendente dalla 0.2.14 — vedi sotto).

---

## Sintomo

Su Windows il flow parte, `pi` si avvia in ogni nodo, la UI funziona, ma **i nodi non si
parlano**: niente handoff, niente `@@CARD`, e se chiedi a un agente *"vedi altri nodi
collegati a te?"* risponde di **no**. Stesso modello, stesso provider: **su Linux capisce
subito, su Windows mai**. Riprodotto su **due** PC Windows distinti (quindi non è ambiente
né residui di installazioni vecchie).

## Cosa è stato escluso (con prove)

| Ipotesi | Esito | Prova |
|--------|-------|-------|
| Token / auth | ❌ escluso | front↔back funziona; nei log nessun 401 |
| Rete / IPv6 `localhost` vs `127.0.0.1` | ❌ escluso | su Windows `node -e "fetch('http://localhost:3847/api/health')"` → **200**, idem `127.0.0.1` |
| Conflitto di porte / due istanze | ❌ escluso | un solo backend 0.2.14 in ascolto (pid corretto) |
| Versione di `pi` diversa | ❌ escluso | `pi 0.79.8` su entrambi |
| Residui di installazioni vecchie | ❌ escluso | riprodotto su un secondo PC Windows pulito |

## Prova decisiva

Nei log del backend su Windows, durante un'intera sessione, arrivano **solo** queste
richieste:

```
/api/health · / · /assets/*.js · /assets/*.css · /ws · /api/prompts
```

**Zero richieste `/internal/*`.** Se l'estensione `call-agent.ts` girasse, al boot di ogni
nodo vedremmo almeno:

- `/internal/ready` (hook `session_start`)
- `/internal/orchestra-context` (hook `before_agent_start`)

Non c'è nulla → **gli hook dell'estensione non vengono mai eseguiti** → `pi` sta girando
**senza** l'estensione di orchestrazione. Nessun errore visibile perché in
`backend/pi-extensions/call-agent.ts` ogni chiamata HTTP è dentro un `try/catch` che ingoia
gli errori (`postWithRetry` → `catch {}`, `fetchCtx` → `catch → null`).

---

## Causa radice (due parti che si rinforzano)

### 1. L'argomento `--extension` non arriva a `pi` (lancio via `cmd.exe`)

`PtyHub.resolvePiCommand()` (`backend/src/pty/PtyHub.ts`) cerca prima un `cli.js` bundlato e,
se non lo trova, ripiega sul binario in PATH. Su Windows quel binario è lo **shim batch
`pi.cmd`**:

```
Found pi CLI: C:\Program Files\nodejs\pi.cmd
spawning pi  C:\Program Files\nodejs\pi.cmd  [ ..., '--system-prompt', '<enorme, multilinea>', '--extension', 'C:\\...\\call-agent.ts' ]
```

Per eseguire un `.cmd`, **node-pty deve passare da `cmd.exe`** (`cmd /c pi.cmd …`). Subito
prima di `--extension` c'è `--system-prompt`, che è una stringa enorme, **multilinea
(piena di `\r\n`)** e con metacaratteri (`"`, `` ` ``, `()`, `[]`). `cmd.exe` interpreta il
primo `\r\n` come **fine comando**: tronca la riga e **perde tutto ciò che segue**, cioè
proprio `--extension …call-agent.ts`. `pi` parte come sessione normale, senza estensione,
senza errori.

Su **Linux** `pi` (o `node cli.js`) viene eseguito **direttamente**, senza shell: node-pty
fa `exec` con un array di argomenti **verbatim**, quindi il prompt multilinea resta un
singolo argomento e `--extension` arriva intatto. Per questo su Linux funziona.

> È un bug **indipendente dalla 0.2.14**: si attiva con qualunque versione che lanci `pi`
> via `pi.cmd` su Windows con un `--system-prompt` lungo/multilinea (i prompt custom
> Architect/Developer lo sono).

### 2. Il fallback "bake appendix" viene saltato

`PtyHub.spawn()` decide se incorporare l'appendice di orchestrazione (elenco dei colleghi,
regola di finalità, kanban) direttamente nel system prompt così:

```ts
// PtyHub.ts (~378)
const hasExtension = fs.existsSync(EXTENSION_PATH);
const systemPrompt = (hasExtension ? rolePrompt : rolePrompt + appendix).trim();
```

Il file `call-agent.ts` **esiste** nel pacchetto → `hasExtension = true` → l'appendice **non**
viene incorporata, dando per scontato che la inietti l'estensione a runtime
(`before_agent_start`). Ma su Windows l'estensione non parte (parte 1) → l'appendice **non**
arriva né bakata né a runtime → **l'agente resta a zero informazioni sui colleghi**. È
esattamente il "non vede gli altri nodi".

`hasExtension` verifica solo l'**esistenza del file**, non che `pi` la **carichi davvero**.

---

## Fix proposta

### Fix primaria — lanciare `pi` come `node <cli.js>`, mai via shim `.cmd`

In `resolvePiCommand()`, quando si ripiega su un binario in PATH che è uno shim
`pi.cmd`/`pi.bat`, **risolvere il `cli.js` sottostante** (npm global lo mette accanto allo
shim) e lanciarlo con `node` direttamente. Così node-pty esegue `node.exe` **senza
`cmd.exe`** e gli argomenti passano verbatim — come su Linux.

```ts
const piBin = findInPath(PI_BIN_NAMES);
if (piBin) {
  // Su Windows pi è lo shim batch pi.cmd: lanciarlo costringe node-pty a passare
  // da cmd.exe, che spezza il --system-prompt multilinea e perde il --extension
  // successivo (l'estensione di orchestrazione non si carica → nodi muti).
  // Preferiamo eseguire il cli.js sottostante con node, senza shell.
  const shimDir = path.dirname(piBin);
  const cliFromShim = path.join(
    shimDir,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "cli.js",
  );
  if (fs.existsSync(cliFromShim)) {
    return { file: process.execPath, baseArgs: [cliFromShim] };
  }
  return { file: piBin, baseArgs: [] };
}
```

> Layout npm global su Windows: `C:\Program Files\nodejs\pi.cmd` e
> `C:\Program Files\nodejs\node_modules\@earendil-works\pi-coding-agent\dist\cli.js`.

### Fix secondaria (difesa in profondità)

1. **Non passare il system-prompt come argomento CLI.** Scriverlo in un file temporaneo e
   passarlo via `--system-prompt-file` (da verificare se `pi` lo supporta) o via stdin.
   Elimina alla radice ogni fragilità di quoting su Windows, anche se in futuro si tornasse
   a un lancio via shell. ⚠️ Da verificare il supporto nella CLI di `pi`.
2. **Irrobustire il fallback dell'appendice.** Se non possiamo garantire che l'estensione
   sia caricata, non saltare il bake dell'appendice (oppure bakarla sempre e far sì che
   l'estensione la sostituisca invece di assumerla assente). Diventa irrilevante una volta
   applicata la fix primaria, ma evita "silent muting" futuri.

---

## Come verificare la fix su Windows

1. **Controprova del meccanismo (a costo zero, prima ancora della patch):** nel pannello,
   metti il prompt di **un** nodo su **una riga sola e corta** (es. `You are a test agent.`),
   salva e rilancia il flow. Se i nodi tornano a parlarsi e compaiono `/internal/ready` /
   `/internal/orchestra-context` nei log → confermata la parte 1 (è il prompt multilinea via
   `cmd.exe`).
2. **Dopo la patch:** con i prompt lunghi originali, nel log del backend devono comparire
   `/internal/ready` e `/internal/orchestra-context` al boot dei nodi, e la riga
   `spawning pi …` deve mostrare **`node … cli.js`** (non più `pi.cmd`). Chiedendo a un
   agente "vedi altri nodi collegati?" deve elencarli.

## File coinvolti

- `backend/src/pty/PtyHub.ts` — `resolvePiCommand()` (fix primaria), `spawn()` / `hasExtension`
  (fix secondaria 2).
- `backend/pi-extensions/call-agent.ts` — nessuna modifica necessaria; nota che ingoia gli
  errori di rete in silenzio (utile saperlo per il debug futuro).
