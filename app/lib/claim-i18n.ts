import db from "../db.server";

export type TranslationStrings = Record<string, string>;

/** Locales that render right-to-left. */
export const RTL_LOCALES = new Set(["ar", "he", "fa", "ur"]);

/** Suggested display names for the language switcher (merchant can override). */
export const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  fr: "Français",
  ar: "العربية",
  hi: "हिन्दी",
  es: "Español",
  de: "Deutsch",
};

/**
 * English is the canonical source of truth for the KEY set — every other
 * locale is layered over this, so a missing string always falls back to
 * English rather than rendering empty. `strings` values in the DB only ever
 * override these keys; they never introduce new ones.
 */
export const DEFAULT_TRANSLATIONS: Record<string, TranslationStrings> = {
  en: {
    "doc.title": "File a claim · Kourify",
    "brand": "Kourify",

    "hero.title": "Protection that follows through.",
    "hero.subtitle":
      "When delivery does not go as planned, tell us what happened. A real person will review your claim and follow up by email.",

    "promise.secure.title": "Secure verification",
    "promise.secure.body": "We match your details to the store order.",
    "promise.human.title": "Human review",
    "promise.human.body": "Every claim is considered individually.",
    "promise.comms.title": "Clear communication",
    "promise.comms.body": "Updates are sent to your order email.",

    "panel.eyebrow": "Shopping guarantee",
    "panel.title": "File a claim",
    "panel.intro": "Most submissions take only a few minutes.",

    "progress.aria": "Claim progress",
    "progress.order": "Order info",
    "progress.order.short": "Order",
    "progress.contact": "Contact",
    "progress.contact.short": "Contact",
    "progress.issue": "Issue details",
    "progress.issue.short": "Issue",
    "progress.review": "Review",
    "progress.review.short": "Review",

    "step.order.title": "Find your protected order",
    "step.order.copy": "Use the details shown in your confirmation email.",
    "field.orderNumber": "Order number",
    "field.confirmationCode": "Confirmation code",

    "step.contact.title": "How can we reach you?",
    "step.contact.copy": "Use the email attached to your Shopify order.",
    "field.fullName": "Full name",
    "field.email": "Order email",

    "step.issue.title": "What happened?",
    "step.issue.copy": "Choose the closest match and share the useful details.",
    "field.issue": "Issue",
    "field.details": "Details",
    "field.details.placeholder":
      "Tell us when you noticed the issue and what was affected.",
    "field.evidence": "Photo evidence",
    "field.evidence.hint":
      "Required for damaged or concealed-damage claims. Maximum 5 MB.",

    "step.review.title": "Review your claim",
    "step.review.copy":
      "Make sure these details are correct before submitting.",
    "notice":
      "Submitting a claim does not guarantee approval or an automatic payout. Kourify reviews each claim under the merchant's configured protection terms.",

    "action.back": "Back",
    "action.continue": "Continue",
    "action.submit": "Submit claim",
    "legal":
      "Your information is used only to verify and review this protection claim.",

    "issue.lost": "Never arrived (lost in transit)",
    "issue.damaged": "Arrived damaged",
    "issue.stolen": "Stolen after delivery",
    "issue.shortage": "Items missing from package",
    "issue.concealed": "Concealed damage",
    "issue.wrong_item": "Wrong item received",

    "review.order": "Order",
    "review.contact": "Contact",
    "review.issue": "Issue",

    "error.imageTooLarge": "Please choose an image smaller than 5 MB.",
    "error.orderRequired": "Enter your order number to continue.",
    "error.contactRequired":
      "Enter your full name and order email to continue.",
    "error.emailInvalid": "Enter a valid email address.",
    "error.photoRequired": "Attach a photo for this type of claim.",
    "error.submitFailed": "We could not submit your claim.",
    "error.generic": "Something went wrong. Please try again.",
    "state.submitting": "Submitting…",
    "success.title": "Claim received",
    "success.body":
      "Thank you. Our team will review your claim and follow up at {email}.",
  },
  fr: {
    "doc.title": "Déposer une réclamation · Kourify",

    "hero.title": "Une protection qui tient ses promesses.",
    "hero.subtitle":
      "Si la livraison ne se passe pas comme prévu, dites-nous ce qui s'est passé. Une personne examinera votre réclamation et vous répondra par e-mail.",

    "promise.secure.title": "Vérification sécurisée",
    "promise.secure.body": "Nous vérifions vos informations avec la commande.",
    "promise.human.title": "Examen humain",
    "promise.human.body": "Chaque réclamation est examinée individuellement.",
    "promise.comms.title": "Communication claire",
    "promise.comms.body":
      "Les mises à jour sont envoyées à l'adresse e-mail de la commande.",

    "panel.eyebrow": "Garantie d'achat",
    "panel.title": "Déposer une réclamation",
    "panel.intro": "La plupart des demandes ne prennent que quelques minutes.",

    "progress.aria": "Progression de la réclamation",
    "progress.order": "Commande",
    "progress.order.short": "Commande",
    "progress.contact": "Coordonnées",
    "progress.contact.short": "Coordonnées",
    "progress.issue": "Détails",
    "progress.issue.short": "Problème",
    "progress.review": "Vérification",
    "progress.review.short": "Vérification",

    "step.order.title": "Trouvez votre commande protégée",
    "step.order.copy":
      "Utilisez les informations de votre e-mail de confirmation.",
    "field.orderNumber": "Numéro de commande",
    "field.confirmationCode": "Code de confirmation",

    "step.contact.title": "Comment pouvons-nous vous joindre ?",
    "step.contact.copy":
      "Utilisez l'adresse e-mail associée à votre commande Shopify.",
    "field.fullName": "Nom complet",
    "field.email": "E-mail de la commande",

    "step.issue.title": "Que s'est-il passé ?",
    "step.issue.copy":
      "Choisissez l'option la plus proche et ajoutez les détails utiles.",
    "field.issue": "Problème",
    "field.details": "Détails",
    "field.details.placeholder":
      "Indiquez quand vous avez remarqué le problème et ce qui était concerné.",
    "field.evidence": "Preuve photographique",
    "field.evidence.hint":
      "Requise pour les dommages visibles ou cachés. Maximum 5 Mo.",

    "step.review.title": "Vérifiez votre réclamation",
    "step.review.copy": "Vérifiez ces informations avant l'envoi.",
    "notice":
      "L'envoi d'une réclamation ne garantit ni son approbation ni un remboursement automatique. Kourify l'examine selon les conditions du marchand.",

    "action.back": "Retour",
    "action.continue": "Continuer",
    "action.submit": "Envoyer la réclamation",
    "legal":
      "Vos informations servent uniquement à vérifier et examiner cette réclamation.",

    "issue.lost": "Jamais arrivé (perdu en transit)",
    "issue.damaged": "Arrivé endommagé",
    "issue.stolen": "Volé après la livraison",
    "issue.shortage": "Articles manquants",
    "issue.concealed": "Dommage caché",
    "issue.wrong_item": "Mauvais article reçu",

    "review.order": "Commande",
    "review.contact": "Coordonnées",
    "review.issue": "Problème",

    "error.imageTooLarge": "Veuillez choisir une image de moins de 5 Mo.",
    "error.orderRequired": "Saisissez votre numéro de commande pour continuer.",
    "error.contactRequired":
      "Saisissez votre nom complet et l'e-mail de la commande.",
    "error.emailInvalid": "Saisissez une adresse e-mail valide.",
    "error.photoRequired": "Joignez une photo pour ce type de réclamation.",
    "error.submitFailed": "Nous n'avons pas pu envoyer votre réclamation.",
    "error.generic": "Une erreur s'est produite. Veuillez réessayer.",
    "state.submitting": "Envoi en cours…",
    "success.title": "Réclamation reçue",
    "success.body":
      "Merci. Notre équipe examinera votre réclamation et vous répondra à {email}.",
  },
  // NOTE: ar/hi below are AI-generated starter translations. They render
  // immediately so merchants aren't stuck typing; a native speaker should
  // review them before heavy production use. Merchants can edit any string.
  ar: {
    "doc.title": "تقديم مطالبة · Kourify",
    "hero.title": "حماية تفي بوعدها.",
    "hero.subtitle":
      "عندما لا يسير التوصيل كما هو مخطط، أخبرنا بما حدث. سيراجع شخص حقيقي مطالبتك ويتابع معك عبر البريد الإلكتروني.",
    "promise.secure.title": "تحقق آمن",
    "promise.secure.body": "نطابق بياناتك مع طلب المتجر.",
    "promise.human.title": "مراجعة بشرية",
    "promise.human.body": "تُدرس كل مطالبة على حدة.",
    "promise.comms.title": "تواصل واضح",
    "promise.comms.body": "تُرسل التحديثات إلى البريد الإلكتروني للطلب.",
    "panel.eyebrow": "ضمان التسوق",
    "panel.title": "تقديم مطالبة",
    "panel.intro": "معظم المطالبات لا تستغرق سوى بضع دقائق.",
    "progress.aria": "تقدم المطالبة",
    "progress.order": "معلومات الطلب",
    "progress.order.short": "الطلب",
    "progress.contact": "التواصل",
    "progress.contact.short": "التواصل",
    "progress.issue": "تفاصيل المشكلة",
    "progress.issue.short": "المشكلة",
    "progress.review": "المراجعة",
    "progress.review.short": "المراجعة",
    "step.order.title": "ابحث عن طلبك المحمي",
    "step.order.copy": "استخدم التفاصيل الموجودة في بريد التأكيد.",
    "field.orderNumber": "رقم الطلب",
    "field.confirmationCode": "رمز التأكيد",
    "step.contact.title": "كيف يمكننا التواصل معك؟",
    "step.contact.copy": "استخدم البريد الإلكتروني المرتبط بطلبك على Shopify.",
    "field.fullName": "الاسم الكامل",
    "field.email": "البريد الإلكتروني للطلب",
    "step.issue.title": "ماذا حدث؟",
    "step.issue.copy": "اختر الخيار الأقرب وأضف التفاصيل المفيدة.",
    "field.issue": "المشكلة",
    "field.details": "التفاصيل",
    "field.details.placeholder": "أخبرنا متى لاحظت المشكلة وما الذي تأثر.",
    "field.evidence": "إثبات بالصور",
    "field.evidence.hint":
      "مطلوب لمطالبات التلف أو التلف المخفي. الحد الأقصى 5 ميغابايت.",
    "step.review.title": "راجع مطالبتك",
    "step.review.copy": "تأكد من صحة هذه التفاصيل قبل الإرسال.",
    "notice":
      "لا يضمن تقديم المطالبة الموافقة عليها أو صرف تعويض تلقائي. تراجع Kourify كل مطالبة وفقًا لشروط الحماية التي حددها التاجر.",
    "action.back": "رجوع",
    "action.continue": "متابعة",
    "action.submit": "إرسال المطالبة",
    "legal": "تُستخدم معلوماتك فقط للتحقق من مطالبة الحماية هذه ومراجعتها.",
    "issue.lost": "لم يصل أبدًا (مفقود أثناء الشحن)",
    "issue.damaged": "وصل تالفًا",
    "issue.stolen": "سُرق بعد التوصيل",
    "issue.shortage": "أصناف مفقودة من الطرد",
    "issue.concealed": "تلف مخفي",
    "issue.wrong_item": "استلام صنف خاطئ",
    "review.order": "الطلب",
    "review.contact": "التواصل",
    "review.issue": "المشكلة",
    "error.imageTooLarge": "يرجى اختيار صورة أصغر من 5 ميغابايت.",
    "error.orderRequired": "أدخل رقم طلبك للمتابعة.",
    "error.contactRequired":
      "أدخل اسمك الكامل والبريد الإلكتروني للطلب للمتابعة.",
    "error.emailInvalid": "أدخل عنوان بريد إلكتروني صالحًا.",
    "error.photoRequired": "أرفق صورة لهذا النوع من المطالبات.",
    "error.submitFailed": "تعذّر إرسال مطالبتك.",
    "error.generic": "حدث خطأ ما. يرجى المحاولة مرة أخرى.",
    "state.submitting": "جارٍ الإرسال…",
    "success.title": "تم استلام المطالبة",
    "success.body":
      "شكرًا لك. سيراجع فريقنا مطالبتك ويتابع معك على {email}.",
  },
  hi: {
    "doc.title": "दावा दर्ज करें · Kourify",
    "hero.title": "सुरक्षा जो निभाती है।",
    "hero.subtitle":
      "जब डिलीवरी योजना के अनुसार न हो, तो हमें बताएं कि क्या हुआ। एक वास्तविक व्यक्ति आपके दावे की समीक्षा करेगा और ईमेल द्वारा संपर्क करेगा।",
    "promise.secure.title": "सुरक्षित सत्यापन",
    "promise.secure.body": "हम आपके विवरण को स्टोर ऑर्डर से मिलाते हैं।",
    "promise.human.title": "मानवीय समीक्षा",
    "promise.human.body": "हर दावे पर अलग से विचार किया जाता है।",
    "promise.comms.title": "स्पष्ट संचार",
    "promise.comms.body": "अपडेट आपके ऑर्डर ईमेल पर भेजे जाते हैं।",
    "panel.eyebrow": "शॉपिंग गारंटी",
    "panel.title": "दावा दर्ज करें",
    "panel.intro": "अधिकांश सबमिशन में केवल कुछ मिनट लगते हैं।",
    "progress.aria": "दावे की प्रगति",
    "progress.order": "ऑर्डर जानकारी",
    "progress.order.short": "ऑर्डर",
    "progress.contact": "संपर्क",
    "progress.contact.short": "संपर्क",
    "progress.issue": "समस्या विवरण",
    "progress.issue.short": "समस्या",
    "progress.review": "समीक्षा",
    "progress.review.short": "समीक्षा",
    "step.order.title": "अपना सुरक्षित ऑर्डर खोजें",
    "step.order.copy": "अपने पुष्टिकरण ईमेल में दिखाए गए विवरण का उपयोग करें।",
    "field.orderNumber": "ऑर्डर नंबर",
    "field.confirmationCode": "पुष्टिकरण कोड",
    "step.contact.title": "हम आपसे कैसे संपर्क करें?",
    "step.contact.copy": "अपने Shopify ऑर्डर से जुड़े ईमेल का उपयोग करें।",
    "field.fullName": "पूरा नाम",
    "field.email": "ऑर्डर ईमेल",
    "step.issue.title": "क्या हुआ?",
    "step.issue.copy": "सबसे नज़दीकी विकल्प चुनें और उपयोगी विवरण साझा करें।",
    "field.issue": "समस्या",
    "field.details": "विवरण",
    "field.details.placeholder":
      "हमें बताएं कि आपने समस्या कब देखी और क्या प्रभावित हुआ।",
    "field.evidence": "फ़ोटो प्रमाण",
    "field.evidence.hint":
      "क्षतिग्रस्त या छिपी क्षति के दावों के लिए आवश्यक। अधिकतम 5 MB।",
    "step.review.title": "अपने दावे की समीक्षा करें",
    "step.review.copy": "सबमिट करने से पहले सुनिश्चित करें कि ये विवरण सही हैं।",
    "notice":
      "दावा सबमिट करने से स्वीकृति या स्वचालित भुगतान की गारंटी नहीं मिलती। Kourify प्रत्येक दावे की समीक्षा व्यापारी द्वारा निर्धारित सुरक्षा शर्तों के अनुसार करता है।",
    "action.back": "वापस",
    "action.continue": "जारी रखें",
    "action.submit": "दावा सबमिट करें",
    "legal":
      "आपकी जानकारी का उपयोग केवल इस सुरक्षा दावे को सत्यापित और समीक्षा करने के लिए किया जाता है।",
    "issue.lost": "कभी नहीं पहुँचा (पारगमन में खो गया)",
    "issue.damaged": "क्षतिग्रस्त पहुँचा",
    "issue.stolen": "डिलीवरी के बाद चोरी",
    "issue.shortage": "पैकेज से गायब वस्तुएँ",
    "issue.concealed": "छिपी क्षति",
    "issue.wrong_item": "गलत वस्तु प्राप्त हुई",
    "review.order": "ऑर्डर",
    "review.contact": "संपर्क",
    "review.issue": "समस्या",
    "error.imageTooLarge": "कृपया 5 MB से छोटी छवि चुनें।",
    "error.orderRequired": "जारी रखने के लिए अपना ऑर्डर नंबर दर्ज करें।",
    "error.contactRequired":
      "जारी रखने के लिए अपना पूरा नाम और ऑर्डर ईमेल दर्ज करें।",
    "error.emailInvalid": "एक मान्य ईमेल पता दर्ज करें।",
    "error.photoRequired": "इस प्रकार के दावे के लिए एक फ़ोटो संलग्न करें।",
    "error.submitFailed": "हम आपका दावा सबमिट नहीं कर सके।",
    "error.generic": "कुछ गलत हो गया। कृपया पुनः प्रयास करें।",
    "state.submitting": "सबमिट हो रहा है…",
    "success.title": "दावा प्राप्त हुआ",
    "success.body":
      "धन्यवाद। हमारी टीम आपके दावे की समीक्षा करेगी और {email} पर संपर्क करेगी।",
  },
};

