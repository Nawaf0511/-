const { 
    Client, GatewayIntentBits, ActionRowBuilder, StringSelectMenuBuilder, 
    StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle, AuditLogEvent, 
    EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, 
    PermissionsBitField, Events 
} = require('discord.js');
const fs = require('fs');
const wait = require('util').promisify(setTimeout);
const { joinVoiceChannel } = require('@discordjs/voice');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express'); // ضروري لمنصة Render

// ==========================================
// 🌐 إعداد خادم ويب بسيط لمنصة Render
// ==========================================
const app = express();
app.get('/', (req, res) => res.send('Bot is running successfully on Render!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Web server is running on port ${PORT}`));

// ==========================================
// ⚙️ الإعدادات الأساسية
// ==========================================
// يفضل دائماً استخدام المتغيرات البيئية (Environment Variables) في Render لحماية التوكن
const MAIN_BOT_TOKEN = process.env.TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_KEY || 'AQ.Ab8RN6JOdYVy0LDg7VUeFHhd0eJ-wLjDPlK5eH1554_3C46nEQ';
const PREFIX = '!';
const OWNER_ID = '972244532542459954';
const LOG_CHANNEL_ID = '1506610506843291649'; 

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildEmojisAndStickers
    ]
});

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const activeBots = new Map(); 

// ==========================================
// 💾 إعداد قاعدة البيانات المدمجة
// ==========================================
const dbPath = './database.json';
let db = { tokens: [], ai_channel: "", voice_configs: {} };

if (fs.existsSync(dbPath)) {
    db = Object.assign(db, JSON.parse(fs.readFileSync(dbPath, 'utf8')));
} else {
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 4));
}
const saveDB = () => fs.writeFileSync(dbPath, JSON.stringify(db, null, 4));

// ==========================================
// 🛡️ دوال الحماية الأساسية
// ==========================================
async function isExempt(guild, userId) {
    if (!userId) return false; 
    if (userId === OWNER_ID || userId === guild.ownerId || userId === client.user.id) return true;
    const settings = db[guild.id] || { whitelist: [] };
    if (!settings.whitelist || settings.whitelist.length === 0) return false;
    try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return false;
        return settings.whitelist.some(roleId => member.roles.cache.has(roleId));
    } catch (err) { return false; }
}

async function getExecutorId(guild, type, targetId = null) {
    await wait(1500); 
    try {
        const logs = await guild.fetchAuditLogs({ limit: 5, type: type });
        const log = logs.entries.find(e => (!targetId || e.target?.id === targetId) && (Date.now() - e.createdTimestamp < 10000));
        return log ? log.executor.id : null;
    } catch (err) { return null; }
}

async function sendLog(guild, title, color, thumb, fields) {
    try {
        const channel = guild.channels.cache.get(LOG_CHANNEL_ID);
        if (!channel) return;
        const embed = new EmbedBuilder().setTitle(title).setColor(color).setThumbnail(thumb).addFields(fields).setTimestamp();
        await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (err) {}
}

async function sendInviteToVictim(guild, user, reason) {
    try {
        const channel = guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(guild.members.me).has('CreateInstantInvite'));
        if (!channel) return;
        const invite = await channel.createInvite({ maxAge: 86400, maxUses: 1, unique: true });
        user.send(`🛡️ **سيرفر ${guild.name}**\n🚨 ${reason}\n✅ **تم معاقبة المخرب!** ارجع من هنا:\n${invite.url}`).catch(()=>{});
    } catch (err) {}
}

// ==========================================
// 🤖 دوال البوتات الفرعية (المالتي بوت)
// ==========================================
function startChildBot(token) {
    if (activeBots.has(token)) return; 
    const child = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
    
    child.once(Events.ClientReady, () => {
        console.log(`🟢 البوت الفرعي ${child.user.tag} اشتغل!`);
        activeBots.set(token, child);
        if (db.voice_configs[token]) {
            const guild = child.guilds.cache.first(); 
            if (guild) {
                joinVoiceChannel({
                    channelId: db.voice_configs[token],
                    guildId: guild.id,
                    adapterCreator: guild.voiceAdapterCreator,
                });
            }
        }
    });
    child.login(token).catch(err => console.log('❌ خطأ في توكن بوت فرعي:', err));
}

