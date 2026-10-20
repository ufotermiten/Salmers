# Salmers

Hitta lediga salar på Chalmers Johanneberg – just nu eller vid en vald tid. Mobile first, helt klientbaserad (ingen backend).

- **Lediga nu** med info om när salen är bokad igen
- **Välj tid** – valfritt datum och klockslag
- **Favoriter** sparas lokalt på enheten
- **Rutt** från din plats förbi så många lediga salar som möjligt inom vald tid (trappor och utomhuspromenader kostar)
- Lektionssalar, hörsalar, datorsalar och drop-in-studieplatser

Inofficiell app, inte kopplad till Chalmers.

## Hur det fungerar

| Data                                            | Källa                                                                                         | När                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Rumskatalog (namn, typ, hus, våning)            | TimeEdit public `objects.html?sid=9&types=4` (filter `fe=14.<Lokaltyp>`, `fe=26.Johanneberg`) | Byggtid, `npm run build:rooms`            |
| Platser, utrustning, koordinater, studieplatser | `maps.chalmers.se/v2` (`info`, `webservices/timeedit/room`, `geojson`)                        | Byggtid                                   |
| Bokningar                                       | TimeEdit public `ri.json?sid=3&objects=<id>.4,...&p=YYYYMMDD-YYYYMMDD`                        | I klienten, cachas 5 min i `localStorage` |

TimeEdit skickar `Access-Control-Allow-Origin: *`, så appen kan hämta schemat direkt från webbläsaren. maps.chalmers.se saknar CORS och används därför bara i byggskriptet. Bokningar matchas mot salar via kolumnen `Lokalnamn` eftersom `ri.json` inte anger objekt-id per bokning.

Rutten är ett orienteringsproblem som löses heuristiskt i klienten ([`src/lib/route.ts`](src/lib/route.ts)): girig insättning av enskilda salar eller hela våningar ("bundles") efter antal salar per tidskostnad, följt av 2-opt. Kostnaden är gångtid inne och ute plus tid per trappa, och en sal räknas bara om den är ledig när du kommer fram. Kartan använder Leaflet med OpenStreetMap-tiles.

Rumskatalogen ligger i [`src/lib/data/rooms.json`](src/lib/data/rooms.json) och uppdateras veckovis av en GitHub Action.

## Utveckling

```bash
npm install
npm run dev
```

```bash
npm test              # enhetstester (vitest)
npm run check         # svelte-check
npm run build:rooms   # bygg om rumskatalogen från TimeEdit + maps
npm run build         # statisk build till build/
```

## Distribution

- **iOS och webb:** PWA på GitHub Pages. Öppna sidan i Safari → Dela → _Lägg till på hemskärmen_.
- **Android:** APK byggs av GitHub Actions med Capacitor och laddas ner från _Releases_ (sideload, ingen Play Store).
