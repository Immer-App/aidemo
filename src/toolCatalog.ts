import type { ToolDefinition } from "./types";

const asNumber = (value: string | number | boolean): number => Number(value);
const asText = (value: string | number | boolean): string => String(value);
const asBool = (value: string | number | boolean): boolean => Boolean(value);
const withSharedContext = (
  body: string,
  selectedText?: string,
  customInstructions?: string
) => `${body}

${selectedText?.trim()
    ? `Geselecteerde passage:
"""${selectedText.trim()}"""

Behandel de volledige tekst als hoofdcontext, maar leg in je antwoord extra nadruk op deze selectie.`
    : "Er is geen aparte selectie opgegeven. Gebruik de volledige tekst als context."}
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
      }
    ],
    defaults: {
      questionCount: 6,
      choiceCount: "4",
      difficulty: "gemiddeld",
      explanations: true
    },
    buildInstruction: ({ text, selectedText, values, customInstructions }) =>
      withSharedContext(`Maak een multiple-choicequiz over deze tekst.

Tekst:
${text}

Instellingen:
- aantal vragen: ${asNumber(values.questionCount)}
- aantal antwoordopties per vraag: ${asNumber(values.choiceCount)}
- niveau: ${asText(values.difficulty)}
- antwoorduitleg opnemen: ${asBool(values.explanations) ? "ja" : "nee"}

Vereisten:
- focus op begrijpend lezen: hoofdgedachte, details, inferenties, woordbetekenis in context en bedoeling van de schrijver
- zorg dat er precies het gevraagde aantal vragen komt
- maak geloofwaardige afleiders
- gebruik Nederlands

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
}`, selectedText, customInstructions)
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
    buildInstruction: ({ text, selectedText, values, customInstructions }) =>
      withSharedContext(`Analyseer de tekst en maak een beeldplan.

Tekst:
${text}

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
}`, selectedText, customInstructions)
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
    buildInstruction: ({ text, selectedText, values, customInstructions }) =>
      withSharedContext(`Genereer een quiz die voorkennis toetst voordat iemand de tekst leest.

Tekst:
${text}

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
}`, selectedText, customInstructions)
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
          { label: "Met nuance", value: "met nuance" },
          { label: "Met voorbeeldzin", value: "met voorbeeldzin" }
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
    buildInstruction: ({ text, selectedText, values, customInstructions }) =>
      withSharedContext(`Maak een woordenlijst bij de tekst.

Tekst:
${text}

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
}`, selectedText, customInstructions)
  },
  {
    id: "summary",
    name: "Samenvatting op Niveau",
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
          { label: "Ultrakort", value: "ultrakort" },
          { label: "Klas-klaar", value: "klas-klaar" },
          { label: "Uitgebreid", value: "uitgebreid" }
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
      length: "klas-klaar",
      readerLevel: "gemiddeld",
      format: "stap voor stap"
    },
    buildInstruction: ({ text, selectedText, values, customInstructions }) =>
      withSharedContext(`Vat de tekst samen.

Tekst:
${text}

Instellingen:
- lengte: ${asText(values.length)}
- leesniveau: ${asText(values.readerLevel)}
- vorm: ${asText(values.format)}

Geef alleen geldige JSON in dit formaat:
{
  "title": "string",
  "summary": "string",
  "sections": [
    { "label": "Kern", "body": "string" },
    { "label": "Belangrijkste details", "body": "string" }
  ],
  "bullets": ["string"]
}`, selectedText, customInstructions)
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
    buildInstruction: ({ text, selectedText, values, customInstructions }) =>
      withSharedContext(`Maak een tijdlijn van de tekst.

Tekst:
${text}

Instellingen:
- detailniveau: ${asText(values.granularity)}
- oorzaak-gevolg opnemen: ${asBool(values.includeCauseEffect) ? "ja" : "nee"}

Geef alleen geldige JSON in dit formaat:
{
  "title": "string",
  "summary": "string",
  "sections": [
    { "label": "Tijdlijn", "body": "string" },
    { "label": "Oorzaak en gevolg", "body": "string" }
  ],
  "bullets": ["string"]
}`, selectedText, customInstructions)
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
    buildInstruction: ({ text, selectedText, values, customInstructions }) =>
      withSharedContext(`Analyseer de personages in de tekst.

Tekst:
${text}

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
}`, selectedText, customInstructions)
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
    buildInstruction: ({ text, selectedText, values, customInstructions }) =>
      withSharedContext(`Analyseer de structuur van de tekst.

Tekst:
${text}

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
}`, selectedText, customInstructions)
  },
  {
    id: "open-questions",
    name: "Open Vragencoach",
    tagline: "Genereer verdiepende vragen met nakijkhulp.",
    description:
      "Maakt open vragen over de tekst en geeft criteria voor een sterk antwoord.",
    category: "Verwerking",
    accent: "#ffa113",
    icon: "09",
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
    buildInstruction: ({ text, selectedText, values, customInstructions }) =>
      withSharedContext(`Maak open vragen bij de tekst.

Tekst:
${text}

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
}`, selectedText, customInstructions)
  },
  {
    id: "custom-prompt",
    name: "Custom prompt",
    tagline: "Probeer een eigen opdracht op dezelfde tekst en selectie.",
    description:
      "Gebruik een vrije prompt om modellen, instructies en formuleringen direct te vergelijken.",
    category: "Experiment",
    accent: "#0f8f7a",
    icon: "10",
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
    buildInstruction: ({ text, selectedText, values, customInstructions }) =>
      withSharedContext(`Voer deze eigen opdracht uit op basis van de tekst.

Tekst:
${text}

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
}`, selectedText, customInstructions)
  }
];

export const TOOL_BY_ID = Object.fromEntries(TOOL_CATALOG.map((tool) => [tool.id, tool]));