// ==========================================
// 🚀 تشغيل البوت الأساسي
// ==========================================
client.on(Events.ClientReady, () => {
    console.log(`🤖 البوت الرئيسي ${client.user.tag} جاهز! ونظام الحماية يعمل.`);
    if(db.tokens) db.tokens.forEach(token => startChildBot(token));
});

// ==========================================
// 💬 نظام الرسائل (الحماية + لوحات التحكم + الذكاء الاصطناعي)
// ==========================================
client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !message.guild) return;

    // --- 1. الحماية من الروابط والملفات ---
    const s = db[message.guild.id] || {};
    const exempt = await isExempt(message.guild, message.author.id);
    
    if (!exempt) {
        if (s.antiLink && /(https?:\/\/[^\s]+)|(discord\.gg\/[^\s]+)/i.test(message.content)) { 
            await message.delete().catch(()=>{}); 
            return message.channel.send(`🚨 ممنوع نشر الروابط!`).then(m=>setTimeout(()=>m.delete().catch(()=>{}), 5000)); 
        }
        if (s.antiMalware && message.attachments.some(a => ['.exe','.scr','.bat','.cmd','.vbs','.js','.msi'].some(e => a.name.toLowerCase().endsWith(e)))) { 
            await message.delete().catch(()=>{}); 
            const u = await message.guild.members.fetch(message.author.id).catch(()=>null); 
            if(u) await u.ban({ reason: 'ملفات ملغمة' }); 
        }
    }

    // --- 2. لوحة تحكم الحماية ---
    if (message.content === PREFIX + 'حماية' && (message.author.id === OWNER_ID || message.author.id === message.guild.ownerId)) {
        const st = (state) => state ? '🟢 **مفعل**' : '🔴 **معطل**';
        const embed = new EmbedBuilder().setTitle('🛡️ لوحة تحكم الحماية').setColor('#2b2d31').setDescription(`> 🎭 **حماية الرتب الشاملة:** ${st(s.antiRole)}\n> 📁 **حماية الرومات:** ${st(s.antiChannel)}\n> 👥 **منع توزيع الرتب:** ${st(s.antiRoleAssign)}\n> 🔨 **حماية الباند:** ${st(s.antiBan)}\n> 👢 **حماية الطرد:** ${st(s.antiKick)}\n> 🔗 **الروابط والملفات:** ${st(s.antiLink)}\n\n🛡️ **رتب التخطي:** 🎖️ \`${s.whitelist?.length || 0}\` رتب مسجلة`).setFooter({ text: 'التخطي يعتمد على الرتب 🚨' });
        const menu = new StringSelectMenuBuilder().setCustomId('protection_menu').setPlaceholder('⚙️ اختر النظام لتفعيله...').addOptions(
            new StringSelectMenuOptionBuilder().setLabel('حماية الرتب').setValue('toggle_antiRole').setEmoji('🎭'), 
            new StringSelectMenuOptionBuilder().setLabel('حماية الرومات').setValue('toggle_antiChannel').setEmoji('📁'),
            new StringSelectMenuOptionBuilder().setLabel('منع إعطاء الرتب').setValue('toggle_antiRoleAssign').setEmoji('👥'), 
            new StringSelectMenuOptionBuilder().setLabel('حماية الباند').setValue('toggle_antiBan').setEmoji('🔨'),
            new StringSelectMenuOptionBuilder().setLabel('حماية الطرد').setValue('toggle_antiKick').setEmoji('👢'), 
            new StringSelectMenuOptionBuilder().setLabel('الروابط والملفات').setValue('toggle_antiLinks').setEmoji('🔗'),
            new StringSelectMenuOptionBuilder().setLabel('إدارة رتب التخطي').setValue('manage_whitelist').setEmoji('🛡️')
        );
        message.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
    }

    // --- 3. لوحة تحكم البوتات المركزية ---
    if (message.content === PREFIX + 'panel' && (message.author.id === OWNER_ID || message.author.id === message.guild.ownerId)) {
        const embed = new EmbedBuilder()
            .setTitle('🎛️ لوحة تحكم البوتات المركزية')
            .setDescription('أهلاً بك، اختر الإجراء اللي تبيه من القائمة المنسدلة تحت:')
            .setColor('#bdbdbd'); 

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('bot_control_panel')
            .setPlaceholder('اختر الإجراء المطلوب من هنا...')
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('إضافة توكن بوت').setDescription('لإدخال بوت جديد للنظام').setValue('add_token').setEmoji('➕'),
                new StringSelectMenuOptionBuilder().setLabel('تحديد روم الذكاء الاصطناعي').setDescription('لتحديد الروم الخاص بمحادثة الذكاء الاصطناعي').setValue('set_ai_room').setEmoji('🤖'),
                new StringSelectMenuOptionBuilder().setLabel('إدخال بوت لروم صوتي').setDescription('لإدخال أحد البوتات لروم صوتي محدد').setValue('join_voice').setEmoji('🔊')
            );
        await message.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(selectMenu)] });
    }

    // --- 4. محادثة الذكاء الاصطناعي ---
    if (db.ai_channel && message.channel.id === db.ai_channel && !message.content.startsWith(PREFIX)) {
        await message.channel.sendTyping();
        try {
            const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash"});
            const result = await model.generateContent(message.content);
            const response = await result.response;
            await message.reply(response.text());
        } catch (error) {
            console.error(error);
            await message.reply("معليش، الذكاء الاصطناعي يواجه مشكلة حالياً.");
        }
    }
});

