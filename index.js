import { Bot, InlineKeyboard } from 'grammy';
import { GIFTS, rub } from './prices.js';

const token = process.env.BOT_TOKEN;
if (!token) throw new Error('Set BOT_TOKEN in hosting environment variables');
const bot = new Bot(token);
const sessions = new Map(); // temporary; resets after restart
const support = (process.env.SUPPORT_USERNAME || 'Sealory').replace(/^@/, '');
const channel = (process.env.CHANNEL_USERNAME || '').replace(/^@/, '');
const adminId = process.env.ADMIN_ID || '';
const fmt = (name, value) => `${name}: ${value}`;
const get = id => { if (!sessions.has(id)) sessions.set(id, { stage: 'home', page: 0, search: '', history: [] }); return sessions.get(id); };
const rows = (...pairs) => InlineKeyboard.from(pairs);
const mainKeyboard = () => rows(
  [{ text: 'Продать NFT', callback_data: 'catalog' }],
  [{ text: 'Цены на NFT', callback_data: 'prices' }],
  [{ text: 'Продать звёзды', callback_data: 'sellstars' }, { text: 'Продать Gram', callback_data: 'sellgram' }],
  [{ text: 'Мой профиль', callback_data: 'profile' }, { text: 'История продаж', callback_data: 'history' }],
  [{ text: 'Информация о боте', callback_data: 'info' }],
  [{ text: 'Наш канал', callback_data: 'channel' }, { text: 'Тех Поддержка', url: `https://t.me/${support}` }]
);
const back = (where='home') => rows([{ text: '⬅️ Назад', callback_data: where }]);
const starsFor = rubles => Math.floor(rubles * 100 / 150);
async function show(ctx, text, keyboard) {
  if (ctx.callbackQuery) { await ctx.answerCallbackQuery().catch(()=>{}); try { return await ctx.editMessageText(text, { reply_markup: keyboard }); } catch(e) { if (String(e).includes('message is not modified')) return; } }
  return ctx.reply(text, { reply_markup: keyboard });
}
async function home(ctx) {
  get(ctx.from.id).stage='home';
  return show(ctx, 'SealoryNFT | Сервис скупки\n\nДобро пожаловать в SealoryNFT!\nНаш сервис специализируется на оценке и выкупе коллекционных Telegram NFT-подарков, Telegram Stars и Gram.\n\nВы можете ознакомиться с ценами, оформить заявку на продажу и отслеживать историю своих сделок.\n\nВыберите необходимый раздел в меню ниже.', mainKeyboard());
}
async function catalog(ctx, pricing=false) {
  const s = get(ctx.from.id); s.stage='catalog'; s.pricing=pricing;
  const found = GIFTS.filter(g=>g.name.toLowerCase().includes(s.search.toLowerCase()));
  const total=Math.max(1,Math.ceil(found.length/10)); s.page=Math.min(s.page,total-1);
  const subset=found.slice(s.page*10,s.page*10+10);
  const kb=new InlineKeyboard().text('🔎 Поиск NFT','search').row();
  subset.forEach((g,i)=>{ kb.text(g.name,`gift:${g.id}`); if(i%2===1)kb.row(); });
  if(subset.length%2)kb.row();
  if(s.page>0)kb.text('⬅️ Назад', 'page:prev');
  if(s.page<total-1)kb.text('Далее ➡️', 'page:next');
  kb.row().text('🏠 Главное меню','home');
  return show(ctx, `${pricing?'SealoryNFT | Цены на NFT':'SealoryNFT | Продажа NFT'}\n\nВыберите коллекцию NFT.\nСтраница ${s.page+1} из ${total}${s.search?'\nПоиск: '+s.search:''}`,kb);
}
async function selectedGift(ctx,id) {
  const g=GIFTS[id]; if(!g)return home(ctx);
  const s=get(ctx.from.id); s.gift=id; s.stage='gift';
  const kb=rows([{text:'Продать NFT',callback_data:'payment'}],[{text:'⬅️ Назад к коллекциям',callback_data:'catalogback'}]);
  return show(ctx,`SealoryNFT | Скупка NFT\n\nКоллекция: ${g.name}\nЦена выкупа: ${rub(g.price)}\n\nМы готовы предложить указанную сумму за ваш NFT-подарок. Для оформления продажи нажмите кнопку ниже.`,kb);
}
async function payment(ctx) {
  const s=get(ctx.from.id); if(s.gift===undefined)return catalog(ctx);
  s.stage='payment';
  return show(ctx,'SealoryNFT | Продажа NFT\n\nВыберите способ получения оплаты.\n\nTelegram Stars поступают без комиссии — ровно указанное количество.\nКурс: 100 ⭐ = 150 ₽.\n\nОриентировочный срок выплаты: от 30 секунд до 24 часов после подтверждения сделки. Если выплата не поступила за 24 часа, обратитесь в поддержку.',rows([{text:'СБП (₽)',callback_data:'method:sbp'},{text:'Telegram Stars ⭐',callback_data:'method:stars'}],[{text:'⬅️ Назад',callback_data:`gift:${s.gift}`} ]));
}
async function askDetails(ctx,method) {
  const s=get(ctx.from.id); s.method=method; s.stage='details';
  const g=GIFTS[s.gift];
  const prompt=method==='sbp'?'Введите номер банковской карты (строго 16 цифр).':`Вы получите ${starsFor(g.price).toLocaleString('ru-RU')} ⭐ без комиссии.\n\nВведите Telegram-юзернейм, начиная с @.`;
  return show(ctx,`SealoryNFT | Реквизиты\n\n${prompt}\n\nЕсли администратор не сможет найти вашу карту или аккаунт, он напишет вам для уточнения.`,back('payment'));
}
async function giftTransfer(ctx) {
  const s=get(ctx.from.id); s.stage='transfer';
  return show(ctx,`SealoryNFT | Передача NFT\n\nОтправьте ваш NFT-подарок на аккаунт @Sealory.\n\nПосле отправки нажмите «Проверить».\n\nВажно: отправляйте подарок только если доверяете получателю и согласовали условия сделки. Автоматическая проверка получения подарка пока не подключена.`,rows([{text:'🎁 Скинуть подарок',url:'https://t.me/Sealory'}],[{text:'🔄 Проверить',callback_data:'verify'}],[{text:'⬅️ Назад',callback_data:'payment'}]));
}
async function record(ctx) {
  const s=get(ctx.from.id); const g=GIFTS[s.gift];
  const item={name:g.name,price:g.price,method:s.method,details:s.details,status:'Ожидает подтверждения'};
  s.history.push(item);
  if(adminId) {
    await bot.api.sendMessage(adminId,`Новая заявка SealoryNFT\nПользователь: ${ctx.from.id} (@${ctx.from.username||'нет username'})\nNFT: ${g.name}\nЦена: ${rub(g.price)}\nСпособ: ${s.method}\nРеквизиты: ${s.details}\nСтатус: требуется ручная проверка`).catch(()=>{});
  }
}
bot.command('start',home);
bot.on('callback_query:data',async ctx=>{
  const s=get(ctx.from.id), d=ctx.callbackQuery.data;
  if(d==='home')return home(ctx);
  if(d==='catalog'||d==='prices'){s.search='';s.page=0;return catalog(ctx,d==='prices');}
  if(d==='catalogback')return catalog(ctx,s.pricing);
  if(d==='search'){s.stage='search';return show(ctx,'Введите название NFT (минимум 3 буквы).',back('catalogback'));}
  if(d==='page:prev'||d==='page:next'){s.page+=d.endsWith('next')?1:-1;return catalog(ctx,s.pricing);}
  if(d.startsWith('gift:'))return selectedGift(ctx,Number(d.split(':')[1]));
  if(d==='payment')return payment(ctx);
  if(d==='method:sbp'||d==='method:stars')return askDetails(ctx,d.split(':')[1]);
  if(d==='transfer')return giftTransfer(ctx);
  if(d==='verify')return show(ctx,'⚠️ Подарок пока не подтверждён.\n\nАвтоматическая проверка поступления NFT ещё не подключена. Если вы уже отправили подарок, обратитесь в поддержку и предоставьте данные передачи.',rows([{text:'Тех Поддержка',url:`https://t.me/${support}`}],[{text:'⬅️ Назад',callback_data:'transfer'}]));
  if(d==='profile')return show(ctx,`SealoryNFT | Мой профиль\n\nTelegram ID: ${ctx.from.id}\nЮзернейм: @${ctx.from.username||'не указан'}\nЗаявок в текущем сеансе: ${s.history.length}`,back());
  if(d==='history')return show(ctx,'SealoryNFT | История продаж\n\n'+(s.history.length?s.history.map((h,i)=>`${i+1}. ${h.name} — ${rub(h.price)}\n${h.status}`).join('\n\n'):'Заявок пока нет.' )+'\n\nИстория временная и сбрасывается при перезапуске бота.',back());
  if(d==='info')return show(ctx,'SealoryNFT | Информация о боте\n\nСервис оформления заявок на выкуп Telegram NFT, Stars и Gram.\n\nКурс для выплаты звёздами: 100 ⭐ = 150 ₽. Без комиссии.\nСрок выплат после подтверждения сделки: от 30 секунд до 24 часов.\n\nПри задержке свыше 24 часов напишите в поддержку.',back());
  if(d==='channel')return show(ctx,channel?`Наш канал: @${channel}`:'Ссылка на канал пока не указана администратором.',channel?rows([{text:'Открыть канал',url:`https://t.me/${channel}`}],[{text:'⬅️ Назад',callback_data:'home'}]):back());
  if(d==='sellstars'||d==='sellgram')return show(ctx,`SealoryNFT | ${d==='sellstars'?'Продать звёзды':'Продать Gram'}\n\nДля оформления продажи обратитесь в техническую поддержку.`,rows([{text:'Тех Поддержка',url:`https://t.me/${support}`}],[{text:'⬅️ Назад',callback_data:'home'}]));
  return home(ctx);
});
bot.on('message:text',async ctx=>{
  const s=get(ctx.from.id), v=ctx.message.text.trim();
  if(v.startsWith('/'))return;
  if(s.stage==='search') {
    if(v.length<3)return ctx.reply('Введите минимум 3 буквы для поиска.');
    s.search=v;s.page=0;return catalog(ctx,s.pricing);
  }
  if(s.stage==='details') {
    if(s.method==='sbp'&&!/^\d{16}$/.test(v.replace(/\s/g,'')))return ctx.reply('Номер карты должен содержать строго 16 цифр. Попробуйте ещё раз.');
    if(s.method==='stars'&&!/^@[A-Za-z0-9_]{5,32}$/.test(v))return ctx.reply('Укажите корректный Telegram-юзернейм в формате @username.');
    s.details=v;await record(ctx);return giftTransfer(ctx);
  }
  return ctx.reply('Выберите действие в меню.',{reply_markup:mainKeyboard()});
});
bot.catch(err=>console.error('Bot error:',err.error));
bot.start();
console.log('SealoryNFT bot started');
