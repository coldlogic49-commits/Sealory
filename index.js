
import { Bot, InlineKeyboard } from "grammy";
import fs from "node:fs";
import path from "node:path";
import { GIFTS, rub } from "./prices.js";

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) throw new Error("BOT_TOKEN is required");

const bot = new Bot(TOKEN);
const ADMIN_ID = 8882210622;
const CHANNEL = "SealoryBio";
const GIFT_ACCOUNT = "Sealory";
const DB_FILE = process.env.DATA_FILE ||
  path.resolve("sealory-data.json");

const initialDB = () => ({
  users: {},
  tickets: {},
  bans: {},
  sales: {},
  nextTicket: 1,
  nextSale: 1
});

let db = initialDB();

try {
  db = {
    ...initialDB(),
    ...JSON.parse(fs.readFileSync(DB_FILE, "utf8"))
  };
} catch (error) {
  if (error.code !== "ENOENT") console.error(error);
}

let saving = Promise.resolve();

function save() {
  const data = JSON.stringify(db, null, 2);
  saving = saving.catch(() => {}).then(async () => {
    await fs.promises.writeFile(DB_FILE + ".tmp", data);
    await fs.promises.rename(DB_FILE + ".tmp", DB_FILE);
  });
  return saving;
}

const sessions = new Map();

function session(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      stage: "home",
      page: 0,
      search: "",
      pricing: false
    });
  }
  return sessions.get(id);
}

const isAdmin = id => Number(id) === ADMIN_ID;

function keyboard(...rows) {
  return InlineKeyboard.from(rows);
}

function back(target = "home") {
  return keyboard([
    { text: "⬅️ Назад", callback_data: target }
  ]);
}

function mainMenu() {
  return keyboard(
    [{ text: "Продать NFT", callback_data: "catalog" }],
    [{ text: "Цены на NFT", callback_data: "prices" }],
    [
      { text: "Мой профиль", callback_data: "profile" },
      { text: "История продаж", callback_data: "history" }
    ],
    [{ text: "Информация о боте", callback_data: "info" }],
    [
      {
        text: "Наш канал",
        url: "https://t.me/" + CHANNEL
      },
      {
        text: "Тех Поддержка",
        callback_data: "support"
      }
    ]
  );
}

async function show(ctx, message, kb) {
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery().catch(() => {});

    try {
      return await ctx.editMessageText(message, {
        reply_markup: kb
      });
    } catch (error) {
      if (String(error).includes("message is not modified")) {
        return;
      }
    }
  }

  return ctx.reply(message, { reply_markup: kb });
}

async function home(ctx) {
  session(ctx.from.id).stage = "home";

  return show(
    ctx,
    "SealoryNFT | Сервис скупки\n\n" +
    "Добро пожаловать в SealoryNFT!\n\n" +
    "Наш сервис специализируется на оценке " +
    "и выкупе коллекционных Telegram NFT-подарков.\n\n" +
    "Вы можете ознакомиться с ценами, " +
    "оформить заявку на продажу и отслеживать " +
    "историю своих сделок.\n\n" +
    "Выберите необходимый раздел в меню ниже.",
    mainMenu()
  );
}

function register(ctx) {
  if (!ctx.from) return;

  const id = String(ctx.from.id);
  const old = db.users[id];

  db.users[id] = {
    username: ctx.from.username || "",
    firstName: ctx.from.first_name || "",
    joined: old?.joined || Date.now()
  };

  save().catch(console.error);
}

bot.use(async (ctx, next) => {
  if (!ctx.from) return next();

  if (
    db.bans[String(ctx.from.id)] &&
    !isAdmin(ctx.from.id)
  ) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({
        text: "Доступ к боту ограничен.",
        show_alert: true
      }).catch(() => {});
    } else if (ctx.message) {
      await ctx.reply("Доступ к боту ограничен.");
    }
    return;
  }

  register(ctx);
  await next();
});

// КАТАЛОГ NFT

