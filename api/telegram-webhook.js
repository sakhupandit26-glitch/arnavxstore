module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Verify Telegram webhook secret
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

    if (!secret ||
        req.headers["x-telegram-bot-api-secret-token"] !== secret) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const update = req.body || {};
    const memberUpdate = update.chat_member;

    // Only process actual channel membership updates
    if (!memberUpdate) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const chat = memberUpdate.chat;
    const oldMember = memberUpdate.old_chat_member;
    const newMember = memberUpdate.new_chat_member;

    if (String(chat.id) !== String(process.env.TELEGRAM_CHANNEL_ID)) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const joined =
      ["left", "kicked"].includes(oldMember.status) &&
      (
        ["member", "administrator", "creator"].includes(newMember.status) ||
        (newMember.status === "restricted" && newMember.is_member)
      );

    if (!joined || !memberUpdate.invite_link) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const userId = newMember.user.id;
    const inviteLink = memberUpdate.invite_link.invite_link;

    const base = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;

    const headers = {
      "apikey": key,
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json"
    };

    // Find the visitor's original tracking session
    const lookup = await fetch(
      `${base}/rest/v1/tracking_sessions?invite_link=eq.${encodeURIComponent(inviteLink)}&select=id,event_id`,
      { headers }
    );

    if (!lookup.ok) {
      throw new Error("Session lookup failed");
    }

    const sessions = await lookup.json();

    if (!sessions.length) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const session = sessions[0];

    // Record this verified join only once
    const saveJoin = await fetch(
      `${base}/rest/v1/telegram_joins`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Prefer": "resolution=ignore-duplicates,return=representation"
        },
        body: JSON.stringify({
          session_id: session.id,
          telegram_user_id: userId
        })
      }
    );

    if (!saveJoin.ok) {
      throw new Error("Join record failed");
    }

    const inserted = await saveJoin.json();

    if (inserted.length > 0) {
      const updateSession = await fetch(
        `${base}/rest/v1/tracking_sessions?id=eq.${session.id}`,
        {
          method: "PATCH",
          headers: {
            ...headers,
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({ status: "joined" })
        }
      );

      if (!updateSession.ok) {
        throw new Error("Session update failed");
      }
    }

    return res.status(200).json({
      ok: true,
      verified_join: inserted.length > 0
    });

  } catch (error) {
    console.error("ShadowTrack webhook error:", error);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
};
