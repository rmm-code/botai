import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../utils/logger';

// Initialize AI providers
const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

const genAI = process.env.GEMINI_API_KEY
    ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    : null;

// Determine which provider to use
const aiProvider = openai ? 'openai' : genAI ? 'gemini' : null;
logger.info(`AI Provider: ${aiProvider || 'none configured'}`);

interface ConversationMessage {
    botUsername: string;
    text: string;
    isAiGenerated: boolean;
}

/**
 * Generate AI response using OpenAI (primary) or Gemini (fallback)
 */
export async function generateResponse(
    personality: string,
    conversationHistory: ConversationMessage[],
    respondingBotUsername: string
): Promise<string> {
    const systemPrompt = buildSystemPrompt(personality, respondingBotUsername);
    const context = buildConversationContext(conversationHistory);

    // Try OpenAI first
    if (openai) {
        try {
            return await generateWithOpenAI(systemPrompt, context, respondingBotUsername);
        } catch (error) {
            logger.warn(`OpenAI failed, trying Gemini: ${(error as Error).message}`);
        }
    }

    // Fall back to Gemini
    if (genAI) {
        try {
            return await generateWithGemini(systemPrompt, context, respondingBotUsername);
        } catch (error) {
            logger.error(`Gemini also failed: ${(error as Error).message}`);
            throw error;
        }
    }

    throw new Error('No AI provider configured. Set OPENAI_API_KEY or GEMINI_API_KEY');
}

/**
 * Generate response using OpenAI GPT-4
 */
async function generateWithOpenAI(
    systemPrompt: string,
    context: string,
    botUsername: string
): Promise<string> {
    const response = await openai!.chat.completions.create({
        model: 'gpt-4',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: context || 'Start a conversation.' },
        ],
        max_tokens: 500,
        temperature: 0.8,
    });

    let text = response.choices[0]?.message?.content?.trim();
    if (!text) throw new Error('Empty OpenAI response');

    // Remove bot username prefix if AI adds it (e.g. "@botname: Hello")
    const prefixRegex = new RegExp(`^@?${botUsername}:?\\s*`, 'i');
    text = text.replace(prefixRegex, '');

    logger.debug(`OpenAI response: ${text.substring(0, 100)}...`);
    return text;
}

/**
 * Generate response using Google Gemini
 */
async function generateWithGemini(
    systemPrompt: string,
    context: string,
    botUsername: string
): Promise<string> {
    const model = genAI!.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `${systemPrompt}\n\nConversation:\n${context}\n\nRespond as @${botUsername}:`;

    const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
            maxOutputTokens: 500,
            temperature: 0.8,
        },
    });

    let text = result.response.text().trim();
    if (!text) throw new Error('Empty Gemini response');

    // Remove bot username prefix if AI adds it
    const prefixRegex = new RegExp(`^@?${botUsername}:?\\s*`, 'i');
    text = text.replace(prefixRegex, '');

    logger.debug(`Gemini response: ${text.substring(0, 100)}...`);
    return text;
}

/**
 * Build system prompt based on bot personality
 */
function buildSystemPrompt(personality: string, botUsername: string): string {
    return `You are a user in an internet chatroom in the year 2000 named ${botUsername}.
    Your base personality is: ${personality} (filtered through 2000s internet culture).

    STYLE RULES:
    1. WRITE LIKE IT'S THE YEAR 2000 (AIM/ICQ/IRC style).
    2. Use lowercase, slang, and abbreviations (u, r, ur, lol, lmao, brb, g2g, rofl).
    3. Typos are okay and encouraged. Be messy but LOGICAL.
    4. EXTREMELY SHORT RESPONSES. Max 1-2 short sentences. No paragraphs.
    5. NEVER act formal, polite, or helpful. No "Greetings" or "I am here to assist".
    6. Be opinionated, sassy, and quick-witted. Defend your points.
    7. FLAME WARS are allowed.
    8. ABSOLUTELY NO "As an AI" language. No hashtags.
    
    Example: "yo check this out lol"
    Example: "wait what?? that makes no sense"
    Example: "brb mom allows calling"`;
}

/**
 * Build conversation context
 */
function buildConversationContext(messages: ConversationMessage[]): string {
    return messages
        .slice(-10)
        .map((msg) => `@${msg.botUsername}: ${msg.text}`)
        .join('\n');
}

/**
 * Generate a conversation starter
 */
export async function generateConversationStarter(
    personality: string,
    topic?: string
): Promise<string> {
    const prompt = topic
        ? `Start a casual conversation about: ${topic}. Keep it brief.`
        : `Start a casual conversation with a greeting. Keep it brief.`;

    try {
        if (openai) {
            const response = await openai.chat.completions.create({
                model: 'gpt-4',
                messages: [
                    { role: 'system', content: `Personality: ${personality}` },
                    { role: 'user', content: prompt },
                ],
                max_tokens: 200,
                temperature: 0.9,
            });
            return response.choices[0]?.message?.content?.trim() || 'Hello everyone!';
        }

        if (genAI) {
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
            const result = await model.generateContent(`${personality}. ${prompt}`);
            return result.response.text().trim() || 'Hello everyone!';
        }
    } catch (error) {
        logger.error(`Starter generation failed: ${(error as Error).message}`);
    }

    return 'Hey everyone, how is it going?';
}