async function catalog(
  ctx,
  pricing = session(ctx.from.id).pricing
) {
  const s = session(ctx.from.id);
  s.stage = "catalog";
  s.pricing = pricing;

  const items = GIFTS.map((gift, id) => ({
    ...gift,
    id
  })).filter(gift =>
    gift.name.toLowerCase().includes(
      s.search.toLowerCase()
    )
  );

  const pages = Math.max(1, Math.ceil(items.length / 10));
  s.page = Math.max(0, Math.min(s.page, pages - 1));

  const current = items.slice(
    s.page * 10,
    s.page * 10 + 10
  );

  const kb = new InlineKeyboard()
    .text("🔎 Поиск NFT", "search")
    .row();

  current.forEach((gift, index) => {
    kb.text(gift.name, "gift:" + gift.id);
    if (index % 2 === 1) kb.row();
  });

  if (current.length % 2) kb.row();

  if (s.page > 0) kb.text("⬅️", "page:prev");
  if (s.page < pages - 1) kb.text("➡️", "page:next");

  kb.row().text("🏠 Главное меню", "home");

  return show(
    ctx,
    "SealoryNFT | " +
    (pricing ? "Цены NFT" : "Продать NFT") +
    "\n\nВыберите коллекцию.\n" +
    `Страница ${s.page + 1} из ${pages}` +
    (s.search ? "\nПоиск: " + s.search : "") +
    (items.length ? "" : "\nНичего не найдено."),
    kb
  );
}

async function giftPage(ctx, id) {
  const gift = GIFTS[id];
  if (!gift) return home(ctx);

  const s = session(ctx.from.id);
  s.gift = id;
  s.stage = "gift";

  return show(
    ctx,
    "SealoryNFT | Скупка NFT\n\n" +
    "Коллекция: " + gift.name +
    "\nЦена выкупа: " + rub(gift.price),
    keyboard(
      [{ text: "Продать NFT", callback_data: "payment" }],
      [{
        text: "⬅️ Назад к коллекциям",
        callback_data: "catalogback"
      }]
    )
  );
}

// ВЫПЛАТЫ

async function payment(ctx) {
  const s = session(ctx.from.id);
  if (s.gift === undefined) return catalog(ctx);

  s.stage = "payment";

  return show(
    ctx,
    "SealoryNFT | Способ выплаты\n\n" +
    "Выберите, куда хотите получить оплату.\n\n" +
    "100 ⭐ = 150 ₽.\n" +
    "Telegram Stars поступают без комиссии.\n\n" +
    "Срок выплаты: от 30 секунд до 24 часов.\n\n" +
    "Если выплата не поступила за 24 часа, " +
    "обратитесь в поддержку.",
    keyboard(
      [
        { text: "СБП (₽)", callback_data: "method:sbp" },
        {
          text: "Telegram Stars ⭐",
          callback_data: "method:stars"
        }
      ],
      [{
        text: "⬅️ Назад",
        callback_data: "gift:" + s.gift
      }]
    )
  );
}

async function details(ctx, method) {
  const s = session(ctx.from.id);
  if (s.gift === undefined) return catalog(ctx);

  s.method = method;
  s.stage = "details";

  const amount = Math.floor(
    GIFTS[s.gift].price * 100 / 150
  );

  const message = method === "sbp"
    ? "SealoryNFT | СБП\n\n" +
      "Введите номер банковской карты.\n" +
      "Строго 16 цифр.\n\n" +
      "Если администратор не сможет найти " +
      "ваши реквизиты, он свяжется с вами."
    : "SealoryNFT | Telegram Stars\n\n" +
      "Вы получите: " +
      amount.toLocaleString("ru-RU") +
      " ⭐ без комиссии.\n\n" +
      "Введите Telegram-юзернейм с @.\n\n" +
      "Если администратор не сможет найти " +
      "аккаунт, он свяжется с вами.";

  return show(ctx, message, back("payment"));
}

// ЗАЯВКИ

async function createSale(ctx, value) {
  const s = session(ctx.from.id);
  const gift = GIFTS[s.gift];

  if (!gift) return home(ctx);

  const id = db.nextSale++;

  db.sales[String(id)] = {
    id,
    userId: ctx.from.id,
    gift: gift.name,
    price: gift.price,
    method: s.method,
    details: value,
    status: "Ожидает проверки",
    created: Date.now()
  };

  s.saleId = id;
  await save();

  await bot.api.sendMessage(
    ADMIN_ID,
    `Новая заявка #${id}\n\n` +
    `Пользователь: ${ctx.from.id}\n` +
    `NFT: ${gift.name}\n` +
    `Цена: ${rub(gift.price)}\n` +
    `Способ выплаты: ${s.method}\n` +
    `Реквизиты: ${value}\n\n` +
    "Статус: ожидает проверки"
  ).catch(console.error);

  return transfer(ctx);
}

// ПЕРЕДАЧА NFT

