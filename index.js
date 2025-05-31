const {
    Client, GatewayIntentBits, Partials, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, SelectMenuBuilder,
    PermissionsBitField, ChannelType
} = require('discord.js');
const config = require('./config.json');
const { loadJson, saveJson, nextTicketNumber, getRoleLabel, parseDuration } = require('./utils');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions 
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User, Partials.Reaction]
});

let tickets = loadJson('./data/tickets.json');
let blacklist = loadJson('./data/blacklist.json');

client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    if (msg.content.startsWith('+tkst')) {
        const embed = new EmbedBuilder()
            .setTitle('فتح تذكرة جديدة')
            .setDescription('يرجى اختيار القسم المناسب لمشكلتك من القائمة بالأسفل.')
            .setColor('#5865F2');
        const menu = new ActionRowBuilder().addComponents(
            new SelectMenuBuilder()
                .setCustomId('ticket_category')
                .setPlaceholder('اختر القسم')
                .addOptions(Object.keys(config.categories).map(cat => ({
                    label: cat,
                    value: cat,
                })))
        );
        await msg.channel.send({ embeds: [embed], components: [menu] });
    }
});

client.on('messageCreate', async (msg) => {
    if (msg.guild || msg.author.bot) return;
    const userBlacklist = blacklist[msg.author.id];
    if (userBlacklist && userBlacklist.expiresAt > Date.now()) return;
    const userTicket = Object.values(tickets).find(t => t.ownerId === msg.author.id && t.status === 'open');
    if (userTicket) {
        try {
            const ticketsGuild = await client.guilds.fetch(config.ticketsGuildId);
            const channel = await ticketsGuild.channels.fetch(userTicket.channelId);
            if (channel) {
                await channel.send(`**${msg.author.username}** : ${msg.content}`);
            }
        } catch (err) {}
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isSelectMenu()) return;
    if (interaction.customId === 'ticket_category') {
        const userBlacklist = blacklist[interaction.user.id];
        if (userBlacklist && userBlacklist.expiresAt > Date.now()) {
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("Ticket System Notifications :")
                        .setDescription(`انت بلاك ليست ولايمكنك فتح تكت`)
                        .setColor("#d32f2f")
                ],
                ephemeral: true
            });
            return;
        }
        const userTicketChannelId = Object.values(tickets).find(t => t.ownerId === interaction.user.id && t.status === 'open')?.channelId;
        if (userTicketChannelId) {
            await interaction.reply({ content: 'لديك تذكرة مفتوحة بالفعل.', ephemeral: true });
            return;
        }
        const section = interaction.values[0];
        const ticketNumber = nextTicketNumber();
        const ticketsGuild = await client.guilds.fetch(config.ticketsGuildId);
        const catId = config.categories[section];
        const channel = await ticketsGuild.channels.create({
            name: `ticket-${ticketNumber}`,
            parent: catId,
            topic: `Ticket #${ticketNumber} by ${interaction.user.tag} (${interaction.user.id})`,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: ticketsGuild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
        });
        tickets[channel.id] = {
            number: ticketNumber,
            ownerId: interaction.user.id,
            section,
            channelId: channel.id,
            status: 'open',
            claimedBy: null,
            createdAt: Date.now()
        };
        saveJson('./data/tickets.json', tickets);
        await interaction.user.send(
            `تم إنشاء التذكرة الخاصة بِك . سيتم التواصل معك في اقرب وقت ممكن\nرقم التذكرة هو : ${ticketNumber}\nيرجى شرح مشكلتك بالتفاصيل وارسال الأدلة إن وجدت .`
        );
        await interaction.reply({ content: 'تم اختيار القسم وسيتم متابعة طلبك بالخاص.', ephemeral: true });

        const claimBtn = new ButtonBuilder().setCustomId('claim_ticket').setLabel('استلام التذكرة').setStyle(ButtonStyle.Primary);
        const closeBtn = new ButtonBuilder().setCustomId('close_ticket').setLabel('قفل التذكرة').setStyle(ButtonStyle.Danger);
        const row = new ActionRowBuilder().addComponents(claimBtn, closeBtn);
        await channel.send({
            content: `لإستلام التذكرة أو قفلها استخدم الأزرار أدناه`,
            components: [row]
        });
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    const ticket = tickets[interaction.channel.id];
    if (!ticket) return;

    if (interaction.customId === 'claim_ticket') {
        if (ticket.claimedBy) {
            return interaction.reply({ content: 'تم استلام التذكرة بالفعل', ephemeral: true });
        }
        ticket.claimedBy = interaction.user.id;
        saveJson('./data/tickets.json', tickets);
        const unclaimBtn = new ButtonBuilder().setCustomId('unclaim_ticket').setLabel('إلغاء الاستلام').setStyle(ButtonStyle.Secondary);
        const closeBtn = new ButtonBuilder().setCustomId('close_ticket').setLabel('قفل التذكرة').setStyle(ButtonStyle.Danger);
        await interaction.update({ content: `تم استلام التذكرة بواسطة <@${interaction.user.id}>`, components: [
            new ActionRowBuilder().addComponents(unclaimBtn, closeBtn)
        ] });
    }
    if (interaction.customId === 'unclaim_ticket') {
        if (!ticket.claimedBy) {
            return interaction.reply({ content: 'لا يوجد أحد مستلم التذكرة حالياً', ephemeral: true });
        }
        if (ticket.claimedBy !== interaction.user.id) {
            return interaction.reply({ content: 'فقط من استلم التذكرة يستطيع إلغاء الاستلام!', ephemeral: true });
        }
        ticket.claimedBy = null;
        saveJson('./data/tickets.json', tickets);
        const claimBtn = new ButtonBuilder().setCustomId('claim_ticket').setLabel('استلام التذكرة').setStyle(ButtonStyle.Primary);
        const closeBtn = new ButtonBuilder().setCustomId('close_ticket').setLabel('قفل التذكرة').setStyle(ButtonStyle.Danger);
        await interaction.update({ content: `لإستلام التذكرة أو قفلها استخدم الأزرار أدناه`, components: [
            new ActionRowBuilder().addComponents(claimBtn, closeBtn)
        ] });
    }
    if (interaction.customId === 'close_ticket') {
        if (ticket.status !== 'open') return interaction.reply({ content: "التذكرة مغلقة بالفعل!", ephemeral: true });
        ticket.status = 'closed';
        saveJson('./data/tickets.json', tickets);
        await interaction.channel.setParent(config.ticketClosedCategory).catch(()=>{});
        try {
            const closerMention = `<@${interaction.user.id}>`;
            const embed = new EmbedBuilder()
                .setTitle("تم قفل التذكرة")
                .setDescription(`تم قفل التذكرة الخاصة بك بواسطة ${closerMention}`)
                .setColor("#d32f2f");
            const user = await client.users.fetch(ticket.ownerId);
            await user.send({ embeds: [embed] });
        } catch (e) {}
        await interaction.update({ content: `تم قفل التذكرة بواسطة <@${interaction.user.id}>.`, components: [] });
    }
});

