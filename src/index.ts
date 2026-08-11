// @ts-nocheck
import express from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { albumTools } from './albums.js';
import { playTools } from './play.js';
import { playlistTools } from './playlist.js';
import { readTools } from './read.js';
import { createSpotifyApi } from './utils.js';

const app = express();

// 1. Обязательный CORS для Google Spark, без жестких ограничений
// --- РАДАР: Логируем абсолютно все входящие запросы ---
app.use((req, res, next) => {
  console.log(`[RADAR] Запрос от клиента: ${req.method} ${req.originalUrl}`);
  console.log(`[RADAR] Заголовки:`, req.headers);
  next();
});

// Настраиваем CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  allowedHeaders: ['*'],
  credentials: true
}));

// Явная обработка OPTIONS только для нужных путей (без звездочек!)
app.options('/sse', cors());
app.options('/messages', cors());

const server = new McpServer({
  name: 'spotify-controller',
  version: '1.0.0',
});

const allTools = [...readTools, ...playTools, ...albumTools, ...playlistTools];

// 2. Возвращаем вашу ОРИГИНАЛЬНУЮ регистрацию.
// @ts-nocheck позволяет сохранить целыми Zod-схемы, которые нужны Google Spark.
allTools.forEach((tool) => {
  server.tool(tool.name, tool.description, tool.schema, tool.handler);
});

const transports = new Map();

app.get('/', (req, res) => {
  res.status(200).send('Spotify MCP Server is perfectly running!');
});

// Google Spark (и другие клиенты) перед реальным подключением делают
// HEAD-запрос на /sse, чтобы проверить доступность эндпоинта.
// Express по умолчанию направляет HEAD в тот же обработчик, что и GET,
// а наш GET-обработчик открывает бесконечный SSE-поток и никогда не
// завершает ответ — из-за этого HEAD-запрос зависает до таймаута,
// и Spark считает URL недоступным. Отвечаем на HEAD сразу и без
// открытия SSE-транспорта.
app.head('/sse', (req, res) => {
  console.log('--- HEAD /sse (reachability check) ---');
  res.status(200).end();
});

app.get('/sse', async (req, res) => {
  console.log('--- SSE Connection Started by Client ---');

  // Возвращаем стандартный относительный путь, Google Spark умеет его склеивать
  const transport = new SSEServerTransport('/messages', res);
  transports.set(transport.sessionId, transport);

  req.on('close', () => {
    console.log(`--- SSE Connection Closed: ${transport.sessionId} ---`);
    transports.delete(transport.sessionId);
  });

  await server.connect(transport);
});

app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId as string;

  if (!sessionId) {
    return res.status(400).send('Missing sessionId');
  }

  const transport = transports.get(sessionId);
  if (!transport) {
    return res.status(404).send('Session not found');
  }

  // Передаем запрос напрямую в SDK
  await transport.handlePostMessage(req, res);
});

setInterval(async () => {
  try {
    await createSpotifyApi();
  } catch (error) {
    console.error('Background token refresh failed:', error);
  }
}, 45 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server successfully started on port ${PORT}`);
});
