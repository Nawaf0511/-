const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    StringSelectMenuOptionBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const fs = require('fs');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// ================= الإعدادات =================
const DB_PATH = './database.json';
// ============================================

function getDB() {
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({ sectors: {}, leaves: [], panelImage: null, statsChannelId: null, statsMessageId: null }, null, 2));
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function saveDB(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// دالة تحديث لوحة الإحصائيات التلقائية
async function updateStatsPanel(client, db) {
    if (!db.statsChannelId || !db.statsMessageId) return;
    try {
        const channel = client.channels.cache.get(db.statsChannelId);
        if (!channel) return;
        const msg = await channel.messages.fetch(db.statsMessageId).catch(() => null);
        if (!msg) return;

        const embed = new EmbedBuilder()
            .setTitle('📊 إحصائيات الإجازات - لوحة الصدارة')
            .setColor('#2b2d31')
            .setFooter({ text: 'يتم تحديث هذه اللوحة تلقائياً عند كل عملية سحب أو قبول أو انتهاء' });

        let description = '';
        const medals = ['🥇', '🥈', '🥉', '🏅', '🏅', '🏅', '🏅', '🏅', '🏅', '🏅'];

        if (db.leaves.length === 0) {
            description = 'لا يوجد أي شخص في إجازة حالياً.';
        } else {
            for (const sectorName of Object.keys(db.sectors)) {
                const sectorLeaves = db.leaves.filter(l => l.sector === sectorName);
                if (sectorLeaves.length > 0) {
                    description += `\n**🏛️ قطاع ${sectorName}:**\n`;
                    sectorLeaves.forEach((leave, index) => {
                        const medal = medals[index] || '🏅';
                        // استخدام t:TIMESTAMP:F يعطي الوقت والتاريخ الدقيق جداً
                        description += `${medal} | الموظف: <@${leave.userId}> ← تنتهي: <t:${Math.floor(leave.endTime / 1000)}:F>\n`;
                    });
                }
            }
        }
        embed.setDescription(description || 'لا يوجد إجازات مسجلة.');
        await msg.edit({ embeds: [embed] }).catch(() => null);
    } catch (error) {
        console.error('خطأ في تحديث لوحة الإحصائيات:', error);
    }
}

client.on('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    getDB();
    checkLeavesContinuously();
});

