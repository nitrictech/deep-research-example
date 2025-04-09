import { search, SafeSearchType } from "duck-duck-scrape";

export default async (query: string, topN: number = 3) => {
  const results = await search(query, { safeSearch: SafeSearchType.STRICT });
  
  // Get the top 3 most relevant results
  const topResults = results.results.slice(0, topN);
  
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

  // Filter out failed fetches and return the results
  return htmlContents.filter(content => content !== null);
}