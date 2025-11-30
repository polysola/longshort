import axios from "axios";
import { EnvConfig } from "../config/env";
import { ExternalServiceError } from "../lib/errors";
import { logDebug, logInfo, logError, logWarn } from "../utils/logger";

const buildTelegramUrl = (token: string, method: string = "sendMessage") => 
  `https://api.telegram.org/bot${token}/${method}`;

// Telegram giới hạn tin nhắn khoảng 4096 ký tự. Ta giới hạn an toàn là 4000.
const MAX_MESSAGE_LENGTH = 4000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Escape các ký tự đặc biệt cho Markdown (Telegram cũ)
 * Các ký tự cần escape: _ * ` [
 */
const escapeMarkdown = (text: string): string => {
  // Không escape nếu đã có format
  // Chỉ escape những ký tự đơn lẻ không phải format
  return text
    .replace(/(?<!\*)\*(?!\*)/g, '\\*')  // * đơn không phải bold
    .replace(/(?<!_)_(?!_)/g, '\\_')      // _ đơn không phải italic
    .replace(/(?<!`)`(?!`)/g, '\\`')      // ` đơn không phải code
    .replace(/\[(?![^\]]*\]\()/g, '\\['); // [ không phải link
};

/**
 * Sanitize text để gửi Telegram - loại bỏ các ký tự có thể gây lỗi parse
 */
const sanitizeForTelegram = (text: string, parseMode: string): string => {
  if (parseMode === "HTML") {
    // Với HTML, cần escape các ký tự HTML đặc biệt NGOÀI các tag cho phép
    // Telegram cho phép: <b>, <i>, <u>, <s>, <code>, <pre>, <a>
    return text;
  }
  
  // Với Markdown, giữ nguyên format nhưng log warning nếu có ký tự lạ
  return text;
};

/**
 * Gửi tin nhắn Telegram với retry và fallback
 */
const sendTelegramWithRetry = async (
  config: EnvConfig, 
  text: string, 
  parseMode: "HTML" | "Markdown" | null,
  retryCount: number = 0
): Promise<void> => {
  const MAX_RETRIES = 2;
  
  try {
    const payload: any = {
      chat_id: config.telegramChatId,
      text: text,
      disable_web_page_preview: true,
    };
    
    if (parseMode) {
      payload.parse_mode = parseMode;
    }

    await axios.post(buildTelegramUrl(config.telegramBotToken), payload);
    
    logDebug("Đã gửi tin nhắn Telegram thành công.", { 
      parseMode: parseMode || "plain",
      textLength: text.length 
    });
    
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const errorData = error.response?.data;
      const errorDescription = errorData?.description || "Unknown error";
      
      // Log chi tiết lỗi
      logError("Telegram API Error chi tiết:", {
        status,
        errorCode: errorData?.error_code,
        description: errorDescription,
        parseMode,
        textPreview: text.substring(0, 200) + "...",
        retryCount
      });
      
      // Nếu lỗi parse entities (400) và còn retry
      if (status === 400 && errorDescription.includes("parse") && retryCount < MAX_RETRIES) {
        logWarn(`Lỗi parse ${parseMode}, thử lại với plain text...`);
        
        // Retry với plain text (không parse mode)
        return sendTelegramWithRetry(config, text, null, retryCount + 1);
      }
      
      // Nếu lỗi rate limit (429)
      if (status === 429) {
        const retryAfter = errorData?.parameters?.retry_after || 5;
        logWarn(`Rate limit! Đợi ${retryAfter}s rồi thử lại...`);
        await sleep(retryAfter * 1000);
        return sendTelegramWithRetry(config, text, parseMode, retryCount + 1);
      }
      
      // Nếu lỗi conflict (409) - có thể do nhiều instance bot
      if (status === 409) {
        logError("Conflict! Có thể có nhiều instance bot đang chạy.", { errorData });
      }
      
      throw new ExternalServiceError("Telegram API lỗi.", {
        status,
        errorCode: errorData?.error_code,
        description: errorDescription,
        parseMode,
        retryCount
      });
    }

    throw new ExternalServiceError("Không gửi được Telegram.", {
      cause: (error as Error).message,
    });
  }
};

/**
 * Gửi tin nhắn Telegram với HTML format (cho Report)
 */
export const sendTelegramMessage = async (config: EnvConfig, text: string) => {
  try {
    // Nếu tin nhắn quá dài, chia nhỏ ra
    if (text.length > MAX_MESSAGE_LENGTH) {
      logInfo("Tin nhắn quá dài, đang chia nhỏ để gửi...", { totalLength: text.length });
      const chunks = splitMessage(text);

      // Gửi từng phần
      for (const [index, chunk] of chunks.entries()) {
        logDebug(`Đang gửi phần ${index + 1}/${chunks.length}...`, { chunkLength: chunk.length });
        await sendTelegramWithRetry(config, chunk, "HTML");
        // Delay nhẹ giữa các tin để tránh spam limit
        if (index < chunks.length - 1) await sleep(500);
      }
      
      logInfo(`Đã gửi ${chunks.length} phần tin nhắn Telegram.`);
      return;
    }

    // Gửi bình thường nếu ngắn
    await sendTelegramWithRetry(config, text, "HTML");

  } catch (error) {
    // Re-throw với context đầy đủ
    if (error instanceof ExternalServiceError) {
      throw error;
    }
    throw new ExternalServiceError("Lỗi gửi tin nhắn Telegram (Report).", {
      cause: (error as Error).message,
    });
  }
};

