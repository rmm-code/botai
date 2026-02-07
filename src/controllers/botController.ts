import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { validateToken, setWebhook, removeWebhook, removeBotInstance } from '../services/telegramService';
import { logger } from '../utils/logger';

const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN || 'https://yourdomain.com';

interface RegisterBotBody {
    token: string;
    personality: string;
    groupId: string;
}

/**
 * Register a new bot
 * POST /api/bots
 */
export async function registerBot(req: Request, res: Response): Promise<void> {
    try {
        const { token, personality, groupId } = req.body as RegisterBotBody;

        // Validate required fields
        if (!token || !personality || !groupId) {
            res.status(400).json({
                error: 'Missing required fields: token, personality, groupId',
            });
            return;
        }

        // Check if bot already exists
        const existingBot = await prisma.bot.findUnique({
            where: { token },
        });

        if (existingBot) {
            res.status(409).json({ error: 'Bot already registered' });
            return;
        }

        // Validate token with Telegram API
        const botInfo = await validateToken(token);
        if (!botInfo) {
            res.status(400).json({ error: 'Invalid bot token' });
            return;
        }

        // Create or update group
        await prisma.group.upsert({
            where: { telegramId: groupId },
            create: {
                telegramId: groupId,
                name: `Group ${groupId}`,
                activeBots: 1,
            },
            update: {
                activeBots: { increment: 1 },
            },
        });

        // Create bot record
        const bot = await prisma.bot.create({
            data: {
                token,
                username: botInfo.username,
                personality,
                groupId,
            },
        });

        // Set webhook
        const webhookUrl = `${WEBHOOK_DOMAIN}/webhook/${token}`;
        const webhookSet = await setWebhook(token, webhookUrl);

        if (!webhookSet) {
            logger.warn(`Failed to set webhook for bot @${botInfo.username}`);
        }

        logger.info(`Bot registered: @${botInfo.username} (${bot.id})`);

        res.status(201).json({
            success: true,
            bot: {
                id: bot.id,
                username: botInfo.username,
                personality: bot.personality,
                groupId: bot.groupId,
                webhookUrl,
            },
        });
    } catch (error) {
        logger.error(`Bot registration failed: ${(error as Error).message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * List all registered bots
 * GET /api/bots
 */
export async function listBots(req: Request, res: Response): Promise<void> {
    try {
        const bots = await prisma.bot.findMany({
            select: {
                id: true,
                username: true,
                personality: true,
                groupId: true,
                isActive: true,
                createdAt: true,
                _count: {
                    select: { messages: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        res.json({
            success: true,
            bots: bots.map((bot) => ({
                ...bot,
                messageCount: bot._count.messages,
                _count: undefined,
            })),
        });
    } catch (error) {
        logger.error(`List bots failed: ${(error as Error).message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Get bot by ID
 * GET /api/bots/:id
 */
export async function getBot(req: Request, res: Response): Promise<void> {
    try {
        const { id } = req.params;

        const bot = await prisma.bot.findUnique({
            where: { id },
            include: {
                messages: {
                    orderBy: { timestamp: 'desc' },
                    take: 20,
                },
            },
        });

        if (!bot) {
            res.status(404).json({ error: 'Bot not found' });
            return;
        }

        res.json({
            success: true,
            bot: {
                id: bot.id,
                username: bot.username,
                personality: bot.personality,
                groupId: bot.groupId,
                isActive: bot.isActive,
                createdAt: bot.createdAt,
                recentMessages: bot.messages,
            },
        });
    } catch (error) {
        logger.error(`Get bot failed: ${(error as Error).message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Delete a bot
 * DELETE /api/bots/:id
 */
export async function deleteBot(req: Request, res: Response): Promise<void> {
    try {
        const { id } = req.params;

        const bot = await prisma.bot.findUnique({
            where: { id },
        });

        if (!bot) {
            res.status(404).json({ error: 'Bot not found' });
            return;
        }

        // Remove webhook
        await removeWebhook(bot.token);
        removeBotInstance(bot.token);

        // Delete bot (messages cascade deleted)
        await prisma.bot.delete({
            where: { id },
        });

        // Update group bot count
        await prisma.group.update({
            where: { telegramId: bot.groupId },
            data: { activeBots: { decrement: 1 } },
        });

        logger.info(`Bot deleted: @${bot.username} (${id})`);

        res.json({ success: true, message: 'Bot deleted successfully' });
    } catch (error) {
        logger.error(`Delete bot failed: ${(error as Error).message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Toggle bot active status
 * PATCH /api/bots/:id/toggle
 */
export async function toggleBot(req: Request, res: Response): Promise<void> {
    try {
        const { id } = req.params;

        const bot = await prisma.bot.findUnique({
            where: { id },
        });

        if (!bot) {
            res.status(404).json({ error: 'Bot not found' });
            return;
        }

        const updatedBot = await prisma.bot.update({
            where: { id },
            data: { isActive: !bot.isActive },
        });

        logger.info(`Bot ${updatedBot.isActive ? 'activated' : 'deactivated'}: @${bot.username}`);

        res.json({
            success: true,
            bot: {
                id: updatedBot.id,
                username: updatedBot.username,
                isActive: updatedBot.isActive,
            },
        });
    } catch (error) {
        logger.error(`Toggle bot failed: ${(error as Error).message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
}
