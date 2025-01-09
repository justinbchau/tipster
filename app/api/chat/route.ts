import { NextRequest, NextResponse } from "next/server";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { OpenAIEmbeddings } from "@langchain/openai";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { Document } from "@langchain/core/documents";
import { Annotation } from "@langchain/langgraph";
import { StateGraph } from "@langchain/langgraph";
import { pgVectorStoreConfig } from "@/config/database";
import { BufferMemory } from "langchain/memory";

// Create our own prompt template instead of pulling from hub
const promptTemplate = ChatPromptTemplate.fromTemplate(`You are a knowledgeable financial expert and market analyst who stays current with stock market trends. You have deep expertise in the field and speak with authority based on your knowledge.

Previous conversation:
{chat_history}

Context information from database:
{context}

Current question: {question}

CRITICAL INSTRUCTION: You must ONLY use information that is explicitly present in the context provided above. However, never mention the context, database, or available information directly. If you don't have information about something, simply state that you don't have enough information about that specific topic.

❌ Don't say:
- "The article mentions..."
- "According to the report..."
- "As stated in..."
- "The document shows..."
- "Based on the available information..."
- "The context doesn't provide..."
- "The data shows..."
- "Current market indicators suggest..."

✅ Instead, say:
- "AMD's revenue has grown significantly..."
- "The market response has been positive..."
- "This strategic move positions the company..."
- "I don't have enough information about that specific aspect..."
- "I can't provide details about that particular topic..."

Example:
"The semiconductor sector is showing strong momentum this quarter [1]. Intel's new chip architecture represents a significant leap forward in processing capability [2]. I don't have enough information about their international market performance.

Sources:
1. [Market Analysis Report](https://example.com/report)
2. [Technical Review](https://example.com/review)"

Remember:
1. Use ONLY information from the provided context
2. Never mention context, data, or available information
3. For unknown information, simply state you don't have enough information
4. Speak as an expert using verified facts
5. Format sources as a numbered list with markdown links: '1. [Title](url)'`);

const memory = new BufferMemory({
  returnMessages: true,
  memoryKey: "chat_history",
  inputKey: "question",
  outputKey: "answer",
});

type InputStateType = {
  question: string;
  chat_history: string;
};

const StateAnnotation = Annotation.Root({
  question: Annotation<string>,
  chat_history: Annotation<string>,
  context: Annotation<Document[]>,
  answer: Annotation<string>,
});

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid API key' },
        { status: 401 }
      );
    }

    const apiKey = authHeader.split(' ')[1];
    

    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: apiKey
    });

    // Initialize vector store with Supabase
    const vectorStore = await PGVectorStore.initialize(embeddings, pgVectorStoreConfig);

    // Initialize ChatOpenAI with the provided API key
    const chat = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: "gpt-4o-mini",
      temperature: 0.7,
    });

    // Log the incoming request
    console.log('Received request:', {
      method: req.method,
      headers: Object.fromEntries(req.headers.entries()),
    });

    if (!req.body) {
      return NextResponse.json(
        { error: "Request body is required", details: "No request body found" },
        { status: 400 }
      );
    }

    let body;
    try {
      body = await req.json();
      console.log('Parsed request body:', body);
    } catch (e) {
      console.error('Error parsing request body:', e);
      return NextResponse.json(
        { error: "Invalid JSON", details: "Could not parse request body" },
        { status: 400 }
      );
    }

    if (!body?.question) {
      return NextResponse.json(
        { error: "Question is required", details: "No question provided in request" },
        { status: 400 }
      );
    }

    // Check environment variables
    const requiredEnvVars = ['PG_HOST', 'PG_PASSWORD'];
    const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingEnvVars.length > 0) {
      console.error('Missing environment variables:', missingEnvVars);
      return NextResponse.json(
        { 
          error: "Configuration Error", 
          details: `Missing environment variables: ${missingEnvVars.join(', ')}` 
        },
        { status: 500 }
      );
    }

    const { question } = body;

    const retrieve = async (state: InputStateType) => {
      console.log('Starting retrieval for question:', state.question);
      try {
        const retrievedDocs = await vectorStore.similaritySearch(
          state.question,
          10
        );
        
        console.log('Retrieved documents:', retrievedDocs.length);
        retrievedDocs.forEach((doc, index) => {
          console.log(`Document ${index + 1}:`, {
            content: doc.pageContent,
            metadata: doc.metadata
          });
        });
        
        return { context: retrievedDocs };
      } catch (error) {
        console.error('Error in retrieval:', error);
        throw error;
      }
    };

    const generate = async (state: typeof StateAnnotation.State) => {
      console.log('Starting generation with context length:', state.context.length);
      
      if (state.context.length === 0) {
        return { 
          answer: "I apologize, but I couldn't find any relevant information about that in my database. Could you please try rephrasing your question or ask about a different topic?" 
        };
      }

      const docsContent = state.context
        .map((doc) => {
          const url = doc.metadata?.url || '';
          const source = doc.metadata?.source || '';
          return `${doc.pageContent}\n[Source: ${source}${url ? ` - ${url}` : ''}]`;
        })
        .join("\n\n");
      
      console.log('Using context:', docsContent);

      const memoryResult = await memory.loadMemoryVariables({});
      
      const messages = await promptTemplate.invoke({
        question: state.question,
        context: docsContent,
        chat_history: memoryResult.chat_history || "",
      });

      const response = await chat.invoke(messages);
      console.log('Raw LLM Response:', response);
      console.log('Response type:', typeof response);
      console.log('Response structure:', JSON.stringify(response, null, 2));
      
      const responseText = response.content || String(response);
      console.log('Final responseText:', responseText);

      await memory.saveContext(
        { question: state.question },
        { answer: responseText }
      );

      return { answer: responseText };
    };

    const graph = new StateGraph(StateAnnotation)
      .addNode("retrieve", retrieve)
      .addNode("generate", generate)
      .addEdge("__start__", "retrieve")
      .addEdge("retrieve", "generate")
      .addEdge("generate", "__end__")
      .compile();

    console.log('Invoking graph with question:', question);
    const result = await graph.invoke({ 
      question,
      chat_history: await memory.loadMemoryVariables({}).then(m => m.chat_history || "")
    });

    return NextResponse.json({
      answer: result.answer
    });

  } catch (error) {
    console.error('Detailed API Error:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      error
    });
    
    return NextResponse.json(
      { 
        error: "Internal Server Error",
        details: error instanceof Error ? error.message : "Unknown error occurred",
        timestamp: new Date().toISOString()
      },
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  }
}
