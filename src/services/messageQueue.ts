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
}

// Create message queue
export const messageQueue = new Bull<MessageJobData>('message-relay', bullRedisConfig);

// Configure queue settings
messageQueue.on('error', (error) => {
    logger.error(`Queue error: ${error.message}`);
});

messageQueue.on('failed', (job, error) => {
    logger.error(`Job ${job.id} failed: ${error.message}`);
});

messageQueue.on('completed', (job) => {
    logger.debug(`Job ${job.id} completed successfully`);
});

/**
 * Add a message job to the queue with delay
 */
export async function addToQueue(data: MessageJobData): Promise<Job<MessageJobData>> {
    // Random delay between 3-5 seconds to appear natural
    const delay = Math.floor(Math.random() * 2000) + 3000;

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
    const { botToken, botId, groupId, groupTelegramId, respondingBotUsername, personality } = job.data;

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
            botUsername: msg.bot.username,
            text: msg.text,
            isAiGenerated: msg.isAiGenerated,
        }));

        // Generate AI response
        const responseText = await generateResponse(
            personality,
            conversationHistory,
            respondingBotUsername
        );

        // Send message to Telegram
        const messageId = await sendMessage(botToken, groupTelegramId, responseText);

        if (messageId) {
            // Store the sent message
            await prisma.message.create({
                data: {
                    botId,
                    groupId,
                    text: responseText,
                    isAiGenerated: true,
                    telegramMsgId: BigInt(messageId),
                },
            });

            logger.info(`Bot @${respondingBotUsername} sent: ${responseText.substring(0, 50)}...`);
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
    groupId: string,
    excludeBotId: string
): Promise<{ id: string; token: string; username: string; personality: string } | null> {
    try {
        // Get all active bots in the group except the one that just sent
        const bots = await prisma.bot.findMany({
            where: {
                groupId,
                isActive: true,
                id: { not: excludeBotId },
            },
            orderBy: { createdAt: 'asc' },
        });

        if (bots.length === 0) {
            return null;
        }

        // Get the last message to determine whose turn it is
        const lastMessage = await prisma.message.findFirst({
            where: { groupId, isAiGenerated: true },
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