function transferKeyboard() {
  return keyboard(
    [{
      text: "🎁 Передать подарок",
      url: "https://t.me/" + GIFT_ACCOUNT
    }],
    [
      {
        text: "📖 Инструкция",
        callback_data: "instruction"
      },
      {
        text: "🧾 Полный чек",
        callback_data: "receipt"
      }
    ],
    [{
      text: "⬅️ Назад",
      callback_data: "payment"
    }]
  );
}

async function transfer(ctx) {
  const s = session(ctx.from.id);
  if (!s.saleId || !db.sales[String(s.saleId)]) {
    return home(ctx);
  }

  s.stage = "transfer";

  return show(
    ctx,
    "SealoryNFT | Передача NFT-подарка\n\n" +
    "Для завершения оформления сделки необходимо " +
    "отправить выбранный NFT-подарок на официальный " +
    "аккаунт сервиса — @Sealory.\n\n" +
    "После передачи подарка вы можете ознакомиться " +
    "с инструкцией или получить полный чек " +
    "по вашей заявке.\n\n" +
    "Срок выплаты: от 30 секунд до 24 часов " +
    "после подтверждения получения NFT-подарка.\n\n" +
    "В случае возникновения вопросов вы можете " +
    "обратиться в техническую поддержку.",
    transferKeyboard()
  );
}

async function instruction(ctx) {
  return show(
    ctx,
    "SealoryNFT | Инструкция\n\n" +
    "1. Нажмите «Передать подарок».\n\n" +
    "2. Откройте официальный аккаунт @Sealory.\n\n" +
    "3. Выберите NFT-подарок, указанный в заявке.\n\n" +
    "4. Отправьте подарок аккаунту @Sealory.\n\n" +
    "5. Дождитесь подтверждения получения подарка.\n\n" +
    "После подтверждения заявка будет обработана " +
    "для выплаты по выбранным реквизитам.",
    keyboard(
      [{
        text: "🎁 Передать подарок",
        url: "https://t.me/" + GIFT_ACCOUNT
      }],
      [{
        text: "⬅️ Назад",
        callback_data: "transfer"
      }]
    )
  );
}

async function receipt(ctx) {
  const s = session(ctx.from.id);
  const sale = db.sales[String(s.saleId)];

  if (!sale || sale.userId !== ctx.from.id) {
    return show(
      ctx,
      "Заявка не найдена.",
      back("home")
    );
  }

  const method = sale.method === "sbp"
    ? "Банковская карта (₽)"
    : "Telegram Stars ⭐";

  const stars = Math.floor(sale.price * 100 / 150);

  return show(
    ctx,
    "SealoryNFT | Полный чек\n\n" +
    `Номер заявки: #${sale.id}\n` +
    `Дата: ${new Date(sale.created).toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow"
    })} (МСК)\n\n` +
    `NFT-подарок: ${sale.gift}\n` +
    `Цена выкупа: ${rub(sale.price)}\n` +
    `Способ выплаты: ${method}\n` +
    (
      sale.method === "stars"
        ? `Количество звёзд: ${stars} ⭐\n`
        : ""
    ) +
    `Реквизиты: ${sale.details}\n\n` +
    `Telegram ID: ${sale.userId}\n` +
    `Получатель NFT: @${GIFT_ACCOUNT}\n` +
    `Статус: ${sale.status}\n\n` +
    "Срок выплаты: от 30 секунд до 24 часов " +
    "после подтверждения получения подарка.",
    keyboard(
      [{
        text: "⬅️ Назад",
        callback_data: "transfer"
      }]
    )
  );
}

// ПОДДЕРЖКА

async function support(ctx) {
  session(ctx.from.id).stage = "support";

  return show(
    ctx,
    "SealoryNFT | Техподдержка\n\n" +
    "Напишите ваш вопрос одним сообщением.\n\n" +
    "Будет создан тикет, на который ответит " +
    "администратор.",
    back()
  );
}

async function createTicket(ctx, message) {
  const id = db.nextTicket++;

  db.tickets[String(id)] = {
    id,
    userId: ctx.from.id,
    status: "open",
    created: Date.now(),
    messages: [{
      role: "user",
      text: message,
      at: Date.now()
    }]
  };

  await save();
  session(ctx.from.id).stage = "home";

  await ctx.reply(
    `Ваш тикет #${id} создан.\n\n` +
    "Администратор ответит через бота.",
    { reply_markup: mainMenu() }
  );

  await bot.api.sendMessage(
    ADMIN_ID,
    `Новый тикет #${id}\n` +
    `Пользователь: ${ctx.from.id}\n\n` +
    message.slice(0, 2500),
    {
      reply_markup: keyboard([{
        text: "Открыть тикет",
        callback_data: "a:ticket:" + id
      }])
    }
  ).catch(console.error);
}

