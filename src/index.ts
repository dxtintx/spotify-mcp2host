// @ts-nocheck
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { albumTools } from './albums.js';
import { playTools } from './play.js';
import { playlistTools } from './playlist.js';
import { readTools } from './read.js';
import { createSpotifyApi } from './utils.js';

const app = express();

const server = new McpServer({
  name: 'spotify-controller',
  version: '1.0.0',
});

const allTools = [...readTools, ...playTools, ...albumTools, ...playlistTools];

// Умная регистрация тулов, которая обходит баги SDK
allTools.forEach((tool) => {
  // 1. Если схемы нет (тул без параметров), передаем пустой объект {}
  let shape = tool.schema || {};

  // 2. Если схема уже обернута в ZodObject, достаем из нее сырую форму (shape)
  if (shape && shape.shape) {
    shape = shape.shape;
  }

  // 3. Вызываем метод SDK с правильным количеством аргументов
  if (tool.description) {
    server.tool(tool.name, tool.description, shape, tool.handler);
  } else {
    server.tool(tool.name, shape, tool.handler);
  }
});

// Хранилище сессий SSE
const transports = new Map();

// Эндпоинт для проверки здоровья сервера (чтобы Render понимал, что сервер жив)
app.get('/', (req, res) => {
  res.status(200).send('Spotify MCP Server is perfectly running!');
});

// Эндпоинт для старта SSE соединения
app.get('/sse', async (req, res) => {
  console.log('New SSE connection initiated');
  const transport = new SSEServerTransport('/messages', res);
  transports.set(transport.sessionId, transport);

  req.on('close', () => {
    console.log(`Connection closed for session: ${transport.sessionId}`);
    transports.delete(transport.sessionId);
  });

  await server.connect(transport);
});

// Эндпоинт для приема сообщений
app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId;
  if (!sessionId) {
    return res.status(400).send('Missing sessionId');
  }

  const transport = transports.get(sessionId);
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send('Session not found');
  }
});

// Поддержание токена Spotify живым
setInterval(async () => {
  try {
    await createSpotifyApi();
  } catch (error) {
    console.error('Background token refresh failed:', error);
  }
}, 45 * 60 * 1000);

// Запуск сервера с привязкой к порту Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server successfully started on port ${PORT}`);
});
