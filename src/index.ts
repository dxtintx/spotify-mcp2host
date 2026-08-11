// @ts-nocheck
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { albumTools } from './albums.js';
import { playTools } from './play.js';
import { playlistTools } from './playlist.js';
import { readTools } from './read.js';
import { createSpotifyApi } from './utils.js';

const app = express();

// Нужно для чтения JSON-RPC тела в POST-запросах Streamable HTTP transport
app.use(express.json());

// --- РАДАР: Логируем абсолютно все входящие запросы ---
app.use((req, res, next) => {
  console.log(`[RADAR] Запрос от клиента: ${req.method} ${req.originalUrl}`);
  console.log(`[RADAR] Заголовки:`, req.headers);
  next();
});

// Настраиваем CORS. mcp-session-id обязателен и в allowedHeaders, и в exposedHeaders,
// иначе клиент не сможет ни отправить, ни прочитать заголовок сессии.
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  allowedHeaders: ['*', 'mcp-session-id', 'Content-Type'],
  exposedHeaders: ['mcp-session-id'],
  credentials: true
}));

app.options('/sse', cors());

const allTools = [...readTools, ...playTools, ...albumTools, ...playlistTools];

// ВАЖНО: McpServer можно подключить только к ОДНОМУ транспорту одновременно.
// Если использовать общий на весь процесс инстанс, вторая параллельная
// сессия (второй initialize, что Google Spark иногда делает) сломает
// первую с ошибкой "Already connected to a transport". Поэтому создаём
// новый McpServer под каждую новую сессию.
function createMcpServer() {
  const server = new McpServer({
    name: 'spotify-controller',
    version: '1.0.0',
  });

  allTools.forEach((tool) => {
    server.tool(tool.name, tool.description, tool.schema, tool.handler);
  });

  return server;
}

// Транспорты по sessionId (Streamable HTTP transport, актуальная версия MCP-спеки)
const transports = new Map();

app.get('/', (req, res) => {
  res.status(200).send('Spotify MCP Server is perfectly running!');
});

// Единая точка входа для Streamable HTTP transport.
// GET  — открытие SSE-потока для существующей сессии (server -> client push)
// POST — JSON-RPC сообщения от клиента, включая initialize
// DELETE — закрытие сессии
// Именно так подключается Google Spark/Gemini — он шлёт HEAD, затем POST
// с initialize-запросом прямо на этот URL, а не на отдельный /messages.
app.all('/sse', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];
    let transport;

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId);
    } else if (req.method === 'POST' && !sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          console.log(`--- MCP session initialized: ${sid} ---`);
          transports.set(sid, transport);
        },
      });

      const server = createMcpServer();

      transport.onclose = () => {
        if (transport.sessionId) {
          console.log(`--- MCP session closed: ${transport.sessionId} ---`);
          transports.delete(transport.sessionId);
        }
        server.close();
      };

      await server.connect(transport);
    } else if (req.method === 'HEAD') {
      // Google Spark проверяет доступность URL перед подключением
      res.status(200).end();
      return;
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
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
