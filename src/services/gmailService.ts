import { google, gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { EnvConfig } from "../config/env";
import { logDebug } from "../utils/logger";
import { ExternalServiceError } from "../lib/errors";
import { NormalizedMail } from "../types/mail";

const REDIRECT_URI = "https://developers.google.com/oauthplayground";

const buildOAuthClient = (config: EnvConfig): OAuth2Client => {
  const client = new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    REDIRECT_URI,
  );

  client.setCredentials({
    refresh_token: config.googleRefreshToken,
  });

  return client;
};

export const createGmailClient = (config: EnvConfig): gmail_v1.Gmail => {
  const authClient = buildOAuthClient(config);
  return google.gmail({ version: "v1", auth: authClient });
};

const decodeBody = (data?: string | null): string => {
  if (!data) {
    return "";
  }

  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const buffer = Buffer.from(normalized, "base64");

  return buffer.toString("utf-8");
};

const extractBody = (payload: gmail_v1.Schema$MessagePart): { plainText: string; htmlText: string } => {
  if (!payload) {
    return { plainText: "", htmlText: "" };
  }

  if (payload.mimeType === "text/plain") {
    return { plainText: decodeBody(payload.body?.data), htmlText: "" };
  }

  if (payload.mimeType === "text/html") {
    return { plainText: "", htmlText: decodeBody(payload.body?.data) };
  }

  if (!payload.parts) {
    return { plainText: "", htmlText: "" };
  }

  return payload.parts.reduce(
    (acc, part) => {
      const result = extractBody(part);

      return {
        plainText: `${acc.plainText}${result.plainText}`,
        htmlText: `${acc.htmlText}${result.htmlText}`,
      };
    },
    { plainText: "", htmlText: "" },
  );
};

const headerMap = (headers?: gmail_v1.Schema$MessagePartHeader[]): Record<string, string> => {
  if (!headers) {
    return {};
  }

  return headers.reduce<Record<string, string>>((acc, header) => {
    if (!header.name || !header.value) {
      return acc;
    }

    acc[header.name.toLowerCase()] = header.value;
    return acc;
  }, {});
};

const headerValue = (headers: Record<string, string>, key: string): string => headers[key.toLowerCase()] ?? "";

export const normalizeMessage = (message: gmail_v1.Schema$Message): NormalizedMail => {
  if (!message.id || !message.threadId || !message.payload) {
    throw new ExternalServiceError("Thiếu dữ liệu Gmail message.", { id: message.id });
  }

  const headers = headerMap(message.payload.headers);
  const body = extractBody(message.payload);

  return {
    id: message.id,
    threadId: message.threadId,
    subject: headerValue(headers, "subject"),
    snippet: message.snippet ?? "",
    from: headerValue(headers, "from"),
    to: headerValue(headers, "to"),
    date: headerValue(headers, "date"),
    plainText: body.plainText,
    htmlText: body.htmlText,
    headers,
  };
};

export const fetchMessages = async (
  gmailClient: gmail_v1.Gmail,
  query: string,
  maxResults: number,
): Promise<gmail_v1.Schema$Message[]> => {
  try {
    const { data } = await gmailClient.users.messages.list({
      userId: "me",
      q: query,
      maxResults,
    });

    if (!data.messages || data.messages.length === 0) {
      return [];
    }

    const results = await Promise.all(
      data.messages.map(async (message) => {
        if (!message.id) {
          return null;
        }

        const detailed = await gmailClient.users.messages.get({
          userId: "me",
          id: message.id,
          format: "full",
        });

        return detailed.data;
      }),
    );

    return results.filter((item): item is gmail_v1.Schema$Message => Boolean(item));
  } catch (error) {
    throw new ExternalServiceError("Không thể lấy danh sách Gmail.", {
      cause: (error as Error).message,
    });
  }
};

export const markMessageAsRead = async (gmailClient: gmail_v1.Gmail, messageId: string) => {
  try {
    await gmailClient.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: {
        removeLabelIds: ["UNREAD"],
      },
    });

    logDebug("Đã đánh dấu thư đã đọc.", { messageId });
  } catch (error) {
    throw new ExternalServiceError("Không thể đánh dấu thư.", {
      messageId,
      cause: (error as Error).message,
    });
  }
};

