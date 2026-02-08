import Bull, { Job } from 'bull';
import { bullRedisConfig } from '../config/redis';
import { prisma } from '../config/database';
import { sendMessage } from './telegramService';
import { generateResponse } from './aiService';
import { waitForRateLimit } from '../utils/rateLimiter';
import { logger } from '../utils/logger';

interface MessageJobData {
    botToken: string;
    botId: string;
    groupId: string;
    groupTelegramId: string;
    respondingBotUsername: string;
    personality: string;
    replyToMsgId?: number;
}

// Create message queue
export const messageQueue = new Bull<MessageJobData>('message-relay', bullRedisConfig);

// ... (listeners)

/**
 * Add a message job to the queue with delay
 */
export async function addToQueue(data: MessageJobData): Promise<Job<MessageJobData>> {
    const delay = Math.floor(Math.random() * 1000) + 500;

    const job = await messageQueue.add(data, {
        delay,
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
    });

    logger.info(`Message job ${job.id} added to queue with ${delay}ms delay`);
    return job;
}

/**
 * Process message jobs from the queue
 */
export async function processMessage(job: Job<MessageJobData>): Promise<void> {
    const { botToken, botId, groupId, groupTelegramId, respondingBotUsername, personality, replyToMsgId } = job.data;

    logger.info(`Processing message job ${job.id} for bot @${respondingBotUsername}`);

    try {
        // Wait for rate limit
        await waitForRateLimit(botId);

        // Fetch recent conversation history
        const recentMessages = await prisma.message.findMany({
            where: { groupId },
            orderBy: { timestamp: 'desc' },
            take: 10,
            include: { bot: true },
        });

        // Build conversation context
        const conversationHistory = recentMessages.reverse().map((msg) => ({
            botUsername: msg.isAiGenerated ? msg.bot.username : 'User', // Correctly attribute user messages
            text: msg.text,
            isAiGenerated: msg.isAiGenerated,
        }));

        // Generate AI response
        const responseText = await generateResponse(
            personality,
            conversationHistory,
            respondingBotUsername
        );

        // Send message to Telegram (with Reply ID if present)
        const sentMessageId = await sendMessage(botToken, groupTelegramId, responseText, replyToMsgId);

        if (sentMessageId) {
            // Store the sent message
            await prisma.message.create({
                data: {
                    botId,
                    groupId,
                    text: responseText,
                    isAiGenerated: true,
                    telegramMsgId: BigInt(sentMessageId),
                },
            });

            logger.info(`Bot @${respondingBotUsername} sent: ${responseText.substring(0, 50)}...`);

            // AUTOMATIC RELAY: Since Telegram bots can't see each other's messages via API,
            // we must manually trigger the next bot's response loop internally.
            // Find the NEXT bot to respond (excluding the current one)
            const nextBot = await selectNextBot(groupId, groupTelegramId, botId);

            if (nextBot) {
                // Determine next sender's delay (randomized for natural feel)
                await addToQueue({
                    botToken: nextBot.token,
                    botId: nextBot.id,
                    groupId,
                    groupTelegramId,
                    respondingBotUsername: nextBot.username,
                    personality: nextBot.personality,
                    // DO NOT pass replyToMsgId here. Telegram API blocks bots replying to bots (Error 400).
                    // We keep the conversation linear.
                });
                logger.info(`Valid relay: Triggering response from @${nextBot.username}`);
            } else {
                logger.info('No other bots in group to continue conversation');
            }
        }
    } catch (error) {
        logger.error(`Message processing failed: ${(error as Error).message}`);
        throw error; // Re-throw to trigger retry
    }
}

/**
 * Initialize queue processor
 */
export function initializeQueueProcessor(): void {
    messageQueue.process(1, processMessage); // Process 1 job at a time
    logger.info('Message queue processor initialized');
}

/**
 * Select the next bot to respond (round-robin)
 */
export async function selectNextBot(
    groupUuid: string,
    groupTelegramId: string,
    excludeBotId: string
): Promise<{ id: string; token: string; username: string; personality: string } | null> {
    try {
        // Get all active bots in the group (using Telegram ID) except the one that just sent
        const bots = await prisma.bot.findMany({
            where: {
                groupId: groupTelegramId, // This is the Telegram Group ID
                isActive: true,
                id: { not: excludeBotId },
            },
            orderBy: { createdAt: 'asc' },
        });

        if (bots.length === 0) {
            logger.warn(`No active bots found for group ${groupTelegramId}`);
            return null;
        }

        // Get the last message to determine whose turn it is (using UUID)
        const lastMessage = await prisma.message.findFirst({
            where: { groupId: groupUuid, isAiGenerated: true },
            orderBy: { timestamp: 'desc' },
        });

        // Find the next bot in rotation
        let nextBotIndex = 0;
        if (lastMessage) {
            const lastBotIndex = bots.findIndex((b) => b.id === lastMessage.botId);
            if (lastBotIndex !== -1) {
                nextBotIndex = (lastBotIndex + 1) % bots.length;
            }
        }

        const nextBot = bots[nextBotIndex];
        return {
            id: nextBot.id,
            token: nextBot.token,
            username: nextBot.username,
            personality: nextBot.personality,
        };
    } catch (error) {
        logger.error(`Bot selection failed: ${(error as Error).message}`);
        return null;
    }
}
