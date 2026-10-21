import { fakeId, weightedPick } from "../deterministic";
import type { WhatsAppOutcome, WhatsAppProvider, WhatsAppSendRequest, WhatsAppSendResult, WhatsAppTemplate } from "../types";

/** Templates a real WABA would have approved in Meta's WhatsApp Manager. */
export const MOCK_TEMPLATES: WhatsAppTemplate[] = [
  {
    name: "appointment_reminder",
    language: "en",
    category: "UTILITY",
    status: "APPROVED",
    headerType: "TEXT",
    headerText: "Appointment reminder",
    body: "Hi {{1}}, this is a reminder of your appointment on {{2}}. Reply STOP to opt out.",
    footer: "ConnectHub demo",
    buttons: [{ type: "QUICK_REPLY", text: "Confirm" }, { type: "QUICK_REPLY", text: "Reschedule" }],
  },
  {
    name: "seasonal_offer_image",
    language: "en",
    category: "MARKETING",
    status: "APPROVED",
    headerType: "IMAGE",
    body: "Hello {{1}}! Our {{2}} offer is live — show this message in store. Reply STOP to unsubscribe.",
    footer: "Terms apply",
  },
  {
    name: "product_demo_video",
    language: "en",
    category: "MARKETING",
    status: "APPROVED",
    headerType: "VIDEO",
    body: "Hi {{1}}, here's a 60-second look at what's new. Questions? Just reply here.",
  },
  {
    name: "order_update",
    language: "en",
    category: "UTILITY",
    status: "APPROVED",
    headerType: "NONE",
    body: "Hi {{1}}, your order {{2}} is now {{3}}.",
  },
  {
    name: "festival_greetings_hi",
    language: "hi",
    category: "MARKETING",
    status: "PENDING",
    headerType: "IMAGE",
    body: "नमस्ते {{1}}! आपको त्योहार की शुभकामनाएं।",
  },
];

const OUTCOMES: readonly (readonly [WhatsAppOutcome | "failed_unreachable", number])[] = [
  ["read", 55],
  ["delivered", 30],
  ["sent", 6],
  ["failed", 5],
  ["failed_unreachable", 4],
];

/** Suffix overrides: …0001 read · …0002 delivered · …0003 sent · …0009 failed */
const FORCED: Record<string, WhatsAppOutcome> = { "0001": "read", "0002": "delivered", "0003": "sent", "0009": "failed" };

export function countPlaceholders(body: string): number {
  const indexes = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return indexes.length ? Math.max(...indexes) : 0;
}

export const mockWhatsAppProvider: WhatsAppProvider = {
  id: "mock",
  displayName: "Mock WhatsApp provider (simulation)",
  mode: "simulation",

  async listTemplates() {
    return MOCK_TEMPLATES;
  },

  async sendTemplate(request: WhatsAppSendRequest): Promise<WhatsAppSendResult> {
    const seed = `${request.campaignId}:${request.to}`;
    const messageId = fakeId("wamid.SIM", seed);
    const template = MOCK_TEMPLATES.find(
      (t) => t.name === request.template.name && t.language === request.template.language,
    );

    // Mirror the Cloud API's request validation so bad campaigns fail loudly.
    const reject = (code: string, message: string): WhatsAppSendResult => ({
      status: "failed",
      providerMessageId: messageId,
      errorCode: code,
      errorMessage: message,
      events: [{ status: "failed", at: new Date().toISOString() }],
      raw: { simulated: true },
    });
    if (!template) return reject("132001", "Template name does not exist in the translation");
    if (template.status !== "APPROVED") return reject("132015", "Template is not approved");
    if (request.bodyParams.length !== countPlaceholders(template.body)) {
      return reject("132000", "Number of parameters does not match the expected number of params");
    }
    if ((template.headerType === "IMAGE" || template.headerType === "VIDEO") && !request.headerMedia) {
      return reject("132012", "Header media is required for this template");
    }

    const suffix = request.to.slice(-4);
    const picked: WhatsAppOutcome | "failed_unreachable" = Object.hasOwn(FORCED, suffix) ? FORCED[suffix] : weightedPick(seed, OUTCOMES);
    const status: WhatsAppOutcome = picked === "failed_unreachable" ? "failed" : picked;
    const start = Date.now();
    const path: WhatsAppOutcome[] =
      status === "read" ? ["sent", "delivered", "read"] : status === "delivered" ? ["sent", "delivered"] : status === "sent" ? ["sent"] : ["failed"];

    return {
      status,
      providerMessageId: messageId,
      ...(status === "failed"
        ? picked === "failed_unreachable"
          ? { errorCode: "131026", errorMessage: "Message undeliverable (simulated: number not on WhatsApp)" }
          : { errorCode: "131049", errorMessage: "Simulated: message not delivered to maintain healthy ecosystem engagement" }
        : {}),
      events: path.map((s, i) => ({ status: s, at: new Date(start + i * 4000).toISOString() })),
      raw: { simulated: true, template: request.template, params: request.bodyParams.length, media: request.headerMedia?.type ?? null },
    };
  },
};
