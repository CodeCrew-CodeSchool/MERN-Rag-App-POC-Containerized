import 'dotenv/config';
import express from 'express';
import { MongoClient } from 'mongodb';

import { JsonLoader, RAGApplicationBuilder } from '@llm-tools/embedjs';
import { Ollama, OllamaEmbeddings } from '@llm-tools/embedjs-ollama';
import { WebLoader } from '@llm-tools/embedjs-loader-web';
import { PdfLoader } from '@llm-tools/embedjs-loader-pdf';
import { CsvLoader } from '@llm-tools/embedjs-loader-csv';
import { MongoDb } from '@llm-tools/embedjs-mongodb';
import { HNSWDb } from '@llm-tools/embedjs-hnswlib';

const app = express();
app.use(express.json());

const config = {
  port: Number(process.env.PORT || 3000),
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://ollama:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3.2',
  embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
  vectorDatabaseType: (process.env.RAG_VECTOR_DB || 'hnsw').toLowerCase(),
  searchResultCount: Number(process.env.RAG_SEARCH_RESULT_COUNT || 8),
  mongoUri: process.env.MONGODB_URI || '',
  mongoDatabaseName: process.env.MONGODB_DB_NAME || 'rag_poc',
  mongoSourceCollection: process.env.MONGODB_SOURCE_COLLECTION || 'rag_documents',
  mongoChatCollection: process.env.MONGODB_CHAT_COLLECTION || 'chat_messages',
};

/*
 * Configure RAG sources here.
 * Students can add or remove sources, then restart the backend container.
 *
 * Examples:
 * { type: 'web', link: 'https://example.com' }
 * { type: 'pdf', link: 'https://example.com/file.pdf' }
 * { type: 'csv', link: '/app/data/example.csv' }
 * { type: 'database', collection: 'rag_documents', limit: 100 }
 * { type: 'json', data: [{ topic: 'RAG', description: 'Retrieval adds context before generation.' }] }
 */
const ragSources = [
  {
    type: 'json',
    data: [
      {
        topic: 'RAG template',
        description:
          'This proof of concept uses EmbedJS, Ollama, React, Node.js, and Docker Compose.',
      },
    ],
  },
  {
    type: 'csv',
    link: './data/sample.csv'
  }
];

let mongoClient;
let ragApplication;

/**
 * Converts a MongoDB document to plain JSON.
 * @param {object} document - MongoDB document to convert.
 * @returns {object} JSON-friendly document.
 */
function serializeDocument(document) {
  return { ...document, _id: String(document._id) };
}

/**
 * Checks whether MongoDB has been configured.
 * @returns {boolean} True when a connection string exists.
 */
function isMongoConfigured() {
  return Boolean(config.mongoUri);
}

/**
 * Creates the RAG source collection when it does not exist.
 * @param {MongoClient} client - Connected MongoDB client.
 * @returns {Promise<void>}
 */
async function initializeMongoDatabase(client) {
  const database = client.db(config.mongoDatabaseName);
  const collections = await database
    .listCollections({}, { nameOnly: true })
    .toArray();

  const collectionExists = collections.some(
    (collection) => collection.name === config.mongoSourceCollection,
  );

  if (!collectionExists) {
    await database.createCollection(config.mongoSourceCollection);
    console.log(`Created MongoDB collection: ${config.mongoSourceCollection}`);
  }
}

/**
 * Opens and reuses the MongoDB connection.
 * @returns {Promise<object|null>} MongoDB client and default database.
 */
async function getMongoConnection() {
  if (!isMongoConfigured()) {
    return null;
  }

  if (!mongoClient) {
    mongoClient = new MongoClient(config.mongoUri);
    await mongoClient.connect();
    await initializeMongoDatabase(mongoClient);
  }

  return {
    client: mongoClient,
    db: mongoClient.db(config.mongoDatabaseName),
  };
}

/**
 * Creates the vector database used by EmbedJS.
 * @returns {HNSWDb|MongoDb} Configured vector database.
 */
function createVectorDatabase() {
  if (config.vectorDatabaseType === 'mongodb') {
    if (!config.mongoUri) {
      throw new Error('RAG_VECTOR_DB=mongodb requires MONGODB_URI.');
    }

    return new MongoDb({ connectionString: config.mongoUri });
  }

  return new HNSWDb();
}

/**
 * Loads documents from MongoDB into the RAG application.
 * @param {object} rag - EmbedJS RAG application.
 * @param {object} source - MongoDB source settings.
 * @returns {Promise<void>}
 */
async function loadDatabaseSource(rag, source) {
  const mongo = await getMongoConnection();

  if (!mongo) {
    throw new Error('Database sources require MONGODB_URI.');
  }

  const databaseName = source.database || config.mongoDatabaseName;
  const collectionName = source.collection || config.mongoSourceCollection;
  const limit = Number(source.limit || 100);

  const documents = await mongo.client
    .db(databaseName)
    .collection(collectionName)
    .find({})
    .limit(limit)
    .toArray();

  await rag.addLoader(
    new JsonLoader({ object: documents.map(serializeDocument) }),
  );
}

