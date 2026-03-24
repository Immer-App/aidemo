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
npm run dev
```

## Build

```bash
npm run build
```
