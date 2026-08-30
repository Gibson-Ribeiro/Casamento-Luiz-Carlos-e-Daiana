import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient.js";

export const WEDDING = {
  couple: "Luiz Carlos & Daiana",
  groom: "Luiz Carlos",
  bride: "Daiana",
  monogram: "L | D",
  dateLabel: "28 de novembro de 2026",
  timeLabel: "15h",
  city: "Timbó, SC",
  timezone: "America/Sao_Paulo",
  eventStartsAt: "2026-11-28T15:00:00-03:00",
  rsvpDeadline: "2026-10-25T23:59:59-03:00",
  ceremony: {
    title: "Capela São Roque",
    label: "Cerimônia",
    time: "15h",
    address: "Rodovia SC-110, 5960, Bairro São Roque, Timbó - SC",
    mapsUrl:
      "https://www.google.com/maps/search/?api=1&query=Capela%20S%C3%A3o%20Roque%20Rodovia%20SC-110%205960%20Timb%C3%B3%20SC",
    wazeUrl:
      "https://waze.com/ul?q=Capela%20S%C3%A3o%20Roque%20Rodovia%20SC-110%205960%20Timb%C3%B3%20SC&navigate=yes",
  },
  reception: {
    title: "Capivaras Feira & Bar",
    label: "Recepção após a cerimônia",
    time: "Após a cerimônia",
    address: "Rua Rui Barbosa, 36, Centro, Timbó - SC",
    mapsUrl:
      "https://www.google.com/maps/search/?api=1&query=Capivaras%20Feira%20%26%20Bar%20Rua%20Rui%20Barbosa%2036%20Timb%C3%B3%20SC",
    wazeUrl:
      "https://waze.com/ul?q=Capivaras%20Feira%20e%20Bar%20Rua%20Rui%20Barbosa%2036%20Timb%C3%B3%20SC&navigate=yes",
  },
  parents: {
    groom: "Luiz Carlos Bassani e Nadir Biz",
    bride: "Osvaldo de Oliveira e Maria Sandri D. de Oliveira",
  },
  verse:
    "Assim, eles já não são dois, mas sim uma só carne. Portanto, o que Deus uniu, ninguém separe.",
  verseRef: "Mateus 19:6",
};

const DEMO_TOKEN = "lucas-fernanda-demo";
const GALLERY_BUCKET = "wedding-gallery";
const FLORAL_FRAME = new URL("./assets/moldura-floral-convite.png", import.meta.url).href;
const ICS_FILE = new URL("./assets/luiz-carlos-daiana.ics", import.meta.url).href;
const DEFAULT_MUSIC_PATH = "assets/audio/jesus-meu-esposo-colo-de-deus-violin.mp3";
const DEFAULT_MUSIC_URL = new URL(`./${DEFAULT_MUSIC_PATH}`, import.meta.url).href;
const INVITATION_ROUTE = new URL("./convite/", import.meta.url).href;
const ADMIN_ROUTE = new URL("./admin/", import.meta.url).href;
const MAX_GALLERY_FILE_SIZE = 12 * 1024 * 1024;
const ALLOWED_GALLERY_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const STORY_PHOTOS = [
  "assets/historia/familia-01.jpg",
  "assets/historia/familia-02.jpg",
  "assets/historia/familia-03.jpg",
  "assets/historia/familia-04.jpg",
  "assets/historia/familia-05.jpg",
];

let app = null;
let supabase = null;
let invitationToken = "";
let invitation = null;
let guestArea = null;
let opened = false;
let busy = false;
let countdownTimer = 0;
let audio = null;
let musicState = {
  visible: false,
  playing: false,
  failed: false,
  hidden:
    typeof localStorage === "undefined"
      ? false
      : localStorage.getItem("ld-music-hidden") === "true",
  volume: readStoredMusicVolume(),
};

export function calculateCountdown(targetIso, nowMs = Date.now()) {
  const targetMs = new Date(targetIso).getTime();
  const diff = Math.max(targetMs - nowMs, 0);

  return {
    started: diff === 0,
    days: Math.floor(diff / 86_400_000),
    hours: Math.floor((diff % 86_400_000) / 3_600_000),
    minutes: Math.floor((diff % 3_600_000) / 60_000),
    seconds: Math.floor((diff % 60_000) / 1000),
  };
}