// ==========================================
// 🖱️ التفاعلات (القوائم المنسدلة والموديلز والأزرار)
// ==========================================
client.on(Events.InteractionCreate, async i => {
    
    // 1. القوائم المنسدلة (Select Menus)
    if (i.isStringSelectMenu()) {
        if (i.customId === 'protection_menu') {
            if (i.user.id !== i.guild.ownerId && i.user.id !== OWNER_ID) return;
            let s = db[i.guild.id] || { whitelist: [] };
            const v = i.values[0];
            if (v === 'manage_whitelist') {
                const modal = new ModalBuilder().setCustomId('whitelist_modal').setTitle('رتب التخطي').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user_id_input').setLabel('أدخل أيدي الرتبة:').setStyle(TextInputStyle.Short).setRequired(true)));
                return await i.showModal(modal);
            }
            if (v === 'toggle_antiRole') s.antiRole = !s.antiRole; if (v === 'toggle_antiChannel') s.antiChannel = !s.antiChannel; if (v === 'toggle_antiRoleAssign') s.antiRoleAssign = !s.antiRoleAssign;
            if (v === 'toggle_antiBan') s.antiBan = !s.antiBan; if (v === 'toggle_antiKick') s.antiKick = !s.antiKick; if (v === 'toggle_antiLinks') { const st = !s.antiLink; s.antiLink = st; s.antiMalware = st; }
            db[i.guild.id] = s; saveDB(); 
            
            const st = (state) => state ? '🟢 **مفعل**' : '🔴 **معطل**';
            const embed = new EmbedBuilder().setTitle('🛡️ لوحة تحكم الحماية').setColor('#2b2d31').setDescription(`> 🎭 **حماية الرتب الشاملة:** ${st(s.antiRole)}\n> 📁 **حماية الرومات:** ${st(s.antiChannel)}\n> 👥 **منع توزيع الرتب:** ${st(s.antiRoleAssign)}\n> 🔨 **حماية الباند:** ${st(s.antiBan)}\n> 👢 **حماية الطرد:** ${st(s.antiKick)}\n> 🔗 **الروابط والملفات:** ${st(s.antiLink)}\n\n🛡️ **رتب التخطي:** 🎖️ \`${s.whitelist?.length || 0}\` رتب مسجلة`).setFooter({ text: 'التخطي يعتمد على الرتب 🚨' });
            await i.update({ embeds: [embed] });
        }

        if (i.customId === 'bot_control_panel') {
            const choice = i.values[0]; 
            if (choice === 'add_token') {
                const modal = new ModalBuilder().setCustomId('token_modal').setTitle('إضافة بوت جديد');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bot_token').setLabel("حط توكن البوت هنا").setStyle(TextInputStyle.Short)));
                await i.showModal(modal);
            }
            else if (choice === 'set_ai_room') {
                const modal = new ModalBuilder().setCustomId('ai_room_modal').setTitle('روم الذكاء الاصطناعي');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('room_id').setLabel("أيدي الروم (ID)").setStyle(TextInputStyle.Short)));
                await i.showModal(modal);
            }
            else if (choice === 'join_voice') {
                const modal = new ModalBuilder().setCustomId('voice_modal').setTitle('إدخال بوت للروم الصوتي');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bot_token').setLabel("توكن البوت").setStyle(TextInputStyle.Short)), 
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('voice_room_id').setLabel("أيدي الروم الصوتي").setStyle(TextInputStyle.Short))
                );
                await i.showModal(modal);
            }
        }
    }

    // 2. النوافذ المنبثقة (Modals)
    if (i.isModalSubmit()) {
        if (i.customId === 'whitelist_modal') {
            const id = i.fields.getTextInputValue('user_id_input');
            let s = db[i.guild.id] || { whitelist: [] };
            if (s.whitelist.includes(id)) { s.whitelist = s.whitelist.filter(x => x !== id); await i.reply({ content: `✅ أزلنا الرتبة \`${id}\``, ephemeral: true }); }
            else { s.whitelist.push(id); await i.reply({ content: `✅ أضفنا الرتبة \`${id}\``, ephemeral: true }); }
            db[i.guild.id] = s; saveDB(); 
            
            const st = (state) => state ? '🟢 **مفعل**' : '🔴 **معطل**';
            const embed = new EmbedBuilder().setTitle('🛡️ لوحة تحكم الحماية').setColor('#2b2d31').setDescription(`> 🎭 **حماية الرتب الشاملة:** ${st(s.antiRole)}\n> 📁 **حماية الرومات:** ${st(s.antiChannel)}\n> 👥 **منع توزيع الرتب:** ${st(s.antiRoleAssign)}\n> 🔨 **حماية الباند:** ${st(s.antiBan)}\n> 👢 **حماية الطرد:** ${st(s.antiKick)}\n> 🔗 **الروابط والملفات:** ${st(s.antiLink)}\n\n🛡️ **رتب التخطي:** 🎖️ \`${s.whitelist?.length || 0}\` رتب مسجلة`).setFooter({ text: 'التخطي يعتمد على الرتب 🚨' });
            try { await i.message.edit({ embeds: [embed] }); } catch(e){}
        }

        if (i.customId === 'token_modal') {
            const token = i.fields.getTextInputValue('bot_token');
            if (!db.tokens.includes(token)) {
                if(!db.tokens) db.tokens = [];
                db.tokens.push(token); saveDB();
                startChildBot(token);
                await i.reply({ content: '✅ تم حفظ التوكن وتشغيل البوت بنجاح!', ephemeral: true });
            } else { await i.reply({ content: '⚠️ هذا البوت مضاف من قبل!', ephemeral: true }); }
        }

        if (i.customId === 'ai_room_modal') {
            const roomId = i.fields.getTextInputValue('room_id');
            db.ai_channel = roomId; saveDB();
            await i.reply({ content: `✅ تم تعيين روم الذكاء الاصطناعي بنجاح <#${roomId}>`, ephemeral: true });
        }

        if (i.customId === 'voice_modal') {
            const token = i.fields.getTextInputValue('bot_token');
            const voiceId = i.fields.getTextInputValue('voice_room_id');
            if(!db.voice_configs) db.voice_configs = {};
            db.voice_configs[token] = voiceId; saveDB();

            const childClient = activeBots.get(token);
            if (childClient) {
                joinVoiceChannel({
                    channelId: voiceId, guildId: i.guildId,
                    adapterCreator: childClient.guilds.cache.get(i.guildId).voiceAdapterCreator,
                });
                await i.reply({ content: `✅ البوت دخل الروم الصوتي بنجاح!`, ephemeral: true });
            } else { await i.reply({ content: `❌ البوت مو شغال أو التوكن غلط، تأكد من إضافته أول.`, ephemeral: true }); }
        }
    }

    // 3. الأزرار (Buttons - حماية البوتات المخربة)
    if (i.isButton() && i.customId.startsWith('approve_bot_')) {
        const [, , botId] = i.customId.split('_');
        await i.update({ content: `✅ تمت الموافقة! الرابط: https://discord.com/oauth2/authorize?client_id=${botId}&permissions=8&scope=bot`, components: [] });
    }
});

