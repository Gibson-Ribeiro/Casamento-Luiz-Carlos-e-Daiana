import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient.js";

const adminApp = document.querySelector("#adminApp");
const INVITATION_ROUTE = new URL("./convite/", import.meta.url).href;
const GALLERY_BUCKET = "wedding-gallery";
const STORY_PHOTOS = [
  "assets/historia/familia-01.jpg",
  "assets/historia/familia-02.jpg",
  "assets/historia/familia-03.jpg",
  "assets/historia/familia-04.jpg",
  "assets/historia/familia-05.jpg",
];

let supabase = null;
let dashboard = null;
let activeTab = "dashboard";
let activeEdit = null;
let demoMode = false;
let filters = {
  guest: "",
  rsvp: "todos",
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
    attending: "Presente",
    declined: "Ausente",
    pending_moderation: "Em moderação",
    upload_requested: "Aguardando upload",
    approved: "Aprovado",
    rejected: "Rejeitado",
  };
  return labels[value] || value || "-";
}

function setAdmin(html) {
  adminApp.innerHTML = html;
}

function showLoading(text = "Carregando painel...") {
  setAdmin(`
    <section class="loading-view">
      <span class="loader" aria-hidden="true"></span>
      <p>${escapeHtml(text)}</p>
    </section>
  `);
}

