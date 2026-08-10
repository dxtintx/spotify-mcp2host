import express, { Request, Response } from 'express';
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

// Регистрируем тулы
[...readTools, ...playTools, ...albumTools, ...playlistTools].forEach((tool) => {
  server.tool(
    tool.name,
    tool.description,
    tool.schema,
    tool.handler as Parameters<typeof server.tool>[3]
  );
});

// Хранилище сессий SSE
const transports = new Map<string, SSEServerTransport>();

// 1. Health check для Render (чтобы деплой завершался успешно)
app.get('/', (_req: Request, res: Response) => {
  res.status(200).send('Spotify MCP Server is running!');
});

// 2. Эндпоинт для открытия SSE соединения
app.get('/sse', async (req: Request, res: Response) => {
  console.log('New SSE connection requested');
  const transport = new SSEServerTransport('/messages', res);
  transports.set(transport.sessionId, transport);

  req.on('close', () => {
    console.log(`Session closed: ${transport.sessionId}`);
    transports.delete(transport.sessionId);
  });

  await server.connect(transport);
});

// 3. Эндпоинт для отправки сообщений от клиента
app.post('/messages', async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId) {
    res.status(400).send('Missing sessionId query parameter');
    return;
  }

  const transport = transports.get(sessionId);
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send('Session not found');
  }
});

// Автоматическое обновление токена каждые 45 минут
setInterval(async () => {
  try {
    await createSpotifyApi();
  } catch {
    // Игнорируем ошибки при фоновом обновлении
  }
}, 45 * 60 * 1000);

// Запуск сервера на порту от Render
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`MCP Spotify Server successfully running on port ${PORT}`);
});