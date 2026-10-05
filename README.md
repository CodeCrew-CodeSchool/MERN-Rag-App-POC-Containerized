# EmbedJS RAG App POC

A beginner-friendly Retrieval-Augmented Generation template using React, Node.js, EmbedJS, Ollama, MongoDB Atlas, and Docker Compose.

## Architecture

```text
React frontend
      |
      | POST /api/chat
      v
Node + Express backend
      |
      |-- EmbedJS RAGApplicationBuilder
      |-- RAG sources configured in app.mjs
      |-- HNSWDb or MongoDb vector store
      |
      +------> Ollama
      |
      +------> MongoDB Atlas (optional)
```

The browser only sends questions. Developers configure RAG sources in `backend/app.mjs`.

## Project structure

```text
.
├── backend/
│   ├── data/sample.csv
│   ├── .env.example
│   ├── app.mjs
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   ├── .env.example
│   ├── Dockerfile
│   └── package.json
├── ollama/
│   ├── .env.example
│   ├── Dockerfile
│   └── entrypoint.sh
├── docker-compose.yml
└── README.md
```

## Prerequisite

Install Docker with Docker Compose support. Node.js, Ollama, and application dependencies run inside containers.

## 1. Create service environment files

From the repository root:

```bash
cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env
cp ollama/.env.example ollama/.env
```

`frontend/.env` points Vite to the backend container:

```env
BACKEND_URL=http://backend:3000
```

Important backend settings in `backend/.env`:

```env
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=llama3.2
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
RAG_VECTOR_DB=hnsw
RAG_SEARCH_RESULT_COUNT=8
MONGODB_URI=
```

Set `MONGODB_URI` if you want Atlas source documents, chat history, or the EmbedJS MongoDB vector store.

The Atlas cluster, database user, and network access must already exist. On the first connection, the backend creates `MONGODB_DB_NAME` and `MONGODB_SOURCE_COLLECTION` if needed.

`ollama/.env` controls the Ollama service:

```env
OLLAMA_HOST=0.0.0.0:11434
OLLAMA_MODEL=llama3.2
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
```

Keep the model names the same in `backend/.env` and `ollama/.env`.

## 2. Configure RAG sources

Edit the `ragSources` array near the top of `backend/app.mjs`.

The template starts with a small inline JSON source:

```js
const ragSources = [
  {
    type: 'json',
    data: [
      {
        topic: 'RAG template',
        description: 'This proof of concept uses EmbedJS, Ollama, React, Node.js, and Docker Compose.',
      },
    ],
  },
];
```

Supported source examples:

```js
// Web page
{ type: 'web', link: 'https://example.com' }

// PDF
{ type: 'pdf', link: 'https://example.com/file.pdf' }

// CSV copied into the backend image
{ type: 'csv', link: '/app/data/sample.csv' }

// MongoDB Atlas collection
{
  type: 'database',
  database: 'rag_poc',
  collection: 'rag_documents',
  limit: 100,
}

// Inline JSON
{
  type: 'json',
  data: [{ topic: 'Example', description: 'Example content' }],
}
```

You can combine several sources in the same array. Files placed in `backend/data` are copied to `/app/data` during the Docker build.

After changing `ragSources`, rebuild the backend image so the code change is copied into the container.

## 3. Start the application

```bash
docker compose up --build
```

Open `http://localhost:5173`.

The first startup downloads the configured chat and embedding models into the `ollama_data` Docker volume.

## Stop the application

```bash
docker compose down
```

Remove the Ollama model volume too:

```bash
docker compose down -v
```

## API

Ask a RAG question:

```http
POST /api/chat
Content-Type: application/json
```

```json
{
  "message": "What does the configured context say about RAG?"
}
```

The client does not send source configuration.

Other endpoints:

```text
GET /api/status
GET /api/health/live
GET /api/history
```

`/api/history` requires `MONGODB_URI`.

## Vector database

The default is the local EmbedJS HNSW store:

```env
RAG_VECTOR_DB=hnsw
```

To use the EmbedJS MongoDB vector store:

```env
RAG_VECTOR_DB=mongodb
MONGODB_URI=mongodb+srv://...
```

## Main RAG flow

`backend/app.mjs` builds the application with:

```js
new RAGApplicationBuilder()
  .setModel(new Ollama(...))
  .setEmbeddingModel(new OllamaEmbeddings(...))
  .setVectorDatabase(...)
  .build();
```

Configured sources are added with EmbedJS loaders. Questions are answered with:

```js
await rag.query(message);
```
