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

// Включаем CORS для любых источников
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

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

app.get('/', (req, res) => {
  res.status(200).send('Spotify MCP Server is perfectly running!');
});

// Эндпоинт SSE с явными заголовками
app.get('/sse', async (req, res) => {
  console.log('New SSE connection initiated');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const transport = new SSEServerTransport('/messages', res);
  transports.set(transport.sessionId, transport);

  req.on('close', () => {
    transports.delete(transport.sessionId);
  });

  await server.connect(transport);
});

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
