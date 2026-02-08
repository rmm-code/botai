import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { addToQueue, selectNextBot } from '../services/messageQueue';
import { initializeBot } from '../services/telegramService';
import { logger } from '../utils/logger';

interface TelegramMessage {
    message_id: number;
    chat: { id: number; type: string; title?: string };
    from?: { id: number; username?: string; is_bot: boolean };
    text?: string;
}

interface TelegramUpdate {
    update_id: number;
    message?: TelegramMessage;
}

/**
 * Handle incoming Telegram webhook updates
 * POST /webhook/:botToken
 */
export async function handleWebhook(req: Request, res: Response): Promise<void> {
    const { botToken } = req.params;
    const update = req.body as TelegramUpdate;

    // Respond immediately to Telegram
    res.sendStatus(200);

    try {
        // Only process text messages
        if (!update.message?.text) {
            return;
        }

        const message = update.message;
        const chatId = message.chat.id.toString();
        const chatType = message.chat.type;

        // Only process group messages
        if (chatType !== 'group' && chatType !== 'supergroup') {
            logger.debug(`Ignoring non-group message from chat ${chatId}`);
            return;
        }

        // Find the bot that received this message
        const bot = await prisma.bot.findUnique({
            where: { token: botToken },
        });

        if (!bot) {
            logger.warn('Received webhook for unregistered bot');
            return;
        }

        // Check if this group is registered
        const group = await prisma.group.findUnique({
            where: { telegramId: chatId },
        });

        if (!group) {
            logger.debug(`Message from unregistered group ${chatId}`);
            return;
        }

        // Check if message is from a registered bot
        const isFromBot = message.from?.is_bot;
        const senderUsername = message.from?.username;

        // Find the sending bot if it's one of ours
        const sendingBot = isFromBot && senderUsername
            ? await prisma.bot.findFirst({
                where: { username: senderUsername, groupId: chatId },
            })
            : null;

        // Store the message (if text exists) and avoid duplicates
        if (message.text) {
            const existingMessage = await prisma.message.findFirst({
                where: {
                    telegramMsgId: BigInt(message.message_id),
                    groupId: group.id,
                },
            });

            if (!existingMessage) {
                await prisma.message.create({
                    data: {
                        botId: sendingBot ? sendingBot.id : bot.id, // Assign to the bot receiving user message if needed
                        groupId: group.id,
                        text: message.text,
                        isAiGenerated: !!sendingBot,
                        telegramMsgId: BigInt(message.message_id),
                    },
                });
                logger.info(`Message stored: ${message.text.substring(0, 20)}... from ${senderUsername || 'user'}`);
            } else {
                logger.debug(`Duplicate message ignored: ${message.message_id}`);
            }
        }

        // If message is from a user or another bot, trigger AI response
        // Don't respond to our own bot's messages
        if (!sendingBot || sendingBot.id !== bot.id) {
            // Select next bot to respond
            const nextBot = await selectNextBot(group.id, group.telegramId, sendingBot?.id || '');

            // Only queue if WE are the chosen one (prevents duplicate responses from multiple webhook hits)
            if (nextBot && nextBot.id !== (sendingBot?.id || '') && nextBot.id === bot.id) {
                // Initialize bot instance if not already
                await initializeBot(nextBot.token);

                // Queue the response
                await addToQueue({
                    botToken: nextBot.token,
                    botId: nextBot.id,
                    groupId: group.id,
                    groupTelegramId: chatId,
                    respondingBotUsername: nextBot.username,
                    personality: nextBot.personality,
                });

                logger.info(`Queued response from @${nextBot.username}`);
            }
        }
    } catch (error) {
        logger.error(`Webhook handling failed: ${(error as Error).message}`);
    }
}

/**
 * Health check endpoint
 * GET /webhook/health
 */
export function healthCheck(req: Request, res: Response): void {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
}