client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot || !msg.content.startsWith('-r')) return;
    const ticket = tickets[msg.channel.id];
    if (!ticket || ticket.status !== 'open') return;
    const replyText = msg.content.replace('-r', '').trim();
    if (!replyText) return msg.reply('يرجى كتابة الرسالة بعد -r');
    try {
        const ticketsGuild = await client.guilds.fetch(config.ticketsGuildId);
        const member = await ticketsGuild.members.fetch(msg.author.id);
        const roleLabel = getRoleLabel(member, config);
        const user = await client.users.fetch(ticket.ownerId);
        await user.send(`**${roleLabel}** : ${replyText}`);
        await msg.reply('تم إرسال الرد في الخاص.');
    } catch (err) {
        msg.reply('تعذر إرسال الرسالة في الخاص.');
    }
});

client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    if (!msg.content.startsWith('-crt')) return;
    const ticket = tickets[msg.channel.id];
    if (!ticket || ticket.status !== 'open') return;
    const args = msg.content.split(' ').slice(1);
    if (!args.length) return msg.reply('حدد وقت القفل! مثال: -cr 10m');
    const duration = parseDuration(args[0]);
    if (!duration) return msg.reply('الوقت غير صحيح! استخدم مثل 10m أو 2h أو 1d');
    await msg.channel.send(`سيتم قفل التذكرة تلقائياً بعد ${args[0]}.`);
    setTimeout(async () => {
        if (ticket.status !== 'open') return;
        ticket.status = "closed";
        saveJson('./data/tickets.json', tickets);
        await msg.channel.setParent(config.ticketClosedCategory).catch(()=>{});
        await msg.channel.send(`تم قفل التذكرة تلقائياً بواسطة <@${msg.author.id}>.`);
        try {
            const embed = new EmbedBuilder()
                .setTitle("تم قفل التذكرة")
                .setDescription(`تم قفل التذكرة الخاصة بك تلقائياً بواسطة <@${msg.author.id}>`)
                .setColor("#d32f2f");
            const user = await client.users.fetch(ticket.ownerId);
            await user.send({ embeds: [embed] });
        } catch (e) {}
    }, duration);
});

