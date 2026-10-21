// Contact fields an import column can be mapped to, with the header
// spellings we recognise automatically.

export const CONTACT_FIELD_KEYS = [
  "phone",
  "firstName",
  "lastName",
  "fullName",
  "email",
  "countryCode",
  "tags",
  "voiceConsent",
  "whatsappOptIn",
] as const;

export type ContactFieldKey = (typeof CONTACT_FIELD_KEYS)[number];

export interface ContactFieldDef {
  key: ContactFieldKey;
  label: string;
  required?: boolean;
  description: string;
  synonyms: string[];
}

export const CONTACT_FIELDS: Record<ContactFieldKey, ContactFieldDef> = {
  phone: {
    key: "phone",
    label: "Phone number",
    required: true,
    description: "Any format; normalised to E.164 (+919876543210).",
    synonyms: [
      "phone", "phone number", "phone no", "mobile", "mobile number", "mobile no", "cell",
      "cell phone", "cellphone", "telephone", "tel", "contact number", "contact no",
      "whatsapp", "whatsapp number", "wa number", "msisdn", "number", "ph", "mob", "phone e164",
    ],
  },
  firstName: {
    key: "firstName",
    label: "First name",
    description: "Given name.",
    synonyms: ["first name", "firstname", "given name", "fname", "first", "forename"],
  },
  lastName: {
    key: "lastName",
    label: "Last name",
    description: "Family name.",
    synonyms: ["last name", "lastname", "surname", "family name", "lname", "last"],
  },
  fullName: {
    key: "fullName",
    label: "Full name",
    description: "Split into first/last name when those aren't mapped.",
    synonyms: ["name", "full name", "fullname", "contact name", "customer name", "display name", "client name"],
  },
  email: {
    key: "email",
    label: "Email",
    description: "Optional; must be a valid address when present.",
    synonyms: ["email", "e mail", "email address", "mail", "email id"],
  },
  countryCode: {
    key: "countryCode",
    label: "Country (ISO code)",
    description: "Two-letter code (IN, US). Used to read local-format numbers.",
    synonyms: ["country", "country code", "iso", "iso code", "region"],
  },
  tags: {
    key: "tags",
    label: "Tags",
    description: "Separated by comma, semicolon or |.",
    synonyms: ["tags", "tag", "labels", "label", "groups", "group", "segment", "segments", "list"],
  },
  voiceConsent: {
    key: "voiceConsent",
    label: "Voice call consent",
    description: "yes/no, true/false, 1/0. Required to receive calls.",
    synonyms: [
      "voice consent", "call consent", "consent call", "calls opt in", "voice opt in",
      "call opt in", "voice optin", "call optin", "consent voice",
    ],
  },
  whatsappOptIn: {
    key: "whatsappOptIn",
    label: "WhatsApp opt-in",
    description: "yes/no, true/false, 1/0. Required to receive WhatsApp messages.",
    synonyms: [
      "whatsapp opt in", "whatsapp optin", "whatsapp consent", "wa opt in", "wa optin",
      "wa consent", "opt in whatsapp", "consent whatsapp",
    ],
  },
};

/** field -> zero-based column index (absent = not mapped) */
export type ColumnMapping = Partial<Record<ContactFieldKey, number>>;

export const MAX_IMPORT_ROWS = 50_000;
export const MAX_TAGS_PER_CONTACT = 20;
export const MAX_TAG_LENGTH = 40;
export const MAX_NAME_LENGTH = 100;