/** Canonical list of translatable keys, derived from the English master. */
export const CLAIM_KEYS = Object.keys(DEFAULT_TRANSLATIONS.en);

export function normalizeLocale(locale: string): string {
  return locale.toLowerCase().split("-")[0];
}

export function isRtl(locale: string): boolean {
  return RTL_LOCALES.has(normalizeLocale(locale));
}

export type LocaleBundle = {
  label: string;
  direction: "ltr" | "rtl";
  strings: TranslationStrings;
};

/** Resolve one key within a bundle, falling back to the English master. */
export function t(bundle: LocaleBundle | undefined, key: string): string {
  return bundle?.strings[key] ?? DEFAULT_TRANSLATIONS.en[key] ?? key;
}

function buildBundle(
  locale: string,
  row?: { label: string; direction: string; strings: string },
): LocaleBundle {
  let dbStrings: TranslationStrings = {};
  if (row) {
    try {
      dbStrings = JSON.parse(row.strings) as TranslationStrings;
    } catch {
      dbStrings = {};
    }
  }
  return {
    label: row?.label ?? LOCALE_LABELS[locale] ?? locale,
    direction:
      (row?.direction as "ltr" | "rtl") ?? (isRtl(locale) ? "rtl" : "ltr"),
    // English base guarantees no missing keys; locale defaults override it;
    // the merchant's DB values override last.
    strings: {
      ...DEFAULT_TRANSLATIONS.en,
      ...(DEFAULT_TRANSLATIONS[locale] ?? {}),
      ...dbStrings,
    },
  };
}

