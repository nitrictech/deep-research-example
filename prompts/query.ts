export default (date: string, topic: string) => `
Your goal is to generate a targeted web search query.

<CONTEXT>
Current date: ${date}
Please ensure your queries account for the most current information available as of this date.
</CONTEXT>

<TOPIC>
${topic}
</TOPIC>

<FORMAT>
Format your response as a JSON object with ALL three of these exact keys:
   - "query": The actual search query string
   - "rationale": Brief explanation of why this query is relevant
</FORMAT>

<EXAMPLE>
Example output:
{
    "query": "machine learning transformer architecture explained",
    "rationale": "Understanding the fundamental structure of transformer models"
}
</EXAMPLE>

Provide your response only in JSON format:
`