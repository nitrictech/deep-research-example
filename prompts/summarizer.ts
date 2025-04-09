export default (topics: string[]) => `<GOAL>
Generate a high-quality summary of the provided context for the following topics: 
${topics.map(topic => `- ${topic}`).join("\n")}
</GOAL>

<REQUIREMENTS>
When creating a summary:
1. Highlight the most relevant information related to the user topic from the search results
2. Ensure a coherent flow of information
3. Do not include any preamble or titles in your response.
4. Do not include a conclusion section in your response.                                                                                                                                                        
< /REQUIREMENTS >

< FORMATTING >
- Start directly with the updated summary, without preamble or titles. Do not use XML tags in the output.  
< /FORMATTING >

<Task>
Think carefully about the provided Context first. Then generate a summary of the context to address the User Input.
</Task>`