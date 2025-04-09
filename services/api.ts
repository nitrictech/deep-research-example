import { api, topic, bucket } from "npm:@nitric/sdk";
import search from "../utils/search.ts";
import openai from "npm:openai";
import queryPrompt from "../prompts/query.ts";
import summarizerPrompt from "../prompts/summarizer.ts";
import reflectionPrompt from "../prompts/reflect.ts";
import TurndownService from "npm:turndown";
import * as cheerio from "npm:cheerio";

const OAI = new openai({
  // use ollama here
  baseURL: "http://localhost:11434/v1",
  apiKey: "ollama",
});

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced'
});

function cleanHtml(html: string): string {
  const $ = cheerio.load(html);
  
  // Remove script and style tags
  $('script, style, noscript, iframe, embed, object').remove();
  
  // Remove navigation elements
  $('nav, header, footer, aside, .nav, .navigation, .menu, .sidebar').remove();
  
  // Remove ads and social media elements
  $('.ad, .ads, .advertisement, .social, .share, .comments').remove();
  
  // Remove empty elements
  $('*').each(function() {
    if ($(this).text().trim() === '') {
      $(this).remove();
    }
  });
  
  // Get the main content (prioritize article, main, or content areas)
  let content = $('article, main, .article, .content, .post, .entry');
  if (content.length === 0) {
    content = $('body');
  }
  
  return content.html() || '';
}

type TopicMessageTypes = "create_query" | "query" | "reflect" | "summarize";

interface ResearchTopicMessage<T extends TopicMessageTypes> {
  type: T;
  // List of topics that have been researched
  topics: string[];
  // Build a list of previous summaries to be used to build up the final response
  summaries: string[];
  // Track remaining iterations to prevent infinite loops
  remainingIterations: number;
}

interface CreateQueryTopicMessage extends ResearchTopicMessage<"create_query"> {
  type: "create_query";
  date: string;
  originalTopic: string;
}

interface PerformQueryTopicMessage extends ResearchTopicMessage<"query"> {
  type: "query";
  query: {
    query: string,
    rationale: string
  }
}

interface SummarizeTopicMessage extends ResearchTopicMessage<"summarize"> {
  type: "summarize";
  content: string;
}

interface ReflectTopicMessage extends ResearchTopicMessage<"reflect"> {
  type: "reflect";
  content: string;
}

type TopicMessages = CreateQueryTopicMessage | PerformQueryTopicMessage | SummarizeTopicMessage | ReflectTopicMessage

const researchApi = api("research");
const researchTopic = topic<TopicMessages>("research");
const researchTopicPub = researchTopic.allow("publish");
const researchBucket = bucket("research").allow("write");

const MODEL = "llama3.2:3b";
const MAX_ITERATIONS = 3;

async function handleCreateQuery(message: CreateQueryTopicMessage) {
  console.log(`[Research] Starting new query for topic: ${message.originalTopic}`);
  // Create a new query using ollama
  const completion = await OAI.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: queryPrompt(new Date().toISOString(), message.originalTopic) },
      { role: "user", content: message.originalTopic }
    ],
  });

  console.log(`[Research] Generated query: ${completion.choices[0].message.content}`);

  // Parse the JSON response to extract query and rationale
  const response = JSON.parse(completion.choices[0].message.content!);
  const { query, rationale } = response;

  console.log(`[Research] Query: ${query}\nRationale: ${rationale}`);

  // submit a new query creation request to the research service
  await researchTopicPub.publish({
    ...message,
    type: "query",
    topics: [...message.topics, query],
    query: {
      query,
      rationale,
    },
  });
}

async function handleQuery(message: PerformQueryTopicMessage) {
  console.log(`[Research] Executing search query: ${message.query.query}`);
  // perform the given query using our search
  const result = await search(message.query.query);

  console.log(`[Research] Found ${result.length} results`);
  console.log(`[Research] First result preview:`, {
    url: result[0]?.url,
    title: result[0]?.title,
    html: result[0]?.html.substring(0, 200) + '...'
  });

  const content = result.reduce((acc, curr) => {
    const cleanedContent = cleanHtml(curr.html);
    return `${acc}

  # ${curr.title}
  ${turndownService.turndown(cleanedContent)}
`;
  }, "");

  // publish a summarize request to the research service
  await researchTopicPub.publish({
    ...message,
    type: "summarize",
    content: content,
  });
}