// ==========================================
// 🛡️ أحداث الحماية (الأدوار، الرومات، الباند، إلخ)
// ==========================================
client.on('roleCreate', async role => {
    let execId = await getExecutorId(role.guild, AuditLogEvent.RoleCreate, role.id);
    sendLog(role.guild, '🎭 إنشاء رتبة', '#43b581', role.guild.iconURL(), [{ name: 'الرتبة', value: `<@&${role.id}>`, inline: true }, { name: 'بواسطة', value: execId ? `<@${execId}>` : 'غير معروف', inline: true }]);
    const settings = db[role.guild.id] || {};
    if (settings.antiRole && execId && !(await isExempt(role.guild, execId))) { 
        await role.delete('حماية: إنشاء رتب تخريبية'); 
        const p = await role.guild.members.fetch(execId).catch(()=>null); 
        if (p) await p.ban({ reason: 'إنشاء رتب بدون إذن' }); 
    }
});

client.on('roleDelete', async role => {
    let execId = await getExecutorId(role.guild, AuditLogEvent.RoleDelete, role.id);
    sendLog(role.guild, '🗑️ حذف رتبة', '#f04747', role.guild.iconURL(), [{ name: 'الرتبة', value: role.name, inline: true }, { name: 'بواسطة', value: execId ? `<@${execId}>` : 'غير معروف', inline: true }]);
    const settings = db[role.guild.id] || {};
    if (settings.antiRole && execId && !(await isExempt(role.guild, execId))) { 
        await role.guild.roles.create({ name: role.name, color: role.color, permissions: role.permissions, reason: 'استرجاع رتبة محذوفة' });
        const p = await role.guild.members.fetch(execId).catch(()=>null); 
        if (p) await p.ban({ reason: 'حذف رتب السيرفر' }); 
    }
});

