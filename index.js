import { Bot, InlineKeyboard } from 'grammy';
import fs from 'node:fs';
import crypto from 'node:crypto';

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN не указан');
const bot = new Bot(process.env.BOT_TOKEN);
const ADMIN = 8882210622;
const RECEIVER = 'Sealory';
const FILE = './offer-data.json';
const SIX_HOURS = 6 * 60 * 60 * 1000;
let db = { access:{}, requests:{}, offers:{}, drafts:{}, recipient:{}, nextRequest:1 };
try { db = {...db,...JSON.parse(fs.readFileSync(FILE,'utf8'))}; } catch {}
const save = () => fs.writeFileSync(FILE, JSON.stringify(db,null,2));
const allowed = id => id === ADMIN || db.access[String(id)] === true;
const esc = s => String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const newId = () => crypto.randomBytes(5).toString('hex');
const keyboard = () => new InlineKeyboard().text('📝 Создать оффер','create').row().text('📋 Мои офферы','mine').row().text('🔐 Активация','activate');
const activationKb = () => new InlineKeyboard().url('🎁 Скинуть подарок','https://t.me/Sealory').row().text('🔎 Проверить','verify');
const activation = ctx => ctx.reply('🔐 Активация Offer\n\nДля постоянного доступа к /offer и Inline Mode отправьте обычный Telegram-подарок стоимостью 100 ⭐ на @Sealory.\n\nПосле отправки нажмите «Проверить». Администратор проверит получение подарка вручную.\n\nЭто не NFT-подарок.',{reply_markup:activationKb()});
function parseGift(input) {
  const raw = input.trim();
  const match = raw.match(/(?:https?:\/\/)?(?:t\.me|telegram\.me)\/nft\/([A-Za-z][A-Za-z0-9_-]*-\d+)/i);
  if (!match) return null;
  const slug = match[1];
  const m = slug.match(/^(.*)-(\d+)$/);
  if (!m) return null;
  const name = m[1].replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[-_]/g,' ');
  return {slug, name, number:m[2], url:`https://t.me/nft/${slug}`};
}
function timeLeft(o) {
  const remaining = Math.max(0,o.expires-Date.now());
  return `${Math.floor(remaining/3600000)} ч. ${Math.floor((remaining%3600000)/60000)} мин.`;
}
function active(o) { return o.status==='open' && Date.now()<o.expires; }
function label(o) {return `${o.gift.name} #${o.gift.number}`;}
function offerText(o) {
  const creator = o.creatorName || (o.creatorUsername ? '@'+o.creatorUsername : `ID ${o.creatorId}`);
  return `🎁 <b>Предложение на NFT-подарок</b>\n\nПользователь <b>${esc(creator)}</b> предлагает Вам <b>${o.price} ⭐</b> за коллекционный предмет <a href="${o.gift.url}">${esc(label(o))}</a>.\n\n${active(o) ? `Предложение действует ещё ${timeLeft(o)}` : `Статус: ${o.status==='open'?'Срок истёк':o.status==='accepted'?'Принято':o.status==='rejected'?'Отклонено':'Отменено'}`}`;
}
const offerKb = o => active(o) ? new InlineKeyboard().text('Отклонить',`reject:${o.id}`).text('Принять',`accept:${o.id}`) : undefined;
const transferKb = o => new InlineKeyboard().url('🎁 Передать NFT',o.gift.url).row().text('✅ Подтвердить передачу',`transfer:${o.id}`);
async function sendUser(id,text,opts={}) {try {await bot.api.sendMessage(id,text,opts);}catch(e){console.error('send:',e.message);}}
async function startDraft(ctx) {
  if (!allowed(ctx.from.id)) return activation(ctx);
  db.drafts[String(ctx.from.id)]={step:'gift'};save();
  return ctx.reply('📝 Создание оффера\n\nОтправьте ссылку на конкретный NFT-подарок:\nhttps://t.me/nft/SkyStilettos-41219\n\nДля отмены: /cancel');
}

