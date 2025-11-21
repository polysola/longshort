import dotenv from "dotenv";
import { ConfigError } from "../lib/errors";

export type EnvConfig = {
  googleClientId: string;
  googleClientSecret: string;
  googleRefreshToken: string;
  geminiApiKey: string;
  telegramBotToken: string;
  telegramChatId: string;
  gmailPollQuery: string;
  maxMessages: number;
  geminiModel: string;
};

let cachedConfig: EnvConfig | null = null;

dotenv.config();

const ensureValue = (value: string | undefined, key: string): string => {
  if (value && value.trim().length > 0) {
    return value.trim();
  }

  // Cho phép Refresh Token rỗng khi chạy script lấy token
  if (key === "GOOGLE_REFRESH_TOKEN") {
    return "";
  }

  throw new ConfigError("Thiếu cấu hình bắt buộc.", { key });
};

const toNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new ConfigError("Giá trị số không hợp lệ.", {
      key: value,
      fallback,
    });
  }

  return parsed;
};

export const getEnv = (): EnvConfig => {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = {
    googleClientId: ensureValue(process.env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID"),
    googleClientSecret: ensureValue(
      process.env.GOOGLE_CLIENT_SECRET,
      "GOOGLE_CLIENT_SECRET",
    ),
    googleRefreshToken: ensureValue(
      process.env.GOOGLE_REFRESH_TOKEN,
      "GOOGLE_REFRESH_TOKEN",
    ),
    geminiApiKey: ensureValue(process.env.GEMINI_API_KEY, "GEMINI_API_KEY"),
    telegramBotToken: ensureValue(
      process.env.TELEGRAM_BOT_TOKEN,
      "TELEGRAM_BOT_TOKEN",
    ),
    telegramChatId: ensureValue(
      process.env.TELEGRAM_CHAT_ID,
      "TELEGRAM_CHAT_ID",
    ),
    // Sửa query: Lấy thư chưa đọc từ noti@vaibb.com để phù hợp logic stateless trên Vercel
    gmailPollQuery: "from:noti@vaibb.com is:unread",
    maxMessages: toNumber(process.env.MAX_MESSAGES, 5),
    geminiModel: process.env.GEMINI_MODEL?.trim() ?? "gemini-2.5-flash",
  };

  return cachedConfig;
};