export function validateRsvpPayload(payload, guest, nowMs = Date.now()) {
  const deadlineMs = new Date(WEDDING.rsvpDeadline).getTime();
  if (nowMs > deadlineMs) {
    return "O prazo de confirmação já encerrou.";
  }

  if (!payload.consent) {
    return "Confirme o consentimento para armazenarmos sua resposta.";
  }

  if (!["attending", "declined"].includes(payload.status)) {
    return "Escolha se você estará presente ou não poderá comparecer.";
  }

  if (payload.status === "declined") return "";

  const adults = Number(payload.adults_count || 0);
  const children = Number(payload.children_count || 0);
  const maxAdults = Number(guest?.max_adults || 0);
  const maxChildren = Number(guest?.max_children || 0);

  if (adults + children < 1) return "Informe ao menos uma pessoa confirmada.";
  if (adults > maxAdults) return "A quantidade de adultos ultrapassa o limite do convite.";
  if (children > maxChildren) return "A quantidade de crianças ultrapassa o limite do convite.";
  if (adults + children > maxAdults + maxChildren) {
    return "A quantidade total ultrapassa o limite deste convite.";
  }

  return "";
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";

  if (/^(?:\.\/|\.\.\/)?assets\//i.test(text)) {
    const normalized = text.replace(/^(?:\.\/|\.\.\/)+/, "");
    return new URL(`./${normalized}`, import.meta.url).href;
  }

  try {
    const url = new URL(text, window.location.href);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function readStoredMusicVolume() {
  if (typeof localStorage === "undefined") return 0.35;
  const volume = Number(localStorage.getItem("ld-music-volume") || "0.35");
  return Number.isFinite(volume) && volume >= 0 && volume <= 1 ? volume : 0.35;
}

function musicUrlFromSettings(settings = {}) {
  return safeUrl(settings.music_url || DEFAULT_MUSIC_PATH) || DEFAULT_MUSIC_URL;
}

function storyPhoto(index) {
  return STORY_PHOTOS[index % STORY_PHOTOS.length] || "";
}

function isNativeStoryPhoto(value = "") {
  const photo = String(value || "").replaceAll("\\", "/");
  return STORY_PHOTOS.some((item) => photo.endsWith(item));
}

function defaultStoryChapters() {
  return [
    {
      title: "O nosso início",
      text: "Daiana e Bassani se conheceram em junho de 2017. Naquele momento, Daiana já era mãe do Davi, e desde o início Bassani criou com ele um vínculo muito especial. Os dois se gostavam muito e construíram uma relação cheia de carinho.",
      image_url: storyPhoto(0),
    },
    {
      title: "A chegada do Matteo",
      text: "Em 2020, a família cresceu com a chegada do Matteo. Davi e Matteo tinham quase nove anos de diferença. Apesar de o Davi ter o seu jeitinho muito particular de ver e se relacionar com o mundo, ainda assim os dois construíram uma relação bonita, cada um à sua maneira, cheia de carinho e cumplicidade.",
      image_url: storyPhoto(3),
    },
    {
      title: "Uma família cheia de amor",
      text: "Ao longo dos anos, os quatro viveram muitos momentos felizes juntos e construíram uma família cheia de amor.",
      image_url: storyPhoto(2),
    },
    {
      title: "Sempre perto, sempre amado",
      text: "Hoje, Davi não está mais fisicamente presente, mas continua sendo parte dessa família e dessa história. Está presente nas lembranças, no coração de todos e, principalmente, no amor que deixou. Matteo ainda fala do irmão, conta que ele mora no céu e carrega consigo esse vínculo tão especial.",
      image_url: storyPhoto(1),
    },
    {
      title: "Um novo capítulo",
      text: "E é assim que essa família chega a um novo capítulo: depois de tantos anos juntos, Daiana e Bassani celebram o amor que construíram, a família que formaram e a história que continuam escrevendo juntos. Com a fé que os sustenta e a certeza de que Deus esteve presente em cada passo dessa caminhada, eles seguem para esse novo capítulo confiantes de que Davi também estará presente, de alguma forma, nesse momento tão especial — sempre perto, sempre amado e para sempre parte dessa família.\n\nAgora, é hora de celebrar o amor, a família e a vida, com o coração cheio de gratidão por tudo o que viveram e por tudo o que ainda está por vir.",
      image_url: storyPhoto(4),
    },
  ];
}

function isPlaceholderStoryText(value = "") {
  const text = String(value).toLowerCase();
  return (
    text.includes("texto provis") ||
    text.includes("preparado para receber") ||
    text.includes("será preenchido") ||
    text.includes("sera preenchido") ||
    text.includes("aqui entra")
  );
}

function normalizeStoryChapters(chapters = []) {
  const defaults = defaultStoryChapters();
  const savedChapters = Array.isArray(chapters) ? chapters : [];
  const shouldUseDefaults =
    !savedChapters.length ||
    savedChapters.every((chapter = {}) => !chapter.text || isPlaceholderStoryText(chapter.text));
  const list = shouldUseDefaults ? defaults : savedChapters;

  return list.map((chapter = {}, index) => {
    const fallback = defaults[index] || {
      title: `Capítulo ${String(index + 1).padStart(2, "0")}`,
      text: "Um trecho complementar da caminhada de Daiana e Bassani.",
      image_url: storyPhoto(index),
    };
    const useDefaultStory = isPlaceholderStoryText(chapter.text);
    const useDefaultTitle = index === 0 && chapter.title === "Junho de 2017";

    return {
      title: !chapter.title || useDefaultStory || useDefaultTitle ? fallback.title : chapter.title,
      text: !chapter.text || useDefaultStory ? fallback.text : chapter.text,
      image_url: isNativeStoryPhoto(chapter.image_url)
        ? fallback.image_url
        : chapter.image_url || fallback.image_url || storyPhoto(index),
    };
  });
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(value) {
  const labels = {
    pending: "Pendente",
    attending: "Presença confirmada",
    declined: "Não poderá comparecer",
    upload_requested: "Aguardando envio",
    pending_moderation: "Em moderação",
    approved: "Aprovado",
    rejected: "Rejeitado",
  };
  return labels[value] || value || "Pendente";
}

function readTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || params.get("convite") || "";
  return token.trim();
}

function invitationBaseUrl() {
  return INVITATION_ROUTE;
}

function withTokenUrl(token = invitationToken, hash = "") {
  const url = new URL(invitationBaseUrl());
  if (token) url.searchParams.set("token", token);
  if (hash) url.hash = hash;
  return url.toString();
}

function showLoading(text = "Preparando seu convite...") {
  app.innerHTML = `
    <section class="loading-view" aria-label="Carregando">
      <span class="loader" aria-hidden="true"></span>
      <p>${escapeHtml(text)}</p>
    </section>
  `;
}

function setApp(html) {
  app.innerHTML = html;
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function defaultContent() {
  return {
    music_url: DEFAULT_MUSIC_PATH,
    gallery_enabled: false,
    gallery_visible_after: "2026-11-28T20:00:00-03:00",
    pix_key: "",
    pix_copy_paste: "",
    pix_receiver: "Luiz Carlos e Daiana",
    pix_bank: "",
    pix_message:
      "Depois de confirmar presença, o código PIX dos noivos aparece somente na sua área privada.",
    attire: "Conteúdo provisório: definir traje sugerido no painel administrativo.",
    parking: "Conteúdo provisório: incluir orientações de estacionamento.",
    arrival:
      "Conteúdo provisório: incluir recomendações de chegada e deslocamento entre cerimônia e recepção.",
    accessibility: "Conteúdo provisório: informar recursos de acessibilidade disponíveis.",
    important_info: "Conteúdo provisório: adicionar informações importantes para os convidados.",
    confirmation_message:
      "Sua resposta foi recebida com carinho. Será uma alegria caminhar até esse dia sabendo que você faz parte da nossa história.",
    story_chapters: defaultStoryChapters(),
    faqs: [
      {
        question: "Posso levar acompanhante?",
        answer:
          "Conteúdo provisório. O limite aparece no seu convite e pode ser ajustado pelos noivos no painel.",
      },
      {
        question: "Crianças são convidadas?",
        answer:
          "Conteúdo provisório. A quantidade autorizada aparece na sua área do convidado.",
      },
      {
        question: "Qual o traje?",
        answer: "Conteúdo provisório. Os noivos poderão definir o traje no painel.",
      },
      {
        question: "Onde estacionar?",
        answer:
          "Conteúdo provisório. As orientações de estacionamento serão adicionadas antes do evento.",
      },
      {
        question: "Como alterar a confirmação?",
        answer:
          "Você pode voltar ao seu link personalizado e editar sua resposta até 25 de outubro de 2026.",
      },
      {
        question: "Como faço para presentear os noivos?",
        answer:
          "Não haverá catálogo de compra. Após confirmar presença, o código PIX dos noivos aparece na sua área privada.",
      },
      {
        question: "Até quando posso confirmar presença?",
        answer: "As confirmações ficam abertas até 25 de outubro de 2026.",
      },
    ],
  };
}

function demoContent() {
  return {
    ...defaultContent(),
    pix_key: "pix-demo-luiz-daiana@example.com",
    pix_receiver: "Luiz Carlos e Daiana",
    pix_bank: "Banco demo",
    pix_copy_paste: "PIX-DEMONSTRACAO-LUIZ-CARLOS-DAIANA",
  };
}

function normalizeDemoState(state) {
  const content = { ...demoContent(), ...(state?.content || {}) };
  content.story_chapters = normalizeStoryChapters(content.story_chapters);

  return {
    guests: Array.isArray(state?.guests) ? state.guests : [],
    rsvps: Array.isArray(state?.rsvps) ? state.rsvps : [],
    messages: Array.isArray(state?.messages) ? state.messages : [],
    gallery: Array.isArray(state?.gallery) ? state.gallery : [],
    content,
  };
}

function demoState() {
  const stored = localStorage.getItem("ld-demo-state");
  if (stored) {
    try {
      const state = normalizeDemoState(JSON.parse(stored));
      saveDemoState(state);
      return state;
    } catch {
      localStorage.removeItem("ld-demo-state");
    }
  }

  return {
    guests: [
      {
        id: "guest-demo-lucas-fernanda",
        token: DEMO_TOKEN,
        display_name: "Lucas e Fernanda",
        max_adults: 2,
        max_children: 1,
        active: true,
        invitation_opened_at: null,
        invitation_open_count: 0,
      },
    ],
    rsvps: [],
    messages: [],
    gallery: [],
    content: demoContent(),
  };
}

function saveDemoState(state) {
  localStorage.setItem("ld-demo-state", JSON.stringify(state));
}

function demoGuest(token, state = demoState()) {
  return state.guests.find((guest) => guest.token === token);
}

function pixIsConfigured(pix = {}) {
  return Boolean(String(pix.copy_paste || pix.key || "").trim());
}

function buildPixAccess(settings = {}, rsvp = null, serverPix = null) {
  const attending = rsvp?.status === "attending";
  const pix = serverPix || {};
  const access = {
    available: Boolean(pix.available ?? attending),
    key: pix.key ?? settings.pix_key ?? "",
    copy_paste: pix.copy_paste ?? settings.pix_copy_paste ?? "",
    receiver: pix.receiver ?? settings.pix_receiver ?? "Luiz Carlos e Daiana",
    bank: pix.bank ?? settings.pix_bank ?? "",
    message: pix.message ?? settings.pix_message ?? "",
  };

  if (!attending && !pix.available) {
    return {
      available: false,
      key: "",
      copy_paste: "",
      receiver: access.receiver,
      bank: "",
      message: settings.pix_message || defaultContent().pix_message,
    };
  }

  return access;
}

export async function demoRpc(name, args = {}) {
  const state = demoState();
  const token = args.p_token || args.token || invitationToken;
  const guest = demoGuest(token, state);

  if (name !== "resolve_invitation" && !guest) {
    return { ok: false, reason: "invalid", message: "Convite não encontrado." };
  }

  if (name === "resolve_invitation") {
    if (!guest) return { ok: false, reason: "invalid", message: "Convite não encontrado." };
    if (!guest.active) return { ok: false, reason: "inactive", message: "Convite desativado." };
    return {
      ok: true,
      guest: {
        display_name: guest.display_name,
        max_adults: guest.max_adults,
        max_children: guest.max_children,
      },
      settings: state.content,
    };
  }

  if (name === "register_invitation_open") {
    guest.invitation_opened_at = guest.invitation_opened_at || new Date().toISOString();
    guest.invitation_open_count += 1;
    saveDemoState(state);
    return { ok: true };
  }

  if (name === "get_guest_area") {
    const rsvp = state.rsvps.find((item) => item.guest_id === guest.id) || null;
    return {
      ok: true,
      guest,
      rsvp,
      pix: buildPixAccess(state.content, rsvp),
      messages: state.messages.filter((item) => item.guest_id === guest.id),
      gallery_items: state.gallery.filter((item) => item.guest_id === guest.id),
      settings: state.content,
      event: WEDDING,
    };
  }

  if (name === "upsert_rsvp") {
    const payload = args.p_payload || {};
    const error = validateRsvpPayload(payload, guest);
    if (error) return { ok: false, message: error };

    const existing = state.rsvps.find((item) => item.guest_id === guest.id);
    const next = {
      id: existing?.id || crypto.randomUUID(),
      guest_id: guest.id,
      status: payload.status,
      adults_count: payload.status === "attending" ? Number(payload.adults_count) : 0,
      children_count: payload.status === "attending" ? Number(payload.children_count) : 0,
      companion_names: payload.status === "attending" ? payload.companion_names || [] : [],
      dietary_restrictions: payload.dietary_restrictions || "",
      phone: payload.phone || "",
      message: payload.message || "",
      consent_at: existing?.consent_at || new Date().toISOString(),
      submitted_at: existing?.submitted_at || new Date().toISOString(),
      changed_at: existing ? new Date().toISOString() : null,
      revision: Number(existing?.revision || 0) + 1,
    };

    if (existing) Object.assign(existing, next);
    else state.rsvps.push(next);

    saveDemoState(state);
    return { ok: true, rsvp: next };
  }

  if (name === "submit_guest_message") {
    const text = String(args.p_message || "").trim();
    if (text.length < 3) return { ok: false, message: "Escreva uma mensagem um pouco maior." };
    const existing = state.messages.find((item) => item.guest_id === guest.id);
    const message = {
      id: existing?.id || crypto.randomUUID(),
      guest_id: guest.id,
      message: text.slice(0, 1200),
      status: "pending_moderation",
      submitted_at: existing?.submitted_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (existing) Object.assign(existing, message);
    else state.messages.push(message);
    saveDemoState(state);
    return { ok: true, message };
  }

  if (name === "request_gallery_upload") {
    const metadata = args.p_metadata || {};
    const item = {
      id: crypto.randomUUID(),
      guest_id: guest.id,
      caption: metadata.caption || "",
      people: metadata.people || "",
      storage_bucket: GALLERY_BUCKET,
      storage_path: `demo/${guest.id}/${crypto.randomUUID()}.jpg`,
      status: "pending_moderation",
      created_at: new Date().toISOString(),
    };
    state.gallery.push(item);
    saveDemoState(state);
    return { ok: true, item, bucket: GALLERY_BUCKET, storage_path: item.storage_path, demo: true };
  }

  if (name === "confirm_gallery_upload") return { ok: true };

  return { ok: false, message: `RPC de demonstração não implementada: ${name}` };
}

async function rpc(name, args = {}) {
  if (!isSupabaseConfigured()) return demoRpc(name, args);

  supabase = supabase || (await getSupabaseClient());
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

function renderSystemMessage({ title, text, action = "" }) {
  setApp(`
    <article class="system-card">
      <p class="eyebrow">${WEDDING.couple}</p>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(text)}</p>
      ${action}
    </article>
  `);
}

function renderTokenEntry(message = "") {
  setApp(`
    <section class="entry-view">
      <div class="entry-art" aria-hidden="true">
        <img src="${FLORAL_FRAME}" alt="" />
      </div>
      <article class="entry-panel">
        <p class="monogram">${WEDDING.monogram}</p>
        <p class="eyebrow">Convite de casamento</p>
        <h1>${WEDDING.couple}</h1>
        <p>
          Abra seu link personalizado para confirmar presença e acessar somente
          a sua área reservada do convite.
        </p>
        ${message ? `<div class="notice notice--warn">${escapeHtml(message)}</div>` : ""}
        <form class="inline-form" data-form="token">
          <label>
            <span>Token do convite</span>
            <input name="token" autocomplete="one-time-code" placeholder="${DEMO_TOKEN}" required />
          </label>
          <button class="button button--primary" type="submit">Abrir</button>
        </form>
        <div class="entry-actions">
          <a class="text-link" href="${ADMIN_ROUTE}">Área dos noivos</a>
          <button class="text-link" type="button" data-action="usar-demo">
            Usar convite de demonstração
          </button>
        </div>
      </article>
    </section>
  `);
}

async function resolveInvitation() {
  if (!invitationToken) {
    renderTokenEntry();
    return;
  }

  showLoading("Localizando seu convite...");

  try {
    const data = await rpc("resolve_invitation", { p_token: invitationToken });
    if (!data?.ok) {
      renderTokenEntry(data?.message || "Convite inválido ou desativado.");
      return;
    }
    invitation = data;
    renderOpeningCover();
  } catch (error) {
    renderSystemMessage({
      title: "Não foi possível abrir o convite.",
      text:
        error?.message ||
        "Verifique a conexão, a configuração do Supabase e tente novamente.",
      action: `<button class="button button--secondary" type="button" data-action="voltar-entrada">Voltar</button>`,
    });
  }
}

function renderOpeningCover() {
  const name = invitation?.guest?.display_name || "Convidado especial";

  setApp(`
    <section class="opening-cover" aria-label="Capa personalizada do convite">
      <img class="opening-cover__frame" src="${FLORAL_FRAME}" alt="" aria-hidden="true" />
      <div class="opening-cover__content">
        <p class="monogram">${WEDDING.monogram}</p>
        <p class="eyebrow">Preparamos este convite especialmente para</p>
        <h1>${escapeHtml(name)}</h1>
        <p class="opening-cover__couple">${WEDDING.couple}</p>
        <p>${WEDDING.dateLabel} · ${WEDDING.timeLabel} · ${WEDDING.city}</p>
        <button class="button button--primary button--large" type="button" data-action="abrir-convite">
          Abrir convite
        </button>
      </div>
    </section>
  `);
}

async function openInvitation() {
  if (busy) return;
  busy = true;
  opened = true;
  document.body.classList.add("invitation-opened");
  const musicStart = startMusic();

  try {
    await rpc("register_invitation_open", { p_token: invitationToken });
  } catch {
    // A abertura não deve bloquear a experiência se o registro falhar.
  }

  await loadGuestArea();
  await musicStart;
  await startMusic();
  busy = false;
}

async function loadGuestArea({ keepScroll = false } = {}) {
  showLoading("Preparando a área do convidado...");

  try {
    const data = await rpc("get_guest_area", { p_token: invitationToken });
    if (!data?.ok) {
      renderTokenEntry(data?.message || "Não foi possível carregar este convite.");
      return;
    }
    guestArea = normalizeArea(data);
    renderSite();
    if (!keepScroll) scrollToTop();
  } catch (error) {
    renderSystemMessage({
      title: "Não foi possível carregar os dados.",
      text: error?.message || "Tente novamente em alguns instantes.",
      action: `<button class="button button--secondary" type="button" data-action="recarregar-area">Tentar novamente</button>`,
    });
  }
}

function normalizeArea(data) {
  const content = { ...defaultContent(), ...(data.settings || {}) };
  content.music_url = musicUrlFromSettings(content);
  content.story_chapters = normalizeStoryChapters(content.story_chapters);
  return {
    ...data,
    settings: content,
    pix: buildPixAccess(content, data.rsvp, data.pix),
    messages: Array.isArray(data.messages) ? data.messages : [],
    gallery_items: Array.isArray(data.gallery_items) ? data.gallery_items : [],
    event: data.event || WEDDING,
  };
}

function renderSite() {
  const guest = guestArea.guest;
  const content = guestArea.settings;
  const rsvp = guestArea.rsvp;
  const pix = guestArea.pix;
  const musicUrl = musicUrlFromSettings(content);
  content.music_url = musicUrl;

  musicState.visible = Boolean(musicUrl);

  setApp(`
    <div class="site-frame" id="conteudo">
      <header class="site-nav" aria-label="Navegação do convite">
        <a href="#inicio" class="site-nav__brand" aria-label="Início">
          <span>${WEDDING.monogram}</span>
          <strong>${WEDDING.groom} & ${WEDDING.bride}</strong>
        </a>
        <nav>
          <a href="#rsvp">RSVP</a>
          <a href="#area">Minha área</a>
          <a href="#mensagens">Mensagens</a>
          <a href="#faq">FAQ</a>
        </nav>
      </header>

      ${renderHero(guest)}
      ${renderCountdownSection()}
      ${renderStory(content.story_chapters)}
      ${renderEvents(content)}
      ${renderRsvp(rsvp, guest)}
      ${renderGuestArea(guest, rsvp, pix)}
      ${renderMessages(guestArea.messages)}
      ${renderGallery(content, guestArea.gallery_items)}
      ${renderFaq(content.faqs)}
      ${renderFooter()}
    </div>
    ${musicUrl ? renderMusicControl() : ""}
  `);

  updateCountdown();
  window.clearInterval(countdownTimer);
  countdownTimer = window.setInterval(updateCountdown, 1000);
  syncRsvpFields();
  updateMusicControl();
}

function renderHero(guest) {
  return `
    <section class="hero-section" id="inicio">
      <img class="hero-section__frame" src="${FLORAL_FRAME}" alt="" aria-hidden="true" />
      <div class="hero-section__text">
        <p class="monogram">${WEDDING.monogram}</p>
        <p class="eyebrow">Com a bênção de seus pais</p>
        <p class="parents">${WEDDING.parents.groom}<br />${WEDDING.parents.bride}</p>
        <h1>${WEDDING.couple}</h1>
        <p class="hero-date">${WEDDING.dateLabel} · ${WEDDING.timeLabel}</p>
        <p class="hero-copy">
          Uma celebração de fé, família e do amor que agora ganha casa, caminho e altar.
        </p>
        <div class="guest-ribbon">
          <span>Convite para</span>
          <strong>${escapeHtml(guest.display_name)}</strong>
        </div>
      </div>
    </section>
  `;
}

function renderCountdownSection() {
  return `
    <section class="section countdown-section" aria-labelledby="countdownTitle">
      <div class="section-heading">
        <p class="eyebrow">Contagem regressiva</p>
        <h2 id="countdownTitle">Até o dia do sim</h2>
      </div>
      <div class="countdown-grid" data-countdown aria-live="polite">
        ${["dias", "horas", "minutos", "segundos"]
          .map(
            (label) => `
              <article>
                <strong data-countdown-${label}>0</strong>
                <span>${label}</span>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function updateCountdown() {
  const root = document.querySelector("[data-countdown]");
  if (!root) return;

  const remaining = calculateCountdown(WEDDING.eventStartsAt);
  if (remaining.started) {
    root.innerHTML = `<div class="celebration-message">Hoje celebramos Luiz Carlos e Daiana.</div>`;
    return;
  }

  for (const key of ["days", "hours", "minutes", "seconds"]) {
    const label = { days: "dias", hours: "horas", minutes: "minutos", seconds: "segundos" }[key];
    const node = root.querySelector(`[data-countdown-${label}]`);
    if (node) node.textContent = String(remaining[key]).padStart(key === "days" ? 1 : 2, "0");
  }
}

function imageBlock(url, alt) {
  const safe = safeUrl(url);
  if (!safe) {
    return `<div class="story-media story-media--fallback" aria-hidden="true">${WEDDING.monogram}</div>`;
  }

  return `
    <figure class="story-media">
      <img
        class="story-photo"
        src="${escapeHtml(safe)}"
        alt="${escapeHtml(alt)}"
        loading="lazy"
        data-image-fallback
      />
    </figure>
  `;
}

function renderStoryText(text = "") {
  const paragraphs = String(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (paragraphs.length ? paragraphs : [""])
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("");
}

function renderStory(chapters = []) {
  const items = (chapters.length ? chapters : defaultContent().story_chapters)
    .map(
      (chapter, index) => `
        <article class="story-card">
          ${imageBlock(chapter.image_url, `Foto do capítulo ${chapter.title}`)}
          <div class="story-card__text">
            <h3>${escapeHtml(chapter.title)}</h3>
            ${renderStoryText(chapter.text)}
          </div>
        </article>
      `
    )
    .join("");

  return `
    <section class="section story-section" id="historia">
      <div class="section-heading">
        <h2>História da nossa família</h2>
      </div>
      <div class="story-grid">${items}</div>
    </section>
  `;
}

function renderEvents(content) {
  const eventCards = [WEDDING.ceremony, WEDDING.reception]
    .map(
      (place) => `
        <article class="event-card">
          <p class="eyebrow">${escapeHtml(place.label)}</p>
          <h3>${escapeHtml(place.title)}</h3>
          <dl>
            <div><dt>Horário</dt><dd>${escapeHtml(place.time)}</dd></div>
            <div><dt>Endereço</dt><dd>${escapeHtml(place.address)}</dd></div>
          </dl>
          <div class="button-row">
            <a class="button button--secondary" href="${escapeHtml(place.mapsUrl)}" target="_blank" rel="noopener noreferrer">Google Maps</a>
            <a class="button button--secondary" href="${escapeHtml(place.wazeUrl)}" target="_blank" rel="noopener noreferrer">Waze</a>
            <a class="button button--ghost" href="${ICS_FILE}" download>Adicionar ao calendário</a>
          </div>
        </article>
      `
    )
    .join("");

  const notes = [
    ["Traje sugerido", content.attire],
    ["Estacionamento", content.parking],
    ["Chegada", content.arrival],
    ["Acessibilidade", content.accessibility],
    ["Importante", content.important_info],
  ]
    .map(
      ([label, value]) => `
        <article class="note-card">
          <span>${escapeHtml(label)}</span>
          <p>${escapeHtml(value)}</p>
        </article>
      `
    )
    .join("");

  return `
    <section class="section events-section" id="evento">
      <div class="section-heading">
        <p class="eyebrow">Evento</p>
        <h2>Onde estaremos juntos</h2>
      </div>
      <div class="event-grid">${eventCards}</div>
      <div class="note-grid">${notes}</div>
    </section>
  `;
}

function renderRsvp(rsvp, guest) {
  const isDeclined = rsvp?.status === "declined";
  const attending = rsvp?.status === "attending" || !rsvp;
  const adults = rsvp?.adults_count ?? Math.min(Number(guest.max_adults || 1), 1);
  const children = rsvp?.children_count ?? 0;
  const deadlinePassed = Date.now() > new Date(WEDDING.rsvpDeadline).getTime();

  return `
    <section class="section rsvp-section" id="rsvp">
      <div class="section-heading">
        <p class="eyebrow">Confirmação de presença</p>
        <h2>Responda até 25 de outubro de 2026</h2>
        <p>
          Este convite permite até ${Number(guest.max_adults || 0)} adulto(s) e
          ${Number(guest.max_children || 0)} criança(s).
        </p>
      </div>
      ${
        deadlinePassed
          ? `<div class="notice notice--warn">O prazo de alteração da confirmação foi encerrado.</div>`
          : ""
      }
      <form class="rsvp-form" data-form="rsvp">
        <fieldset class="segmented-field">
          <legend>Resposta</legend>
          <label>
            <input type="radio" name="status" value="attending" ${attending ? "checked" : ""} ${deadlinePassed ? "disabled" : ""} />
            <span>Estarei presente</span>
          </label>
          <label>
            <input type="radio" name="status" value="declined" ${isDeclined ? "checked" : ""} ${deadlinePassed ? "disabled" : ""} />
            <span>Não poderei comparecer</span>
          </label>
        </fieldset>

        <div class="rsvp-counts" data-rsvp-attending>
          <label>
            <span>Adultos</span>
            <input name="adults_count" type="number" min="0" max="${Number(guest.max_adults || 0)}" value="${Number(adults)}" inputmode="numeric" ${deadlinePassed ? "disabled" : ""} />
          </label>
          <label>
            <span>Crianças</span>
            <input name="children_count" type="number" min="0" max="${Number(guest.max_children || 0)}" value="${Number(children)}" inputmode="numeric" ${deadlinePassed ? "disabled" : ""} />
          </label>
        </div>

        <div class="companions-box" data-companion-fields></div>

        <label>
          <span>Restrições alimentares</span>
          <textarea name="dietary_restrictions" rows="3" ${deadlinePassed ? "disabled" : ""}>${escapeHtml(rsvp?.dietary_restrictions || "")}</textarea>
        </label>
        <label>
          <span>Telefone ou WhatsApp</span>
          <input name="phone" type="tel" autocomplete="tel" value="${escapeHtml(rsvp?.phone || "")}" ${deadlinePassed ? "disabled" : ""} />
        </label>
        <label>
          <span>Mensagem aos noivos</span>
          <textarea name="message" rows="4" maxlength="900" ${deadlinePassed ? "disabled" : ""}>${escapeHtml(rsvp?.message || "")}</textarea>
        </label>
        <label class="checkbox-line">
          <input name="consent" type="checkbox" ${rsvp?.consent_at ? "checked" : ""} ${deadlinePassed ? "disabled" : ""} />
          <span>Autorizo o armazenamento dos dados desta confirmação para organização do casamento.</span>
        </label>
        <div class="form-feedback" data-form-feedback aria-live="polite"></div>
        <button class="button button--primary" type="submit" ${deadlinePassed ? "disabled" : ""}>
          ${rsvp ? "Atualizar confirmação" : "Enviar confirmação"}
        </button>
      </form>
    </section>
  `;
}

function syncRsvpFields() {
  const form = document.querySelector('[data-form="rsvp"]');
  if (!form || !guestArea) return;
  const attendingBlock = form.querySelector("[data-rsvp-attending]");
  const companionsBox = form.querySelector("[data-companion-fields]");
  const status = new FormData(form).get("status");
  const isAttending = status === "attending";
  const guest = guestArea.guest;
  const rsvp = guestArea.rsvp;

  if (attendingBlock) attendingBlock.hidden = !isAttending;
  if (!companionsBox) return;

  if (!isAttending) {
    companionsBox.innerHTML = "";
    companionsBox.hidden = true;
    return;
  }

  const adults = Math.max(Number(form.elements.adults_count?.value || 0), 0);
  const children = Math.max(Number(form.elements.children_count?.value || 0), 0);
  const total = Math.min(adults + children, Number(guest.max_adults || 0) + Number(guest.max_children || 0));
  const names = Array.isArray(rsvp?.companion_names) ? rsvp.companion_names : [];
  companionsBox.hidden = false;
  companionsBox.innerHTML = `
    <p class="field-note">Informe os nomes das pessoas confirmadas neste convite.</p>
    ${Array.from({ length: total }, (_, index) => {
      const label = index === 0 ? "Pessoa 1" : `Pessoa ${index + 1}`;
      return `
        <label>
          <span>${label}</span>
          <input name="companion_${index}" type="text" maxlength="120" value="${escapeHtml(names[index] || "")}" />
        </label>
      `;
    }).join("")}
  `;
}

function readRsvpPayload(form) {
  const formData = new FormData(form);
  const status = String(formData.get("status") || "");
  const companionNames = Array.from(form.querySelectorAll('[name^="companion_"]'))
    .map((input) => input.value.trim())
    .filter(Boolean);

  return {
    status,
    adults_count: Number(formData.get("adults_count") || 0),
    children_count: Number(formData.get("children_count") || 0),
    companion_names: companionNames,
    dietary_restrictions: String(formData.get("dietary_restrictions") || "").trim(),
    phone: String(formData.get("phone") || "").trim(),
    message: String(formData.get("message") || "").trim(),
    consent: Boolean(formData.get("consent")),
  };
}

function renderGuestArea(guest, rsvp, pix) {
  const rsvpSummary = rsvp
    ? `
      <dl>
        <div><dt>Status</dt><dd>${statusLabel(rsvp.status)}</dd></div>
        <div><dt>Adultos</dt><dd>${Number(rsvp.adults_count || 0)}</dd></div>
        <div><dt>Crianças</dt><dd>${Number(rsvp.children_count || 0)}</dd></div>
        <div><dt>Atualizado</dt><dd>${formatDateTime(rsvp.changed_at || rsvp.submitted_at)}</dd></div>
      </dl>
      ${
        rsvp.companion_names?.length
          ? `<p><strong>Nomes:</strong> ${escapeHtml(rsvp.companion_names.join(", "))}</p>`
          : ""
      }
      ${rsvp.message ? `<p><strong>Mensagem:</strong> ${escapeHtml(rsvp.message)}</p>` : ""}
    `
    : `<p>Você ainda não enviou sua confirmação.</p>`;

  return `
    <section class="section guest-section" id="area">
      <div class="section-heading">
        <p class="eyebrow">Área privada do convidado</p>
        <h2>${escapeHtml(guest.display_name)}</h2>
        <p>Este conteúdo está vinculado ao token individual do convite.</p>
      </div>
      <div class="private-grid">
        <article class="private-panel">
          <h3>Confirmação</h3>
          ${rsvpSummary}
          <a class="button button--secondary" href="#rsvp">Atualizar dados</a>
        </article>
        ${renderPixPanel(rsvp, pix)}
        <article class="private-panel">
          <h3>Atalhos do evento</h3>
          <div class="button-row">
            <a class="button button--secondary" href="${WEDDING.ceremony.mapsUrl}" target="_blank" rel="noopener noreferrer">Cerimônia</a>
            <a class="button button--secondary" href="${WEDDING.reception.mapsUrl}" target="_blank" rel="noopener noreferrer">Recepção</a>
            <a class="button button--ghost" href="${ICS_FILE}" download>Calendário</a>
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderPixPanel(rsvp, pix) {
  const confirmed = rsvp?.status === "attending";
  const declined = rsvp?.status === "declined";
  const configured = pixIsConfigured(pix);
  const label = pix?.copy_paste ? "Código PIX copia e cola" : "Chave PIX";

  if (!confirmed) {
    return `
      <article class="private-panel private-panel--pix is-locked">
        <h3>PIX dos noivos</h3>
        <p>
          ${
            declined
              ? "Como você marcou que não poderá comparecer, o PIX fica oculto neste convite."
              : "Confirme sua presença para liberar o código PIX dos noivos."
          }
        </p>
        <a class="button button--secondary" href="#rsvp">Confirmar presença</a>
      </article>
    `;
  }

  if (!configured) {
    return `
      <article class="private-panel private-panel--pix">
        <h3>PIX dos noivos</h3>
        <p>Código ainda não cadastrado no painel dos noivos.</p>
      </article>
    `;
  }

  return `
    <article class="private-panel private-panel--pix">
      <h3>PIX dos noivos</h3>
      <p>${escapeHtml(pix.message || "Obrigado por fazer parte da nossa história.")}</p>
      <dl>
        <div><dt>Favorecido</dt><dd>${escapeHtml(pix.receiver || "Luiz Carlos e Daiana")}</dd></div>
        ${pix.bank ? `<div><dt>Banco</dt><dd>${escapeHtml(pix.bank)}</dd></div>` : ""}
        <div><dt>${label}</dt><dd>Disponível após confirmação</dd></div>
      </dl>
      <div class="button-row">
        <button class="button button--primary" type="button" data-action="abrir-pix">Abrir código PIX</button>
      </div>
    </article>
  `;
}

function renderMessages(messages = []) {
  const current = messages[0];
  return `
    <section class="section messages-section" id="mensagens">
      <div class="section-heading">
        <p class="eyebrow">Livro de mensagens</p>
        <h2>Deixe uma palavra para os noivos</h2>
        <p>As mensagens passam por moderação antes de qualquer mural público.</p>
      </div>
      ${
        current
          ? `<div class="notice notice--success"><strong>Mensagem enviada.</strong><span>Status: ${statusLabel(current.status)}.</span></div>`
          : ""
      }
      <form class="message-form" data-form="guest-message">
        <label>
          <span>Sua mensagem</span>
          <textarea name="message" rows="5" maxlength="1200" required>${escapeHtml(current?.message || "")}</textarea>
        </label>
        <button class="button button--primary" type="submit">
          ${current ? "Revisar alteração" : "Revisar mensagem"}
        </button>
      </form>
    </section>
  `;
}

function galleryIsVisible(content) {
  if (content.gallery_enabled) return true;
  const visibleAfter = new Date(content.gallery_visible_after || WEDDING.eventStartsAt).getTime();
  return Date.now() >= visibleAfter;
}

function renderGallery(content, items = []) {
  const visible = galleryIsVisible(content);
  return `
    <section class="section gallery-section" id="galeria">
      <div class="section-heading">
        <p class="eyebrow">Compartilhe seu olhar</p>
        <h2>Fotos do casamento</h2>
        <p>Envios ficam vinculados ao seu convite e passam por moderação.</p>
      </div>
      ${
        visible
          ? `
            <form class="gallery-form" data-form="gallery">
              <label>
                <span>Foto</span>
                <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required />
                <small>JPG, PNG ou WEBP até 12 MB. Imagens grandes são reduzidas antes do envio.</small>
              </label>
              <label>
                <span>Legenda</span>
                <input name="caption" maxlength="180" />
              </label>
              <label>
                <span>Quem aparece na foto?</span>
                <input name="people" maxlength="180" />
              </label>
              <div class="form-feedback" data-gallery-feedback aria-live="polite"></div>
              <button class="button button--primary" type="submit">Enviar foto</button>
            </form>
          `
          : `<div class="empty-state">Este módulo ficará disponível após o casamento ou quando os administradores ativarem a galeria.</div>`
      }
      <div class="gallery-list">
        ${
          items.length
            ? items
                .map(
                  (item) => `
                    <article class="gallery-item">
                      <strong>${escapeHtml(item.caption || "Foto enviada")}</strong>
                      <span>${statusLabel(item.status)}</span>
                      <small>${escapeHtml(item.people || "")}</small>
                    </article>
                  `
                )
                .join("")
            : `<p class="muted">Nenhuma foto enviada por este convite ainda.</p>`
        }
      </div>
    </section>
  `;
}

function renderFaq(faqs = []) {
  return `
    <section class="section faq-section" id="faq">
      <div class="section-heading">
        <p class="eyebrow">FAQ</p>
        <h2>Dúvidas frequentes</h2>
      </div>
      <div class="faq-list">
        ${(faqs.length ? faqs : defaultContent().faqs)
          .map(
            (item) => `
              <details>
                <summary>${escapeHtml(item.question)}</summary>
                <p>${escapeHtml(item.answer)}</p>
              </details>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderFooter() {
  return `
    <footer class="site-footer">
      <p>${escapeHtml(WEDDING.verse)}</p>
      <span>${WEDDING.verseRef}</span>
      <strong>${WEDDING.couple}</strong>
    </footer>
  `;
}

function renderMusicControl() {
  return `
    <aside class="music-control" data-music-control aria-label="Controle da música">
      <div class="music-control__main">
        <button class="music-control__play" type="button" data-action="alternar-musica" aria-label="Pausar ou tocar música">
          <span data-music-button-label>Tocar</span>
        </button>
        <button class="music-control__hide" type="button" data-action="ocultar-musica" aria-label="Ocultar controle de música">X</button>
      </div>
      <label class="music-control__volume">
        <span>Volume</span>
        <input type="range" min="0" max="1" step="0.05" value="${musicState.volume}" data-action="volume-musica" />
      </label>
      <span class="music-control__status" data-music-status></span>
    </aside>
    <button class="music-chip" type="button" data-music-chip data-action="mostrar-musica" aria-label="Mostrar controle de música" hidden>Som</button>
  `;
}

async function startMusic() {
  const url = musicUrlFromSettings(guestArea?.settings || {});
  if (!url) return;

  if (!audio || audio.src !== url) {
    if (audio) audio.pause();
    audio = new Audio(url);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 0;
  }

  try {
    await audio.play();
    musicState.playing = true;
    musicState.failed = false;
    fadeAudioTo(musicState.volume);
  } catch {
    musicState.playing = false;
    musicState.failed = true;
  }

  updateMusicControl();
}

function fadeAudioTo(target) {
  if (!audio || prefersReducedMotion()) {
    if (audio) audio.volume = target;
    return;
  }

  const start = audio.volume;
  const startedAt = performance.now();
  const duration = 1600;

  function frame(now) {
    const progress = Math.min((now - startedAt) / duration, 1);
    audio.volume = start + (target - start) * progress;
    if (progress < 1) requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function updateMusicControl() {
  const control = document.querySelector("[data-music-control]");
  const chip = document.querySelector("[data-music-chip]");
  if (!control || !guestArea?.settings?.music_url) return;
  control.hidden = musicState.hidden;
  if (chip) chip.hidden = !musicState.hidden;
  const button = control.querySelector("[data-music-button-label]");
  const status = control.querySelector("[data-music-status]");
  if (button) button.textContent = musicState.playing ? "Pausar" : "Tocar";
  if (status) {
    status.textContent = musicState.failed
      ? "Toque em Tocar para iniciar"
      : musicState.playing
        ? "Música tocando"
        : "Música pausada";
  }
}

async function toggleMusic() {
  if (!audio) {
    await startMusic();
    return;
  }
  if (audio.paused) {
    await startMusic();
    return;
  }
  audio.pause();
  musicState.playing = false;
  updateMusicControl();
}

function setMusicControlHidden(hidden) {
  musicState.hidden = hidden;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("ld-music-hidden", String(hidden));
  }
  updateMusicControl();
}

function setBusy(button, value) {
  if (!button) return;
  button.disabled = value;
  if (value) {
    button.dataset.originalText = button.textContent;
    button.textContent = "Aguarde...";
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
  }
}

async function handleRsvp(form, button) {
  const feedback = form.querySelector("[data-form-feedback]");
  const payload = readRsvpPayload(form);
  const error = validateRsvpPayload(payload, guestArea.guest);
  if (error) {
    feedback.textContent = error;
    feedback.className = "form-feedback is-error";
    return;
  }

  setBusy(button, true);
  try {
    const result = await rpc("upsert_rsvp", {
      p_token: invitationToken,
      p_payload: payload,
    });
    if (!result?.ok) throw new Error(result?.message || "Não foi possível salvar.");
    await loadGuestArea({ keepScroll: true });
    showToast(
      payload.status === "declined"
        ? "Resposta registrada com carinho. Sentiremos sua falta."
        : guestArea.settings.confirmation_message
    );
    document.querySelector("#area")?.scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    feedback.textContent = error?.message || "Não foi possível salvar sua resposta.";
    feedback.className = "form-feedback is-error";
  } finally {
    setBusy(button, false);
  }
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function pixCode() {
  return String(guestArea?.pix?.copy_paste || guestArea?.pix?.key || "").trim();
}

async function copyPublicText(text) {
  if (!text) throw new Error("Código PIX ainda não configurado.");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function openPixDialog() {
  if (guestArea?.rsvp?.status !== "attending") {
    showToast("Confirme presença para liberar o PIX dos noivos.");
    return;
  }

  const pix = guestArea.pix || {};
  const code = pixCode();
  if (!code) {
    showToast("O PIX ainda não foi cadastrado pelos noivos.");
    return;
  }

  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="modal-panel modal-panel--pix" role="dialog" aria-modal="true" aria-labelledby="pixDialogTitle">
      <button class="modal-close" type="button" data-modal-close aria-label="Fechar">×</button>
      <p class="eyebrow">PIX liberado</p>
      <h2 id="pixDialogTitle">Código PIX dos noivos</h2>
      <p>${escapeHtml(pix.message || "Obrigado por celebrar com Luiz Carlos e Daiana.")}</p>
      <dl>
        <div><dt>Favorecido</dt><dd>${escapeHtml(pix.receiver || "Luiz Carlos e Daiana")}</dd></div>
        ${pix.bank ? `<div><dt>Banco</dt><dd>${escapeHtml(pix.bank)}</dd></div>` : ""}
      </dl>
      <div class="pix-code" tabindex="0">${escapeHtml(code)}</div>
      <div class="button-row">
        <button class="button button--primary" type="button" data-action="copiar-pix">Copiar código PIX</button>
        <button class="button button--ghost" type="button" data-modal-close>Cancelar</button>
      </div>
    </section>
  `;
  document.body.appendChild(modal);
  document.body.classList.add("modal-open");
  modal.querySelector("button")?.focus();
}

function closeModal() {
  document.querySelector(".modal-backdrop")?.remove();
  document.body.classList.remove("modal-open");
}

async function copyPix(button) {
  setBusy(button, true);
  try {
    await copyPublicText(pixCode());
    showToast("Código PIX copiado.");
  } catch (error) {
    showToast(error?.message || "Não foi possível copiar o código PIX.");
  } finally {
    setBusy(button, false);
  }
}

function reviewMessage(form) {
  const text = String(new FormData(form).get("message") || "").trim();
  if (text.length < 3) {
    form.querySelector("textarea")?.focus();
    showToast("Escreva uma mensagem um pouco maior antes de revisar.");
    return;
  }

  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="messageReviewTitle">
      <button class="modal-close" type="button" data-modal-close aria-label="Fechar">×</button>
      <p class="eyebrow">Revisar mensagem</p>
      <h2 id="messageReviewTitle">Enviar para Luiz Carlos e Daiana?</h2>
      <blockquote>${escapeHtml(text)}</blockquote>
      <div class="button-row">
        <button class="button button--primary" type="button" data-action="enviar-mensagem" data-message="${escapeHtml(text)}">Enviar mensagem</button>
        <button class="button button--ghost" type="button" data-modal-close>Editar</button>
      </div>
    </section>
  `;
  document.body.appendChild(modal);
  document.body.classList.add("modal-open");
}

async function submitMessage(button) {
  setBusy(button, true);
  try {
    const result = await rpc("submit_guest_message", {
      p_token: invitationToken,
      p_message: button.dataset.message,
    });
    if (!result?.ok) throw new Error(result?.message || "Não foi possível enviar.");
    closeModal();
    await loadGuestArea({ keepScroll: true });
    showToast("Mensagem enviada para moderação.");
  } catch (error) {
    showToast(error?.message || "Não foi possível enviar a mensagem.");
  } finally {
    setBusy(button, false);
  }
}

async function compressImageIfNeeded(file) {
  if (!file || file.size < 3 * 1024 * 1024 || !file.type.startsWith("image/")) return file;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return file;

  const bitmap = await createImageBitmap(file);
  const maxSide = 1800;
  const scale = Math.min(maxSide / bitmap.width, maxSide / bitmap.height, 1);
  if (scale === 1 && file.size <= MAX_GALLERY_FILE_SIZE) return file;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) resolve(file);
        else resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.82
    );
  });
}

async function handleGallery(form, button) {
  const feedback = form.querySelector("[data-gallery-feedback]");
  const formData = new FormData(form);
  const file = formData.get("photo");

  if (!file || !file.size) {
    feedback.textContent = "Escolha uma foto para enviar.";
    feedback.className = "form-feedback is-error";
    return;
  }

  if (!ALLOWED_GALLERY_TYPES.has(file.type)) {
    feedback.textContent = "Envie JPG, PNG ou WEBP.";
    feedback.className = "form-feedback is-error";
    return;
  }

  if (file.size > MAX_GALLERY_FILE_SIZE) {
    feedback.textContent = "A foto precisa ter até 12 MB.";
    feedback.className = "form-feedback is-error";
    return;
  }

  setBusy(button, true);
  feedback.textContent = "Preparando envio...";
  feedback.className = "form-feedback";

  try {
    const uploadFile = await compressImageIfNeeded(file);
    const metadata = {
      caption: String(formData.get("caption") || "").trim(),
      people: String(formData.get("people") || "").trim(),
      content_type: uploadFile.type,
      file_size: uploadFile.size,
    };
    const request = await rpc("request_gallery_upload", {
      p_token: invitationToken,
      p_metadata: metadata,
    });
    if (!request?.ok) throw new Error(request?.message || "Não foi possível autorizar o envio.");

    if (!request.demo) {
      supabase = supabase || (await getSupabaseClient());
      const { error: uploadError } = await supabase.storage
        .from(request.bucket || GALLERY_BUCKET)
        .upload(request.storage_path, uploadFile, {
          cacheControl: "3600",
          contentType: uploadFile.type,
          upsert: false,
        });
      if (uploadError) throw uploadError;
      await rpc("confirm_gallery_upload", {
        p_token: invitationToken,
        p_gallery_id: request.item?.id || request.item_id,
      });
    }

    form.reset();
    await loadGuestArea({ keepScroll: true });
    showToast("Foto enviada para moderação.");
  } catch (error) {
    feedback.textContent = error?.message || "Não foi possível enviar a foto.";
    feedback.className = "form-feedback is-error";
  } finally {
    setBusy(button, false);
  }
}

function bindEvents() {
  app.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('button[type="submit"]');

    if (form.dataset.form === "token") {
      const token = String(new FormData(form).get("token") || "").trim();
      window.location.href = withTokenUrl(token);
      return;
    }

    if (form.dataset.form === "rsvp") await handleRsvp(form, button);
    if (form.dataset.form === "guest-message") reviewMessage(form);
    if (form.dataset.form === "gallery") await handleGallery(form, button);
  });

  app.addEventListener("input", (event) => {
    if (event.target.matches('[data-action="volume-musica"]')) {
      musicState.volume = Number(event.target.value || 0.35);
      localStorage.setItem("ld-music-volume", String(musicState.volume));
      if (audio) audio.volume = musicState.volume;
      updateMusicControl();
      return;
    }

    if (event.target.closest('[data-form="rsvp"]')) syncRsvpFields();
  });

  app.addEventListener("change", (event) => {
    if (event.target.closest('[data-form="rsvp"]')) syncRsvpFields();
  });

  document.addEventListener("click", async (event) => {
    const close = event.target.closest("[data-modal-close]");
    if (close) {
      closeModal();
      return;
    }

    const button = event.target.closest("[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    if (action === "usar-demo") window.location.href = withTokenUrl(DEMO_TOKEN);
    if (action === "voltar-entrada") renderTokenEntry();
    if (action === "abrir-convite") await openInvitation();
    if (action === "recarregar-area") await loadGuestArea();
    if (action === "abrir-pix") openPixDialog();
    if (action === "copiar-pix") await copyPix(button);
    if (action === "enviar-mensagem") await submitMessage(button);
    if (action === "alternar-musica") await toggleMusic();
    if (action === "ocultar-musica") setMusicControlHidden(true);
    if (action === "mostrar-musica") setMusicControlHidden(false);
    if (action === "volume-musica") {
      musicState.volume = Number(button.value || 0.35);
      localStorage.setItem("ld-music-volume", String(musicState.volume));
      if (audio) audio.volume = musicState.volume;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
  });

  document.addEventListener(
    "error",
    (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || !image.matches("[data-image-fallback]")) return;
      const fallback = document.createElement("div");
      fallback.className = image.classList.contains("story-photo")
        ? "story-photo story-photo--fallback"
        : "visual-placeholder";
      fallback.textContent = WEDDING.monogram;
      fallback.setAttribute("aria-hidden", "true");
      image.replaceWith(fallback);
    },
    true
  );
}

async function boot() {
  app = document.querySelector("#app");
  if (!app) return;
  bindEvents();
  invitationToken = readTokenFromUrl();

  if (window.location.hash === "#galeria" && invitationToken) opened = true;

  await resolveInvitation();
}

if (typeof document !== "undefined") {
  boot();
}
