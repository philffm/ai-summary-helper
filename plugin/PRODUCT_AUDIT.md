# AISH Produkt-Audit (2026-10-09)

Stand: v2.1.22, `main` @ 1c96a29. Ergänzt `plugin/PROJECT_AUDIT.md` (Code-Struktur) und `plugin/STYLE_AUDIT.md` (CSS). Dieser Audit schaut auf Produkt, UX, Vertrauen, Wachstum und Betrieb. Gemessen wurde am Code, nicht an Nutzerdaten, es gibt also keine Aussagen zu Conversion oder Retention.

## 0. Umsetzungsstand (2026-10-09)

Erledigt in diesem Branch: #35 (Tests grün, 33 Strings in 13 Sprachen übersetzt), #36 (Datenschutztext: eine Quelle `site-src/pages/privacy.html`, `privacy.md` und `plugin/src/privacy.md` werden generiert und per `test93` geprüft), #37 (Kindle läuft über den byPhil-Proxy, LocalSend und Share-Sheet sind direkt; README und Datenschutzseite beschreiben jetzt dasselbe), #38 (`LICENSE`, MIT), #43 (`ci.yml` auf Pull Requests und `main`), #44 (README-Abweichungen, `npm run build`-Skripte ergänzt). Alles andere ist offen.

## 1. Kurzfazit

AISH ist für ein Ein-Personen-Projekt ungewöhnlich ausgereift: Eine Browser-Extension (Chrome, Firefox, Android, Safari) plus Bookmarklet, ein Feature-Set weit über „Seite zusammenfassen“ hinaus (RSS, Archiv, Graph, Highlights, Podcast, Kindle/LocalSend), eine echte Testsuite (92 jsdom-Tests, 2 E2E), ESLint ohne Befunde, 13 Sprachen und eine konsequente Privacy-Haltung (Bring-your-own-key, lokale Daten).

Die größten Hebel liegen nicht in neuen Features, sondern in:
1. **Vertrauen und Konsistenz** (veraltete Datenschutztexte, die dem Produkt widersprechen).
2. **Erster Eindruck** (Login-Zwang als erste Karte, sehr breite Berechtigungen).
3. **Fokus** (Feature-Breite wächst schneller als Wartbarkeit und Auffindbarkeit).

## 2. Was ist gut

| Bereich | Beleg |
|---|---|
| Datenschutz als Produktprinzip | Keys lokal, kein eigener Server im BYOK/Ollama-Pfad, Seite ohne Cookies, selbst gehostetes Matomo (`site-src/pages/privacy.html`) |
| Provider-Vielfalt | OpenAI, Gemini, Mistral, DeepSeek, Ollama inkl. Erkennung installierter Modelle, byPhil Cloud ohne Key |
| Architektur | MV3, vanilla ES-Module ohne Framework, `loader.js` (~6 KB) injiziert das große Content-Script nur bei Bedarf, zentraler `StorageManager`, gespeicherte Keys in `storageKeys.js` |
| Sicherheit nachgezogen | Sidebar-`postMessage` mit Token, Background-Aktionen verweigern Content-Scripts, `escapeHtml`/`cleanUntrustedHtml`, kein `eval` mehr (AMO-tauglich) |
| Qualitätsnetz | 92 Tests, Lint und Tests laufen im Release-Workflow vor dem Paketieren, Release serialisiert (`concurrency`) |
| i18n | Englisch ist der Key, 13 Locales, Script `feed-i18n.mjs check`, automatische Website-Übersetzung per CI |
| UX-Details | Hintergrund-Queue (eine Zusammenfassung zugleich), Folgefragen mit Kurzantwort, Side-Panel Attach/Detach, Long-Press-Auswahl, Fehlerlinks in die Einstellungen |
| Plattformbreite | Chrome, Edge, Firefox, Android, Safari/iOS und Bookmarklet für alles andere |
| Dokumentation | README mit Architekturdiagramm, Speichertabelle, Sicherheits- und Test-Abschnitt; bestehende Audits mit Stand-Abschnitt |

