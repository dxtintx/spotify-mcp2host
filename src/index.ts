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

// 1. Обязательные middleware для CORS и парсинга JSON
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'mcp-session-id', 'mcp-protocol-version']
}));
app.use(express.json());

const server = new McpServer({
  name: 'spotify-controller',
  version: '1.0.0',
});

const allTools = [...readTools, ...playTools, ...albumTools, ...playlistTools];

allTools.forEach((tool) => {
  let shape = tool.schema || {};
  if (shape && shape.shape) {
    shape = shape.shape;
  }
  if (tool.description) {
    server.tool(tool.name, tool.description, shape, tool.handler);
  } else {
    server.tool(tool.name, shape, tool.handler);
  }
});

const transports = new Map();

// Главная заглушка
app.get('/', (req, res) => {
  res.status(200).send('Spotify MCP Server is perfectly running!');
});

// 2. Обработка SSE соединения с АБСОЛЮТНЫМ URL для сообщений
app.get('/sse', async (req, res) => {
  console.log('New SSE connection initiated by client');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Формируем полный абсолютный URL для эндпоинта отправки сообщений
  const host = req.get('host');
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const endpointUrl = `${protocol}://${host}/messages`;

  const transport = new SSEServerTransport(endpointUrl, res);
  transports.set(transport.sessionId, transport);

  req.on('close', () => {
    transports.delete(transport.sessionId);
  });

  await server.connect(transport);
});

// 3. Эндпоинт отправки сообщений (принимает sessionId и из Query, и из Headers)
app.post('/messages', async (req, res) => {
  const sessionId = (req.query.sessionId as string) || (req.headers['mcp-session-id'] as string);

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId' });
  }

  const transport = transports.get(sessionId);
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(404).json({ error: 'Session not found or expired' });
  }
});

// Обновление токена Spotify
setInterval(async () => {
  try {
    await createSpotifyApi();
  } catch (error) {
    console.error('Background token refresh failed:', error);
  }
}, 45 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server successfully running on port ${PORT}`);
});
