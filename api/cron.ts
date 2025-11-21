import { VercelRequest, VercelResponse } from '@vercel/node';
import { getEnv } from '../src/config/env';
import { createGmailClient, fetchMessages, normalizeMessage, markMessageAsRead } from '../src/services/gmailService';
import { analyzeMail } from '../src/services/geminiService';
import { sendTelegramMessage } from '../src/services/telegramService';
import { formatTelegramMessage } from '../src/utils/telegramFormatter';
import { logInfo, logError } from '../src/utils/logger';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Bảo mật cơ bản: Kiểm tra secret key từ header nếu gọi thủ công
  // (Khi set up Cron Job trên Vercel, ta cũng có thể dùng header này)
  const authHeader = req.headers['authorization'];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  logInfo("Cron Job triggered via HTTP Request.");

  try {
    const env = getEnv();
    const gmailClient = createGmailClient(env);

    // Logic kiểm tra mail (copy từ checkNewEmails nhưng bỏ loop)
    const messages = await fetchMessages(gmailClient, env.gmailPollQuery, 1);

    if (messages.length === 0) {
      return res.status(200).json({ message: 'No new emails found.' });
    }

    const latestMessage = messages[0];
    if (!latestMessage?.id) {
      return res.status(200).json({ message: 'Found message but no ID.' });
    }

    // Trên môi trường Serverless (Vercel), ta KHÔNG THỂ lưu lastProcessedMsgId vào biến toàn cục
    // vì mỗi lần chạy là một instance mới.
    // => Ta phải dựa vào việc email đã "ĐỌC" chưa để lọc.
    // => Logic fetchMessages hiện tại lấy "from:..." có thể lấy cả mail cũ.
    // => Cần đảm bảo fetchMessages CHỈ LẤY MAIL CHƯA ĐỌC (label:UNREAD).
    
    // Tuy nhiên, để an toàn, ta sẽ xử lý và đánh dấu đã đọc ngay.
    const thread = await gmailClient.users.messages.get({
      userId: 'me',
      id: latestMessage.id,
      format: 'full' // Lấy full để check label UNREAD
    });

    const isUnread = thread.data.labelIds?.includes('UNREAD');

    if (!isUnread) {
      return res.status(200).json({ message: 'Latest email is already read. Skipping.' });
    }

    logInfo("Processing new email...", { id: latestMessage.id });

    const normalized = await normalizeMessage(latestMessage);
    const analysis = await analyzeMail(env, normalized);
    const telegramMessage = formatTelegramMessage(analysis);
    await sendTelegramMessage(env, telegramMessage);
    await markMessageAsRead(gmailClient, latestMessage.id!);

    return res.status(200).json({ 
      success: true, 
      message: 'Email processed and sent to Telegram.',
      mailId: latestMessage.id 
    });

  } catch (error: any) {
    logError("Fatal error in Cron Handler", { error: error.message });
    return res.status(500).json({ error: error.message });
  }
}