## 3. Was ist schlecht / riskant

Gewichtung: **H** hoch, **M** mittel, **N** niedrig.

| # | Befund | Gewicht | Beleg |
|---|---|---|---|
| 1 | **Datenschutztext im Paket ist veraltet und widerspricht dem Produkt.** `plugin/src/privacy.md` nennt nur OpenAI, „GPT-3.5“, behauptet Matomo-Analytics in der Extension (im Extension-Code gibt es keine Matomo-Aufrufe), enthält den Platzhalter `[Your Contact Email]` und kennt weder byPhil Cloud noch Ollama, Feeds-AI oder Kindle. `privacy.md` im Root weicht davon ebenfalls ab. Die Website-Version ist dagegen aktuell. Store-Review und Nutzervertrauen hängen daran. | H | `plugin/src/privacy.md`, `privacy.md` |
| 2 | **Widerspruch Kindle-Versand.** README: „Send to Kindle (byPhil Cloud proxy)“ und Free-Tier mit 3 Sends. Website-Privacy: „sent directly from your browser … we do not act as an intermediary and do not see or store this content“. Eine der beiden Aussagen stimmt nicht. | H | `readme.md`, `site-src/pages/privacy.html` |
| 3 | **Sehr breite Berechtigungen.** `<all_urls>` + `file:///*` als Host-Permission **und** als Content-Script-Match, dazu `tabs`, `unlimitedStorage`. Für ein Tool, das nur auf Klick arbeitet, ist `activeTab` + optionale Hosts glaubwürdiger. Das Content-Script `loader.js` läuft auf jeder Seite. Erzeugt Install-Warnung („Alle Daten auf allen Websites lesen“) und Review-Reibung. | H | `plugin/platforms/chrome/manifest.json` |
| 4 | **Login-Wand als erste Karte.** Der leere Zustand zeigt „Sign in to AI Summary Helper“ (E-Mail-Code), der Weg „eigener Key“ ist ein Tertiär-Button. Für Nutzer, die Privacy suchen, wirkt das wie der falsche Einstieg. | M | `plugin/src/popup.html:30-52` |
| 5 | **Keine Lizenzdatei.** README-Badge sagt MIT, im Repo existiert kein `LICENSE`. Rechtlich unklar, blockiert Beiträge und manche Distributionen. | M | Repo-Root |
| 6 | **Keine Contributor-/Community-Infrastruktur.** Kein `CONTRIBUTING`, `SECURITY`, `CHANGELOG`, keine Issue-Templates, nur 2 offene Issues aus 2024. Bugs und Wünsche landen woanders (Mail/Store) und sind nicht nachvollziehbar. | M | `.github/` |
| 7 | **Große Module.** `feedManager.js` ~2100, `articleManager.js` ~1800, `mainScreen.js` ~1560, `settingsManager.js` ~1300 Zeilen, `styles.css` ~3700. Neue Features werden dadurch teurer und fehleranfälliger. Bereits in `PROJECT_AUDIT.md` mit Split-Plan. | M | `wc -l plugin/src` |
| 8 | **~92 `innerHTML`-Zuweisungen in 26 Dateien.** Es gibt Escape-Helfer, aber jede neue Stelle ist ein potenzieller XSS-Pfad, zumal Seiteninhalte und KI-Ausgaben verarbeitet werden. | M | `grep innerHTML` |
| 9 | **Accessibility lückenhaft.** 98 `<button>` in `popup.html`, 39 `aria-label`; Icon-Buttons (Emoji) ohne Namen; Sheets ohne bestätigte Fokusfalle/Esc; Kontrast von `--text-muted` auf Glas nie geprüft. | M | `plugin/src/popup.html` |
| 10 | **Emoji als Icons.** ⚙️ 🕸️ 📊 🗑️ rendern je nach OS verschieden (Android, Windows, Linux) und passen schlecht zu einem „Glass“-Design. | N | `popup.html` |
| 11 | **Build/Doku-Drift.** README nennt `docs/` als GitHub-Pages-Quelle und `docs/assets/main.js`, der Quellbaum ist aber `site-src/` mit `scripts/build-site.mjs`. Die Projektstruktur-Sektion der README ist teilweise veraltet. | N | `readme.md` |
| 12 | **`main` ist rot: 3 von 92 Tests schlagen fehl, und `release.yml` führt `npm test` vor dem Paketieren aus – ein Release würde heute scheitern.** Ursache sind die letzten Umbauten am Modell-Panel (byPhil Cloud / Own key / Ollama): `test55` erwartet 2 statt jetzt 3 Quellen-Buttons, `test57` erwartet den Ollama-Hinweis für andere Provider, `test60` meldet 429 fehlende Übersetzungen (Locales nicht nachgezogen). Zusätzlich dauert die Suite über 2 Minuten. | H | `npm test` |
| 13 | **`lib/` ist ~2,7 MB** (pdf.js, d3); Ladeverhalten von pdf.js ungeprüft. | N | `plugin/src/lib` |
| 14 | **Monetarisierung schwer lesbar.** „Support Pass“, „Pro License Key“, „byPhil Cloud“, „Free tier 3 Kindle sends“ sind nicht an einer Stelle erklärt; zwei Account-Konzepte (Konto + Lizenzschlüssel) im selben Panel. | N | `readme.md`, `popup.html` |

