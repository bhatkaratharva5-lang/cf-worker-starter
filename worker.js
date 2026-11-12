export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const botUsername = "FILE_STOREB_BOT"; // Bina @ ke
    const UPLOADER_CPM_INR = 70; // ₹70 per 1,000 completed views (20% margin + ₹30 safety buffer)

    const corsHeaders = {
      "Access-Control-Allow-Origin": "https://primegate.pages.dev",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 1. STEP 3 FINAL VERIFICATION + UPLOADER VIEW COUNT + SHORTUN LINK
    if (url.pathname === "/api/verify-final") {
      const token = url.searchParams.get("token");
      const uploaderId = (url.searchParams.get("u") || "admin").trim().toLowerCase();
      const s1 = url.searchParams.get("s1");
      const s2 = url.searchParams.get("s2");
      const s3 = url.searchParams.get("s3");

      if (!token || s1 !== "1" || s2 !== "1" || s3 !== "1") {
        return new Response(
          JSON.stringify({ success: false, error: "Bypass detected! Complete all 3 steps." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 24-hour anti-cheat token lock (1 user = max 1 counted view)
      if (env.STATS_KV) {
        const lockKey = `used_token:${token}`;
        const alreadyCounted = await env.STATS_KV.get(lockKey);

        if (!alreadyCounted) {
          await env.STATS_KV.put(lockKey, "1", { expirationTtl: 86400 });

          const userKey = `uploader:${uploaderId}`;
          const existingRaw = await env.STATS_KV.get(userKey);
          const userData = existingRaw
            ? JSON.parse(existingRaw)
            : { uploaderId, completedViews: 0, lastActive: null };

          userData.completedViews += 1;
          userData.lastActive = new Date().toISOString();

          await env.STATS_KV.put(userKey, JSON.stringify(userData));
        }
      }

      const destinationUrl = `https://t.me/${botUsername}?start=${encodeURIComponent(token)}`;

      try {
        const shortunApiUrl = `https://shortun.com/api?api=${env.SHORTUN_API_KEY}&url=${encodeURIComponent(destinationUrl)}`;
        const apiRes = await fetch(shortunApiUrl);
        const apiData = await apiRes.json();
        const finalUrl = apiData && apiData.shortenedUrl ? apiData.shortenedUrl : destinationUrl;

        return new Response(
          JSON.stringify({ success: true, redirectUrl: finalUrl }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ success: true, redirectUrl: destinationUrl }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // 2. UPLOADER PUBLIC STATS API (/api/stats?u=rahul)
    if (url.pathname === "/api/stats") {
      const uploaderId = (url.searchParams.get("u") || "").trim().toLowerCase();
      if (!uploaderId) {
        return new Response(
          JSON.stringify({ success: false, error: "Uploader ID missing" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const raw = env.STATS_KV ? await env.STATS_KV.get(`uploader:${uploaderId}`) : null;
      const data = raw ? JSON.parse(raw) : { uploaderId, completedViews: 0, lastActive: null };
      const earningsInr = ((data.completedViews / 1000) * UPLOADER_CPM_INR).toFixed(2);

      return new Response(
        JSON.stringify({
          success: true,
          uploader: data.uploaderId,
          completedViews: data.completedViews,
          cpmRateINR: UPLOADER_CPM_INR,
          earningsINR: earningsInr,
          lastActive: data.lastActive,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. ADMIN ALL-UPLOADERS REPORT (/api/admin/all?key=YOUR_ADMIN_KEY)
    if (url.pathname === "/api/admin/all") {
      const adminKey = url.searchParams.get("key");
      if (!env.ADMIN_KEY || adminKey !== env.ADMIN_KEY) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const list = await env.STATS_KV.list({ prefix: "uploader:" });
      const results = [];

      for (const item of list.keys) {
        const raw = await env.STATS_KV.get(item.name);
        if (raw) {
          const parsed = JSON.parse(raw);
          const earnings = ((parsed.completedViews / 1000) * UPLOADER_CPM_INR).toFixed(2);
          results.push({
            uploader: parsed.uploaderId,
            views: parsed.completedViews,
            payoutINR: `₹${earnings}`,
            lastActive: parsed.lastActive,
          });
        }
      }

      return new Response(JSON.stringify({ cpmINR: UPLOADER_CPM_INR, uploaders: results }, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("PrimeGate Worker Active", { status: 200 });
  },
};