client.on('roleUpdate', async (oldRole, newRole) => {
    if (oldRole.name === newRole.name && oldRole.color === newRole.color && oldRole.permissions.bitfield === newRole.permissions.bitfield) return;
    let execId = await getExecutorId(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    sendLog(newRole.guild, '⚙️ تعديل رتبة', '#faa61a', newRole.guild.iconURL(), [{ name: 'الرتبة', value: `<@&${newRole.id}>`, inline: true }, { name: 'بواسطة', value: execId ? `<@${execId}>` : 'غير معروف', inline: true }]);
    const settings = db[newRole.guild.id] || {};
    if (settings.antiRole && execId && !(await isExempt(newRole.guild, execId))) {
        const oldPerms = new PermissionsBitField(oldRole.permissions.bitfield);
        const newPerms = new PermissionsBitField(newRole.permissions.bitfield);
        const dangerousPerms = [PermissionsBitField.Flags.Administrator, PermissionsBitField.Flags.BanMembers, PermissionsBitField.Flags.KickMembers, PermissionsBitField.Flags.ManageGuild, PermissionsBitField.Flags.ManageRoles, PermissionsBitField.Flags.ManageChannels];
        if (dangerousPerms.some(perm => !oldPerms.has(perm) && newPerms.has(perm)) || oldRole.name !== newRole.name) {
            await newRole.edit({ name: oldRole.name, color: oldRole.color, permissions: oldRole.permissions, reason: 'استرجاع التعديل الخبيث' });
            const p = await newRole.guild.members.fetch(execId).catch(()=>null); 
            if (p) await p.ban({ reason: 'العبث بالرتب' });
        }
    }
});

client.on('channelCreate', async channel => {
    let execId = await getExecutorId(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
    sendLog(channel.guild, '📁 إنشاء روم', '#43b581', channel.guild.iconURL(), [{ name: 'الروم', value: `<#${channel.id}>`, inline: true }, { name: 'بواسطة', value: execId ? `<@${execId}>` : 'غير معروف', inline: true }]);
    const settings = db[channel.guild.id] || {};
    if (settings.antiChannel && execId && !(await isExempt(channel.guild, execId))) {
        await channel.delete('حماية رومات');
        const p = await channel.guild.members.fetch(execId).catch(()=>null);
        if (p) await p.ban({ reason: 'تخريب رومات' });
    }
});

client.on('channelDelete', async channel => {
    let execId = await getExecutorId(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
    sendLog(channel.guild, '🗑️ حذف روم', '#f04747', channel.guild.iconURL(), [{ name: 'اسم الروم', value: channel.name, inline: true }, { name: 'بواسطة', value: execId ? `<@${execId}>` : 'غير معروف', inline: true }]);
    const settings = db[channel.guild.id] || {};
    if (settings.antiChannel && execId && !(await isExempt(channel.guild, execId))) {
        await channel.clone({ name: channel.name });
        const p = await channel.guild.members.fetch(execId).catch(()=>null);
        if (p) await p.ban({ reason: 'تخريب رومات' });
    }
});

client.on('guildBanAdd', async ban => {
    let execId = await getExecutorId(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    sendLog(ban.guild, '🔨 حظر عضو (باند)', '#f04747', ban.user.displayAvatarURL(), [{ name: 'العضو', value: `<@${ban.user.id}>`, inline: true }, { name: 'بواسطة', value: execId ? `<@${execId}>` : 'غير معروف', inline: true }]);
    const settings = db[ban.guild.id] || {};
    if (settings.antiBan && execId && !(await isExempt(ban.guild, execId))) {
        await ban.guild.members.unban(ban.user.id);
        await sendInviteToVictim(ban.guild, ban.user, 'تم تبنيدك عشوائياً.');
        const p = await ban.guild.members.fetch(execId).catch(()=>null);
        if (p) await p.ban({ reason: 'تبنيد عشوائي' });
    }
});

client.on('guildMemberRemove', async member => {
    if (member.user.bot) return;
    let execId = await getExecutorId(member.guild, AuditLogEvent.MemberKick, member.id);
    if (execId) {
        sendLog(member.guild, '👢 طرد عضو (كيك)', '#f04747', member.user.displayAvatarURL(), [{ name: 'العضو', value: `<@${member.id}>`, inline: true }, { name: 'بواسطة', value: `<@${execId}>`, inline: true }]);
        const settings = db[member.guild.id] || {};
        if (settings.antiKick && !(await isExempt(member.guild, execId))) {
            await sendInviteToVictim(member.guild, member.user, 'انطردت عشوائياً.');
            const p = await member.guild.members.fetch(execId).catch(()=>null);
            if (p) await p.ban({ reason: 'طرد عشوائي' });
        }
    } else {
        sendLog(member.guild, '📤 مغادرة عضو', '#f04747', member.user.displayAvatarURL(), [{ name: 'العضو', value: `<@${member.id}>`, inline: true }, { name: 'بواسطة', value: `<@${member.id}> (بنفسه)`, inline: true }]);
    }
});

client.on('guildMemberUpdate', async (oldM, newM) => {
    const avatar = newM.user.displayAvatarURL();
    if (oldM.roles.cache.size !== newM.roles.cache.size) {
        const added = newM.roles.cache.filter(r => !oldM.roles.cache.has(r.id));
        let execId = await getExecutorId(newM.guild, AuditLogEvent.MemberRoleUpdate, newM.id);
        if (added.size > 0) {
            sendLog(newM.guild, '🟢 إعطاء رتبة', '#43b581', avatar, [{ name: 'العضو', value: `<@${newM.id}>`, inline: true }, { name: 'الرتبة', value: added.map(r=>`<@&${r.id}>`).join(','), inline: true }]);
            const settings = db[newM.guild.id] || {};
            if (settings.antiRoleAssign && execId && !(await isExempt(newM.guild, execId))) {
                await newM.roles.remove(added);
                const p = await newM.guild.members.fetch(execId).catch(()=>null);
                if (p) await p.ban({ reason: 'توزيع رتب بدون إذن' });
            }
        }
    }
});

client.on('guildMemberAdd', async member => {
    if (!member.user.bot) return;
    let execId = await getExecutorId(member.guild, AuditLogEvent.BotAdd, member.id);
    const owner = await client.users.fetch(OWNER_ID).catch(()=>null);
    if (!member.user.flags?.toArray().includes('VerifiedBot')) {
        await member.kick('بوت خاص مخرب');
        if (execId && execId !== OWNER_ID && execId !== member.guild.ownerId) {
            const p = await member.guild.members.fetch(execId).catch(()=>null);
            if (p) await p.ban({ reason: 'إدخال بوت خاص مخرب' });
        }
    } else {
        if (execId && await isExempt(member.guild, execId)) return;
        await member.kick('بانتظار الموافقة');
        if (owner) {
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`approve_bot_${member.user.id}_${member.guild.id}`).setLabel('موافقة ✅').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`deny_bot_${member.user.id}_${member.guild.id}`).setLabel('رفض ❌').setStyle(ButtonStyle.Danger));
            owner.send({ content: `⚠️ محاولة إدخال بوت عام (${member.user.tag})\nبواسطة: <@${execId || 'مجهول'}>\nهل توافق؟`, components: [row] }).catch(()=>{});
        }
    }
});

client.login(MAIN_BOT_TOKEN);