// АДМИН-ПАНЕЛЬ

function adminMenu() {
  return keyboard(
    [{
      text: "📢 Рассылка",
      callback_data: "a:broadcast"
    }],
    [{
      text: "🎫 Тикеты",
      callback_data: "a:tickets"
    }],
    [{
      text: "🚫 Блокировки",
      callback_data: "a:bans"
    }]
  );
}

async function adminHome(ctx) {
  session(ctx.from.id).stage = "admin";

  return show(
    ctx,
    "SealoryNFT | Админ-панель\n\n" +
    "Выберите раздел:",
    adminMenu()
  );
}

async function tickets(ctx) {
  const all = Object.values(db.tickets)
    .sort((a, b) => b.id - a.id);

  const open = all.filter(t => t.status === "open");
  const kb = new InlineKeyboard();

  for (const t of open.slice(0, 20)) {
    kb.text(
      `#${t.id} · ${t.userId}`,
      "a:ticket:" + t.id
    ).row();
  }

  kb.text("Все тикеты", "a:allTickets")
    .row()
    .text("⬅️ Админ-панель", "a:home");

  return show(
    ctx,
    `Тикеты\n\nОткрытых: ${open.length}\n` +
    `Всего: ${all.length}\n\n` +
    "Выберите обращение:",
    kb
  );
}

async function allTickets(ctx) {
  const all = Object.values(db.tickets)
    .sort((a, b) => b.id - a.id)
    .slice(0, 25);

  const kb = new InlineKeyboard();

  for (const t of all) {
    kb.text(
      `#${t.id} · ${t.status === "open" ? "Открыт" : "Закрыт"}`,
      "a:ticket:" + t.id
    ).row();
  }

  kb.text("⬅️ Тикеты", "a:tickets");

  return show(ctx, "Последние 25 тикетов:", kb);
}

async function ticketView(ctx, id) {
  const t = db.tickets[String(id)];
  if (!t) return tickets(ctx);

  const kb = new InlineKeyboard()
    .text("Ответить", "a:reply:" + id)
    .row()
    .text(
      t.status === "open"
        ? "Закрыть тикет"
        : "Открыть тикет",
      "a:toggle:" + id
    )
    .row()
    .text("⬅️ К тикетам", "a:tickets");

  const messages = t.messages.slice(-8).map(m =>
    (m.role === "admin" ? "Админ: " : "Пользователь: ") +
    m.text.slice(0, 350)
  ).join("\n\n");

  return show(
    ctx,
    `Тикет #${id}\n` +
    `Пользователь: ${t.userId}\n` +
    `Статус: ${t.status}\n\n${messages}`,
    kb
  );
}

// БЛОКИРОВКИ

async function bans(ctx) {
  const list = Object.entries(db.bans);

  const kb = new InlineKeyboard()
    .text("Заблокировать по ID", "a:banAsk")
    .row()
    .text("Разблокировать по ID", "a:unbanAsk")
    .row()
    .text("⬅️ Админ-панель", "a:home");

  return show(
    ctx,
    "Блокировки\n\n" +
    `Всего: ${list.length}\n\n` +
    (
      list.slice(-15).map(([id, ban]) =>
        `${id} — ${ban.reason}`
      ).join("\n") || "Нет заблокированных пользователей."
    ),
    kb
  );
}

// РАССЫЛКА

async function broadcast(ctx) {
  session(ctx.from.id).stage = "broadcastText";

  return show(
    ctx,
    "Рассылка\n\n" +
    "Отправьте текст сообщения.\n\n" +
    "Перед отправкой появится предварительный просмотр.",
    back("a:home")
  );
}

