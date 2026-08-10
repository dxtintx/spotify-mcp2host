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

// Регистрируем тулы
[...readTools, ...playTools, ...albumTools, ...playlistTools].forEach((tool) => {
    server.tool(tool.name, tool.description, tool.schema, tool.handler);
});

// Периодическое обновление токена
setInterval(async () => {
    try {
        await createSpotifyApi();
    } catch {
        // Ошибка обработается при следующем вызове
    }
}, 45 * 60 * 1000);

// Хранилище для активных SSE-транспортов
const transports = new Map();

// 1. Эндпоинт для открытия SSE-соединения (клиент подключается сюда)
app.get('/sse', async (req, res) => {
    const transport = new SSEServerTransport('/messages', res);
    transports.set(transport.sessionId, transport);

    req.on('close', () => {
        transports.delete(transport.sessionId);
    });

    await server.connect(transport);
});

// 2. Эндпоинт для приема команд от клиента
app.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId;
    const transport = transports.get(sessionId);

    if (transport) {
        await transport.handlePostMessage(req, res);
    } else {
        res.status(400).send('Session not found');
    }
});

// Запуск HTTP-сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`MCP Spotify Server running on port ${PORT}`);
});
