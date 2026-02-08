import { Telegraf, Context } from 'telegraf';
import { logger } from '../utils/logger';

// Store active bot instances
const botInstances: Map<string, Telegraf<Context>> = new Map();

export interface TelegramBotInfo {
    id: number;
    username: string;
    firstName: string;
}

/**
 * Initialize a Telegraf bot instance
 */
export async function initializeBot(token: string): Promise<Telegraf<Context>> {
    if (botInstances.has(token)) {
        return botInstances.get(token)!;
    }

    const bot = new Telegraf(token);
    botInstances.set(token, bot);
    logger.info(`Bot initialized with token: ${token.substring(0, 10)}...`);
    return bot;
}

/**
 * Validate bot token with Telegram API
 */
export async function validateToken(token: string): Promise<TelegramBotInfo | null> {
    try {
        const bot = new Telegraf(token);
        const me = await bot.telegram.getMe();
        logger.info(`Token validated for bot: @${me.username}`);
        return {
            id: me.id,
            username: me.username || '',
            firstName: me.first_name,
        };
    } catch (error) {
        logger.error(`Token validation failed: ${(error as Error).message}`);
        return null;
    }
}

/**
 * Set webhook for a bot
 */
export async function setWebhook(token: string, webhookUrl: string): Promise<boolean> {
    try {
        const bot = await initializeBot(token);
        await bot.telegram.setWebhook(webhookUrl, {
            drop_pending_updates: true,
        });
        logger.info(`Webhook set for bot: ${webhookUrl}`);
        return true;
    } catch (error) {
        logger.error(`Failed to set webhook: ${(error as Error).message}`);
        return false;
    }
}

/**
 * Remove webhook for a bot
 */
export async function removeWebhook(token: string): Promise<boolean> {
    try {
        const bot = await initializeBot(token);
        await bot.telegram.deleteWebhook({ drop_pending_updates: true });
        logger.info(`Webhook removed for bot`);
        return true;
    } catch (error) {
        logger.error(`Failed to remove webhook: ${(error as Error).message}`);
        return false;
    }
}

/**
 * Send message to a chat
 */
export async function sendMessage(
    token: string,
    chatId: string | number,
    text: string,
    replyToMessageId?: number
): Promise<number | null> {
    try {
        const bot = await initializeBot(token);
        const result = await bot.telegram.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
            reply_to_message_id: replyToMessageId,
        } as any);
        logger.debug(`Message sent to chat ${chatId}: ${text.substring(0, 50)}...`);
        return result.message_id;
    } catch (error) {
        logger.error(`Failed to send message: ${(error as Error).message}`);
        return null;
    }
}

/**
 * Get bot instance by token
 */
export function getBotInstance(token: string): Telegraf<Context> | undefined {
    return botInstances.get(token);
}

/**
 * Remove bot instance
 */
export function removeBotInstance(token: string): void {
    botInstances.delete(token);
}

/**
 * Get webhook callback for Express
 */
export function getWebhookCallback(token: string) {
    const bot = botInstances.get(token);
    if (!bot) {
        throw new Error('Bot not initialized');
    }
    return bot.webhookCallback(`/webhook/${token}`);
}