## 4. SWOT

**Stärken (intern, positiv)**
- Klares Privacy-Versprechen, das technisch gedeckt ist (BYOK, Ollama, lokale Speicherung).
- Funktionsumfang: Zusammenfassen + Fragen + Highlights + RSS + Archiv + Versand in einem Werkzeug.
- Plattformabdeckung inkl. iOS-Bookmarklet.
- Gute Engineering-Basis: Tests, Lint, CI-Release, i18n-Tooling, vorhandene Audits.
- Eigene Marketing-Site mit Blog (9 Seiten), SEO-Skript, mehrsprachig.

**Schwächen (intern, negativ)**
- Ein-Personen-Betrieb: Bus-Faktor 1, Support und Releases hängen an einer Person.
- Veraltete/widersprüchliche rechtliche Texte (Befunde 1, 2, 5).
- Breite Berechtigungen und Pflicht-Login im Onboarding.
- Monolithische Module, hoher `innerHTML`-Anteil, A11y-Lücken.
- Keine sichtbare Messung von Aktivierung (erste Zusammenfassung) – bewusst privacy-freundlich, aber man fliegt blind.

**Chancen (extern, positiv)**
- „Pocket-Alternative“-Welle (Blogartikel existiert): Nutzer suchen Read-it-later mit Datenhoheit.
- Lokale Modelle (Ollama, Browser-/On-Device-Modelle) werden alltagstauglich; AISH ist dafür bereits vorbereitet (`on-device-architecture`-Blogpost).
- Wunsch nach verifizierbaren KI-Zusammenfassungen (Zitate mit Sprung zur Textstelle ist schon da, Blogartikel `verify-ai-summary`).
- Kindle/E-Reader-Workflow und Podcast als Differenzierung gegenüber reinen Summarizern.
- Store-Verteilung für Firefox/Edge/Safari ausbaubar, Android (Firefox/Kiwi) als unterversorgter Markt.

**Risiken (extern, negativ)**
- Browser-Anbieter integrieren Zusammenfassungen nativ (Chrome/Edge/Safari/Arc); der Basisnutzen wird zur Commodity.
- Store-Policies: `<all_urls>`, `tabs`, Remote-Code-/Datenschutz-Prüfung; veraltete Privacy-Texte können zu Ablehnung führen.
- Abhängigkeit von Drittanbieter-APIs (Preise, Modelle, Rate-Limits); byPhil Cloud trägt Kosten und Missbrauchsrisiko (Free-Tier).
- Prompt-Injection über Webseiten und Feeds (Inhalte gehen ungefiltert in Prompts; Ausgaben werden als HTML dargestellt).
- MV3-Änderungen (Service-Worker-Lebensdauer, Offscreen-Dokumente) betreffen Streaming, Audio und Feed-Polling.

