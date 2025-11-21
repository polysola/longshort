import { google } from "googleapis";
import http from "http";
import url from "url";
import { getEnv } from "../config/env";

const env = getEnv();

const oauth2Client = new google.auth.OAuth2(
  env.googleClientId,
  env.googleClientSecret,
  "http://localhost:3000/oauth2callback"
);

const scopes = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify"
];

const server = http.createServer(async (req, res) => {
  if (req.url?.startsWith("/oauth2callback")) {
    const qs = new url.URL(req.url, "http://localhost:3000").searchParams;
    const code = qs.get("code");

    res.end("Authentication successful! You can close this tab. Check your console for the Refresh Token.");
    server.close();

    if (code) {
      const { tokens } = await oauth2Client.getToken(code);
      console.log("\n=== YOUR REFRESH TOKEN ===");
      console.log(tokens.refresh_token);
      console.log("==========================\n");
      console.log("Copy token này và dán vào file .env tại dòng GOOGLE_REFRESH_TOKEN=");
      process.exit(0);
    }
  }
});

server.listen(3000, () => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    prompt: "consent" // Bắt buộc để lấy refresh token
  });

  console.log("\n=== AUTHENTICATION REQUIRED ===");
  console.log("Mở link sau để cấp quyền Gmail:");
  console.log(authUrl);
  console.log("===============================\n");
});
