# BegrAIp

BegrAIp is een lokale AI playground voor begrijpend lezen. Je plakt een tekst en laat daar verschillende tools op los, zoals:

- meerkeuzequizzen
- voorkennischecks
- woordenlijsten
- beeldprompts en illustraties
- samenvattingen, tijdlijnen en tekststructuuranalyses

## Stack

- React
- TypeScript
- Vite

## Providers

De app ondersteunt meerdere LLM-aanbieders:

- OpenAI
- Anthropic
- Google AI
- Mistral
- Groq

API-keys worden lokaal geladen via `.env.local` en lokaal in de browser onthouden per provider.

## Lokaal draaien

```bash
npm install
npm run dev:usage-log
npm run dev
```

De app post usage-events standaard naar `/api/usage`.

Als je lokaal ook analytics wilt wegschrijven:

- start `npm run dev:usage-log`
- events worden dan appended naar `server/logs/usage.ndjson`

Elke regel in dat bestand is een JSON-event met tool, provider, model, timing, tokens, kosten en status.

## Build

```bash
npm run build
```

## GitHub Pages

Deze repo bevat een GitHub Actions workflow voor deployment naar GitHub Pages.

Belangrijk:

- GitHub Pages is een statische host
- API-keys die je in de front-end stopt zijn publiek zichtbaar
- gebruik daarom op de hosted versie alleen eigen tijdelijke keys of zet een backend-proxy voor de modelproviders
- hetzelfde geldt voor usage-logging: GitHub Pages kan niet zelf naar een serverbestand schrijven; daarvoor heb je een eigen backend of proxy nodig