client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    const CEO_ROLE = config.roles.CEO;
    if (
        msg.content.startsWith('+black') ||
        msg.content.startsWith('+unblack')
    ) {
        if (!msg.member.roles.cache.has(CEO_ROLE)) return;
    }
    if (msg.content.startsWith('-black')) {
        const args = msg.content.split(' ').slice(1);
        const userId = args.shift();
        const durationText = args.pop();
        const reason = args.join(' ') || 'بدون سبب';
        if (!userId || !durationText) return msg.reply('الاستخدام: -black (ايدي) (سبب) (مدة مثل 1h 1d 1w)');
        const duration = parseDuration(durationText);
        if (!duration) return msg.reply('المدة غير صحيحة!');
        const member = await msg.guild.members.fetch(userId).catch(() => null);
        if (!member) return msg.reply('المستخدم غير موجود!');
        blacklist[userId] = {
            expiresAt: Date.now() + duration,
            reason,
            by: msg.author.id
        };
        saveJson('./data/blacklist.json', blacklist);
        await member.roles.add(config.blacklistRole).catch(() => {});
        const embed = new EmbedBuilder()
            .setTitle("Ticket System Notifications :")
            .setDescription(
                `تم وضعك في القائمة السوداء ولايمكنك فتح التذاكر حاليا\n` +
                `سيتم اخراجك من القائمة السوداء بعد (${durationText})\n` +
                `تم إعطائك بلاك ليست من طرف ${msg.author.tag}\n` +
                `السبب : ${reason}`
            ).setColor("#d32f2f");
        await member.send({ embeds: [embed] }).catch(() => {});
        await msg.reply('تم وضع المستخدم في البلاك ليست.');
    }
    if (msg.content.startsWith('-unblack')) {
        const args = msg.content.split(' ').slice(1);
        const userId = args.shift();
        const reason = args.join(' ') || 'بدون سبب';
        if (!userId) return msg.reply('الاستخدام: -unblack (ايدي) (سبب)');
        const member = await msg.guild.members.fetch(userId).catch(() => null);
        if (blacklist[userId]) delete blacklist[userId];
        saveJson('./data/blacklist.json', blacklist);
        if (member) {
            await member.roles.remove(config.blacklistRole).catch(() => {});
            const embed = new EmbedBuilder()
                .setTitle("Ticket System Notifications :")
                .setDescription(
                    `تم إزالتك من القائمة السوداء للتذاكر بطلب من المسؤولين\n` +
                    `السبب : ${reason}\n` +
                    `المسؤول : ${msg.author.tag}`
                ).setColor("#388e3c");
            await member.send({ embeds: [embed] }).catch(() => {});
        } else {
            // حتى لو غير موجود بالسيرفر توصل الخاص
            try {
                const user = await client.users.fetch(userId);
                const embed = new EmbedBuilder()
                    .setTitle("Ticket System Notifications :")
                    .setDescription(
                        `تم إزالتك من القائمة السوداء للتذاكر بطلب من المسؤولين\n` +
                        `السبب : ${reason}\n` +
                        `المسؤول : ${msg.author.tag}`
                    ).setColor("#388e3c");
                await user.send({ embeds: [embed] }).catch(() => {});
            } catch (e) {}
        }
        await msg.reply('تم إزالة البلاك ليست.');
    }
});

// ====== فك البلاك ليست تلقائيا ======
setInterval(async () => {
    const now = Date.now();
    for (const userId in blacklist) {
        if (blacklist[userId].expiresAt <= now) {
            const guild = await client.guilds.fetch(config.ticketsGuildId).catch(() => null);
            if (guild) {
                const member = await guild.members.fetch(userId).catch(() => null);
                if (member) {
                    await member.roles.remove(config.blacklistRole).catch(() => {});
                    const embed = new EmbedBuilder()
                        .setTitle("Ticket System Notifications :")
                        .setDescription(`تم ازالتك من القائمة السوداء بعد مرور المدة المختارة`)
                        .setColor("#388e3c");
                    await member.send({ embeds: [embed] }).catch(() => {});
                }
            }
            try {
                const user = await client.users.fetch(userId);
                const embed = new EmbedBuilder()
                    .setTitle("Ticket System Notifications :")
                    .setDescription(`تم ازالتك من القائمة السوداء بعد مرور المدة المختارة`)
                    .setColor("#388e3c");
                await user.send({ embeds: [embed] }).catch(() => {});
            } catch (e) {}
            delete blacklist[userId];
            saveJson('./data/blacklist.json', blacklist);
        }
    }
}, 30000);

const REACTION_MESSAGE_ID = '1378415657368162346';
const REACTION_ROLE_ID = config.reactionRoleId;
client.on('messageReactionAdd', async (reaction, user) => {
    if (reaction.partial) {
        try { await reaction.fetch(); } catch { return; }
    }
    if (user.bot) return;
    if (reaction.message.id !== REACTION_MESSAGE_ID) return;
    const guild = reaction.message.guild;
    if (!guild) return;
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;
    if (!member.roles.cache.has(REACTION_ROLE_ID)) {
        await member.roles.add(REACTION_ROLE_ID).catch(() => {});
    }
});

client.login('MTM3ODM5NTc3OTU3OTkwODE2Nw.G_zJFf.Ki1G8jpa0rE3B_tgqR-KqU0rkHC0c7HwWbkUW8');