import type { ToolDefinition } from "./types";

const asNumber = (value: string | number | boolean): number => Number(value);
const asText = (value: string | number | boolean): string => String(value);
const asBool = (value: string | number | boolean): boolean => Boolean(value);
const withSharedContext = (
  body: string,
  selectedText?: string,
  customInstructions?: string,
  tokenMap?: string,
  selectionOnly?: boolean
) => `${body}

${selectionOnly && selectedText?.trim()
    ? `Gebruik alleen de geselecteerde passage als bron.

Geselecteerde passage:
"""${selectedText.trim()}"""`
    : selectedText?.trim()
      ? `Geselecteerde passage:
"""${selectedText.trim()}"""

Behandel de volledige tekst als hoofdcontext, maar leg in je antwoord extra nadruk op deze selectie.`
      : "Er is geen aparte selectie opgegeven. Gebruik de volledige tekst als context."}
${tokenMap?.trim() ? `

Tokenlijst voor eventuele annotaties:
${tokenMap.trim()}` : ""}
${customInstructions?.trim() ? `

Extra instructies van de gebruiker:
${customInstructions.trim()}` : ""}`;

export const TOOL_CATALOG: ToolDefinition[] = [
  {
    id: "mcq",
    name: "Meerkeuzequiz",
    tagline: "Toets tekstbegrip met instelbare vragen.",
    description:
      "Genereert een klassiek begrijpend-lezenmoment met multiple-choicevragen, afleiders en antwoorduitleg.",
    category: "Begrip",
    accent: "#2164f3",
    icon: "01",
    outputKind: "quiz",
    fields: [
      { id: "questionCount", label: "Aantal vragen", type: "number", min: 3, max: 12, step: 1 },
      {
        id: "choiceCount",
        label: "Antwoorden per vraag",
        type: "select",
        options: [
          { label: "3 opties", value: "3" },
          { label: "4 opties", value: "4" }
        ]
      },
      {
        id: "difficulty",
        label: "Niveau vragen",
        type: "select",
        options: [
          { label: "Basis", value: "basis" },
          { label: "Gemiddeld", value: "gemiddeld" },
          { label: "Verdiepend", value: "verdiepend" }
        ]
      },
      {
        id: "explanations",
        label: "Geef antwoorduitleg",
        type: "toggle",
        description: "Laat per vraag zien waarom het antwoord klopt."
      },
      {
        id: "explainWrongAnswers",
        label: "Leg foute antwoorden uit",
        type: "toggle",
        description: "Laat per vraag ook kort zien waarom de afleiders niet kloppen."
      }
    ],
    defaults: {
      questionCount: 6,
      choiceCount: "4",
      difficulty: "gemiddeld",
      explanations: true,
      explainWrongAnswers: true
    },
    buildInstruction: ({ text, selectedText, values, customInstructions, selectionOnly }) =>
      withSharedContext(`Maak een multiple-choicequiz over deze tekst.

Tekst:
${selectionOnly && selectedText?.trim() ? selectedText : text}

Instellingen:
- aantal vragen: ${asNumber(values.questionCount)}
- aantal antwoordopties per vraag: ${asNumber(values.choiceCount)}
- niveau: ${asText(values.difficulty)}
- antwoorduitleg opnemen: ${asBool(values.explanations) ? "ja" : "nee"}
- foute antwoorden toelichten: ${asBool(values.explainWrongAnswers) ? "ja" : "nee"}

Vereisten:
- focus op begrijpend lezen: hoofdgedachte, details, inferenties, woordbetekenis in context en bedoeling van de schrijver
- zorg dat er precies het gevraagde aantal vragen komt
- maak geloofwaardige afleiders
- gebruik Nederlands
- als foute antwoorden toelichten uit staat, laat dan alleen zien waarom het goede antwoord klopt
- als foute antwoorden toelichten aan staat, noem in de explanation ook kort waarom de andere opties niet kloppen

Geef alleen geldige JSON in dit formaat:
{
  "title": "string",
  "summary": "string",
  "quiz": {
    "title": "string",
    "instructions": "string",
    "questions": [
      {
        "prompt": "string",
        "choices": ["string"],
        "correctIndex": 0,
        "explanation": "string"
      }
    ]
  }
}`, selectedText, customInstructions, undefined, selectionOnly)
  },
  {
    id: "image-generator",
    name: "Verhaal in Beeld",
    tagline: "Maak beelden bij scènes, personages of moeilijke woorden.",
    description:
      "Zet de tekst om naar gerichte illustraties voor visualisatie, woordenschat en klassengesprek.",
    category: "Visualisatie",
    accent: "#c149ff",
    icon: "02",
    outputKind: "images",
    fields: [
      {
        id: "focus",
        label: "Beeldfocus",
        type: "select",
        options: [
          { label: "Hele verhaal", value: "hele-verhaal" },
          { label: "Hoofdpersonen", value: "hoofdpersonen" },
          { label: "Moeilijke woorden", value: "moeilijke-woorden" }
        ]
      },
      { id: "imageCount", label: "Aantal beelden", type: "number", min: 1, max: 4, step: 1 },
      {
        id: "style",
        label: "Beeldstijl",
        type: "select",
        options: [
          { label: "Educatieve illustratie", value: "educatieve illustratie" },
          { label: "Stripachtig", value: "stripachtig" },
          { label: "Realistisch", value: "realistisch" },
          { label: "Aquarel", value: "aquarel" }
        ]
      },
      {
        id: "aspect",
        label: "Formaat",
        type: "select",
        options: [
          { label: "Vierkant", value: "1024x1024" },
          { label: "Liggend", value: "1536x1024" },
          { label: "Staand", value: "1024x1536" }
        ]
      }
    ],
    defaults: {
      focus: "hele-verhaal",
      imageCount: 3,
      style: "educatieve illustratie",
      aspect: "1536x1024"
    },
    buildInstruction: ({ text, selectedText, values, customInstructions, selectionOnly }) =>
      withSharedContext(`Analyseer de tekst en maak een beeldplan.

Tekst:
${selectionOnly && selectedText?.trim() ? selectedText : text}

Instellingen:
- focus: ${asText(values.focus)}
- aantal beelden: ${asNumber(values.imageCount)}
- stijl: ${asText(values.style)}

Vereisten:
- geef korte, educatief bruikbare titels in natuurlijk Nederlands en in zinshoofdletters
- beschrijf wat leerlingen in elk beeld moeten herkennen
- schrijf elke afbeeldingsprompt in het Nederlands
- prompts moeten geschikt zijn voor een image model en expliciet de stijl "${asText(values.style)}" verwerken

Geef alleen geldige JSON in dit formaat:
{
  "title": "string",
  "summary": "string",
  "sections": [{ "label": "Didactische insteek", "body": "string" }],
  "images": [
    {
      "title": "string",
      "prompt": "string",
      "alt": "string"
    }
  ]
}`, selectedText, customInstructions, undefined, selectionOnly)
  },
  {
    id: "prior-knowledge",
    name: "Voorkennischeck",
    tagline: "Meet wat de lezer al weet over het onderwerp.",
    description:
      "Genereert een quiz voorafgaand aan het lezen, zodat je de startpositie kunt inschatten.",
    category: "Diagnostiek",
    accent: "#07a37e",
    icon: "03",
    outputKind: "quiz",
    fields: [
      { id: "questionCount", label: "Aantal vragen", type: "number", min: 3, max: 10, step: 1 },
      {
        id: "scope",
        label: "Focus",
        type: "select",
        options: [
          { label: "Onderwerp van de tekst", value: "onderwerp" },
          { label: "Historische/culturele context", value: "context" },
          { label: "Algemene vakkennis", value: "vakkennis" }
        ]
      },
      {
        id: "level",
        label: "Doelniveau",
        type: "select",
        options: [
          { label: "Basisschool bovenbouw", value: "basisschool bovenbouw" },
          { label: "Brugklas", value: "brugklas" },
          { label: "Onderbouw vmbo/havo/vwo", value: "onderbouw" }
        ]
      }
    ],
    defaults: {
      questionCount: 5,
      scope: "onderwerp",
      level: "basisschool bovenbouw"
    },
    buildInstruction: ({ text, selectedText, values, customInstructions, selectionOnly }) =>
      withSharedContext(`Genereer een quiz die voorkennis toetst voordat iemand de tekst leest.

Tekst:
${selectionOnly && selectedText?.trim() ? selectedText : text}

Instellingen:
- aantal vragen: ${asNumber(values.questionCount)}
- focus: ${asText(values.scope)}
- doelniveau: ${asText(values.level)}

Vereisten:
- vragen mogen niet afhankelijk zijn van details uit de tekst zelf
- ze moeten kennis over onderwerp, context en kernbegrippen vooraf testen
- gebruik multiple choice
- houd de toon neutraal en schoolgeschikt

Geef alleen geldige JSON in dit formaat:
{
  "title": "string",
  "summary": "string",
  "quiz": {
    "title": "string",
    "instructions": "string",
    "questions": [
      {
        "prompt": "string",
        "choices": ["string"],
        "correctIndex": 0,
        "explanation": "string"
      }
    ]
  }
}`, selectedText, customInstructions, undefined, selectionOnly)
  },
  {
    id: "glossary",
    name: "Woordlijst",
    tagline: "Selecteer moeilijke woorden en definities op maat.",
    description:
      "Maakt een woordenlijst met definities, voorbeelden en categorieen zoals archaismen, leenwoorden of vaktaal.",
    category: "Woordenschat",
    accent: "#ff7a32",
    icon: "04",
    outputKind: "glossary",
    fields: [
      { id: "wordCount", label: "Aantal woorden", type: "number", min: 5, max: 20, step: 1 },
      {
        id: "focus",
        label: "Selectie",
        type: "select",
        options: [
          { label: "Moeilijke woorden algemeen", value: "moeilijke woorden" },
          { label: "Lange woorden", value: "lange woorden" },
          { label: "Archaische woorden", value: "archaische woorden" },
          { label: "Leenwoorden", value: "leenwoorden" },
          { label: "Vaktaal", value: "vaktermen" }
        ]
      },
      {
        id: "definitionStyle",
        label: "Definities",
        type: "select",
        options: [
          { label: "Kort en simpel", value: "kort en simpel" },
          { label: "Met nuance", value: "met nuance" }
        ]
      },
      {
        id: "includeExample",
        label: "Voorbeeldzin opnemen",
        type: "toggle"
      }
    ],
    defaults: {
      wordCount: 10,
      focus: "moeilijke woorden",
      definitionStyle: "kort en simpel",
      includeExample: true
    },
    buildInstruction: ({ text, selectedText, values, customInstructions, selectionOnly }) =>
      withSharedContext(`Maak een woordenlijst bij de tekst.

Tekst:
${selectionOnly && selectedText?.trim() ? selectedText : text}

Instellingen:
- aantal woorden: ${asNumber(values.wordCount)}
- selectietype: ${asText(values.focus)}
- definitiestijl: ${asText(values.definitionStyle)}
- voorbeeldzin opnemen: ${asBool(values.includeExample) ? "ja" : "nee"}

Vereisten:
- kies woorden die echt relevant zijn voor begrip
- leg elk woord uit in helder Nederlands
- gebruik categorieen waar passend

Geef alleen geldige JSON in dit formaat:
{
  "title": "string",
  "summary": "string",
  "glossary": [
    {
      "term": "string",
      "definition": "string",
      "category": "string",
      "example": "string"
    }
  ]
}`, selectedText, customInstructions, undefined, selectionOnly)
  },
  {
    id: "summary",
    name: "Samenvatting",
    tagline: "Maak een samenvatting passend bij de lezer.",
    description:
      "Vat de tekst samen op een gekozen leesniveau en met een duidelijke didactische insteek.",
    category: "Verwerking",
    accent: "#2441b2",
    icon: "05",
    outputKind: "report",
    fields: [
      {
        id: "length",
        label: "Lengte",
        type: "select",
        options: [
          { label: "2 zinnen", value: "2 zinnen" },
          { label: "1 alinea", value: "1 alinea" },
          { label: "3 alinea's", value: "3 alinea's" }
        ]
      },
      {
        id: "readerLevel",
        label: "Leesniveau",
        type: "select",
        options: [
          { label: "Eenvoudig", value: "eenvoudig" },
          { label: "Gemiddeld", value: "gemiddeld" },
          { label: "Uitdagend", value: "uitdagend" }
        ]
      },
      {
        id: "format",
        label: "Vorm",
        type: "select",
        options: [
          { label: "Doorlopende tekst", value: "doorlopende tekst" },
          { label: "Puntsgewijs", value: "puntsgewijs" },
          { label: "Stap voor stap", value: "stap voor stap" }
        ]
      }
    ],
    defaults: {
      length: "1 alinea",
      readerLevel: "gemiddeld",
      format: "doorlopende tekst"
    },
    buildInstruction: ({ text, selectedText, values, customInstructions, selectionOnly }) =>
      withSharedContext(`Vat de tekst samen.

Tekst:
${selectionOnly && selectedText?.trim() ? selectedText : text}

Instellingen:
- lengte: ${asText(values.length)}
- leesniveau: ${asText(values.readerLevel)}
- vorm: ${asText(values.format)}

Vereisten:
- volg de gevraagde vorm exact
- bij "doorlopende tekst" gebruik je geen bullets, geen nummering en geen losse labels
- bij "puntsgewijs" geef je de samenvatting alleen als bullets
- bij "stap voor stap" geef je een korte genummerde volgorde
- sections en bullets moeten aansluiten op de gevraagde vorm; laat velden weg die niet passen

Geef alleen geldige JSON in dit formaat:
{
  "title": "string",
  "summary": "string",
  "sections": [
    { "label": "Kern", "body": "string" },
    { "label": "Belangrijkste details", "body": "string" }
  ],
  "bullets": ["string"]
}`, selectedText, customInstructions, undefined, selectionOnly)
  },
  {
    id: "timeline",
    name: "Verhaallijn & Tijdlijn",
    tagline: "Orden gebeurtenissen en oorzaak-gevolg.",
    description:
      "Brengt de tekst terug tot een heldere volgorde van gebeurtenissen met causale verbanden.",
    category: "Structuur",
    accent: "#9738ff",
    icon: "06",
    outputKind: "report",
    fields: [
      {
        id: "granularity",
        label: "Detailniveau",
        type: "select",
        options: [
          { label: "Hoofdlijn", value: "hoofdlijn" },
          { label: "Gebalanceerd", value: "gebalanceerd" },
          { label: "Fijnmazig", value: "fijnmazig" }
        ]
      },
      {
        id: "includeCauseEffect",
        label: "Oorzaak-gevolg tonen",
        type: "toggle"
      }
    ],
    defaults: {
      granularity: "gebalanceerd",
      includeCauseEffect: true
    },
    buildInstruction: ({ text, selectedText, values, customInstructions, selectionOnly }) =>
      withSharedContext(`Maak een tijdlijn van de tekst.

Tekst:
${selectionOnly && selectedText?.trim() ? selectedText : text}

Instellingen:
- detailniveau: ${asText(values.granularity)}
- oorzaak-gevolg opnemen: ${asBool(values.includeCauseEffect) ? "ja" : "nee"}

Vereisten:
- gebruik geen markdown in strings
- schrijf compacte, heldere zinnen
- maak de tijdlijn concreet en chronologisch
- als oorzaak-gevolg opnemen aan staat, vul dan per gebeurtenis waar passend cause en effect in

Geef alleen geldige JSON in dit formaat:
{
  "title": "string",
  "summary": "string",
  "timeline": [
    {
      "title": "string",
      "detail": "string",
      "cause": "string",
      "effect": "string"
    }
  ],
  "sections": [
    { "label": "Tijdlijn", "body": "string" },
    { "label": "Oorzaak en gevolg", "body": "string" }
  ],
  "bullets": ["string"]
}`, selectedText, customInstructions, undefined, selectionOnly)
  },
  {
    id: "character-map",
    name: "Personagekaart",
    tagline: "Maak rollen, motieven en relaties inzichtelijk.",
    description:
      "Extraheert hoofd- en bijfiguren en beschrijft hun eigenschappen, doelen en onderlinge verbanden.",
    category: "Analyse",
    accent: "#e4446f",
    icon: "07",
    outputKind: "report",
    fields: [
      {
        id: "focus",
        label: "Analysefocus",
        type: "select",
        options: [
          { label: "Eigenschappen", value: "eigenschappen" },
          { label: "Motieven", value: "motieven" },
          { label: "Relaties", value: "relaties" }
        ]
      },
      {
        id: "characterCount",
        label: "Aantal personages",
        type: "number",
        min: 2,
        max: 8,
        step: 1
      }
    ],
    defaults: {
      focus: "relaties",
      characterCount: 4
    },
    buildInstruction: ({ text, selectedText, values, customInstructions, selectionOnly }) =>
      withSharedContext(`Analyseer de personages in de tekst.

Tekst:
${selectionOnly && selectedText?.trim() ? selectedText : text}

Instellingen:
- analysefocus: ${asText(values.focus)}
- maximaal aantal personages: ${asNumber(values.characterCount)}

Geef alleen geldige JSON in dit formaat:
{
  "title": "string",
  "summary": "string",
  "sections": [
    { "label": "Personages", "body": "string" },
    { "label": "Relaties", "body": "string" }
  ],
  "bullets": ["string"]
}`, selectedText, customInstructions, undefined, selectionOnly)
  },
  {
    id: "text-structure",
    name: "Tekststructuurcoach",
    tagline: "Herken signaalwoorden en tekstverbanden.",
    description:
      "Laat zien hoe de tekst is opgebouwd en welke signaalwoorden helpen om verbanden te begrijpen.",
    category: "Structuur",
    accent: "#00a4c7",
    icon: "08",
    outputKind: "report",
    fields: [
      {
        id: "structureType",
        label: "Analysefocus",
        type: "select",
        options: [
          { label: "Tekstverbanden", value: "tekstverbanden" },
          { label: "Signaalwoorden", value: "signaalwoorden" },
          { label: "Beide", value: "beide" }
        ]
      },
      {
        id: "includeTips",
        label: "Leestips toevoegen",
        type: "toggle"
      }
    ],
    defaults: {
      structureType: "beide",
      includeTips: true
    },
    buildInstruction: ({ text, selectedText, values, customInstructions, selectionOnly }) =>
      withSharedContext(`Analyseer de structuur van de tekst.

Tekst:
${selectionOnly && selectedText?.trim() ? selectedText : text}

Instellingen:
- focus: ${asText(values.structureType)}
- leestips opnemen: ${asBool(values.includeTips) ? "ja" : "nee"}

Geef alleen geldige JSON in dit formaat:
{
  "title": "string",
  "summary": "string",
  "sections": [
    { "label": "Structuur", "body": "string" },
    { "label": "Signaalwoorden", "body": "string" },
    { "label": "Leestips", "body": "string" }
  ],
  "bullets": ["string"]
}`, selectedText, customInstructions, undefined, selectionOnly)
  },
  {
    id: "word-highlighter",
    name: "Woordsoorten markeren",
    tagline: "Laat woorden in de brontekst kleurcodes krijgen.",
    description:
      "Vraagt het model om token-id's terug te geven zodat woorden in de invoertekst gemarkeerd kunnen worden.",
    category: "Analyse",
    accent: "#2f8f6b",
    icon: "09",
    outputKind: "report",
    fields: [
      {
        id: "focus",
        label: "Markeer",
        type: "select",
        options: [
          { label: "Zelfstandige naamwoorden, werkwoorden, bijvoeglijke naamwoorden", value: "znw-ww-bvnw" },
          { label: "Alleen werkwoorden", value: "werkwoorden" },
          { label: "Alleen zelfstandige naamwoorden", value: "zelfstandige naamwoorden" },
          { label: "Alleen bijvoeglijke naamwoorden", value: "bijvoeglijke naamwoorden" },
          { label: "Verwijswoorden", value: "verwijswoorden" },
          { label: "Signaalwoorden", value: "signaalwoorden" },
          { label: "Woordsoorten + verwijswoorden + signaalwoorden", value: "alles" }
        ]
      }
    ],
    defaults: {
      focus: "znw-ww-bvnw"
    },
    buildInstruction: ({ text, selectedText, values, customInstructions, tokenMap, selectionOnly }) =>
      withSharedContext(`Analyseer de tekst en geef markeringen terug voor woorden in de brontekst.

Tekst:
${selectionOnly && selectedText?.trim() ? selectedText : text}

Instellingen:
- markeer: ${asText(values.focus)}

Vereisten:
- gebruik uitsluitend tokenIds uit de meegeleverde tokenlijst
- geef per woordsoort een aparte highlight-groep terug
- gebruik alleen deze kleuren: "noun", "verb", "adjective", "pronoun", "signal"
- laat tokenIds alleen verwijzen naar woorden die echt in de tekst voorkomen
- bij verwijswoorden maak je een sectie "Verwijzingen" waarin je per verwijswoord kort noteert waar het naar verwijst
- voeg voor verwijswoorden ook een expliciete references-array toe die sourceTokenIds koppelt aan targetTokenIds
- bij signaalwoorden maak je een sectie "Signaalwoorden" waarin je kort uitlegt welk tekstverband ze aangeven

Geef alleen geldige JSON in dit formaat:
{
  "title": "string",
  "summary": "string",
  "sections": [
    { "label": "Legenda", "body": "string" },
    { "label": "Verwijzingen", "body": "string" },
    { "label": "Signaalwoorden", "body": "string" }
  ],
  "highlights": [
    {
      "label": "Zelfstandige naamwoorden",
      "color": "noun",
      "tokenIds": [1, 4, 10]
    }
  ],
  "references": [
    {
      "sourceTokenIds": [82],
      "targetTokenIds": [31],
      "label": "hij verwijst naar Amir"
    }
  ]
}`, selectedText, customInstructions, tokenMap, selectionOnly)
  },
  {
    id: "open-questions",
    name: "Open Vragencoach",
    tagline: "Genereer verdiepende vragen met nakijkhulp.",
    description:
      "Maakt open vragen over de tekst en geeft criteria voor een sterk antwoord.",
    category: "Verwerking",
    accent: "#ffa113",
    icon: "10",
    outputKind: "report",
    fields: [
      { id: "questionCount", label: "Aantal vragen", type: "number", min: 2, max: 8, step: 1 },
      {
        id: "thinkingLevel",
        label: "Denkniveau",
        type: "select",
        options: [
          { label: "Letterlijk begrip", value: "letterlijk begrip" },
          { label: "Interpreteren", value: "interpreteren" },
          { label: "Evalueren", value: "evalueren" }
        ]
      }
    ],
    defaults: {
      questionCount: 4,
      thinkingLevel: "interpreteren"
    },
    buildInstruction: ({ text, selectedText, values, customInstructions, selectionOnly }) =>
      withSharedContext(`Maak open vragen bij de tekst.

Tekst:
${selectionOnly && selectedText?.trim() ? selectedText : text}

Instellingen:
- aantal vragen: ${asNumber(values.questionCount)}
- denkniveau: ${asText(values.thinkingLevel)}

Geef alleen geldige JSON in dit formaat:
{
  "title": "string",
  "summary": "string",
  "sections": [
    { "label": "Open vragen", "body": "string" },
    { "label": "Nakijkmodel", "body": "string" }
  ],
  "bullets": ["string"]
}`, selectedText, customInstructions, undefined, selectionOnly)
  },
  {
    id: "rewrite",
    name: "Tekst herschrijven",
    tagline: "Vereenvoudig of verrijk de tekst doelgericht.",
    description:
      "Herschrijft de tekst in eenvoudiger taal of verrijkt hem met extra, bewust toegevoegde details.",
    category: "Verwerking",
    accent: "#8a5cf6",
    icon: "11",
    outputKind: "report",
    fields: [
      {
        id: "mode",
        label: "Bewerking",
        type: "select",
        options: [
          { label: "Vereenvoudigen", value: "vereenvoudigen" },
          { label: "Verrijken met extra details", value: "verrijken" }
        ]
      },
      {
        id: "strength",
        label: "Mate",
        type: "select",
        options: [
          { label: "Subtiel", value: "subtiel" },
          { label: "Duidelijk", value: "duidelijk" },
          { label: "Sterk", value: "sterk" }
        ]
      }
    ],
    defaults: {
      mode: "vereenvoudigen",
      strength: "duidelijk"
    },
    buildInstruction: ({ text, selectedText, values, customInstructions, selectionOnly }) =>
      withSharedContext(`Herschrijf de tekst.

Tekst:
${selectionOnly && selectedText?.trim() ? selectedText : text}

Instellingen:
- bewerking: ${asText(values.mode)}
- mate: ${asText(values.strength)}

Vereisten:
- geef eerst kort aan wat je hebt aangepast
- geef daarna de herschreven tekst
- als de bewerking "verrijken" is, mag je plausibele extra details toevoegen die niet letterlijk in de bron staan
- benoem bij verrijken expliciet dat er extra details zijn toegevoegd

Geef alleen geldige JSON in dit formaat:
{
  "title": "string",
  "summary": "string",
  "sections": [
    { "label": "Wat is aangepast", "body": "string" },
    { "label": "Herschreven tekst", "body": "string" }
  ]
}`, selectedText, customInstructions, undefined, selectionOnly)
  },
  {
    id: "custom-prompt",
    name: "Custom prompt",
    tagline: "Probeer een eigen opdracht op dezelfde tekst en selectie.",
    description:
      "Gebruik een vrije prompt om modellen, instructies en formuleringen direct te vergelijken.",
    category: "Experiment",
    accent: "#0f8f7a",
    icon: "12",
    outputKind: "report",
    fields: [
      {
        id: "task",
        label: "Opdracht",
        type: "textarea",
        description: "Beschrijf wat het model met de tekst moet doen."
      }
    ],
    defaults: {
      task: "Geef een korte analyse van deze tekst voor een docent begrijpend lezen."
    },
    buildInstruction: ({ text, selectedText, values, customInstructions, selectionOnly }) =>
      withSharedContext(`Voer deze eigen opdracht uit op basis van de tekst.

Tekst:
${selectionOnly && selectedText?.trim() ? selectedText : text}

Opdracht:
${asText(values.task)}

Geef alleen geldige JSON in dit formaat:
{
  "title": "string",
  "summary": "string",
  "sections": [
    { "label": "Antwoord", "body": "string" }
  ],
  "bullets": ["string"]
}`, selectedText, customInstructions, undefined, selectionOnly)
  }
];

export const TOOL_BY_ID = Object.fromEntries(TOOL_CATALOG.map((tool) => [tool.id, tool]));