// ================= أوامر البوت =================
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    // 1. أمر لوحة تحكم الإدارة العليا
    if (message.content === '!لوحة-التحكم') {
        if (!message.member.permissions.has('Administrator')) return;

        const db = getDB();
        let sectorsList = Object.keys(db.sectors).map(name => `**${name}**\n↳ رتبة الموظفين: <@&${db.sectors[name].employeeRoleId}>\n↳ رتبة الإجازة: <@&${db.sectors[name].roleId}>\n↳ الإدارة المسؤولة: <@&${db.sectors[name].adminRoleId}>\n↳ روم الطلبات: <#${db.sectors[name].logChannelId}>`).join('\n\n') || 'لا يوجد قطاعات مسجلة.';

        const embed = new EmbedBuilder()
            .setTitle('⚙️ لوحة تحكم نظام الإجازات')
            .setDescription(`من هنا يمكنك إدارة الإعدادات الأساسية للقطاعات.\n\n🏛️ **القطاعات الحالية:**\n${sectorsList}`)
            .setColor('#2b2d31');

        const adminMenu = new StringSelectMenuBuilder()
            .setCustomId('admin_menu')
            .setPlaceholder('⚙️ خيارات لوحة التحكم')
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('تثبيت لوحة الإحصائيات').setEmoji('📊').setValue('cp_setup_stats'),
                new StringSelectMenuOptionBuilder().setLabel('إعطاء إجازة لعضو (يدوي)').setEmoji('✅').setValue('cp_grant_leave'),
                new StringSelectMenuOptionBuilder().setLabel('تغيير صورة اللوحة').setEmoji('🖼️').setValue('cp_set_image'),
                new StringSelectMenuOptionBuilder().setLabel('إضافة قطاع جديد').setEmoji('🏛️').setValue('cp_add_sector'),
                new StringSelectMenuOptionBuilder().setLabel('إزالة قطاع').setEmoji('🗑️').setValue('cp_remove_sector')
            );

        const row = new ActionRowBuilder().addComponents(adminMenu);
        await message.channel.send({ embeds: [embed], components: [row] });
        await message.delete();
    }

    // 2. أمر لوحة مسؤول القطاع
    if (message.content === '!لوحة-المسؤول') {
        if (!message.member.permissions.has('Administrator')) return; 

        const embed = new EmbedBuilder()
            .setTitle('🛡️ لوحة مسؤول القطاع')
            .setDescription('من هنا يمكنك إدارة إجازات موظفي قطاعك (تمديد، إلغاء، وعرض المجازين).')
            .setColor('#2b2d31');

        const managerMenu = new StringSelectMenuBuilder()
            .setCustomId('manager_menu')
            .setPlaceholder('🛡️ خيارات المسؤول')
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('المجازين حالياً').setEmoji('👥').setValue('mgr_list_leaves'),
                new StringSelectMenuOptionBuilder().setLabel('تمديد إجازة شخص').setEmoji('⏳').setValue('mgr_extend_leave'),
                new StringSelectMenuOptionBuilder().setLabel('إلغاء إجازة').setEmoji('🔨').setValue('mgr_cancel_leave')
            );

        const row = new ActionRowBuilder().addComponents(managerMenu);
        await message.channel.send({ embeds: [embed], components: [row] });
        await message.delete();
    }

    // 3. أمر إرسال اللوحة للأعضاء
    if (message.content === '!إرسال-اللوحة') {
        if (!message.member.permissions.has('Administrator')) return;

        const db = getDB();
        const embed = new EmbedBuilder()
            .setAuthor({ name: 'نظام الإجازات ✉️ | Oblivion Town' })
            .setDescription(`[ أهلاً وسهلاً بك في طاقم إدارة Oblivion Town ]\n\nيرجى اختيار نوع الطلب بالأسفل (⬇️).\n\nراح يساعدك فريقنا بأسرع وقت ( ⏳ ).\n\n📅 **التاريخ والوقت:** <t:${Math.floor(Date.now() / 1000)}:F>`)
            .setColor('#2b2d31');

        if (db.panelImage) {
            try { embed.setImage(db.panelImage); } catch (error) {}
        }

        const menu = new StringSelectMenuBuilder()
            .setCustomId('leave_menu')
            .setPlaceholder('🌴 طلب إجازة')
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('طلب إجازة').setEmoji('🌴').setValue('request_leave'),
                new StringSelectMenuOptionBuilder().setLabel('طلب تمديد').setEmoji('⏳').setValue('extend_leave'),
                new StringSelectMenuOptionBuilder().setLabel('طلب كسر إجازة').setEmoji('🔨').setValue('break_leave')
            );

        const row = new ActionRowBuilder().addComponents(menu);
        await message.channel.send({ embeds: [embed], components: [row] });
        await message.delete();
    }
});