async function runBroadcast(ctx) {
  const s = session(ctx.from.id);
  const message = s.broadcastText;

  if (!message || s.stage !== "broadcastConfirm") {
    return adminHome(ctx);
  }

  s.broadcastText = null;
  s.stage = "admin";

  await show(
    ctx,
    "Рассылка запущена.\n" +
    "После завершения вы получите результат.",
    adminMenu()
  );

  let success = 0;
  let failed = 0;

  const users = Object.keys(db.users).filter(id =>
    !db.bans[id] && Number(id) !== ADMIN_ID
  );

  for (const id of users) {
    try {
      await bot.api.sendMessage(id, message);
      success++;
    } catch (error) {
      failed++;
      console.error("Broadcast error:", error.message);
    }

    await new Promise(resolve => setTimeout(resolve, 70));
  }

  await bot.api.sendMessage(
    ADMIN_ID,
    "Рассылка завершена.\n\n" +
    `Успешно: ${success}\nОшибок: ${failed}`
  ).catch(console.error);
}

// КОМАНДЫ

bot.command("start", home);

bot.command("admin", ctx =>
  isAdmin(ctx.from.id)
    ? adminHome(ctx)
    : ctx.reply("Команда недоступна.")
);

bot.command("cancel", home);

// ОБРАБОТЧИК КНОПОК

bot.on("callback_query:data", async ctx => {
  const d = ctx.callbackQuery.data;
  const s = session(ctx.from.id);

  if (d.startsWith("a:")) {
    if (!isAdmin(ctx.from.id)) {
      return ctx.answerCallbackQuery({
        text: "Нет доступа",
        show_alert: true
      });
    }

    if (d === "a:home") return adminHome(ctx);
    if (d === "a:broadcast") return broadcast(ctx);
    if (d === "a:tickets") return tickets(ctx);
    if (d === "a:allTickets") return allTickets(ctx);
    if (d === "a:bans") return bans(ctx);

    if (d === "a:banAsk") {
      s.stage = "banAsk";
      return show(
        ctx,
        "Введите Telegram ID пользователя для блокировки.",
        back("a:bans")
      );
    }

    if (d === "a:unbanAsk") {
      s.stage = "unbanAsk";
      return show(
        ctx,
        "Введите Telegram ID пользователя для разблокировки.",
        back("a:bans")
      );
    }

    if (d === "a:send") return runBroadcast(ctx);

    if (d === "a:cancelSend") {
      s.broadcastText = null;
      return adminHome(ctx);
    }

    if (d.startsWith("a:ticket:")) {
      return ticketView(ctx, Number(d.split(":")[2]));
    }

    if (d.startsWith("a:reply:")) {
      s.ticketId = Number(d.split(":")[2]);
      s.stage = "ticketReply";

      return show(
        ctx,
        `Напишите ответ для тикета #${s.ticketId}.`,
        back("a:ticket:" + s.ticketId)
      );
    }

    if (d.startsWith("a:toggle:")) {
      const id = d.split(":")[2];
      const t = db.tickets[id];

      if (!t) return tickets(ctx);

      t.status = t.status === "open" ? "closed" : "open";
      await save();

      return ticketView(ctx, Number(id));
    }
  }

  if (d === "home") return home(ctx);

  if (d === "catalog" || d === "prices") {
    s.search = "";
    s.page = 0;
    return catalog(ctx, d === "prices");
  }

  if (d === "catalogback") return catalog(ctx);

  if (d === "search") {
    s.stage = "search";
    return show(
      ctx,
      "Введите минимум 3 буквы названия NFT.",
      back("catalogback")
    );
  }

  if (d === "page:prev" || d === "page:next") {
    s.page += d.endsWith("next") ? 1 : -1;
    return catalog(ctx);
  }

  if (d.startsWith("gift:")) {
    return giftPage(ctx, Number(d.split(":")[1]));
  }

  if (d === "payment") return payment(ctx);

  if (d === "method:sbp" || d === "method:stars") {
    return details(ctx, d.split(":")[1]);
  }

  if (d === "transfer") return transfer(ctx);
  if (d === "instruction") return instruction(ctx);
  if (d === "receipt") return receipt(ctx);
  if (d === "support") return support(ctx);

  if (d === "profile") {
    const sales = Object.values(db.sales).filter(
      x => x.userId === ctx.from.id
    );

    return show(
      ctx,
      "Мой профиль\n\n" +
      `Telegram ID: ${ctx.from.id}\n` +
      `Юзернейм: @${ctx.from.username || "не указан"}\n` +
      `Заявок: ${sales.length}`,
      back()
    );
  }

  if (d === "history") {
    const sales = Object.values(db.sales)
      .filter(x => x.userId === ctx.from.id)
      .slice(-15)
      .reverse();

    return show(
      ctx,
      "История продаж\n\n" +
      (
        sales.map(x =>
          `#${x.id} ${x.gift} — ${rub(x.price)}\n${x.status}`
        ).join("\n\n") || "Заявок пока нет."
      ),
      back()
    );
  }

  if (d === "info") {
    return show(
      ctx,
      "SealoryNFT | Информация\n\n" +
      "Сервис выкупа Telegram NFT.\n\n" +
      "100 ⭐ = 150 ₽.\n" +
      "Звёзды без комиссии.\n" +
      "Срок выплаты: 30 секунд — 24 часа " +
      "после подтверждения получения NFT.\n\n" +
      "Канал: @SealoryBio\n" +
      "Поддержка: тикеты внутри бота.",
      back()
    );
  }

  return home(ctx);
});