/**
 * Loads the languages a shop offers on the claim page, layering the
 * merchant's DB overrides over code defaults. English is always present as
 * the ultimate fallback, and so is the shop's configured fallback language.
 */
export async function getClaimTranslations(shop: string): Promise<{
  locales: Record<string, LocaleBundle>;
  fallback: string;
}> {
  const [settings, rows] = await Promise.all([
    db.merchantSettings.findUnique({ where: { shop } }),
    db.storefrontTranslation.findMany({ where: { shop, enabled: true } }),
  ]);

  const fallback = normalizeLocale(settings?.storefrontFallbackLanguage ?? "en");
  const byLocale = new Map(
    rows.map((row) => [normalizeLocale(row.locale), row]),
  );

  // Which languages to expose: the merchant's saved rows if any, otherwise
  // the configured storefrontLanguages list against code defaults.
  const exposed = byLocale.size
    ? [...byLocale.keys()]
    : (settings?.storefrontLanguages ?? "en,fr")
        .split(",")
        .map((locale) => normalizeLocale(locale.trim()))
        .filter(Boolean);

  const locales: Record<string, LocaleBundle> = {};
  for (const locale of exposed) {
    locales[locale] = buildBundle(locale, byLocale.get(locale));
  }

  // Guarantee the fallback locale and English are always available.
  if (!locales[fallback]) locales[fallback] = buildBundle(fallback);
  if (!locales.en) locales.en = buildBundle("en");

  return { locales, fallback: locales[fallback] ? fallback : "en" };
}