// ================= التفاعلات =================
client.on('interactionCreate', async interaction => {
    const db = getDB();

    // ---------------- أزرار (قبول / رفض) ----------------
    if (interaction.isButton()) {
        const parts = interaction.customId.split('_');
        const action = parts[0]; 
        const userId = parts[2];
        const sectorName = parts.slice(3).join('_'); 

        if (action === 'accept' || action === 'reject') {
            const sectorData = db.sectors[sectorName];
            if (!sectorData) return interaction.reply({ content: '❌ هذا القطاع لم يعد موجوداً.', ephemeral: true });

            if (!interaction.member.roles.cache.has(sectorData.adminRoleId) && !interaction.member.permissions.has('Administrator')) {
                return interaction.reply({ content: `❌ عذراً، فقط أصحاب الرتبة المسؤولة عن قطاع (**${sectorName}**) يمكنهم اتخاذ إجراء على هذا الطلب.`, ephemeral: true });
            }

            if (action === 'accept') {
                const modal = new ModalBuilder().setCustomId(`modal_accept_${userId}_${sectorName}`).setTitle('تحديد وقت الإجازة (للقبول)');
                const daysInput = new TextInputBuilder().setCustomId('leave_days').setLabel('عدد الأيام (كم يوم سيضاف له؟)').setStyle(TextInputStyle.Short).setRequired(true);
                const timeInput = new TextInputBuilder().setCustomId('end_time').setLabel('وقت الانتهاء (مثال: 14:30)').setStyle(TextInputStyle.Short).setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(daysInput), new ActionRowBuilder().addComponents(timeInput));
                await interaction.showModal(modal);
            }

            if (action === 'reject') {
                const modal = new ModalBuilder().setCustomId(`modal_reject_${userId}_${sectorName}`).setTitle('سبب الرفض');
                const reasonInput = new TextInputBuilder().setCustomId('reject_reason').setLabel('اكتب سبب الرفض (سيتم إرساله للعضو)').setStyle(TextInputStyle.Paragraph).setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
                await interaction.showModal(modal);
            }
        }
    }

    // ---------------- القوائم المنسدلة ----------------
    if (interaction.isStringSelectMenu()) {
        const selected = interaction.values[0];

        // --- 1. قائمة لوحة تحكم الإدارة العليا ---
        if (interaction.customId === 'admin_menu') {
            if (!interaction.member.permissions.has('Administrator')) return interaction.reply({ content: '❌ لا تملك صلاحية.', ephemeral: true });

            // إعداد لوحة الإحصائيات (الجديد)
            if (selected === 'cp_setup_stats') {
                const modal = new ModalBuilder().setCustomId('modal_setup_stats').setTitle('تثبيت لوحة الإحصائيات');
                const channelInput = new TextInputBuilder().setCustomId('channel_id').setLabel('ايدي الروم المراد وضع الإحصائيات فيه').setStyle(TextInputStyle.Short).setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(channelInput));
                await interaction.showModal(modal);
            }

            if (selected === 'cp_add_sector') {
                const modal = new ModalBuilder().setCustomId('modal_add_sector').setTitle('إضافة قطاع جديد');
                const nameInput = new TextInputBuilder().setCustomId('sector_name').setLabel('اسم القطاع (مثال: المباحث)').setStyle(TextInputStyle.Short).setRequired(true);
                const empInput = new TextInputBuilder().setCustomId('sector_emp_role').setLabel('ايدي رتبة الموظفين').setStyle(TextInputStyle.Short).setRequired(true);
                const adminInput = new TextInputBuilder().setCustomId('sector_admin_role').setLabel('ايدي رتبة مسؤولي القطاع').setStyle(TextInputStyle.Short).setRequired(true);
                const leaveInput = new TextInputBuilder().setCustomId('sector_leave_role').setLabel('ايدي رتبة إجازة القطاع').setStyle(TextInputStyle.Short).setRequired(true);
                const logInput = new TextInputBuilder().setCustomId('sector_log_channel').setLabel('ايدي روم طلبات القطاع').setStyle(TextInputStyle.Short).setRequired(true);
                
                modal.addComponents(
                    new ActionRowBuilder().addComponents(nameInput), 
                    new ActionRowBuilder().addComponents(empInput),
                    new ActionRowBuilder().addComponents(adminInput),
                    new ActionRowBuilder().addComponents(leaveInput),
                    new ActionRowBuilder().addComponents(logInput)
                );
                await interaction.showModal(modal);
            }

            if (selected === 'cp_remove_sector') {
                const modal = new ModalBuilder().setCustomId('modal_remove_sector').setTitle('إزالة قطاع مسجل');
                const nameInput = new TextInputBuilder().setCustomId('sector_name').setLabel('اكتب اسم القطاع المراد حذفه').setStyle(TextInputStyle.Short).setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
                await interaction.showModal(modal);
            }

            if (selected === 'cp_set_image') {
                const modal = new ModalBuilder().setCustomId('modal_set_image').setTitle('تغيير صورة لوحة الأعضاء');
                const imgInput = new TextInputBuilder().setCustomId('image_url').setLabel('رابط الصورة المباشر (URL)').setStyle(TextInputStyle.Short).setRequired(false);
                modal.addComponents(new ActionRowBuilder().addComponents(imgInput));
                await interaction.showModal(modal);
            }

            if (selected === 'cp_grant_leave') {
                const modal = new ModalBuilder().setCustomId('modal_grant_leave').setTitle('إعطاء إجازة يدوياً');
                const userInput = new TextInputBuilder().setCustomId('user_id').setLabel('ايدي العضو').setStyle(TextInputStyle.Short).setRequired(true);
                const daysInput = new TextInputBuilder().setCustomId('leave_days').setLabel('عدد الأيام (كم يوم سيضاف له؟)').setStyle(TextInputStyle.Short).setRequired(true);
                const timeInput = new TextInputBuilder().setCustomId('end_time').setLabel('وقت الانتهاء (مثال: 14:30)').setStyle(TextInputStyle.Short).setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(userInput), new ActionRowBuilder().addComponents(daysInput), new ActionRowBuilder().addComponents(timeInput));
                await interaction.showModal(modal);
            }
        }

        // --- 2. قائمة لوحة المسؤول ---
        if (interaction.customId === 'manager_menu') {
            let isManager = interaction.member.permissions.has('Administrator');
            for (const sector of Object.values(db.sectors)) {
                if (interaction.member.roles.cache.has(sector.adminRoleId)) { isManager = true; break; }
            }

            if (!isManager) return interaction.reply({ content: '❌ لا تملك صلاحية مسؤول قطاع لاستخدام هذه اللوحة.', ephemeral: true });

            if (selected === 'mgr_list_leaves') {
                if (db.leaves.length === 0) return interaction.reply({ content: 'لا يوجد أي شخص في إجازة حالياً.', ephemeral: true });
                const list = db.leaves.map((l, i) => `${i + 1}- <@${l.userId}> | القطاع: **${l.sector}** | تنتهي: <t:${Math.floor(l.endTime / 1000)}:f>`).join('\n');
                return interaction.reply({ content: `**📋 قائمة المجازين:**\n${list}`, ephemeral: true });
            }

            if (selected === 'mgr_extend_leave') {
                const modal = new ModalBuilder().setCustomId('modal_mgr_extend').setTitle('تمديد إجازة شخص');
                const userInput = new TextInputBuilder().setCustomId('user_id').setLabel('ايدي العضو').setStyle(TextInputStyle.Short).setRequired(true);
                const daysInput = new TextInputBuilder().setCustomId('extra_days').setLabel('عدد الأيام الإضافية').setStyle(TextInputStyle.Short).setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(userInput), new ActionRowBuilder().addComponents(daysInput));
                await interaction.showModal(modal);
            }

            if (selected === 'mgr_cancel_leave') {
                const modal = new ModalBuilder().setCustomId('modal_mgr_cancel').setTitle('إلغاء إجازة شخص');
                const userInput = new TextInputBuilder().setCustomId('user_id').setLabel('ايدي العضو').setStyle(TextInputStyle.Short).setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(userInput));
                await interaction.showModal(modal);
            }
        }

        // --- 3. قائمة لوحة الأعضاء ---
        if (interaction.customId === 'leave_menu') {
            const userLeave = db.leaves.find(l => l.userId === interaction.user.id);

            if (selected === 'request_leave') {
                if (userLeave) return interaction.reply({ content: '❌ لديك إجازة نشطة بالفعل!', ephemeral: true });

                let userSector = null;
                for (const [sectorName, sectorData] of Object.entries(db.sectors)) {
                    if (interaction.member.roles.cache.has(sectorData.employeeRoleId)) { userSector = sectorName; break; }
                }

                if (!userSector) return interaction.reply({ content: '❌ لم أتمكن من التعرف على قطاعك! تأكد أنك تمتلك رتبة موظف لقطاع مسجل في النظام.', ephemeral: true });

                const modal = new ModalBuilder().setCustomId(`modal_req_leave_${userSector}`).setTitle('تقديم طلب إجازة');
                const nameInput = new TextInputBuilder().setCustomId('req_name').setLabel('الاسم').setStyle(TextInputStyle.Short).setRequired(true);
                const durationInput = new TextInputBuilder().setCustomId('req_duration').setLabel('المدة المطلوبة').setStyle(TextInputStyle.Short).setRequired(true);
                const reasonInput = new TextInputBuilder().setCustomId('req_reason').setLabel('السبب').setStyle(TextInputStyle.Paragraph).setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(nameInput), new ActionRowBuilder().addComponents(durationInput), new ActionRowBuilder().addComponents(reasonInput));
                await interaction.showModal(modal);
            }

            else if (selected === 'extend_leave') {
                if (!userLeave) return interaction.reply({ content: '❌ ليس لديك إجازة لطلب تمديدها!', ephemeral: true });
                const modal = new ModalBuilder().setCustomId(`modal_extend_${userLeave.sector}`).setTitle('طلب تمديد الإجازة');
                const durationInput = new TextInputBuilder().setCustomId('ext_duration').setLabel('المدة الإضافية المطلوبة').setStyle(TextInputStyle.Short).setRequired(true);
                const reasonInput = new TextInputBuilder().setCustomId('ext_reason').setLabel('سبب التمديد').setStyle(TextInputStyle.Paragraph).setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(durationInput), new ActionRowBuilder().addComponents(reasonInput));
                await interaction.showModal(modal);
            }

            else if (selected === 'break_leave') {
                if (!userLeave) return interaction.reply({ content: '❌ ليس لديك إجازة لكسرها!', ephemeral: true });
                const sectorData = db.sectors[userLeave.sector];
                if (sectorData && sectorData.roleId) {
                    await interaction.member.roles.remove(sectorData.roleId).catch(() => null);
                }
                db.leaves = db.leaves.filter(l => l.userId !== interaction.user.id);
                saveDB(db);
                updateStatsPanel(client, db); // تحديث الإحصائيات
                await interaction.reply({ content: '✅ تم كسر إجازتك بنجاح وسحب رتبة الإجازة. أهلاً بعودتك!', ephemeral: true });
                
                if (sectorData && sectorData.logChannelId) {
                    const logChannel = client.channels.cache.get(sectorData.logChannelId);
                    if (logChannel) logChannel.send(`🔨 <@${interaction.user.id}> قام بكسر إجازته والعودة للعمل في قطاع **${userLeave.sector}**!`);
                }
            }
        }
    }

    // ================== استقبال النماذج ==================
    if (interaction.isModalSubmit()) {

        // 1. تثبيت لوحة الإحصائيات التلقائية
        if (interaction.customId === 'modal_setup_stats') {
            const channelId = interaction.fields.getTextInputValue('channel_id');
            const channel = client.channels.cache.get(channelId);
            if (!channel) return interaction.reply({ content: '❌ لم يتم العثور على الروم. تأكد من الايدي.', ephemeral: true });

            const embed = new EmbedBuilder().setTitle('📊 جاري تحميل إحصائيات الإجازات...').setColor('Blue');
            const msg = await channel.send({ embeds: [embed] }).catch(() => null);
            
            if (!msg) return interaction.reply({ content: '❌ البوت لا يمتلك صلاحية للكتابة في هذا الروم.', ephemeral: true });

            db.statsChannelId = channelId;
            db.statsMessageId = msg.id;
            saveDB(db);
            updateStatsPanel(client, db); // تحديث المحتوى فوراً

            return interaction.reply({ content: '✅ تم تثبيت لوحة الإحصائيات بنجاح. سيتم تحديثها تلقائياً عند أي إجراء.', ephemeral: true });
        }

        // 2. طلب إجازة / تمديد (من العضو)
        if (interaction.customId.startsWith('modal_req_leave_') || interaction.customId.startsWith('modal_extend_')) {
            const isRequest = interaction.customId.startsWith('modal_req_leave_');
            const sector = interaction.customId.split('_').slice(3).join('_'); 
            
            const sectorData = db.sectors[sector];
            if (!sectorData || !sectorData.logChannelId) return interaction.reply({ content: '❌ لم يتم العثور على إعدادات روم الطلبات لهذا القطاع. تواصل مع الإدارة.', ephemeral: true });

            const logChannel = client.channels.cache.get(sectorData.logChannelId);
            if (!logChannel) return interaction.reply({ content: '❌ لم يتم العثور على روم طلبات القطاع.', ephemeral: true });

            const embed = new EmbedBuilder()
                .setTitle(isRequest ? '📩 طلب إجازة جديد يدعو لقبوله' : '📩 طلب تمديد إجازة يدعو لقبوله')
                .setColor('#2b2d31')
                .setFooter({ text: `Submitted by ${interaction.user.username} • ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' })}`, iconURL: interaction.user.displayAvatarURL() });

            if (isRequest) {
                embed.setDescription(`**From:** <@${interaction.user.id}> ( **${interaction.user.id}** ) \n\n**الاسم:**\n\`\`\`${interaction.fields.getTextInputValue('req_name')}\`\`\`\n**القطاع:**\n\`\`\`${sector}\`\`\`\n**المدة المطلوبة:**\n\`\`\`${interaction.fields.getTextInputValue('req_duration')}\`\`\`\n**السبب:**\n\`\`\`${interaction.fields.getTextInputValue('req_reason')}\`\`\``);
            } else {
                embed.setDescription(`**From:** <@${interaction.user.id}> ( **${interaction.user.id}** ) \n\n**القطاع:**\n\`\`\`${sector}\`\`\`\n**المدة الإضافية:**\n\`\`\`${interaction.fields.getTextInputValue('ext_duration')}\`\`\`\n**سبب التمديد:**\n\`\`\`${interaction.fields.getTextInputValue('ext_reason')}\`\`\``);
            }

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`accept_req_${interaction.user.id}_${sector}`).setLabel('قبول').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`reject_req_${interaction.user.id}_${sector}`).setLabel('رفض').setStyle(ButtonStyle.Danger)
            );

            await logChannel.send({ content: `<@&${sectorData.adminRoleId}>`, embeds: [embed], components: [buttons] });
            return interaction.reply({ content: '✅ تم إرسال طلبك لإدارة قطاعك بنجاح.', ephemeral: true });
        }

        // 3. قبول الطلب
        if (interaction.customId.startsWith('modal_accept_')) {
            const parts = interaction.customId.split('_');
            const userId = parts[2];
            const sector = parts.slice(3).join('_');
            const days = parseInt(interaction.fields.getTextInputValue('leave_days'));
            const timeStr = interaction.fields.getTextInputValue('end_time');

            if (isNaN(days) || days <= 0) return interaction.reply({ content: '❌ عدد الأيام غير صحيح.', ephemeral: true });
            if (!/^([01]?\d|2[0-3]):([0-5]\d)$/.test(timeStr)) return interaction.reply({ content: '❌ صيغة الوقت غير صحيحة (استخدم HH:MM).', ephemeral: true });

            const [hours, minutes] = timeStr.split(':').map(Number);
            const endDateObj = new Date();
            endDateObj.setDate(endDateObj.getDate() + days);
            endDateObj.setHours(hours, minutes, 0, 0);

            const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
            if (!targetMember) return interaction.reply({ content: '❌ العضو غير موجود بالسيرفر.', ephemeral: true });

            await targetMember.roles.add(db.sectors[sector].roleId).catch(() => null);
            db.leaves = db.leaves.filter(l => l.userId !== userId);
            db.leaves.push({ userId, guildId: interaction.guild.id, sector, endTime: endDateObj.getTime() });
            saveDB(db);
            updateStatsPanel(client, db); // تحديث الإحصائيات

            await targetMember.send(`✅ **تم قبول طلب إجازتك! سلم عتادك وسلمك العسكري.**\nالقطاع: ${sector}\nموعد الانتهاء: <t:${Math.floor(endDateObj.getTime() / 1000)}:F>`).catch(() => null);

            const embed = EmbedBuilder.from(interaction.message.embeds[0]).setColor('Green').addFields({ name: 'حالة الطلب', value: `✅ تم القبول بواسطة <@${interaction.user.id}>` });
            await interaction.message.edit({ embeds: [embed], components: [] });
            return interaction.reply({ content: '✅ تم القبول بنجاح.', ephemeral: true });
        }

        // 4. رفض الطلب
        if (interaction.customId.startsWith('modal_reject_')) {
            const parts = interaction.customId.split('_');
            const userId = parts[2];
            const reason = interaction.fields.getTextInputValue('reject_reason');

            const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
            if (targetMember) await targetMember.send(`❌ **تم رفض طلب إجازتك.**\nالسبب: ${reason}`).catch(() => null);

            const embed = EmbedBuilder.from(interaction.message.embeds[0]).setColor('Red').addFields({ name: 'حالة الطلب', value: `❌ تم الرفض بواسطة <@${interaction.user.id}>\nالسبب: ${reason}` });
            await interaction.message.edit({ embeds: [embed], components: [] });
            return interaction.reply({ content: '✅ تم الرفض وإشعار العضو.', ephemeral: true });
        }

        // أوامر الإدارة الأساسية
        if (interaction.customId === 'modal_add_sector') {
            const name = interaction.fields.getTextInputValue('sector_name');
            db.sectors[name] = { 
                employeeRoleId: interaction.fields.getTextInputValue('sector_emp_role'), 
                adminRoleId: interaction.fields.getTextInputValue('sector_admin_role'), 
                roleId: interaction.fields.getTextInputValue('sector_leave_role'), 
                logChannelId: interaction.fields.getTextInputValue('sector_log_channel') 
            };
            saveDB(db);
            return interaction.reply({ content: `✅ تم إضافة قطاع **${name}** بنجاح.`, ephemeral: true });
        }

        if (interaction.customId === 'modal_remove_sector') {
            const name = interaction.fields.getTextInputValue('sector_name');
            if (!db.sectors[name]) return interaction.reply({ content: `❌ القطاع غير موجود.`, ephemeral: true });
            delete db.sectors[name];
            saveDB(db);
            updateStatsPanel(client, db);
            return interaction.reply({ content: `✅ تم الحذف بنجاح.`, ephemeral: true });
        }

        if (interaction.customId === 'modal_grant_leave') {
            const userId = interaction.fields.getTextInputValue('user_id');
            const days = parseInt(interaction.fields.getTextInputValue('leave_days'));
            const timeStr = interaction.fields.getTextInputValue('end_time');

            if (isNaN(days) || days <= 0) return interaction.reply({ content: '❌ عدد الأيام غير صحيح.', ephemeral: true });
            if (!/^([01]?\d|2[0-3]):([0-5]\d)$/.test(timeStr)) return interaction.reply({ content: '❌ صيغة الوقت غير صحيحة.', ephemeral: true });

            const [hours, minutes] = timeStr.split(':').map(Number);
            const endDateObj = new Date();
            endDateObj.setDate(endDateObj.getDate() + days);
            endDateObj.setHours(hours, minutes, 0, 0);

            const member = await interaction.guild.members.fetch(userId).catch(() => null);
            if (!member) return interaction.reply({ content: '❌ لم يتم العثور على العضو.', ephemeral: true });

            let sector = null;
            for (const [sectorName, sectorData] of Object.entries(db.sectors)) {
                if (member.roles.cache.has(sectorData.employeeRoleId)) { sector = sectorName; break; }
            }
            if (!sector) return interaction.reply({ content: '❌ العضو لا يمتلك رتبة قطاع مسجل.', ephemeral: true });

            await member.roles.add(db.sectors[sector].roleId).catch(() => null);
            db.leaves = db.leaves.filter(l => l.userId !== userId);
            db.leaves.push({ userId, guildId: interaction.guild.id, sector, endTime: endDateObj.getTime() });
            saveDB(db);
            updateStatsPanel(client, db);

            return interaction.reply({ content: `✅ تم تفعيل إجازة العضو بنجاح.`, ephemeral: true });
        }

        // أوامر لوحة المسؤولين (تمديد - إلغاء)
        if (interaction.customId === 'modal_mgr_extend') {
            const userId = interaction.fields.getTextInputValue('user_id');
            const days = parseInt(interaction.fields.getTextInputValue('extra_days'));
            
            const leaveIndex = db.leaves.findIndex(l => l.userId === userId);
            if (leaveIndex === -1) return interaction.reply({ content: '❌ العضو ليس في إجازة.', ephemeral: true });

            db.leaves[leaveIndex].endTime += days * 24 * 60 * 60 * 1000;
            saveDB(db);
            updateStatsPanel(client, db);

            return interaction.reply({ content: `✅ تم تمديد الإجازة بنجاح.`, ephemeral: true });
        }

        if (interaction.customId === 'modal_mgr_cancel') {
            const userId = interaction.fields.getTextInputValue('user_id');
            const leaveIndex = db.leaves.findIndex(l => l.userId === userId);
            if (leaveIndex === -1) return interaction.reply({ content: '❌ العضو ليس في إجازة.', ephemeral: true });

            const sectorData = db.sectors[db.leaves[leaveIndex].sector];
            const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
            if (targetMember && sectorData) await targetMember.roles.remove(sectorData.roleId).catch(() => null);

            db.leaves.splice(leaveIndex, 1);
            saveDB(db);
            updateStatsPanel(client, db);

            return interaction.reply({ content: `✅ تم الإلغاء وسحب الرتبة.`, ephemeral: true });
        }
    }
});