async function handleSummarize(message: SummarizeTopicMessage) {
  console.log(`[Research] Summarizing content for topic: ${message.topics[message.topics.length - 1]}`);
  
  console.log(`[Research] Previous summaries count: ${message.summaries.length}`);
  console.log(`[Research] Current content length: ${message.content.length}`);

  // Process the current content in isolation
  const completion = await OAI.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: summarizerPrompt([message.topics[message.topics.length - 1]]) },
      { role: "user", content: message.content }
    ],
  });

  const summary = completion.choices[0].message.content!;
  console.log(`[Research] Generated summary: ${summary}`);

  // publish a reflect request to the research service
  await researchTopicPub.publish({
    summaries: [
      // Keep all previous summaries and add the new one
      ...message.summaries,
      summary
    ],
    remainingIterations: message.remainingIterations,
    topics: [...message.topics, message.topics[message.topics.length - 1]],
    type: "reflect",
    content: summary,
  });
}

async function handleReflect(message: ReflectTopicMessage) {
  console.log(`[Research] Reflecting on summary for topics: ${message.topics}`);
  console.log(`[Research] Current summary: ${message.content.substring(0, 200)}...`);
  console.log(`[Research] Remaining iterations: ${message.remainingIterations}`);
  
  // Check iteration limit
  if (message.remainingIterations <= 0) {
    console.log(`[Research] No iterations remaining. Writing final summary to bucket.`);
    // Create a more comprehensive final summary with proper structure
    const finalSummary = `# Research Summary: ${message.topics[0]}

## Introduction
This document contains research findings on the topic "${message.topics[0]}". The research was conducted through multiple iterations of querying, analyzing, and synthesizing information.

## Research Findings
${message.summaries.map((summary, index) => 
  `### Research Topic: ${message.topics[index]}\n\n${summary}`
).join('\n\n')}

## Conclusion
This research provides a comprehensive overview of "${message.topics[0]}" and related topics. The findings are based on multiple sources and have been synthesized to provide a coherent understanding of the subject matter.
`;
    
    await researchBucket.file(message.topics[0]).write(finalSummary);
    return;
  }
  
  // Here I want to use the reflection prompt I have to restart the research chain
  const completion = await OAI.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: reflectionPrompt(message.topics) },
      { role: "user", content: message.content }
    ],
  });

  console.log(`[Research] Parsing reflection:`, completion.choices[0].message.content!);

  const reflection = completion.choices[0].message.content!;
  
  // Only restart research if knowledge gaps were identified
  if (reflection !== "") {
    console.log(`[Research] Found knowledge gap, following up with: ${reflection}`);
    await researchTopicPub.publish({
      ...message,
      remainingIterations: message.remainingIterations - 1,
      type: "create_query",
      topics: [...message.topics],
      originalTopic: reflection,
      date: new Date().toISOString(),
    });
  } else {
    console.log(`[Research] No knowledge gaps found. Writing final summary to bucket: ${message.topics[message.topics.length - 1]}`);
    // Create a more comprehensive final summary with proper structure
    const finalSummary = `# Research Summary: ${message.topics[0]}

## Introduction
This document contains research findings on the topic "${message.topics[0]}". The research was conducted through multiple iterations of querying, analyzing, and synthesizing information.

## Research Findings
${message.summaries.map((summary, index) => 
  `### Research Topic: ${message.topics[index]}\n\n${summary}`
).join('\n\n')}

## Conclusion
This research provides a comprehensive overview of "${message.topics[0]}" and related topics. The findings are based on multiple sources and have been synthesized to provide a coherent understanding of the subject matter.
`;
    
    console.log(`[Research] Final summary length: ${finalSummary.length}`);
    await researchBucket.file(message.topics[0]).write(finalSummary);
  }
}

researchApi.post("/query", async (ctx) => {
  const query = ctx.req.text();
  const remainingIterations = MAX_ITERATIONS;

  // Submit off start of research chain
  await researchTopicPub.publish({
    summaries: [],
    remainingIterations,
    type: "create_query",
    date: new Date().toISOString(),
    topics: [],
    originalTopic: query,
  });

  ctx.res.body = "Query submitted";

  return ctx;
});

researchTopic.subscribe(async (ctx) => {
  const message = ctx.req.json();

  switch (message.type) {
    case "create_query":
      await handleCreateQuery(message);
      break;
    case "query":
      await handleQuery(message);
      break;
    case "summarize":
      await handleSummarize(message);
      break;
    case "reflect":
      await handleReflect(message);
      break;
  }
});
