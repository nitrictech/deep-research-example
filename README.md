<p align="center"><a href="https://nitric.io" target="_blank"><img src="https://raw.githubusercontent.com/nitrictech/nitric/main/docs/assets/nitric-logo.svg" height="120"></a></p>

# Deep Research Project

A Nitric-based research assistant that uses AI to perform deep research on topics, iteratively exploring knowledge gaps and building comprehensive summaries.

## Prerequisites

- [Deno](https://deno.land/) installed
- [Nitric](https://nitric.io/) CLI installed
- [Ollama](https://ollama.ai/) running locally (for LLM access)

## Project Setup

1. Initialize a new Nitric project:
```bash
nitric new deep-research
cd deep-research
```

2. Install required dependencies:
```bash
deno cache --reload deps.ts
```

3. Create the project structure:
```
deep-research/
├── deno.json         # Deno configuration
├── services/
│   └── api.ts        # Main API service
├── utils/
│   └── search.ts     # Search utility
├── prompts/
│   ├── query.ts      # Query generation prompt
│   ├── summarizer.ts # Summarization prompt
│   └── reflect.ts    # Reflection prompt
└── README.md         # This guide
```

## Dependencies Setup

Create `deno.json` with the following configuration:

```json
{
  "imports": {
    "@nitric/sdk": "npm:@nitric/sdk",
    "duck-duck-scrape": "npm:duck-duck-scrape",
    "openai": "npm:openai",
    "turndown": "npm:turndown",
    "cheerio": "npm:cheerio"
  },
  "tasks": {
    "fmt": "deno fmt",
    "check": "deno check services/api.ts"
  }
}
```

Then in your TypeScript files, you can import dependencies directly:

```typescript
import { api, topic, bucket } from "@nitric/sdk";
import { search, SafeSearchType } from "duck-duck-scrape";
import { default as openai } from "openai";
import { default as TurndownService } from "turndown";
import * as cheerio from "cheerio";
```

## Core Components

### 1. Search Utility (`utils/search.ts`)

```typescript
import { search, SafeSearchType } from "duck-duck-scrape";

export default async (query: string) => {
  const results = await search(query, { safeSearch: SafeSearchType.STRICT });
  
  // Get the top 3 most relevant results
  const topResults = results.results.slice(0, 3);
  
  // Fetch HTML content for each result
  const htmlContents = await Promise.all(
    topResults.map(async (result) => {
      try {
        const response = await fetch(result.url);
        const html = await response.text();
        return {
          url: result.url,
          title: result.title,
          html
        };
      } catch (error) {
        console.error(`Failed to fetch ${result.url}:`, error);
        return null;
      }
    })
  );

  return htmlContents.filter(content => content !== null);
}
```

### 2. Prompts

#### Query Prompt (`prompts/query.ts`)
```typescript
export default (date: string, topic: string) => `
You are a research assistant. Given a topic, generate a search query and rationale.
Current date: ${date}
Topic: ${topic}

Respond with a JSON object containing:
- query: The search query to use
- rationale: Why this query will help research the topic

Example response:
{
  "query": "quantum computing applications 2024",
  "rationale": "This query will find recent applications of quantum computing to understand current use cases"
}
`;
```

#### Summarizer Prompt (`prompts/summarizer.ts`)
```typescript
export default (topics: string[]) => `
You are a research summarizer. Given content from multiple sources, create a comprehensive summary.
Topics researched: ${topics.join(", ")}

Focus on:
- Key findings and insights
- Supporting evidence
- Connections between different sources
- Clear organization of information

Format the summary in markdown with appropriate headings and sections.
`;
```

#### Reflection Prompt (`prompts/reflect.ts`)
```typescript
export default (topics: string[]) => `
You are a research analyst. Review the current summary and identify knowledge gaps.
Topics researched: ${topics.join(", ")}

If you find significant knowledge gaps, respond with a new topic to research.
If the research is comprehensive, respond with an empty string.

Focus on:
- Missing perspectives
- Unexplored aspects
- Contradictions needing resolution
- Recent developments not covered
`;
```

### 3. Main API Service (`services/api.ts`)

The main service implements the research chain:
1. Create initial query
2. Search and fetch content
3. Clean and convert HTML to markdown
4. Summarize findings
5. Reflect on gaps
6. Iterate if needed

Key features:
- Iterative research with configurable depth
- HTML cleaning and markdown conversion
- Topic tracking and preservation
- Comprehensive logging

## Running the Project

1. Start Ollama (if not already running):
```bash
ollama serve
```

2. Deploy the Nitric project:
```bash
nitric up
```

3. Make a research request:
```bash
curl -X POST http://localhost:4001/query -d "Your research topic here"
```

## Project Structure

The project follows a modular design:
- `services/api.ts`: Main API service handling the research chain
- `utils/search.ts`: Search utility for fetching web content
- `prompts/*.ts`: AI prompts for different stages of research
- `deno.json`: Centralized dependency management

## Configuration

Key configuration points:
- `MAX_ITERATIONS`: Controls research depth (default: 3)
- `MODEL`: Ollama model to use (default: "llama3.2:3b")
- Search parameters in `utils/search.ts`

## Development

1. Run tests:
```bash
deno test
```

2. Format code:
```bash
deno fmt
```

3. Check types:
```bash
deno check
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License