bot.command('start',ctx=>ctx.reply('🤝 Offer\n\nСоздавайте предложения на конкретные Telegram NFT-подарки и отправляйте их через Inline Mode.\n\n/offer — создать предложение\n/recipient @username — получатель для передачи NFT\n/help — инструкция',{reply_markup:keyboard()}));
bot.command('help',ctx=>ctx.reply('1. Активируйте доступ обычным подарком за 100 ⭐ на @Sealory.\n2. Введите /offer, ссылку на NFT и цену в ⭐.\n3. В любом чате введите @username_бота и выберите оффер.\n4. Получатель нажимает «Принять» или «Отклонить».\n5. После принятия получатель вручную передаёт NFT и запрашивает проверку передачи.\n\n/recipient @username — укажите Telegram-аккаунт для передачи.\n\nВажно: бот не резервирует Stars и не переводит их автоматически.')); 
bot.command('offer',startDraft);
bot.command('cancel',ctx=>{delete db.drafts[String(ctx.from.id)];save();return ctx.reply('Создание отменено.');});
bot.command('recipient',async ctx=>{
  if(!allowed(ctx.from.id))return activation(ctx);
  const username=(ctx.match||'').trim().replace(/^@/,'');
  if(!/^[a-zA-Z0-9_]{5,32}$/.test(username))return ctx.reply('Использование: /recipient @username');
  db.recipient[String(ctx.from.id)]=username;save();
  return ctx.reply(`Получатель для передачи: @${username}\n\nУказание username не проверяет владение аккаунтом.`);
});
bot.callbackQuery('create',async ctx=>{await ctx.answerCallbackQuery();return startDraft(ctx);});
bot.callbackQuery('activate',async ctx=>{await ctx.answerCallbackQuery();return allowed(ctx.from.id)?ctx.reply('✅ Доступ уже активирован.'):activation(ctx);});
bot.callbackQuery('verify',async ctx=>{
  await ctx.answerCallbackQuery();
  if(allowed(ctx.from.id))return ctx.reply('✅ Доступ уже активирован.');
  const pending=Object.values(db.requests).find(r=>r.userId===ctx.from.id&&r.status==='pending');
  if(pending)return ctx.reply(`⏳ Заявка #${pending.id} уже ожидает проверки.`);
  const id=db.nextRequest++;
  db.requests[id]={id,userId:ctx.from.id,username:ctx.from.username||'',status:'pending',created:Date.now()};save();
  try {
    await bot.api.sendMessage(ADMIN,`🔔 Активация Offer #${id}\n\nПользователь: ${ctx.from.first_name||'Без имени'}\nID: ${ctx.from.id}\nUsername: @${ctx.from.username||'не указан'}\n\nПроверьте обычный Telegram-подарок стоимостью 100 ⭐ на @Sealory.`,{reply_markup:new InlineKeyboard().text('✅ Подтвердить',`grant:${id}`).row().text('❌ Отклонить',`deny:${id}`)});
  } catch(e){delete db.requests[id];save();return ctx.reply('Не удалось отправить заявку. Администратор должен сначала открыть чат с ботом через /start.');}
  return ctx.reply(`⏳ Заявка #${id} отправлена администратору.`);
});
bot.callbackQuery(/^(grant|deny):(\d+)$/,async ctx=>{
  if(ctx.from.id!==ADMIN)return ctx.answerCallbackQuery({text:'Нет доступа',show_alert:true});
  const [,action,id]=ctx.match;const r=db.requests[id];
  if(!r||r.status!=='pending')return ctx.answerCallbackQuery({text:'Заявка уже обработана',show_alert:true});
  r.status=action==='grant'?'approved':'denied';
  if(action==='grant')db.access[String(r.userId)]=true;
  save();await ctx.answerCallbackQuery();
  await ctx.editMessageText(`Заявка #${id}: ${r.status}\nПользователь: ${r.userId}`);
  await sendUser(r.userId,action==='grant'?'✅ Доступ к /offer и Inline Mode открыт навсегда.':'❌ Получение подарка не подтверждено. Проверьте отправку и подайте заявку повторно.');
});
bot.callbackQuery('mine',async ctx=>{
  await ctx.answerCallbackQuery();if(!allowed(ctx.from.id))return activation(ctx);
  const arr=Object.values(db.offers).filter(o=>o.creatorId===ctx.from.id).sort((a,b)=>b.created-a.created).slice(0,20);
  if(!arr.length)return ctx.reply('Пока нет офферов. Создать: /offer');
  const kb=new InlineKeyboard();for(const o of arr)kb.text(`${label(o).slice(0,32)} · ${o.price} ⭐`, `view:${o.id}`).row();
  return ctx.reply('📋 Мои офферы',{reply_markup:kb});
});
bot.callbackQuery(/^view:([a-f0-9]+)$/,async ctx=>{
  await ctx.answerCallbackQuery();const o=db.offers[ctx.match[1]];
  if(!o||o.creatorId!==ctx.from.id)return ctx.reply('Не найдено.');
  const kb=active(o)?new InlineKeyboard().text('🚫 Отменить',`canceloffer:${o.id}`):undefined;
  return ctx.reply(offerText(o),{parse_mode:'HTML',link_preview_options:{is_disabled:false},reply_markup:kb});
});
bot.callbackQuery(/^canceloffer:([a-f0-9]+)$/,async ctx=>{
  const o=db.offers[ctx.match[1]];
  if(!o||o.creatorId!==ctx.from.id||!active(o))return ctx.answerCallbackQuery({text:'Отмена невозможна',show_alert:true});
  o.status='cancelled';save();await ctx.answerCallbackQuery({text:'Отменено'});
  await ctx.editMessageText(offerText(o),{parse_mode:'HTML'});
});
bot.on('message:text',async ctx=>{
  const uid=String(ctx.from.id),draft=db.drafts[uid];
  if(!draft||!allowed(ctx.from.id)||ctx.message.text.startsWith('/'))return;
  const value=ctx.message.text.trim();
  if(draft.step==='gift'){
    const gift=parseGift(value);
    if(!gift)return ctx.reply('Нужна ссылка на конкретный NFT вида https://t.me/nft/SkyStilettos-41219');
    draft.gift=gift;draft.step='price';save();return ctx.reply(`🎁 ${label({gift})}\n\nВведите сумму предложения в ⭐ (1–1 000 000).`);
  }
  if(draft.step==='price'){
    if(!/^\d+$/.test(value)||Number(value)<1||Number(value)>1000000)return ctx.reply('Введите целое число от 1 до 1 000 000.');
    const id=newId(),o={id,gift:draft.gift,price:Number(value),creatorId:ctx.from.id,creatorUsername:ctx.from.username||'',creatorName:ctx.from.first_name||'',recipient:db.recipient[uid]||'',status:'open',created:Date.now(),expires:Date.now()+SIX_HOURS};
    db.offers[id]=o;delete db.drafts[uid];save();
    const me=await bot.api.getMe();
    return ctx.reply(`✅ Оффер создан!\n\n${label(o)}\n${o.price} ⭐\nДействует 6 часов.\n\nОпубликовать в любом чате: @${me.username} ${id}`,{reply_markup:new InlineKeyboard().switchInlineCurrent('📤 Выбрать оффер')});
  }
});
bot.on('inline_query',async ctx=>{
  if(!allowed(ctx.from.id))return ctx.answerInlineQuery([{type:'article',id:'locked',title:'🔒 Активируйте доступ',description:'Обычный подарок за 100 ⭐',input_message_content:{message_text:'Для использования Offer сначала активируйте доступ в боте.'}}],{cache_time:0,is_personal:true,button:{text:'🔓 Активация',start_parameter:'activate'}});
  const q=ctx.inlineQuery.query.trim().toLowerCase();
  const offers=Object.values(db.offers).filter(o=>o.creatorId===ctx.from.id&&active(o)&&(!q||o.id.includes(q)||label(o).toLowerCase().includes(q))).sort((a,b)=>b.created-a.created).slice(0,30);
  const results=offers.map(o=>({type:'article',id:o.id,title:`${label(o)} — ${o.price} ⭐`,description:'Предложение действует 6 часов',input_message_content:{message_text:offerText(o),parse_mode:'HTML',link_preview_options:{is_disabled:false}},reply_markup:offerKb(o),url:o.gift.url}));
  await ctx.answerInlineQuery(results,{cache_time:0,is_personal:true,button:{text:'📝 Создать оффер',start_parameter:'create'}});
});
bot.callbackQuery(/^(accept|reject):([a-f0-9]+)$/,async ctx=>{
  const [,action,id]=ctx.match,o=db.offers[id];
  if(!o||!active(o))return ctx.answerCallbackQuery({text:'Предложение уже недействительно',show_alert:true});
  if(ctx.from.id===o.creatorId)return ctx.answerCallbackQuery({text:'Нельзя отвечать на собственный оффер',show_alert:true});
  // Если указан получатель, только этот username может принять оффер.
  if(o.recipient&&(!ctx.from.username||o.recipient.toLowerCase()!==ctx.from.username.toLowerCase()))return ctx.answerCallbackQuery({text:`Оффер адресован @${o.recipient}`,show_alert:true});
  o.status=action==='accept'?'accepted':'rejected';o.responderId=ctx.from.id;o.responderUsername=ctx.from.username||'';o.closed=Date.now();save();
  await ctx.answerCallbackQuery({text:action==='accept'?'Предложение принято':'Предложение отклонено'});
  const message=action==='accept'?`🤝 Предложение принято\n\n${label(o)}\nЦена: ${o.price} ⭐\n\nПередача NFT выполняется вручную. Подтверждение передачи проверяется администратором. Оплата Stars не резервируется ботом.`:`❌ Предложение отклонено\n\n${label(o)}`;
  try{await ctx.editMessageText(message,{reply_markup:action==='accept'?transferKb(o):undefined});}catch(e){console.error('edit inline:',e.message);}
  await sendUser(o.creatorId,`Offer #${id}: ${action==='accept'?'принят':'отклонён'} пользователем ${ctx.from.username?'@'+ctx.from.username:ctx.from.id}.`);
  await sendUser(ctx.from.id,message,action==='accept'?{reply_markup:transferKb(o)}:{});
});
bot.callbackQuery(/^transfer:([a-f0-9]+)$/,async ctx=>{
  const o=db.offers[ctx.match[1]];
  if(!o||o.status!=='accepted'||o.responderId!==ctx.from.id)return ctx.answerCallbackQuery({text:'Нет доступа к заявке',show_alert:true});
  if(o.transferStatus==='pending')return ctx.answerCallbackQuery({text:'Заявка уже на проверке',show_alert:true});
  if(o.transferStatus==='confirmed')return ctx.answerCallbackQuery({text:'Уже подтверждено',show_alert:true});
  o.transferStatus='pending';save();
  try{await bot.api.sendMessage(ADMIN,`🎁 Проверка передачи NFT\n\nОффер: #${o.id}\nNFT: ${label(o)}\nСсылка: ${o.gift.url}\nПредложение: ${o.price} ⭐\nАвтор: ${o.creatorId}\nПринявший: ${o.responderId}\n\nПроверьте передачу самостоятельно. Бот не подтверждает её автоматически.`,{reply_markup:new InlineKeyboard().text('✅ Передача подтверждена',`transferok:${o.id}`).row().text('❌ Не подтверждена',`transferno:${o.id}`)});}catch(e){o.transferStatus='none';save();return ctx.answerCallbackQuery({text:'Не удалось отправить админу',show_alert:true});}
  await ctx.answerCallbackQuery({text:'Отправлено на проверку'});
  await ctx.reply('⏳ Запрос на подтверждение передачи отправлен администратору.');
});
bot.callbackQuery(/^transfer(ok|no):([a-f0-9]+)$/,async ctx=>{
  if(ctx.from.id!==ADMIN)return ctx.answerCallbackQuery({text:'Нет доступа',show_alert:true});
  const [,action,id]=ctx.match,o=db.offers[id];
  if(!o||o.transferStatus!=='pending')return ctx.answerCallbackQuery({text:'Уже обработано',show_alert:true});
  o.transferStatus=action==='ok'?'confirmed':'rejected';save();await ctx.answerCallbackQuery();
  await ctx.editMessageText(`Оффер #${id}: передача ${action==='ok'?'подтверждена':'не подтверждена'}.`);
  const msg=action==='ok'?`✅ Передача ${label(o)} подтверждена администратором.\n\nЭто не подтверждение оплаты Stars.`:`❌ Передача ${label(o)} не подтверждена администратором.`;
  await sendUser(o.creatorId,msg);await sendUser(o.responderId,msg);
});
bot.catch(e=>console.error('Bot error:',e.error));
bot.start();