function showNotice(title, text) {
  const notice = document.querySelector("[data-admin-notice]");
  if (!notice) return;
  notice.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span>`;
  notice.hidden = false;
  notice.scrollIntoView({ behavior: "smooth", block: "center" });
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
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

function defaultSettings() {
  return {
    music_url: "",
    gallery_enabled: false,
    gallery_visible_after: "2026-11-28T20:00:00-03:00",
    pix_key: "",
    pix_copy_paste: "",
    pix_receiver: "Luiz Carlos e Daiana",
    pix_bank: "",
    pix_message: "Obrigado por celebrar conosco. O PIX aparece apenas para convidados com presença confirmada.",
    attire: "Conteúdo provisório: definir traje sugerido no painel administrativo.",
    parking: "Conteúdo provisório: incluir orientações de estacionamento.",
    arrival: "Conteúdo provisório: incluir orientações de chegada.",
    accessibility: "Conteúdo provisório: informar acessibilidade.",
    important_info: "Conteúdo provisório: adicionar informações importantes.",
    confirmation_message: "Sua resposta foi recebida com carinho.",
    story_chapters: defaultStoryChapters(),
    faqs: [
      {
        question: "Posso levar acompanhante?",
        answer: "Conteúdo provisório. Use o limite definido no convite.",
      },
    ],
  };
}

function demoSettings() {
  return {
    ...defaultSettings(),
    pix_key: "pix-demo-luiz-daiana@example.com",
    pix_receiver: "Luiz Carlos e Daiana",
    pix_bank: "Banco demo",
    pix_copy_paste: "PIX-DEMONSTRACAO-LUIZ-CARLOS-DAIANA",
  };
}

function normalizeDemoState(state) {
  const content = { ...demoSettings(), ...(state?.content || {}) };
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
    const state = normalizeDemoState(safeJson(stored, null) || createDemoState());
    localStorage.setItem("ld-demo-state", JSON.stringify(state));
    return state;
  }
  const state = createDemoState();
  localStorage.setItem("ld-demo-state", JSON.stringify(state));
  return state;
}

function createDemoState() {
  return {
    guests: [
      {
        id: "guest-demo-lucas-fernanda",
        token: "lucas-fernanda-demo",
        token_hint: "demo",
        display_name: "Lucas e Fernanda",
        max_adults: 2,
        max_children: 1,
        active: true,
        invitation_opened_at: null,
        invitation_open_count: 0,
        created_at: new Date().toISOString(),
      },
    ],
    rsvps: [],
    messages: [],
    gallery: [],
    content: demoSettings(),
  };
}

function saveDemoState(state) {
  localStorage.setItem("ld-demo-state", JSON.stringify(state));
}

function buildDashboardFromDemo() {
  const state = demoState();
  const guests = state.guests.map((guest) => {
    const rsvp = state.rsvps.find((item) => item.guest_id === guest.id) || null;
    return {
      ...guest,
      rsvp,
    };
  });

  const totals = {
    invitations_created: guests.length,
    invitations_opened: guests.filter((guest) => guest.invitation_opened_at).length,
    rsvps_received: state.rsvps.length,
    attending: state.rsvps.filter((item) => item.status === "attending").length,
    declined: state.rsvps.filter((item) => item.status === "declined").length,
    pending: guests.length - state.rsvps.length,
    adults: state.rsvps.reduce((sum, item) => sum + Number(item.adults_count || 0), 0),
    children: state.rsvps.reduce((sum, item) => sum + Number(item.children_count || 0), 0),
    pix_unlocked: state.rsvps.filter((item) => item.status === "attending").length,
    messages: state.messages.length,
    gallery_items: state.gallery.length,
    dietary_notes: state.rsvps.filter((item) => item.dietary_restrictions).length,
  };

  return {
    ok: true,
    totals,
    guests,
    rsvps: state.rsvps,
    messages: state.messages.map((message) => ({
      ...message,
      guest: state.guests.find((guest) => guest.id === message.guest_id),
    })),
    gallery_items: state.gallery.map((item) => ({
      ...item,
      guest: state.guests.find((guest) => guest.id === item.guest_id),
    })),
    settings: state.content || defaultSettings(),
  };
}

async function demoRpc(name, args = {}) {
  const state = demoState();

  if (name === "admin_get_dashboard") return buildDashboardFromDemo();

  if (name === "admin_save_guest") {
    const id = args.p_guest_id || crypto.randomUUID();
    let guest = state.guests.find((item) => item.id === id);
    const plainToken = guest ? null : `convite-${crypto.randomUUID()}`;
    if (!guest) {
      guest = {
        id,
        token: plainToken,
        token_hint: plainToken.slice(-8),
        created_at: new Date().toISOString(),
        invitation_opened_at: null,
        invitation_open_count: 0,
      };
      state.guests.push(guest);
    }
    Object.assign(guest, {
      display_name: args.p_display_name,
      max_adults: Number(args.p_max_adults || 1),
      max_children: Number(args.p_max_children || 0),
      active: Boolean(args.p_active),
    });
    saveDemoState(state);
    return { ok: true, guest, plain_token: plainToken };
  }

  if (name === "admin_regenerate_guest_token") {
    const guest = state.guests.find((item) => item.id === args.p_guest_id);
    if (!guest) return { ok: false, message: "Convidado não encontrado." };
    const plainToken = `convite-${crypto.randomUUID()}`;
    guest.token = plainToken;
    guest.token_hint = plainToken.slice(-8);
    saveDemoState(state);
    return { ok: true, guest, plain_token: plainToken };
  }

  if (name === "admin_deactivate_guest") {
    const guest = state.guests.find((item) => item.id === args.p_guest_id);
    if (!guest) return { ok: false, message: "Convidado não encontrado." };
    guest.active = Boolean(args.p_active);
    saveDemoState(state);
    return { ok: true };
  }

  if (name === "admin_save_site_settings") {
    state.content = { ...defaultSettings(), ...(args.p_settings || {}) };
    state.content.story_chapters = normalizeStoryChapters(state.content.story_chapters);
    saveDemoState(state);
    return { ok: true, settings: state.content };
  }

  if (name === "admin_moderate_message") {
    const message = state.messages.find((item) => item.id === args.p_message_id);
    if (!message) return { ok: false, message: "Mensagem não encontrada." };
    message.status = args.p_status;
    saveDemoState(state);
    return { ok: true };
  }

  if (name === "admin_moderate_gallery_item") {
    const item = state.gallery.find((photo) => photo.id === args.p_gallery_id);
    if (!item) return { ok: false, message: "Foto não encontrada." };
    item.status = args.p_status;
    saveDemoState(state);
    return { ok: true };
  }

  return { ok: false, message: `RPC demo não implementada: ${name}` };
}

async function rpc(name, args = {}) {
  if (demoMode || !isSupabaseConfigured()) return demoRpc(name, args);
  supabase = supabase || (await getSupabaseClient());
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

function renderConfigurationPending() {
  setAdmin(`
    <article class="system-card">
      <p class="eyebrow">Painel administrativo</p>
      <h1>Supabase ainda não configurado.</h1>
      <p>
        Preencha a URL e a chave pública em <code>supabaseClient.js</code>.
        Enquanto isso, você pode abrir um painel local de demonstração sem dados reais.
      </p>
      <div class="button-row">
        <button class="button button--primary" type="button" data-admin-action="demo-admin">
          Abrir demonstração local
        </button>
        <a class="button button--secondary" href="${INVITATION_ROUTE}?token=lucas-fernanda-demo">Ver convite demo</a>
      </div>
    </article>
  `);
}

function renderLogin(error = "") {
  setAdmin(`
    <article class="system-card admin-login">
      <p class="eyebrow">Área dos noivos</p>
      <h1>Painel administrativo</h1>
      <p>Entre com um usuário autorizado no Supabase Auth.</p>
      ${error ? `<div class="notice notice--warn">${escapeHtml(error)}</div>` : ""}
      <form class="stack-form" data-admin-form="login">
        <label>
          <span>E-mail</span>
          <input name="email" type="email" autocomplete="email" required />
        </label>
        <label>
          <span>Senha</span>
          <input name="password" type="password" autocomplete="current-password" required />
        </label>
        <button class="button button--primary" type="submit">Entrar</button>
      </form>
    </article>
  `);
}

async function loadDashboard() {
  showLoading("Atualizando painel...");
  try {
    const data = await rpc("admin_get_dashboard");
    if (!data?.ok) throw new Error(data?.message || "Acesso não autorizado.");
    dashboard = data;
    renderDashboard();
  } catch (error) {
    renderLogin(error?.message || "Não foi possível carregar o painel.");
  }
}

function renderDashboard() {
  if (!dashboard) return;

  const tabs = [
    ["dashboard", "Dashboard"],
    ["guests", "Convidados"],
    ["rsvps", "Confirmações"],
    ["content", "Conteúdo"],
    ["moderation", "Mensagens e fotos"],
  ];

  setAdmin(`
    <section class="admin-dashboard" id="adminConteudo">
      <header class="admin-header">
        <div>
          <p class="eyebrow">Luiz Carlos & Daiana</p>
          <h1>Painel do casamento</h1>
          ${demoMode ? `<span class="demo-badge">Demonstração local</span>` : ""}
        </div>
        <div class="button-row">
          <button class="button button--secondary" type="button" data-admin-action="refresh">Atualizar</button>
          ${
            demoMode
              ? ""
              : `<button class="button button--ghost" type="button" data-admin-action="logout">Sair</button>`
          }
        </div>
      </header>

      <nav class="admin-tabs" aria-label="Seções do painel">
        ${tabs
          .map(
            ([id, label]) => `
              <button type="button" class="${activeTab === id ? "is-active" : ""}" data-admin-tab="${id}">
                ${label}
              </button>
            `
          )
          .join("")}
      </nav>

      <div class="notice notice--warn admin-feedback" data-admin-notice hidden></div>
      ${renderActiveTab()}
    </section>
  `);
}

function renderActiveTab() {
  if (activeTab === "guests") return renderGuests();
  if (activeTab === "rsvps") return renderRsvps();
  if (activeTab === "content") return renderContent();
  if (activeTab === "moderation") return renderModeration();
  return renderMetrics();
}

function renderMetrics() {
  const totals = dashboard.totals || {};
  const cards = [
    ["Convites criados", totals.invitations_created || 0],
    ["Convites abertos", totals.invitations_opened || 0],
    ["Confirmações recebidas", totals.rsvps_received || 0],
    ["PIX liberado", totals.pix_unlocked || totals.attending || 0],
    ["Adultos", totals.adults || 0],
    ["Crianças", totals.children || 0],
    ["Restrições alimentares", totals.dietary_notes || 0],
    ["Mensagens", totals.messages || 0],
    ["Fotos enviadas", totals.gallery_items || 0],
    ["Pendentes", totals.pending || 0],
  ]
    .map(
      ([label, value]) => `
        <article class="metric-card">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </article>
      `
    )
    .join("");

  return `
    <section class="admin-panel">
      <div class="metrics-grid">${cards}</div>
      <div class="admin-two-col">
        <article class="private-panel">
          <h2>Pendências importantes</h2>
          <ul class="plain-list">
            <li>${Number(totals.pending || 0)} convite(s) sem confirmação.</li>
            <li>${(dashboard.messages || []).filter((item) => item.status === "pending_moderation").length} mensagem(ns) aguardando moderação.</li>
            <li>${(dashboard.gallery_items || []).filter((item) => ["pending_moderation", "upload_requested"].includes(item.status)).length} foto(s) aguardando revisão.</li>
          </ul>
        </article>
        <article class="private-panel">
          <h2>Segurança</h2>
          <p>
            Links usam token privado. O banco armazena hash do token e as tabelas
            ficam atrás de RLS; o convidado acessa apenas RPCs limitadas.
          </p>
        </article>
      </div>
    </section>
  `;
}

function guestLink(guest) {
  const sessionToken = sessionStorage.getItem(`ld-token-${guest.id}`) || guest.plain_token || guest.token || "";
  if (!sessionToken) return "";
  const url = new URL(INVITATION_ROUTE);
  url.searchParams.set("token", sessionToken);
  return url.toString();
}

function renderGuests() {
  const query = filters.guest.toLowerCase();
  const guests = (dashboard.guests || []).filter((guest) =>
    String(guest.display_name || "").toLowerCase().includes(query)
  );
  const editing = activeEdit?.type === "guest"
    ? (dashboard.guests || []).find((guest) => guest.id === activeEdit.id)
    : null;

  return `
    <section class="admin-panel">
      <form class="stack-form admin-form" data-admin-form="guest">
        <h2>${editing ? "Editar convidado" : "Novo convidado"}</h2>
        <input type="hidden" name="id" value="${escapeHtml(editing?.id || "")}" />
        <label>
          <span>Nome de exibição</span>
          <input name="display_name" value="${escapeHtml(editing?.display_name || "")}" placeholder="Lucas e Fernanda" required />
        </label>
        <div class="form-grid">
          <label>
            <span>Adultos</span>
            <input name="max_adults" type="number" min="0" value="${Number(editing?.max_adults ?? 2)}" required />
          </label>
          <label>
            <span>Crianças</span>
            <input name="max_children" type="number" min="0" value="${Number(editing?.max_children ?? 0)}" required />
          </label>
        </div>
        <label class="checkbox-line">
          <input name="active" type="checkbox" ${editing?.active === false ? "" : "checked"} />
          <span>Convite ativo</span>
        </label>
        <div class="button-row">
          <button class="button button--primary" type="submit">${editing ? "Salvar convidado" : "Criar e gerar token"}</button>
          ${editing ? `<button class="button button--ghost" type="button" data-admin-action="cancel-edit">Cancelar</button>` : ""}
        </div>
      </form>

      <form class="table-tools" data-admin-form="guest-filter">
        <label>
          <span>Pesquisar convidados</span>
          <input name="guest" type="search" value="${escapeHtml(filters.guest)}" placeholder="Buscar por nome" />
        </label>
        <button class="button button--secondary" type="button" data-admin-action="export-guests">Exportar CSV</button>
      </form>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Limite</th>
              <th>Status</th>
              <th>Abertura</th>
              <th>Token</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            ${
              guests.length
                ? guests.map(renderGuestRow).join("")
                : `<tr><td colspan="6">Nenhum convidado encontrado.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderGuestRow(guest) {
  const link = guestLink(guest);
  const status = guest.rsvp?.status || "pending";
  return `
    <tr>
      <td>${escapeHtml(guest.display_name)}</td>
      <td>${Number(guest.max_adults || 0)} adulto(s), ${Number(guest.max_children || 0)} criança(s)</td>
      <td><span class="status-pill status-${escapeHtml(status)}">${statusLabel(status)}</span></td>
      <td>${guest.invitation_opened_at ? formatDateTime(guest.invitation_opened_at) : "Ainda não abriu"}</td>
      <td>${guest.token_hint ? `...${escapeHtml(guest.token_hint)}` : "Gerado uma única vez"}</td>
      <td class="table-actions">
        <button type="button" class="table-action" data-admin-action="edit-guest" data-id="${escapeHtml(guest.id)}">Editar</button>
        <button type="button" class="table-action" data-admin-action="regenerate-token" data-id="${escapeHtml(guest.id)}">Gerar token</button>
        <button type="button" class="table-action" data-admin-action="copy-whatsapp" data-id="${escapeHtml(guest.id)}" ${link ? "" : "disabled"}>WhatsApp</button>
        <button type="button" class="table-action" data-admin-action="copy-link" data-id="${escapeHtml(guest.id)}" ${link ? "" : "disabled"}>Copiar link</button>
        <button type="button" class="table-action" data-admin-action="show-qr" data-id="${escapeHtml(guest.id)}" ${link ? "" : "disabled"}>QR</button>
        <button type="button" class="table-action table-action--danger" data-admin-action="toggle-guest" data-id="${escapeHtml(guest.id)}" data-active="${guest.active ? "false" : "true"}">${guest.active ? "Desativar" : "Ativar"}</button>
      </td>
    </tr>
  `;
}

function renderRsvps() {
  const rsvps = (dashboard.guests || []).filter((guest) => {
    const status = guest.rsvp?.status || "pending";
    return filters.rsvp === "todos" || filters.rsvp === status;
  });

  return `
    <section class="admin-panel">
      <form class="table-tools" data-admin-form="rsvp-filter">
        <label>
          <span>Status</span>
          <select name="rsvp">
            ${["todos", "attending", "declined", "pending"]
              .map(
                (status) => `
                  <option value="${status}" ${filters.rsvp === status ? "selected" : ""}>
                    ${status === "todos" ? "Todos" : statusLabel(status)}
                  </option>
                `
              )
              .join("")}
          </select>
        </label>
        <button class="button button--secondary" type="button" data-admin-action="export-rsvps">Exportar CSV</button>
      </form>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Convidado</th>
              <th>Status</th>
              <th>Adultos</th>
              <th>Crianças</th>
              <th>Nomes</th>
              <th>Restrições</th>
              <th>Telefone</th>
              <th>Atualização</th>
            </tr>
          </thead>
          <tbody>
            ${
              rsvps.length
                ? rsvps
                    .map((guest) => {
                      const rsvp = guest.rsvp || {};
                      return `
                        <tr>
                          <td>${escapeHtml(guest.display_name)}</td>
                          <td>${statusLabel(rsvp.status || "pending")}</td>
                          <td>${Number(rsvp.adults_count || 0)}</td>
                          <td>${Number(rsvp.children_count || 0)}</td>
                          <td>${escapeHtml((rsvp.companion_names || []).join(", "))}</td>
                          <td>${escapeHtml(rsvp.dietary_restrictions || "")}</td>
                          <td>${escapeHtml(rsvp.phone || "")}</td>
                          <td>${formatDateTime(rsvp.changed_at || rsvp.submitted_at)}</td>
                        </tr>
                      `;
                    })
                    .join("")
                : `<tr><td colspan="8">Nenhuma confirmação neste filtro.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderContent() {
  const settings = { ...defaultSettings(), ...(dashboard.settings || {}) };
  settings.story_chapters = normalizeStoryChapters(settings.story_chapters);

  return `
    <section class="admin-panel">
      <form class="stack-form admin-form admin-form--wide" data-admin-form="settings">
        <h2>Conteúdo do site</h2>
        <label><span>URL da música autorizada</span><input name="music_url" type="url" value="${escapeHtml(settings.music_url || "")}" placeholder="https://..." /></label>
        <div class="admin-form__group">
          <h3>PIX após confirmação</h3>
          <p class="muted">Esses dados só aparecem para o convidado depois que ele confirma presença.</p>
          <label><span>Favorecido</span><input name="pix_receiver" value="${escapeHtml(settings.pix_receiver || "")}" placeholder="Luiz Carlos e Daiana" /></label>
          <div class="form-grid">
            <label><span>Chave PIX</span><input name="pix_key" value="${escapeHtml(settings.pix_key || "")}" /></label>
            <label><span>Banco</span><input name="pix_bank" value="${escapeHtml(settings.pix_bank || "")}" /></label>
          </div>
          <label><span>PIX copia e cola</span><textarea name="pix_copy_paste" rows="4">${escapeHtml(settings.pix_copy_paste || "")}</textarea></label>
          <label><span>Mensagem no modal do PIX</span><textarea name="pix_message" rows="2">${escapeHtml(settings.pix_message || "")}</textarea></label>
        </div>
        <div class="form-grid">
          <label><span>Galeria ativa</span><select name="gallery_enabled"><option value="false" ${settings.gallery_enabled ? "" : "selected"}>Não</option><option value="true" ${settings.gallery_enabled ? "selected" : ""}>Sim</option></select></label>
          <label><span>Galeria visível após</span><input name="gallery_visible_after" value="${escapeHtml(settings.gallery_visible_after || "")}" /></label>
        </div>
        <label><span>Traje sugerido</span><textarea name="attire" rows="2">${escapeHtml(settings.attire || "")}</textarea></label>
        <label><span>Estacionamento</span><textarea name="parking" rows="2">${escapeHtml(settings.parking || "")}</textarea></label>
        <label><span>Orientações de chegada</span><textarea name="arrival" rows="2">${escapeHtml(settings.arrival || "")}</textarea></label>
        <label><span>Acessibilidade</span><textarea name="accessibility" rows="2">${escapeHtml(settings.accessibility || "")}</textarea></label>
        <label><span>Informações importantes</span><textarea name="important_info" rows="2">${escapeHtml(settings.important_info || "")}</textarea></label>
        <label><span>Mensagem pós-confirmação</span><textarea name="confirmation_message" rows="2">${escapeHtml(settings.confirmation_message || "")}</textarea></label>
        <label>
          <span>História do casal em JSON</span>
          <textarea name="story_chapters" rows="10">${escapeHtml(JSON.stringify(settings.story_chapters || [], null, 2))}</textarea>
        </label>
        <label>
          <span>FAQ em JSON</span>
          <textarea name="faqs" rows="10">${escapeHtml(JSON.stringify(settings.faqs || [], null, 2))}</textarea>
        </label>
        <button class="button button--primary" type="submit">Salvar conteúdo</button>
      </form>
    </section>
  `;
}

function renderModeration() {
  return `
    <section class="admin-panel">
      <h2>Mensagens</h2>
      <div class="moderation-grid">
        ${
          (dashboard.messages || []).length
            ? dashboard.messages.map(renderMessageCard).join("")
            : `<div class="empty-state">Nenhuma mensagem enviada.</div>`
        }
      </div>
      <h2>Fotografias</h2>
      <div class="moderation-grid">
        ${
          (dashboard.gallery_items || []).length
            ? dashboard.gallery_items.map(renderGalleryCard).join("")
            : `<div class="empty-state">Nenhuma foto enviada.</div>`
        }
      </div>
    </section>
  `;
}

function renderMessageCard(message) {
  return `
    <article class="moderation-card">
      <span>${escapeHtml(message.guest?.display_name || "")}</span>
      <p>${escapeHtml(message.message || "")}</p>
      <small>${statusLabel(message.status)} · ${formatDateTime(message.updated_at || message.submitted_at)}</small>
      <div class="button-row">
        <button class="button button--secondary" type="button" data-admin-action="moderate-message" data-status="approved" data-id="${escapeHtml(message.id)}">Aprovar</button>
        <button class="button button--danger" type="button" data-admin-action="moderate-message" data-status="rejected" data-id="${escapeHtml(message.id)}">Rejeitar</button>
      </div>
    </article>
  `;
}

function renderGalleryCard(item) {
  return `
    <article class="moderation-card">
      <span>${escapeHtml(item.guest?.display_name || "")}</span>
      <p>${escapeHtml(item.caption || "Foto enviada")}</p>
      <small>${statusLabel(item.status)} · ${escapeHtml(item.people || "")}</small>
      <code>${escapeHtml(item.storage_path || "")}</code>
      <div class="button-row">
        <button class="button button--secondary" type="button" data-admin-action="moderate-gallery" data-status="approved" data-id="${escapeHtml(item.id)}">Aprovar</button>
        <button class="button button--danger" type="button" data-admin-action="moderate-gallery" data-status="rejected" data-id="${escapeHtml(item.id)}">Rejeitar</button>
      </div>
    </article>
  `;
}

async function handleLogin(form, button) {
  const formData = new FormData(form);
  button.disabled = true;
  try {
    const client = await getSupabaseClient();
    const { error } = await client.auth.signInWithPassword({
      email: String(formData.get("email") || "").trim().toLowerCase(),
      password: String(formData.get("password") || ""),
    });
    if (error) throw error;
    await loadDashboard();
  } catch (error) {
    renderLogin(error?.message || "Não foi possível entrar.");
  } finally {
    button.disabled = false;
  }
}

async function handleGuestForm(form) {
  const formData = new FormData(form);
  const result = await rpc("admin_save_guest", {
    p_guest_id: String(formData.get("id") || "") || null,
    p_display_name: String(formData.get("display_name") || "").trim(),
    p_max_adults: Number(formData.get("max_adults") || 0),
    p_max_children: Number(formData.get("max_children") || 0),
    p_active: Boolean(formData.get("active")),
  });
  if (!result?.ok) throw new Error(result?.message || "Não foi possível salvar convidado.");
  if (result.plain_token && result.guest?.id) {
    sessionStorage.setItem(`ld-token-${result.guest.id}`, result.plain_token);
    await copyText(guestLink({ ...result.guest, token: result.plain_token }));
  }
  activeEdit = null;
  await loadDashboard();
  if (result.plain_token && result.guest?.id) {
    showNotice("Convidado salvo.", "Link copiado. Guarde o CSV/link, pois o token não fica salvo em texto puro.");
  } else {
    showNotice("Convidado salvo.", "A lista foi atualizada.");
  }
}

async function handleSettingsForm(form) {
  const formData = new FormData(form);
  const settings = {
    music_url: String(formData.get("music_url") || "").trim(),
    gallery_enabled: String(formData.get("gallery_enabled")) === "true",
    gallery_visible_after: String(formData.get("gallery_visible_after") || "").trim(),
    pix_key: String(formData.get("pix_key") || "").trim(),
    pix_copy_paste: String(formData.get("pix_copy_paste") || "").trim(),
    pix_receiver: String(formData.get("pix_receiver") || "").trim(),
    pix_bank: String(formData.get("pix_bank") || "").trim(),
    pix_message: String(formData.get("pix_message") || "").trim(),
    attire: String(formData.get("attire") || "").trim(),
    parking: String(formData.get("parking") || "").trim(),
    arrival: String(formData.get("arrival") || "").trim(),
    accessibility: String(formData.get("accessibility") || "").trim(),
    important_info: String(formData.get("important_info") || "").trim(),
    confirmation_message: String(formData.get("confirmation_message") || "").trim(),
    story_chapters: safeJson(String(formData.get("story_chapters") || "[]"), []),
    faqs: safeJson(String(formData.get("faqs") || "[]"), []),
  };
  const result = await rpc("admin_save_site_settings", { p_settings: settings });
  if (!result?.ok) throw new Error(result?.message || "Não foi possível salvar conteúdo.");
  await loadDashboard();
  showNotice("Conteúdo salvo.", "As páginas passam a usar os novos textos.");
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyText(text) {
  if (!text) throw new Error("Não há link disponível. Gere um novo token para este convidado.");
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

function guestById(id) {
  return (dashboard.guests || []).find((guest) => guest.id === id);
}

async function regenerateToken(id) {
  const result = await rpc("admin_regenerate_guest_token", { p_guest_id: id });
  if (!result?.ok) throw new Error(result?.message || "Não foi possível gerar token.");
  sessionStorage.setItem(`ld-token-${id}`, result.plain_token);
  await copyText(guestLink({ ...result.guest, token: result.plain_token }));
  await loadDashboard();
  showNotice("Novo token gerado.", "Link copiado. O token anterior deixa de funcionar.");
}

async function showQr(id) {
  const guest = guestById(id);
  const link = guestLink(guest);
  if (!link) throw new Error("Gere um token antes de criar o QR.");
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="qrTitle">
      <button class="modal-close" type="button" data-modal-close aria-label="Fechar">×</button>
      <p class="eyebrow">QR Code individual</p>
      <h2 id="qrTitle">${escapeHtml(guest.display_name)}</h2>
      <canvas width="280" height="280" data-qr-canvas></canvas>
      <p class="muted">${escapeHtml(link)}</p>
      <button class="button button--secondary" type="button" data-admin-action="download-qr" data-name="${escapeHtml(guest.display_name)}">Baixar QR</button>
    </section>
  `;
  document.body.appendChild(modal);
  document.body.classList.add("modal-open");
  const QRCode = await import("https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm");
  await QRCode.toCanvas(modal.querySelector("[data-qr-canvas]"), link, {
    width: 280,
    margin: 2,
    color: { dark: "#3d1f3c", light: "#fbf7f0" },
  });
}

function closeModal() {
  document.querySelector(".modal-backdrop")?.remove();
  document.body.classList.remove("modal-open");
}

function exportGuests() {
  const rows = [
    ["nome", "adultos", "criancas", "ativo", "aberto_em", "status"],
    ...(dashboard.guests || []).map((guest) => [
      guest.display_name,
      guest.max_adults,
      guest.max_children,
      guest.active,
      guest.invitation_opened_at,
      guest.rsvp?.status || "pending",
    ]),
  ];
  downloadCsv("convidados-luiz-carlos-daiana.csv", rows);
}

function exportRsvps() {
  const rows = [
    ["nome", "status", "adultos", "criancas", "nomes", "restricoes", "telefone", "mensagem", "atualizado_em"],
    ...(dashboard.guests || []).map((guest) => {
      const rsvp = guest.rsvp || {};
      return [
        guest.display_name,
        rsvp.status || "pending",
        rsvp.adults_count || 0,
        rsvp.children_count || 0,
        (rsvp.companion_names || []).join("; "),
        rsvp.dietary_restrictions || "",
        rsvp.phone || "",
        rsvp.message || "",
        rsvp.changed_at || rsvp.submitted_at || "",
      ];
    }),
  ];
  downloadCsv("confirmacoes-luiz-carlos-daiana.csv", rows);
}

adminApp.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;

  try {
    if (form.dataset.adminForm === "login") await handleLogin(form, button);
    if (form.dataset.adminForm === "guest") await handleGuestForm(form);
    if (form.dataset.adminForm === "settings") await handleSettingsForm(form);
  } catch (error) {
    showNotice("Não foi possível concluir.", error?.message || "Revise os dados e tente novamente.");
  } finally {
    if (button) button.disabled = false;
  }
});

