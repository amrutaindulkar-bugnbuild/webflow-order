import crypto from "node:crypto";

const sha256 = (s) =>
  crypto.createHash("sha256").update(s.trim().toLowerCase()).digest("hex");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // simple shared-secret check so only your Webflow webhook can call this
  if (req.query.token !== process.env.WEBHOOK_TOKEN) return res.status(401).end();

  const order = req.body?.payload;
  if (!order?.orderId) return res.status(400).json({ error: "no order" });

  const currency = order.customerPaid?.unit || "USD";
  const email = order.customerInfo?.email;

  const event = {
    id: order.orderId, // same ID must be used by the browser pixel for dedupe
    type: "order_created",
    timestamp_ms: order.acceptedOn
      ? new Date(order.acceptedOn).getTime()
      : Date.now(),
    source_url: "https://YOUR-SITE.com/order-confirmation",
    action_source: "web",
    ...(email && { user: { email_sha256: sha256(email) } }),
    data: {
      type: "contents",
      amount: Number(order.customerPaid?.value), // integer, minor units (e.g. cents)
      currency,
      contents: (order.purchasedItems || []).map((i) => ({
        id: i.variantSku || i.productId,
        name: i.productName,
        content_type: "product",
        quantity: i.count,
        amount: Number(i.rowTotal?.value),
        currency,
      })),
    },
  };

  const r = await fetch(
    `https://bzr.openai.com/v1/events?pid=${process.env.OPENAI_PIXEL_ID}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_EVENTS_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        validate_only: process.env.VALIDATE_ONLY === "true",
        events: [event],
      }),
    }
  );

  if (!r.ok) {
    console.error("OpenAI Events API error", r.status, await r.text());
    return res.status(500).json({ error: "upstream failed" }); // Webflow will retry
  }
  return res.status(200).json({ ok: true });
}
