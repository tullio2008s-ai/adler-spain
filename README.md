# ADLER · Costo prodotto (Tangeri / Zaragoza)

Pagina web con login (ID + password) e dati condivisi tra più utenti.

- **Questo repository contiene solo il codice.** Nessun dato aziendale, nessuna password.
- **I dati** stanno in un Google Sheet privato (Drive di Tullio), creato dallo script.
- **Il login** è verificato sul server Apps Script (password salvate come hash con salt, blocco dopo 6 tentativi errati, sessione 6 h).
- **Ruoli**: `admin` (tutto, incluso azzeramento), `editor` (modifica), `viewer` (sola lettura).
- **Più utenti insieme**: salvataggio automatico per documento (prodotto, stabilimento, materiali), aggiornamento ogni 15 s, avviso di conflitto se due persone modificano lo stesso prodotto, storico di ogni salvataggio.

## Installazione (una tantum, ~10 minuti)

### 1. Backend (Google Apps Script)
1. Aprire <https://script.google.com> con l'account Google di Tullio → **Nuovo progetto**, nome «ADLER costo prodotto».
2. Incollare tutto il contenuto di `apps-script/Code.gs` al posto del codice di esempio. Salvare.
3. Menu a tendina funzioni → **setup** → Esegui (autorizzare l'accesso a Drive/Fogli). Crea il Google Sheet privato «Costo Prodotto ADLER – ARCHIVIO PRIVATO».
4. In `utentiIniziali()` sostituire le tre password (minimo 10 caratteri, diverse tra loro) → eseguire **utentiIniziali** → **cancellare le password dal codice** e salvare.
   Per cambiare una password o aggiungere una persona: stessa procedura con `creaUtente('id','password','Nome','editor')`.
5. **Distribuisci → Nuova distribuzione → App web**: *Esegui come*: **Me**; *Chi ha accesso*: **Chiunque**. Copiare l'URL che termina in `/exec`.
   (L'URL è raggiungibile da chiunque, ma senza ID e password valide non restituisce nessun dato.)
6. Dopo ogni modifica a `Code.gs`: Distribuisci → Gestisci distribuzioni → Modifica → *Nuova versione*.

### 2. Pagina (GitHub Pages)
1. Incollare l'URL `/exec` in `config.js`: `window.ADLER_API = '…/exec';` e fare commit.
2. Repository → Settings → Pages → *Deploy from a branch* → `main` / root.
3. Aprire l'indirizzo Pages, accedere come `tullio` e usare **⬆ Carica dati** con il file `dati_iniziali_ADLER.json` (fuori dal repository, consegnato a parte): popola il database condiviso. Da quel momento Juan e Paolo vedono gli stessi dati.

## Backup e sicurezza
- Il Google Sheet ha il foglio **Storico** con chi ha salvato cosa e quando; il contenuto precedente di ogni documento è recuperabile da lì.
- Backup manuale: pulsante **⬇ Salva dati (.json)** nella barra laterale.
- Non condividere il Google Sheet con nessuno: l'accesso passa solo dalla pagina.
- Non mettere mai dati aziendali o password in questo repository (è pubblico).
