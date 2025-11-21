import axios from "axios";
import { EnvConfig } from "../config/env";
import { ExternalServiceError } from "../lib/errors";
import { logDebug, logInfo } from "../utils/logger";

const buildTelegramUrl = (token: string) => `https://api.telegram.org/bot${token}/sendMessage`;

// Telegram giới hạn tin nhắn khoảng 4096 ký tự. Ta giới hạn an toàn là 4000.
const MAX_MESSAGE_LENGTH = 4000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const sendTelegramMessage = async (config: EnvConfig, text: string) => {
  try {
    // Nếu tin nhắn quá dài, chia nhỏ ra
    if (text.length > MAX_MESSAGE_LENGTH) {
      logInfo("Tin nhắn quá dài, đang chia nhỏ để gửi...");
      const chunks = [];
      let currentChunk = "";
      
      // Chia theo dòng để tránh cắt giữa chừng
      const lines = text.split("\n");
      
      for (const line of lines) {
        if ((currentChunk + line).length > MAX_MESSAGE_LENGTH) {
          chunks.push(currentChunk);
          currentChunk = line + "\n";
        } else {
          currentChunk += line + "\n";
        }
      }
      if (currentChunk) chunks.push(currentChunk);

      // Gửi từng phần
      for (let i = 0; i < chunks.length; i++) {
        await axios.post(buildTelegramUrl(config.telegramBotToken), {
          chat_id: config.telegramChatId,
          text: chunks[i],
          disable_web_page_preview: true,
        });
        // Delay nhẹ giữa các tin để tránh spam limit
        if (i < chunks.length - 1) await sleep(500);
      }
      
      logDebug(`Đã gửi ${chunks.length} phần tin nhắn Telegram.`, { chatId: config.telegramChatId });
      return;
    }

    // Gửi bình thường nếu ngắn
    await axios.post(buildTelegramUrl(config.telegramBotToken), {
      chat_id: config.telegramChatId,
      text,
      disable_web_page_preview: true,
    });

    logDebug("Đã gửi thông báo Telegram.", { chatId: config.telegramChatId });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new ExternalServiceError("Telegram API lỗi.", {
        status: error.response?.status,
        data: error.response?.data,
      });
    }

    throw new ExternalServiceError("Không gửi được Telegram.", {
      cause: (error as Error).message,
    });
  }
};

// Lắng nghe tin nhắn từ Telegram (dùng Long Polling)
export const getTelegramUpdates = async (config: EnvConfig, offset: number = 0): Promise<any[]> => {
  try {
    const url = `https://api.telegram.org/bot${config.telegramBotToken}/getUpdates`;
    const response = await axios.get(url, {
      params: {
        offset,
        timeout: 30, // Long polling 30s
        allowed_updates: ['message']
      }
    });

    if (response.data.ok) {
      return response.data.result;
    }

    return [];
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new ExternalServiceError("Không thể lấy updates từ Telegram.", {
        status: error.response?.status,
        data: error.response?.data,
      });
    }
    throw error;
  }
};