/**
 * Gửi tin nhắn Telegram với Markdown format (cho Chat)
 */
export const sendTelegramChatMessage = async (config: EnvConfig, text: string) => {
  try {
    // Nếu tin nhắn quá dài, chia nhỏ ra
    if (text.length > MAX_MESSAGE_LENGTH) {
      logInfo("Tin nhắn chat quá dài, đang chia nhỏ để gửi...", { totalLength: text.length });
      const chunks = splitMessage(text);

      for (const [index, chunk] of chunks.entries()) {
        logDebug(`Đang gửi phần chat ${index + 1}/${chunks.length}...`, { chunkLength: chunk.length });
        await sendTelegramWithRetry(config, chunk, "Markdown");
        if (index < chunks.length - 1) await sleep(500);
      }
      
      logInfo(`Đã gửi ${chunks.length} phần tin nhắn chat.`);
      return;
    }

    // Gửi bình thường
    await sendTelegramWithRetry(config, text, "Markdown");

  } catch (error) {
    // Re-throw với context đầy đủ
    if (error instanceof ExternalServiceError) {
      throw error;
    }
    throw new ExternalServiceError("Lỗi gửi tin nhắn Telegram (Chat).", {
      cause: (error as Error).message,
    });
  }
};

/**
 * Chia tin nhắn dài thành nhiều phần
 */
const splitMessage = (text: string): string[] => {
  const chunks: string[] = [];
  let currentChunk = "";
  
  // Chia theo dòng để tránh cắt giữa chừng
  const lines = text.split("\n");
  
  for (const line of lines) {
    // Nếu thêm dòng này vào sẽ vượt quá limit
    if ((currentChunk + line + "\n").length > MAX_MESSAGE_LENGTH) {
      // Lưu chunk hiện tại nếu có nội dung
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      // Bắt đầu chunk mới
      currentChunk = line + "\n";
    } else {
      currentChunk += line + "\n";
    }
  }
  
  // Lưu chunk cuối cùng
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
};

/**
 * Lắng nghe tin nhắn từ Telegram (dùng Long Polling)
 */
export const getTelegramUpdates = async (config: EnvConfig, offset: number = 0): Promise<any[]> => {
  try {
    const url = buildTelegramUrl(config.telegramBotToken, "getUpdates");
    const response = await axios.get(url, {
      params: {
        offset,
        timeout: 30, // Long polling 30s
        allowed_updates: ['message']
      },
      timeout: 35000 // Axios timeout > long polling timeout
    });

    if (response.data.ok) {
      return response.data.result;
    }

    logWarn("Telegram getUpdates không thành công.", { response: response.data });
    return [];
    
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const errorData = error.response?.data;
      
      // Log chi tiết
      logError("Telegram getUpdates Error:", {
        status,
        errorCode: errorData?.error_code,
        description: errorData?.description,
        code: error.code, // ECONNABORTED, ETIMEDOUT, etc.
      });
      
      // Nếu là timeout, không throw error (bình thường với long polling)
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        logDebug("Long polling timeout (bình thường).");
        return [];
      }
      
      // Nếu lỗi conflict (409) - có thể do webhook đang active hoặc nhiều instance
      if (status === 409) {
        logError("Conflict! Có thể webhook đang active hoặc nhiều bot instance.", {
          description: errorData?.description
        });
        // Không throw, return empty để tiếp tục
        return [];
      }
      
      throw new ExternalServiceError("Không thể lấy updates từ Telegram.", {
        status,
        errorCode: errorData?.error_code,
        description: errorData?.description,
      });
    }
    
    logError("Lỗi không xác định khi getUpdates.", { error: (error as Error).message });
    throw error;
  }
};

/**
 * Kiểm tra webhook status (debug)
 */
export const getWebhookInfo = async (config: EnvConfig): Promise<any> => {
  try {
    const url = buildTelegramUrl(config.telegramBotToken, "getWebhookInfo");
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    logError("Không thể lấy webhook info.", { error: (error as Error).message });
    return null;
  }
};

/**
 * Xóa webhook (nếu cần dùng long polling)
 */
export const deleteWebhook = async (config: EnvConfig): Promise<boolean> => {
  try {
    const url = buildTelegramUrl(config.telegramBotToken, "deleteWebhook");
    const response = await axios.post(url);
    logInfo("Đã xóa webhook.", { result: response.data });
    return response.data.ok;
  } catch (error) {
    logError("Không thể xóa webhook.", { error: (error as Error).message });
    return false;
  }
};