## 5. Hoher Impact / geringer Aufwand (Quick Wins)

Sortiert nach Verhältnis Nutzen zu Aufwand. Aufwand grob: XS < 1 h, S ≈ halber Tag, M ≈ 1–3 Tage.

| Prio | Maßnahme | Impact | Aufwand | Ticket |
|---|---|---|---|---|
| 1 | Datenschutztexte vereinheitlichen: eine Quelle, Platzhalter weg, byPhil Cloud/Ollama/Feeds/Kindle korrekt, Matomo-Aussage prüfen | Vertrauen, Store-Review | S | #36 |
| 2 | Kindle-Versand klären (Proxy ja/nein) und README/Privacy angleichen | Vertrauen, Rechtliches | XS | #37 |
| 3 | `LICENSE` (MIT) ergänzen | Rechtssicherheit, Beiträge | XS | #38 |
| 4 | Issue-Templates, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md` | Support-Last sinkt, Qualität der Meldungen | S | #39 |
| 5 | Onboarding: „Eigener Key / Ollama / Cloud“ als gleichwertige Wahl, erste Zusammenfassung in < 60 s | Aktivierung | S–M | #40 |
| 6 | Accessibility-Quick-Pass: `aria-label` für alle Icon-Buttons, Esc/Fokusfalle in Sheets, Kontrast-Check der Tokens | Barrierefreiheit, Store-Qualität | S | #41 |
| 7 | README-Drift beheben (`docs/` vs `site-src/`, Strukturbaum) | Onboarding für Contributor | XS | #44 |
| 8 | i18n-Check und Tests als PR-Workflow (heute nur im Release-Workflow) | Regressionen früher sehen | XS | #43 |
| 9 | Berechtigungen reduzieren: `activeTab` + optionale Host-Permissions, `loader.js` nur dort, wo Highlights existieren | Installationsrate, Review | M | #42 |
| 0 | **`main` grün machen:** `test55`, `test57` an das neue Drei-Quellen-Modell-Panel anpassen, 429 fehlende Übersetzungen ergänzen (`feed-i18n.mjs extract/merge`), danach Testlaufzeit senken | Release blockiert | S | #35 |

## 6. UX-Review

Positiv: klare Navigation (Summarize / Feeds / History / Settings), Settings nach Aufgaben gruppiert und durchsuchbar, Eingabeoptionen als Chip-Panels, Fehler mit Direktlink in die Einstellungen, Side-Panel-Wechsel mit einem Klick, Long-Press-Mehrfachauswahl.

Verbesserbar:

| Bereich | Beobachtung | Empfehlung |
|---|---|---|
| Erststart | Login-Karte vor der Wertdemonstration; „eigener Key“ nur als Textlink | Drei gleichrangige Karten: *Cloud (kostenlos testen)*, *Eigener Key*, *Lokal (Ollama)*; vor dem Login ein „Diese Seite jetzt zusammenfassen“ ermöglichen, wenn möglich |
| Leerer Zustand | „No recent summaries – Summarize a page to see it here“ | Konkreter CTA-Button „Aktuelle Seite zusammenfassen“, Hinweis auf Shortcut `Ctrl/⌘+Shift+E` |
| Entdeckbarkeit | Viele Kernfunktionen (Ghost-Highlights, Graph, Analytics, Podcast, LocalSend) stecken in Menüs oder Einstellungen | Kurze, überspringbare Tour (3–4 Schritte) und „Neu“-Marker nach Updates; Changelog im Popup |
| Settings | 10 Bereiche, „Models & API“ und „Account & Plan“ überschneiden sich (Kontext: Cloud vs. eigener Key) | Klare Sprache: „Welche KI antwortet?“ als einzelne Entscheidung mit drei Tabs (bereits in Arbeit: byPhil Cloud / Own key / Ollama) – nach dem Umbau Account-Panel auf Konto + Lizenz reduzieren |
| Icons | Emoji-Icons wirken uneinheitlich | Einheitliches SVG-Set (Lucide/Phosphor, MIT) |
| Responsiveness | Nur 3 Media-Queries; Placeholder in History bei ~520 px abgeschnitten | Breakpoints für Side-Panel-Breite (320–480 px) und Bookmarklet-Ansicht testen |
| Feedback | Hintergrund-Queue ist stark, Fortschritt aber nur im Popup sichtbar | Badge-Text am Toolbar-Icon („…“/Anzahl) und Benachrichtigung bei Fertigstellung |
| Fehlertexte | Ollama-Fehler werden per Regex erkannt (`/HTTP (403|404|0)/`), Kategorien anderer Provider weniger klar | Einheitliche Fehlerklassen (Key, Quota, Netz, Modell, Inhalt zu lang) mit je einer Handlungsanweisung |
| Lange Artikel | Kein sichtbarer Hinweis, wenn Text für das Modell gekürzt wird | Hinweis „Artikel gekürzt auf X Wörter“ und Option „in Abschnitten zusammenfassen“ |
| Accessibility | siehe Befund 9 | Fokusführung, Tastatur-Tabs, Kontrast |

## 7. User Stories

Format: *Als … möchte ich …, damit …* mit Akzeptanzkriterien. Priorität: **Must / Should / Could**.

### Onboarding & Vertrauen
1. **(Must)** Als neuer Nutzer möchte ich ohne Konto mit meinem eigenen API-Key starten, damit ich meine Daten nicht an AISH gebe.
   - Der Startbildschirm bietet Cloud, eigener Key und Ollama gleichwertig an.
   - Nach Key-Eingabe ist die erste Zusammenfassung in höchstens drei Klicks möglich.
2. **(Must)** Als datenschutzbewusster Nutzer möchte ich in der Extension selbst sehen, welche Daten an wen gehen, damit ich informiert zustimme.
   - Einstellungen › About zeigt pro Modus („Cloud“, „Eigener Key“, „Ollama“) in einem Satz, wohin Seitentext geht.
   - Datenschutztext im Paket entspricht dem der Website.
3. **(Should)** Als Nutzer möchte ich weniger Berechtigungen vergeben, damit die Installationswarnung nicht abschreckt.

### Zusammenfassen & Fragen
4. **(Must)** Als Leser möchte ich bei langen Artikeln sehen, ob der Text gekürzt wurde, damit ich der Zusammenfassung richtig vertrauen kann.
5. **(Should)** Als Leser möchte ich eine Zusammenfassung abbrechen und mit anderem Modell/Länge wiederholen, ohne die Seite neu zu laden.
6. **(Could)** Als Forscher möchte ich eine Zusammenfassung in Abschnitten (Kapitel für Kapitel) erhalten, damit lange Papers/PDFs nicht an Kontextgrenzen scheitern.
7. **(Should)** Als Nutzer von Paywall-/Login-Seiten möchte ich markierten Text oder Auswahl zusammenfassen, damit auch dort etwas funktioniert.

### Highlights & Archiv
8. **(Should)** Als Nutzer möchte ich am Monatsende eine Rückschau meiner gelesenen Artikel sehen (Offenes Issue #1), damit ich weiß, was ich gelernt habe.
   - Monatsbericht mit Themen, Artikelanzahl, Top-Quellen, Auswahl der markierten Zitate; als Markdown/PDF exportierbar.
9. **(Should)** Als Nutzer möchte ich mein Archiv als offenes Format (Markdown/JSON/OPML/Obsidian) exportieren, damit ich nicht eingesperrt bin.
10. **(Could)** Als Nutzer möchte ich Tags automatisch vorgeschlagen und gemerged bekommen, damit das Archiv sauber bleibt.

### Feeds
11. **(Should)** Als Nutzer möchte ich pro Feed Regeln (Stichworte ausblenden, automatisch zusammenfassen), damit mein Feed leise und relevant ist.
12. **(Could)** Als Nutzer möchte ich eine tägliche Zusammenfassung als Benachrichtigung zu fester Uhrzeit, damit ich nichts verpasse, ohne die App zu öffnen.

### Versand & Audio
13. **(Must)** Als Kindle-Nutzer möchte ich wissen, über welchen Weg mein Text geht (direkt oder Proxy) und was das kostet, damit ich entscheiden kann.
14. **(Could)** Als Pendler möchte ich aus gespeicherten Artikeln einen Audio-Podcast erzeugen (Offenes Issue #2; Grundlage existiert in `podcastManager.js`), damit ich unterwegs „lese“.

### Qualität & Barrierefreiheit
15. **(Must)** Als Screenreader-Nutzer möchte ich jede Schaltfläche mit Namen und per Tastatur bedienen können.
16. **(Should)** Als Nutzer in meiner Sprache möchte ich keine ungeübersetzten UI-Texte sehen (i18n-Check in jedem PR).

### Community & Wartung
17. **(Should)** Als Beitragender möchte ich Setup, Lizenz und Meldewege klar finden, damit ich Fehler oder Pull Requests sinnvoll einreichen kann.

## 8. Technischer Zustand (gemessen)

- Lint (`npm run lint`): 0 Befunde.
- `npm test`: 89 von 92 grün; rot sind `test55` (Modell-Panel: 3 statt 2 Quellen-Buttons), `test57` (Ollama-Hinweis für andere Provider) und `test60` (429 fehlende Übersetzungen). Laufzeit > 2 Minuten. Da `release.yml` die Tests vor dem Paketieren ausführt, ist der nächste Release blockiert (Ticket #35).
- Quellcode `plugin/src`: ~21.400 Zeilen JS, größte Dateien siehe Befund 7.
- `innerHTML =`: 92 Zuweisungen; `aria-label`: 39 bei 98 Buttons in `popup.html`.
- Lizenz-, Contributing-, Security-, Changelog-Datei: nicht vorhanden.
- Berechtigungen (Chrome): `tabs, activeTab, sidePanel, scripting, storage, contextMenus, notifications, alarms, offscreen, tts, unlimitedStorage` + `<all_urls>`, `file:///*`.