// ОБРАБОТЧИК СООБЩЕНИЙ

bot.on("message:text", async ctx => {
  const s = session(ctx.from.id);
  const msg = ctx.message.text.trim();

  if (msg.startsWith("/")) return;

  if (isAdmin(ctx.from.id)) {
    if (s.stage === "broadcastText") {
      if (!msg || msg.length > 3500) {
        return ctx.reply(
          "Введите сообщение длиной до 3500 символов."
        );
      }

      s.broadcastText = msg;
      s.stage = "broadcastConfirm";

      const count = Object.keys(db.users).filter(id =>
        !db.bans[id] && Number(id) !== ADMIN_ID
      ).length;

      return ctx.reply(
        "Предпросмотр рассылки:\n\n" +
        msg +
        `\n\nПолучателей: ${count}\n\nОтправить?`,
        {
          reply_markup: keyboard(
            [{
              text: "Подтвердить рассылку",
              callback_data: "a:send"
            }],
            [{
              text: "Отмена",
              callback_data: "a:cancelSend"
            }]
          )
        }
      );
    }

    if (
      s.stage === "banAsk" ||
      s.stage === "unbanAsk"
    ) {
      if (!/^\d{5,20}$/.test(msg)) {
        return ctx.reply("Введите числовой Telegram ID.");
      }

      if (Number(msg) === ADMIN_ID) {
        return ctx.reply(
          "Главного администратора блокировать нельзя."
        );
      }

      if (s.stage === "banAsk") {
        db.bans[msg] = {
          reason: "Заблокирован администратором",
          at: Date.now()
        };
        await save();
        await ctx.reply(`Пользователь ${msg} заблокирован.`);
      } else {
        delete db.bans[msg];
        await save();
        await ctx.reply(`Пользователь ${msg} разблокирован.`);
      }

      s.stage = "admin";
      return;
    }

    if (s.stage === "ticketReply") {
      const t = db.tickets[String(s.ticketId)];
      if (!t) return ctx.reply("Тикет не найден.");

      try {
        await bot.api.sendMessage(
          t.userId,
          `Ответ поддержки по тикету #${t.id}:\n\n${msg}`
        );
      } catch (error) {
        return ctx.reply(
          "Не удалось доставить ответ: " + error.message
        );
      }

      t.messages.push({
        role: "admin",
        text: msg,
        at: Date.now()
      });

      await save();
      s.stage = "admin";

      return ctx.reply(
        `Ответ по тикету #${t.id} отправлен.`,
        { reply_markup: adminMenu() }
      );
    }
  }

  if (s.stage === "support") {
    return createTicket(ctx, msg);
  }

  if (s.stage === "search") {
    if (msg.length < 3) {
      return ctx.reply("Введите минимум 3 буквы.");
    }

    s.search = msg;
    s.page = 0;
    return catalog(ctx);
  }

  if (s.stage === "details") {
    const value = msg.replace(/\s/g, "");

    if (
      s.method === "sbp" &&
      !/^\d{16}$/.test(value)
    ) {
      return ctx.reply(
        "Нужно ввести строго 16 цифр номера карты."
      );
    }

    if (
      s.method === "stars" &&
      !/^@[A-Za-z0-9_]{5,32}$/.test(msg)
    ) {
      return ctx.reply(
        "Укажите юзернейм в формате @username."
      );
    }

    return createSale(
      ctx,
      s.method === "sbp" ? value : msg
    );
  }

  return ctx.reply(
    "Выберите раздел меню или отправьте /start.",
    { reply_markup: mainMenu() }
  );
});

bot.catch(error => {
  console.error("Bot error:", error.error);
});

bot.start();
console.log("SealoryNFT started");
