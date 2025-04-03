import { api, topic, bucket } from "npm:@nitric/sdk";
import search from "../utils/search.ts";
import openai from "npm:openai";
import queryPrompt from "../prompts/query.ts";
import summarizerPrompt from "../prompts/summarizer.ts";
import reflectionPrompt from "../prompts/reflect.ts";
import converterPrompt from "../prompts/converter.ts";

const OAI = new openai({
  // use ollama here
  baseURL: "http://localhost:11434/v1",
  apiKey: "ollama",
});

type TopicMessageTypes = "create_query" | "query" | "reflect" | "summarize";

interface ResearchTopicMessage<T extends TopicMessageTypes> {
  type: T;
  topic: string;
  // Build a list of previous summaries to be used to build up the final response
  summaries: string[];
}

interface CreateQueryTopicMessage extends ResearchTopicMessage<"create_query"> {
  type: "create_query";
  date: string;
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

async function handleCreateQuery(message: CreateQueryTopicMessage) {
  console.log(`[Research] Starting new query for topic: ${message.topic}`);
  // Create a new query using ollama
  const completion = await OAI.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: queryPrompt(new Date().toISOString(), message.topic) },
      { role: "user", content: message.topic }
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
    topic: message.topic,
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

  // Use the converter prompt to convert the html to markdown
  console.log(`[Research] Converting HTML to Markdown for URL: ${result[0]?.url}`);
  console.log(`[Research] HTML content length: ${result[0]?.html.length}`);
  
  const completion = await OAI.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: converterPrompt },
      { role: "user", content: result[0]?.html }
    ],
  });

  const markdown = completion.choices[0].message.content!;
  console.log(`[Research] Converted HTML to Markdown: ${markdown.substring(0, 200)}...`);
  console.log(`[Research] Markdown content length: ${markdown.length}`);

  // publish a summarize request to the research service
  await researchTopicPub.publish({
    ...message,
    type: "summarize",
    topic: message.topic,
    content: markdown,
  });
}

async function handleSummarize(message: SummarizeTopicMessage) {
  console.log(`[Research] Summarizing content for topic: ${message.topic}`);
  // append message content to previous summaries
  const summaries = [
    ...message.summaries,
    message.content,
  ];

  console.log(`[Research] Previous summaries count: ${message.summaries.length}`);
  console.log(`[Research] Current content length: ${message.content.length}`);

  // reduce summaries into a single string
  const fullSummary = summaries.join("\n");
  console.log(`[Research] Combined summary length: ${fullSummary.length}`);
  
  // summarize the given content
  const completion = await OAI.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: summarizerPrompt },
      { role: "user", content: fullSummary }
    ],
  });

  const summary = completion.choices[0].message.content!;
  console.log(`[Research] Generated summary: ${summary}`);

  // publish a reflect request to the research service
  await researchTopicPub.publish({
    summaries: [
      // reset to the newly compacted summary
      summary
    ],
    type: "reflect",
    topic: message.topic,
    content: summary,
  });
}

async function handleReflect(message: ReflectTopicMessage) {
  console.log(`[Research] Reflecting on summary for topic: ${message.topic}`);
  console.log(`[Research] Current summary: ${message.content.substring(0, 200)}...`);
  
  // Here I want to use the reflection prompt I have to restart the research chain
  const completion = await OAI.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: reflectionPrompt(message.topic) },
      { role: "user", content: message.content }
    ],
  });

  // log out the provided content
  console.log(`[Research] Provided content: ${completion.choices[0].message.content!}`);

  // Parse the reflection response
  const reflection = JSON.parse(completion.choices[0].message.content!);
  console.log(`[Research] Reflection analysis:`, reflection);
  
  // Only restart research if knowledge gaps were identified
  if (reflection.knowledge_gap) {
    console.log(`[Research] Found knowledge gap: ${reflection.knowledge_gap}\nFollowing up with: ${reflection.follow_up_query}`);
    await researchTopicPub.publish({
      ...message,
      type: "create_query",
      topic: reflection.follow_up_query,
      date: new Date().toISOString(),
    });
  } else {
    console.log(`[Research] No knowledge gaps found. Writing final summary to bucket: ${message.topic}`);
    console.log(`[Research] Final summary length: ${message.content.length}`);
    // write the summary to a nitric bucket
    await researchBucket.file(message.topic).write(message.content);
  }
}

researchApi.post("/query", async (ctx) => {
  const query = ctx.req.text();

  // Submit off start of research chain
  await researchTopicPub.publish({
    summaries: [],
    type: "create_query",
    date: new Date().toISOString(),
    topic: `Query for ${query}`
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