adminApp.addEventListener("input", (event) => {
  if (event.target.closest('[data-admin-form="guest-filter"]')) {
    filters.guest = event.target.value;
    renderDashboard();
  }
});

adminApp.addEventListener("change", (event) => {
  if (event.target.closest('[data-admin-form="rsvp-filter"]')) {
    filters.rsvp = event.target.value;
    renderDashboard();
  }
});

document.addEventListener("click", async (event) => {
  if (event.target.closest("[data-modal-close]")) {
    closeModal();
    return;
  }

  const tab = event.target.closest("[data-admin-tab]");
  if (tab) {
    activeTab = tab.dataset.adminTab;
    activeEdit = null;
    renderDashboard();
    return;
  }

  const button = event.target.closest("[data-admin-action]");
  if (!button) return;

  try {
    const action = button.dataset.adminAction;
    if (action === "demo-admin") {
      demoMode = true;
      await loadDashboard();
    }
    if (action === "refresh") await loadDashboard();
    if (action === "logout") {
      const client = await getSupabaseClient();
      await client.auth.signOut();
      renderLogin();
    }
    if (action === "cancel-edit") {
      activeEdit = null;
      renderDashboard();
    }
    if (action === "edit-guest") {
      activeEdit = { type: "guest", id: button.dataset.id };
      renderDashboard();
    }
    if (action === "toggle-guest") {
      const result = await rpc("admin_deactivate_guest", {
        p_guest_id: button.dataset.id,
        p_active: button.dataset.active === "true",
      });
      if (!result?.ok) throw new Error(result?.message || "Não foi possível alterar convidado.");
      await loadDashboard();
    }
    if (action === "regenerate-token") await regenerateToken(button.dataset.id);
    if (action === "copy-link") {
      await copyText(guestLink(guestById(button.dataset.id)));
      showNotice("Link copiado.", "Envie apenas para o convidado correspondente.");
    }
    if (action === "copy-whatsapp") {
      const guest = guestById(button.dataset.id);
      await copyText(
        `Olá, ${guest.display_name}! Luiz Carlos e Daiana prepararam este convite especialmente para vocês: ${guestLink(guest)}`
      );
      showNotice("Texto copiado.", "Cole no WhatsApp do convidado.");
    }
    if (action === "show-qr") await showQr(button.dataset.id);
    if (action === "download-qr") {
      const canvas = document.querySelector("[data-qr-canvas]");
      const link = document.createElement("a");
      link.download = `${button.dataset.name || "convite"}-qr.png`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      link.href = canvas.toDataURL("image/png");
      link.click();
    }
    if (action === "export-guests") exportGuests();
    if (action === "export-rsvps") exportRsvps();
    if (action === "moderate-message") {
      const result = await rpc("admin_moderate_message", {
        p_message_id: button.dataset.id,
        p_status: button.dataset.status,
      });
      if (!result?.ok) throw new Error(result?.message || "Não foi possível moderar mensagem.");
      await loadDashboard();
    }
    if (action === "moderate-gallery") {
      const result = await rpc("admin_moderate_gallery_item", {
        p_gallery_id: button.dataset.id,
        p_status: button.dataset.status,
      });
      if (!result?.ok) throw new Error(result?.message || "Não foi possível moderar foto.");
      await loadDashboard();
    }
  } catch (error) {
    showNotice("Ação não concluída.", error?.message || "Tente novamente.");
  }
});

async function boot() {
  if (!isSupabaseConfigured()) {
    renderConfigurationPending();
    return;
  }

  showLoading();
  try {
    supabase = await getSupabaseClient();
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      renderLogin();
      return;
    }
    await loadDashboard();
  } catch (error) {
    renderLogin(error?.message || "Não foi possível iniciar o painel.");
  }
}

boot();