function checkLeavesContinuously() {
    setInterval(async () => {
        const db = getDB();
        const now = Date.now();
        let updated = false;

        for (let i = 0; i < db.leaves.length; i++) {
            if (now >= db.leaves[i].endTime) {
                const leaveInfo = db.leaves[i];
                const guild = client.guilds.cache.get(leaveInfo.guildId);
                const sectorData = db.sectors[leaveInfo.sector];

                if (guild && sectorData && sectorData.roleId) {
                    const member = await guild.members.fetch(leaveInfo.userId).catch(() => null);
                    if (member) {
                        await member.roles.remove(sectorData.roleId).catch(() => null);
                        await member.send(`⏰ **انتهت إجازتك في قطاع ${leaveInfo.sector}، نتمنى لك عودة حميدة للعمل في Oblivion Town!**`).catch(() => null);
                    }
                }
                
                db.leaves.splice(i, 1);
                i--; 
                updated = true;
            }
        }
        if (updated) {
            saveDB(db);
            updateStatsPanel(client, db); // تحديث الإحصائيات إذا انتهت إجازة
        }
    }, 60000); 
}

client.login('MTM0MjI4ODUyODIwNTE1MjM3OQ.GRrZj1.qUXlQDKnThl5eg0DBw-fdQk6oJ-66Zi-c0w2YQ');