/**
 * Loads one configured source into EmbedJS.
 * @param {object} rag - EmbedJS RAG application.
 * @param {object} source - Source settings from ragSources.
 * @returns {Promise<void>}
 */
async function loadSource(rag, source) {
  switch (source.type) {
    case 'web':
      await rag.addLoader(new WebLoader({ urlOrContent: source.link }));
      break;
    case 'pdf':
      await rag.addLoader(new PdfLoader({ filePathOrUrl: source.link }));
      break;
    case 'csv':
      await rag.addLoader(new CsvLoader({ filePathOrUrl: source.link }));
      break;
    case 'database':
      await loadDatabaseSource(rag, source);
      break;
    case 'json':
      await rag.addLoader(new JsonLoader({ object: source.data }));
      break;
    default:
      throw new Error(`Unsupported source type: ${source.type}`);
  }
}

/**
 * Loads every source configured in ragSources.
 * @param {object} rag - EmbedJS RAG application.
 * @returns {Promise<void>}
 */
async function loadSources(rag) {
  for (const source of ragSources) {
    await loadSource(rag, source);
  }
}

/**
 * Builds the EmbedJS RAG application and loads its sources.
 * @returns {Promise<object>} Ready RAG application.
 */
async function buildRagApplication() {
  const rag = await new RAGApplicationBuilder()
    .setModel(
      new Ollama({
        modelName: config.ollamaModel,
        baseUrl: config.ollamaBaseUrl,
      }),
    )
    .setEmbeddingModel(
      new OllamaEmbeddings({
        model: config.embeddingModel,
        baseUrl: config.ollamaBaseUrl,
      }),
    )
    .setVectorDatabase(createVectorDatabase())
    .setSearchResultCount(config.searchResultCount)
    .setSystemMessage(
      'Answer using the retrieved context. If the context does not contain the answer, say so.',
    )
    .build();

  await loadSources(rag);
  return rag;
}

/**
 * Builds the RAG application once and reuses it.
 * @returns {Promise<object>} Shared RAG application.
 */
async function getRagApplication() {
  if (!ragApplication) {
    ragApplication = await buildRagApplication();
  }

  return ragApplication;
}

/**
 * Saves a successful chat when MongoDB is configured.
 * @param {string} message - Student or user question.
 * @param {string} reply - RAG response.
 * @returns {Promise<void>}
 */
async function saveChat(message, reply) {
  if (!isMongoConfigured()) {
    return;
  }

  const mongo = await getMongoConnection();

  await mongo.db.collection(config.mongoChatCollection).insertOne({
    message,
    reply,
    createdAt: new Date(),
  });
}

/**
 * Returns a simple backend health response.
 * @param {object} _req - Express request.
 * @param {object} res - Express response.
 */
function handleHealth(_req, res) {
  res.json({ ok: true, service: 'backend' });
}

/**
 * Returns basic service and RAG configuration status.
 * @param {object} _req - Express request.
 * @param {object} res - Express response.
 * @returns {Promise<void>}
 */
async function handleStatus(_req, res) {
  let ollama = 'unavailable';

  try {
    const response = await fetch(`${config.ollamaBaseUrl}/api/tags`);
    ollama = response.ok ? 'ok' : 'error';
  } catch {
    ollama = 'unavailable';
  }

  res.json({
    backend: 'ok',
    ollama,
    mongodb: isMongoConfigured() ? 'configured' : 'not configured',
    rag: {
      model: config.ollamaModel,
      embeddingModel: config.embeddingModel,
      vectorDatabase: config.vectorDatabaseType,
      configuredSources: ragSources.length,
    },
  });
}

/**
 * Sends a question through the EmbedJS RAG application.
 * @param {object} req - Express request containing a message.
 * @param {object} res - Express response.
 * @returns {Promise<void>}
 */
async function handleChat(req, res) {
  const message = String(req.body?.message || '').trim();

  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  try {
    const rag = await getRagApplication();
    const result = await rag.query(message);
    const reply = result?.content ?? String(result ?? '');

    await saveChat(message, reply);
    res.json({ reply });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Returns the 20 newest saved chats from MongoDB.
 * @param {object} _req - Express request.
 * @param {object} res - Express response.
 * @returns {Promise<void>}
 */
async function handleHistory(_req, res) {
  const mongo = await getMongoConnection();

  if (!mongo) {
    res.status(503).json({ error: 'MongoDB is not configured.' });
    return;
  }

  const history = await mongo.db
    .collection(config.mongoChatCollection)
    .find({})
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();

  res.json(history);
}

app.get('/api/health/live', handleHealth);
app.get('/api/status', handleStatus);
app.post('/api/chat', handleChat);
app.get('/api/history', handleHistory);

app.listen(config.port, '0.0.0.0');