## 9. Empfohlene Reihenfolge

1. **Sofort:** #35 (`main` ist rot, Release würde scheitern).
2. **Diese Woche (Vertrauen & Hygiene):** #36, #37, #38, #44.
3. **Nächste 2 Wochen (Aktivierung & Qualität):** #40, #41, #43, #39.
4. **Danach (Reichweite & Wartbarkeit):** #42, dann die Refactoring-Tickets aus `PROJECT_AUDIT.md` (Modul-Splits, CSS-Tokens), parallel die Story-Tickets (Monatsrückblick #1, Export, Podcast #2).
5. **Beobachten:** Berechtigungsreduktion (#42) zuerst auf Firefox testen, dort ist die Install-Warnung weniger kritisch, bevor Chrome-Store-Änderungen kommen.

## 10. Ticketübersicht

Alle Tickets sind als GitHub-Issues angelegt (Label `audit`).

| Issue | Thema |
|---|---|
| #35 | `main` grün machen (3 Tests, 429 fehlende Übersetzungen) |
| #36 | Datenschutztext vereinheitlichen |
| #37 | Kindle-Pfad klären (README vs. Privacy) |
| #38 | LICENSE ergänzen |
| #39 | Issue-Templates, SECURITY, CONTRIBUTING, CHANGELOG |
| #40 | Onboarding mit drei gleichrangigen Wegen |
| #41 | Accessibility-Pass |
| #42 | Berechtigungen reduzieren |
| #43 | CI auf Pull Requests (Lint, Tests, i18n) |
| #44 | README-Drift beheben |
| #45 | Kürzungshinweis und abschnittsweise Zusammenfassung |
| #46 | Export in offene Formate |
| #47 | innerHTML reduzieren und Prompt-Injection-Schutz |
| #48 | SVG-Icons statt Emoji |
| #49 | Badge und Benachrichtigung für Hintergrund-Queue |
| #50 | Große Module aufteilen |

Bestehend: #1 (Monatsrückblick, Story 8) und #2 (Podcast, Story 14).
