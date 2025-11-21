import { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  return res.status(200).json({
    message: "Server is running successfully!",
    endpoints: {
      cron: "/cron (Visit this to trigger email check)"
    },
    timestamp: new Date().toISOString()
  });
}

