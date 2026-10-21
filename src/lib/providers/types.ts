// Provider-independent contracts. Phone Calls and WhatsApp deliberately have
// separate interfaces and registries: a voice vendor and the WhatsApp
// Business Platform have nothing in common beyond "deliver to a number".

export type DeliveryMode = "simulation" | "live";
export type Channel = "voice" | "whatsapp";

export interface ProviderInfo {
  /** stable id stored on campaigns.provider, e.g. "mock", "twilio" */
  id: string;
  displayName: string;
  mode: DeliveryMode;
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------
export type VoiceOutcome = "answered" | "voicemail" | "no_answer" | "busy" | "failed";

export interface VoiceCallRequest {
  to: string;
  from: string | null;
  /** short-lived signed URL the provider fetches the recording from */
  audioUrl: string | null;
  audioDurationSeconds: number | null;
  campaignId: string;
  recipientId: string;
}

export interface VoiceCallResult {
  status: VoiceOutcome;
  providerCallId: string;
  durationSeconds: number;
  errorCode?: string;
  errorMessage?: string;
  raw: Record<string, unknown>;
}

export interface VoiceProvider extends ProviderInfo {
  placeCall(request: VoiceCallRequest): Promise<VoiceCallResult>;
}

// ---------------------------------------------------------------------------
// WhatsApp (template messages only — business-initiated messages outside the
// 24h service window must use an approved template)
// ---------------------------------------------------------------------------
export type WhatsAppHeaderType = "NONE" | "TEXT" | "IMAGE" | "VIDEO";

export interface WhatsAppTemplate {
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  status: "APPROVED" | "PENDING" | "REJECTED";
  headerType: WhatsAppHeaderType;
  headerText?: string;
  /** body with {{1}}, {{2}} … placeholders */
  body: string;
  footer?: string;
  buttons?: { type: "QUICK_REPLY" | "URL"; text: string }[];
}

export type WhatsAppOutcome = "sent" | "delivered" | "read" | "failed";

export interface WhatsAppSendRequest {
  to: string;
  template: { name: string; language: string };
  bodyParams: string[];
  headerMedia: { type: "image" | "video"; url: string } | null;
  campaignId: string;
  recipientId: string;
}

export interface WhatsAppSendResult {
  status: WhatsAppOutcome;
  providerMessageId: string;
  errorCode?: string;
  errorMessage?: string;
  /** status webhooks the provider would have sent, in order */
  events: { status: WhatsAppOutcome; at: string }[];
  raw: Record<string, unknown>;
}

export interface WhatsAppProvider extends ProviderInfo {
  listTemplates(): Promise<WhatsAppTemplate[]>;
  sendTemplate(request: WhatsAppSendRequest): Promise<WhatsAppSendResult>;
}

export class LiveModeBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveModeBlockedError";
  }
}
