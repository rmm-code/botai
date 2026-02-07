import express, { Express, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import { connectDatabase, disconnectDatabase } from './config/database';
import { connectRedis, disconnectRedis } from './config/redis';
import { initializeQueueProcessor } from './services/messageQueue';
import { validateWebhook } from './middleware/validateWebhook';
import { registerBot, listBots, getBot, deleteBot, toggleBot } from './controllers/botController';
import { handleWebhook, healthCheck } from './controllers/webhookController';
import { logger } from './utils/logger';

// Load environment variables
dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
});

// Health check
app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Bot API routes
app.post('/api/bots', registerBot);
app.get('/api/bots', listBots);
app.get('/api/bots/:id', getBot);
app.delete('/api/bots/:id', deleteBot);
app.patch('/api/bots/:id/toggle', toggleBot);

// Webhook routes
app.get('/webhook/health', healthCheck);
app.post('/webhook/:botToken', validateWebhook, handleWebhook);

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error(`Unhandled error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
});

// Graceful shutdown
async function shutdown(): Promise<void> {
    logger.info('Shutting down gracefully...');
    await disconnectDatabase();
    await disconnectRedis();
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start server
async function start(): Promise<void> {
    try {
        // Connect to services
        await connectDatabase();
        await connectRedis();

        // Initialize queue processor
        initializeQueueProcessor();

        // Start Express server
        app.listen(PORT, () => {
            logger.info(`🚀 Server running on port ${PORT}`);
            logger.info(`📡 Webhook endpoint: POST /webhook/:botToken`);
            logger.info(`🤖 Bot API: /api/bots`);
        });
    } catch (error) {
        logger.error(`Failed to start server: ${(error as Error).message}`);
        process.exit(1);
    }
}

start();
