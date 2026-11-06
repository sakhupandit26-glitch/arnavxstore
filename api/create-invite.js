const crypto = require("crypto");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      SUPABASE_URL,
      SUPABASE_SECRET_KEY,
      TELEGRAM_BOT_TOKEN,
      TELEGRAM_CHANNEL_ID
    } = process.env;

    if (!SUPABASE_URL || !SUPABASE_SECRET_KEY ||
        !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
      return res.status(500).json({ error: "Server configuration missing" });
    }

    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const expireUnix = Math.floor(expiresAt.getTime() / 1000);

    const body = req.body || {};

    // Generate a unique, single-use Telegram invite
    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createChatInviteLink`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHANNEL_ID,
          name: `ShadowTrack-${sessionId.slice(0, 8)}`,
          expire_date: expireUnix,
          member_limit: 1
        })
      }
    );

    const telegramData = await telegramResponse.json();

    if (!telegramData.ok) {
      return res.status(502).json({ error: "Telegram invite creation failed" });
    }

    const inviteLink = telegramData.result.invite_link;

    // Save tracking session in Supabase
    const dbResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/tracking_sessions`,
      {
        method: "POST",
        headers: {
          "apikey": SUPABASE_SECRET_KEY,
          "Authorization": `Bearer ${SUPABASE_SECRET_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          id: sessionId,
          invite_link: inviteLink,
          fbclid: body.fbclid || null,
          fbc: body.fbc || null,
          fbp: body.fbp || null,
          status: "pending",
          expires_at: expiresAt.toISOString()
        })
      }
    );

    if (!dbResponse.ok) {
      return res.status(500).json({ error: "Database save failed" });
    }

    return res.status(200).json({
      success: true,
      invite_link: inviteLink,
      session_id: sessionId,
      expires_at: expiresAt.toISOString()
    });

  } catch (error) {
    console.error("ShadowTrack error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
