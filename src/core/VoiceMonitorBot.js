const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { PrismaClient } = require('@prisma/client');
const cron = require('node-cron');
const Redis = require('ioredis');
const Logger = require('../utils/logger');
const ConfigManager = require('./ConfigManager');
const SessionManager = require('./SessionManager');
const CommandHandler = require('./CommandHandler');
const SetupWizard = require('./SetupWizard');
const BackupHandler = require('./BackupHandler');

class VoiceMonitorBot {
    constructor() {
        const databaseUrl = process.env.DATABASE_URL;
        
        if (!databaseUrl) {
            console.error('DATABASE_URL environment variable not set');
            process.exit(1);
        }

        this.prisma = new PrismaClient({ 
            log: ['error']
        });
        
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
            console.error('REDIS_URL environment variable not set');
            process.exit(1);
        }
        
        this.redis = new Redis(redisUrl, {
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
            enableOfflineQueue: true,
            maxRetriesPerRequest: 3,
            reconnectOnError: (err) => {
                const targetError = 'READONLY';
                if (err.message.includes(targetError)) {
                    return true;
                }
                return false;
            }
        });

        this.configManager = new ConfigManager(this.prisma, this.redis);
        this.sessionManager = new SessionManager(this.redis);
        
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildMembers
            ],
            failIfNotExists: false
        });

        this.logger = null;
        
        this.client.prisma = this.prisma;
        this.client.redis = this.redis;
        this.client.configManager = this.configManager;
        this.client.sessionManager = this.sessionManager;
        this.client.generateAndSendReport = this.generateAndSendReport.bind(this);
        this.client.generateReport = this.generateReport.bind(this);
        this.client.scheduleWeeklyReport = this.scheduleWeeklyReport.bind(this);
        this.client.updateCommandPermissions = this.updateCommandPermissions.bind(this);
        this.client.scheduledTasks = new Map();

        this.commandHandler = new CommandHandler(this.client);
        this.setupWizard = new SetupWizard(this.client);
        this.client.setupWizard = this.setupWizard;
        this.backupHandler = new BackupHandler(this.client);
        this.client.backupHandler = this.backupHandler;
        
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.redis.on('connect', () => console.log('Redis connected'));
        this.redis.on('error', (err) => console.error('Redis error:', err));
        this.redis.on('ready', () => console.log('Redis ready'));
        
        this.client.once('ready', () => this.onReady());
        this.client.on('guildCreate', (guild) => this.onGuildCreate(guild));
        this.client.on('guildDelete', (guild) => this.onGuildDelete(guild));
        this.client.on('voiceStateUpdate', (oldState, newState) => this.onVoiceStateUpdate(oldState, newState));
        this.client.on('interactionCreate', (interaction) => this.commandHandler.handleInteraction(interaction));
        
        this.client.on('error', (error) => {
            if (this.logger) {
                this.logger.error('Discord client error', error);
            } else {
                console.error('Discord client error:', error);
            }
        });
        
        process.on('unhandledRejection', (error) => {
            if (this.logger) {
                this.logger.error('Unhandled promise rejection', error);
            } else {
                console.error('Unhandled promise rejection:', error);
            }
        });
    }

    async onReady() {
        this.logger = new Logger(this.client, this.redis);
        this.client.logger = this.logger;
        
        this.logger.info(`Bot logged in as ${this.client.user.tag}`);
        this.logger.info(`Serving ${this.client.guilds.cache.size} guilds`);
        
        await this.commandHandler.loadCommands();
        
        for (const [guild] of this.client.guilds.cache) {
            await this.setupGuild(guild);
        }
        
        await this.syncAllGuilds();
        
        this.backupHandler.startBackupSchedule();
        
        setInterval(async () => {
            const activeSessionCount = await this.redis.keys('voice:*:active:*');
            if (activeSessionCount.length > 0) {
                this.logger.debug(`Active voice sessions: ${activeSessionCount.length}`);
            }
            
            const cutoff = Date.now() - (60 * 24 * 60 * 60 * 1000);
            for (const [guildId, guild] of this.client.guilds.cache) {
                const removed = await this.redis.zremrangebyscore(
                    `voice:${guildId}:completed`,
                    0,
                    cutoff
                );
                if (removed > 0) {
                    this.logger.info(`Cleaned up ${removed} sessions older than 60 days`, { guild });
                }
            }
        }, 30 * 60 * 1000);
    }

    async onGuildCreate(guild) {
        this.logger.info(`Joined new guild: ${guild.name} (${guild.id})`);
        
        try {
            const existingConfig = await this.prisma.serverConfig.findUnique({
                where: { guildId: guild.id }
            });
            
            if (!existingConfig) {
                const defaultConfig = {
                    guildId: guild.id,
                    trackingRoleName: 'Voice Active',
                    commandRoleId: null,
                    reportChannelId: null,
                    reportRecipients: [],
                    excludedChannelIds: [],
                    minSessionMinutes: 20,
                    rejoinWindowMinutes: 20,
                    weeklyReportEnabled: true,
                    weeklyReportDay: 0,
                    weeklyReportHour: 9,
                    antiCheatEnabled: true,
                    minUsersInChannel: 2
                };
                
                await this.prisma.serverConfig.create({
                    data: defaultConfig
                });
            }
            
            await this.configManager.refreshCache(guild.id);
            await this.setupGuild(guild);
            
            const welcomeEmbed = new EmbedBuilder()
                .setTitle('👋 Thanks for adding GW2 Eternal VAT')
                .setDescription('I track voice channel activity for guild members')
                .addFields(
                    { name: 'Setup', value: 'Use `/setup` to configure the bot for your server' },
                    { name: 'Commands', value: 'Use `/help` to see all available commands' }
                )
                .setColor(0x00FF88)
                .setTimestamp()
                .setThumbnail('https://static.staticwars.com/quaggans/party.jpg');
            
            const channel = guild.systemChannel || guild.channels.cache.find(
                ch => ch.type === 0 && ch.permissionsFor(guild.members.me).has('SendMessages')
            );
            
            if (channel) {
                await channel.send({ embeds: [welcomeEmbed] });
            }
        } catch (error) {
            this.logger.error(`Failed to setup guild ${guild.id}`, error, { guild });
        }
    }

    async onGuildDelete(guild) {
        this.logger.info(`Left guild: ${guild.name} (${guild.id})`);
        
        const task = this.client.scheduledTasks.get(guild.id);
        if (task) {
            task.stop();
            this.client.scheduledTasks.delete(guild.id);
        }
        
        if (process.env.DELETE_DATA_ON_LEAVE === 'true') {
            await this.cleanupGuildData(guild.id);
        }
    }

    async setupGuild(guild) {
        const config = await this.configManager.getServerConfig(guild.id);
        if (!config) return;
        
        try {
            let commands;
            if (guild.id === process.env.DEV_SERVER_ID) {
                commands = [
                    ...Array.from(this.commandHandler.commands.values()).map(cmd => cmd.data),
                    ...Array.from(this.commandHandler.devCommands.values()).map(cmd => cmd.data)
                ];
                this.logger.info(`Registered commands + dev commands for dev server: ${guild.name}`);
            } else {
                commands = Array.from(this.commandHandler.commands.values()).map(cmd => cmd.data);
                this.logger.info(`Registered commands for guild: ${guild.name}`);
            }
            
            await guild.commands.set(commands);
            
            if (config.commandRoleId) {
                const role = guild.roles.cache.get(config.commandRoleId);
                if (role) {
                    await this.updateCommandPermissions(guild, role);
                }
            }
        } catch (error) {
            this.logger.error(`Failed to register commands for guild ${guild.id}`, error, { guild });
        }
        
        if (config.weeklyReportEnabled) {
            this.scheduleWeeklyReport(guild.id, config);
        }
    }

    async updateCommandPermissions(guild, commandRole) {
        try {
            const targetPermission = PermissionFlagsBits.ManageMessages;
            
            this.logger.info(`Setting command permissions for role: ${commandRole.name}`, { guild });
            
            let commands;
            if (guild.id === process.env.DEV_SERVER_ID) {
                commands = [
                    ...Array.from(this.commandHandler.commands.values()),
                    ...Array.from(this.commandHandler.devCommands.values())
                ];
            } else {
                commands = Array.from(this.commandHandler.commands.values());
            }
            
            const commandData = commands.map(cmd => {
                const data = cmd.data;
                if (data.name !== 'setup' && !cmd.isDev) {
                    data.setDefaultMemberPermissions(targetPermission);
                }
                return data;
            });
            
            await guild.commands.set(commandData);
            this.logger.info('Command permissions updated successfully', { guild });
        } catch (error) {
            this.logger.error('Failed to update command permissions', error, { guild });
        }
    }

    scheduleWeeklyReport(guildId, config) {
        const existingTask = this.client.scheduledTasks.get(guildId);
        if (existingTask) {
            existingTask.stop();
        }
        
        const guild = this.client.guilds.cache.get(guildId);
        const guildName = guild ? guild.name : 'Unknown';
        
        const cronExpression = `0 ${config.weeklyReportHour} * * ${config.weeklyReportDay}`;
        const task = cron.schedule(cronExpression, async () => {
            await this.generateAndSendReport(guildId, 7);
        });
        
        this.client.scheduledTasks.set(guildId, task);
        this.logger.info(`Scheduled weekly report for ${guildName} (${guildId})`);
    }

    async onVoiceStateUpdate(oldState, newState) {
        if (!newState.guild) return;
        
        try {
            const config = await this.configManager.getServerConfig(newState.guild.id);
            if (!config) return;
            
            const member = newState.member;
            if (!member || member.user.bot) return;
            
            const trackingRole = newState.guild.roles.cache.find(
                role => role.name === config.trackingRoleName
            );
            
            if (!trackingRole || !member.roles.cache.has(trackingRole.id)) return;
            
            const guildId = newState.guild.id;
            const userId = member.id;
            const displayName = member.displayName || member.user.username;
            
            const isExcluded = (channel) => {
                return channel && config.excludedChannelIds && config.excludedChannelIds.includes(channel.id);
            };
            
            const meetsMinUserRequirement = (channel) => {
                if (!config.antiCheatEnabled || !config.minUsersInChannel) return true;
                const nonBotMembers = channel.members.filter(m => !m.user.bot).size;
                return nonBotMembers >= config.minUsersInChannel;
            };
            
            const isDeafened = newState.selfDeaf || newState.serverDeaf;
            const wasDeafened = oldState.selfDeaf || oldState.serverDeaf;
            
            if (oldState.channel && newState.channel && oldState.channel.id === newState.channel.id) {
                if (!wasDeafened && isDeafened) {
                    this.logger.voice('deafened', member, newState.guild);
                    await this.sessionManager.pauseSession(guildId, userId, 'deafened');
                    return;
                } else if (wasDeafened && !isDeafened) {
                    if (!isExcluded(newState.channel) && meetsMinUserRequirement(newState.channel)) {
                        this.logger.voice('undeafened', member, newState.guild);
                        await this.sessionManager.resumeSession(guildId, userId, displayName);
                    }
                    return;
                }
                
                if (oldState.selfMute !== newState.selfMute) {
                    await this.sessionManager.updateMuteStatus(guildId, userId, newState.selfMute);
                }
                return;
            }
            
            if (!oldState.channel && newState.channel && !isExcluded(newState.channel)) {
                if (!meetsMinUserRequirement(newState.channel)) {
                    this.logger.voice('joined but not enough users', member, newState.guild);
                    return;
                }
                
                if (isDeafened) {
                    this.logger.voice('joined but deafened', member, newState.guild);
                    return;
                }
                
                this.logger.voice('joined', member, newState.guild);
                
                const recentSession = await this.sessionManager.getRecentSession(guildId, userId);
                if (recentSession) {
                    await this.sessionManager.resumeSession(guildId, userId, displayName);
                    await this.sessionManager.removeCompletedSession(guildId, recentSession);
                } else {
                    await this.sessionManager.startSession(guildId, userId, displayName, newState.selfMute);
                }
            }
            else if ((oldState.channel && !newState.channel) || (!isExcluded(oldState.channel) && isExcluded(newState.channel))) {
                this.logger.voice('left', member, newState.guild);
                await this.sessionManager.endSession(guildId, userId);
            }
            else if (isExcluded(oldState.channel) && newState.channel && !isExcluded(newState.channel)) {
                if (!meetsMinUserRequirement(newState.channel)) {
                    this.logger.voice('moved but not enough users', member, newState.guild);
                    return;
                }
                
                if (isDeafened) {
                    this.logger.voice('moved but deafened', member, newState.guild);
                    return;
                }
                
                this.logger.voice('moved from excluded to tracked channel', member, newState.guild);
                
                const recentSession = await this.sessionManager.getRecentSession(guildId, userId);
                if (recentSession) {
                    await this.sessionManager.resumeSession(guildId, userId, displayName);
                    await this.sessionManager.removeCompletedSession(guildId, recentSession);
                } else {
                    await this.sessionManager.startSession(guildId, userId, displayName, newState.selfMute);
                }
            }
            
            if (oldState.channel && config.antiCheatEnabled && config.minUsersInChannel) {
                const nonBotMembers = oldState.channel.members.filter(m => !m.user.bot).size;
                if (nonBotMembers < config.minUsersInChannel) {
                    for (const [memberId, channelMember] of oldState.channel.members) {
                        if (!channelMember.user.bot && memberId !== userId) {
                            await this.sessionManager.endSession(guildId, memberId);
                            this.logger.voice('ended due to insufficient users', channelMember, newState.guild);
                        }
                    }
                }
            }
        } catch (error) {
            this.logger.error('Error in voice state update', error, { guild: newState.guild });
        }
    }

    async syncAllGuilds() {
        this.logger.info('Syncing voice states across all guilds');
        
        for (const [guild] of this.client.guilds.cache) {
            await this.syncGuildVoiceStates(guild);
        }
    }

    async syncGuildVoiceStates(guild) {
        try {
            const config = await this.configManager.getServerConfig(guild.id);
            if (!config) return;
            
            const trackingRole = guild.roles.cache.find(
                role => role.name === config.trackingRoleName
            );
            
            if (!trackingRole) return;
            
            const activeSessionKeys = await this.redis.keys(`voice:${guild.id}:active:*`);
            const pausedSessionKeys = await this.redis.keys(`voice:${guild.id}:paused:*`);
            
            for (const key of activeSessionKeys) {
                const sessionData = await this.redis.get(key);
                if (!sessionData) continue;
                
                const session = JSON.parse(sessionData);
                const member = await guild.members.fetch(session.userId).catch(() => null);
                
                const isInVoice = member && 
                                 member.voice.channel && 
                                 member.roles.cache.has(trackingRole.id);
                const isExcluded = member?.voice.channel && 
                                  config.excludedChannelIds && 
                                  config.excludedChannelIds.includes(member.voice.channel.id);
                const isDeafened = member && (member.voice.selfDeaf || member.voice.serverDeaf);
                
                const channelMemberCount = member?.voice.channel 
                    ? member.voice.channel.members.filter(m => !m.user.bot).size 
                    : 0;
                const meetsMinUsers = !config.antiCheatEnabled || 
                                    !config.minUsersInChannel || 
                                    channelMemberCount >= config.minUsersInChannel;
                
                if (!isInVoice || isExcluded || isDeafened || !meetsMinUsers) {
                    await this.sessionManager.endSession(guild.id, session.userId);
                    this.logger.info(`Ended stale session for ${session.displayName}`, { guild });
                }
            }
            
            for (const key of pausedSessionKeys) {
                const sessionData = await this.redis.get(key);
                if (!sessionData) continue;
                
                const session = JSON.parse(sessionData);
                const member = await guild.members.fetch(session.userId).catch(() => null);
                
                if (!member || !member.voice.channel) {
                    await this.redis.del(key);
                    this.logger.info(`Cleaned up paused session for ${session.displayName}`, { guild });
                }
            }
            
            for (const [channelId, channel] of guild.channels.cache) {
                if (channel.type === 2) {
                    if (config.excludedChannelIds && config.excludedChannelIds.includes(channelId)) {
                        continue;
                    }
                    
                    const nonBotMembers = channel.members.filter(m => !m.user.bot).size;
                    if (config.antiCheatEnabled && config.minUsersInChannel && nonBotMembers < config.minUsersInChannel) {
                        continue;
                    }
                    
                    for (const [memberId, member] of channel.members) {
                        if (!member.user.bot && 
                            member.roles.cache.has(trackingRole.id) && 
                            !member.voice.selfDeaf && 
                            !member.voice.serverDeaf) {
                            const existingSession = await this.redis.get(`voice:${guild.id}:active:${memberId}`);
                            if (!existingSession) {
                                await this.sessionManager.startSession(
                                    guild.id,
                                    memberId,
                                    member.displayName || member.user.username,
                                    member.voice.selfMute
                                );
                                this.logger.info(`Started session for ${member.displayName}`, { guild });
                            }
                        }
                    }
                }
            }
        } catch (error) {
            this.logger.error('Error syncing voice states', error, { guild });
        }
    }

    async generateAndSendReport(guildId, days) {
        try {
            const guild = this.client.guilds.cache.get(guildId);
            if (!guild) return;
            
            const config = await this.configManager.getServerConfig(guildId);
            if (!config) return;
            
            const report = await this.generateReport(guild, config, days);
            
            for (const recipient of config.reportRecipients) {
                try {
                    if (recipient.startsWith('c:')) {
                        const channelId = recipient.substring(2);
                        const channel = await this.client.channels.fetch(channelId);
                        if (channel?.isTextBased()) {
                            await channel.send({ embeds: [report] });
                        }
                    } else {
                        const user = await this.client.users.fetch(recipient);
                        await user.send({ embeds: [report] });
                    }
                } catch (error) {
                    this.logger.error(`Failed to send report to ${recipient}`, error, { guild });
                }
            }
            
            this.logger.report('Scheduled', guild, days, config.reportRecipients);
            
            await this.prisma.reportLog.create({
                data: {
                    guildId,
                    reportType: 'scheduled',
                    days,
                    sentTo: config.reportRecipients,
                    success: true
                }
            }).catch(err => this.logger.error('Failed to log report', err));
            
        } catch (error) {
            this.logger.error(`Failed to generate report for guild ${guildId}`, error);
            
            await this.prisma.reportLog.create({
                data: {
                    guildId,
                    reportType: 'scheduled',
                    days,
                    sentTo: [],
                    success: false,
                    error: error.message
                }
            }).catch(err => this.logger.error('Failed to log report error', err));
        }
    }

    async generateReport(guild, config, days) {
        const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
        const trackingRole = guild.roles.cache.find(
            role => role.name === config.trackingRoleName
        );
        
        if (!trackingRole) {
            return new EmbedBuilder()
                .setTitle('❌ Report Error')
                .setDescription(`Tracking role "${config.trackingRoleName}" not found`)
                .setColor(0xFF0000)
                .setTimestamp();
        }
        
        await guild.members.fetch();
        const trackedMembers = new Map();
        
        guild.members.cache.forEach(member => {
            if (!member.user.bot && member.roles.cache.has(trackingRole.id)) {
                trackedMembers.set(member.id, member.displayName || member.user.username);
            }
        });
        
        const userActivity = new Map();
        const userMuteStats = new Map();
        
        const completedSessions = await this.redis.zrangebyscore(
            `voice:${guild.id}:completed`,
            cutoff,
            Date.now()
        );
        
        for (const sessionStr of completedSessions) {
            const session = JSON.parse(sessionStr);
            if (trackedMembers.has(session.userId)) {
                const current = userActivity.get(session.userId) || 0;
                userActivity.set(session.userId, current + session.totalTime);
                
                if (!userMuteStats.has(session.userId)) {
                    userMuteStats.set(session.userId, { mutedTime: 0, totalTime: 0 });
                }
                const muteStats = userMuteStats.get(session.userId);
                muteStats.mutedTime += session.mutedTime || 0;
                muteStats.totalTime += session.totalTime;
            }
        }
        
        const activeSessionKeys = await this.redis.keys(`voice:${guild.id}:active:*`);
        const now = Date.now();
        
        for (const key of activeSessionKeys) {
            const sessionData = await this.redis.get(key);
            if (!sessionData) continue;
            
            const session = JSON.parse(sessionData);
            if (trackedMembers.has(session.userId)) {
                const totalTime = now - session.startTime + (session.totalTime || 0);
                const current = userActivity.get(session.userId) || 0;
                userActivity.set(session.userId, current + totalTime);
                
                if (!userMuteStats.has(session.userId)) {
                    userMuteStats.set(session.userId, { mutedTime: 0, totalTime: 0 });
                }
                const muteStats = userMuteStats.get(session.userId);
                
                const timeSinceLastCheck = now - session.lastMuteCheck;
                const currentMutedTime = (session.mutedTime || 0) + (session.isMuted ? timeSinceLastCheck : 0);
                
                muteStats.mutedTime += currentMutedTime;
                muteStats.totalTime += totalTime;
            }
        }
        
        const activeUsers = Array.from(userActivity.entries())
            .map(([userId, time]) => {
                const muteStats = userMuteStats.get(userId) || { mutedTime: 0, totalTime: time };
                const mutePercentage = muteStats.totalTime > 0 
                    ? Math.round((muteStats.mutedTime / muteStats.totalTime) * 100)
                    : 0;
                
                return {
                    displayName: trackedMembers.get(userId),
                    time: this.formatDuration(time),
                    rawTime: time,
                    mutePercentage
                };
            })
            .sort((a, b) => b.rawTime - a.rawTime);
        
        const inactiveUsers = Array.from(trackedMembers.entries())
            .filter(([userId]) => !userActivity.has(userId))
            .map(([_, displayName]) => displayName)
            .sort();
        
        const totalTracked = activeUsers.length + inactiveUsers.length;
        const activityRate = totalTracked > 0 ? Math.round((activeUsers.length / totalTracked) * 100) : 0;
        
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - (days * 24 * 60 * 60 * 1000));
        const formatDate = (date) => {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
        };
        const dateRangeText = `${formatDate(startDate)} - ${formatDate(endDate)}`;
        
        const embed = new EmbedBuilder()
            .setTitle(`📊 ${days === 7 ? 'Weekly' : `${days}-Day`} Voice Activity Report`)
            .setDescription(`📍 **Tracking Role:** \`${trackingRole.name}\`\n📅 **Period:** Last ${days} days`)
            .setColor(0x00FF88)
            .setTimestamp()
            .setFooter({ text: dateRangeText })
            .setThumbnail(guild.iconURL());
        
        if (config.antiCheatEnabled) {
            embed.addFields({
                name: '🛡️ Anti-Cheat Status',
                value: `**Min Users Required:** ${config.minUsersInChannel || 2}\n` +
                       '**Deafened Detection:** Enabled\n' +
                       '**Mute Tracking:** Enabled',
                inline: false
            });
        }
        
        embed.addFields({
            name: '📈 Statistics',
            value: `**Active Users:** ${activeUsers.length} (${activityRate}%)\n` +
                   `**Inactive Users:** ${inactiveUsers.length} (${100 - activityRate}%)\n` +
                   `**Total Tracked:** ${totalTracked}`,
            inline: false
        });
        
        embed.addFields({
            name: '\u200B',
            value: '────────────────────────────────',
            inline: false
        });
        
        if (activeUsers.length > 0) {
            let activeList = '';
            activeUsers.forEach((u) => {
                const muteIndicator = u.mutePercentage > 80 ? ' 🔇' : '';
                const muteInfo = u.mutePercentage > 0 ? ` (${u.mutePercentage}% muted)${muteIndicator}` : '';
                activeList += `${u.displayName} ─ \`${u.time}\`${muteInfo}\n`;
            });
            
            const chunks = [];
            const lines = activeList.split('\n').filter(line => line.trim());
            let currentChunk = '';
            
            for (const line of lines) {
                if ((currentChunk + line + '\n').length > 1000) {
                    chunks.push(currentChunk.trim());
                    currentChunk = line + '\n';
                } else {
                    currentChunk += line + '\n';
                }
            }
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
            }
            
            chunks.forEach((chunk, index) => {
                embed.addFields({
                    name: index === 0 ? `✅ Active Users (${activeUsers.length})` : '\u200B',
                    value: chunk,
                    inline: false
                });
            });
        } else {
            embed.addFields({
                name: '✅ Active Users',
                value: '*No active users this period*',
                inline: false
            });
        }
        
        embed.addFields({
            name: '\u200B',
            value: '────────────────────────────────',
            inline: false
        });
        
        if (inactiveUsers.length > 0) {
            const chunks = [];
            let currentChunk = '';
            
            inactiveUsers.forEach((user) => {
                const userLine = `• ${user}\n`;
                
                if ((currentChunk + userLine).length > 1000) {
                    chunks.push(currentChunk.trim());
                    currentChunk = userLine;
                } else {
                    currentChunk += userLine;
                }
            });
            
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
            }
            
            chunks.forEach((chunk, index) => {
                embed.addFields({
                    name: index === 0 ? `❌ Inactive Users (${inactiveUsers.length})` : '\u200B',
                    value: chunk,
                    inline: false
                });
            });
        }
        
        return embed;
    }

    formatDuration(ms) {
        const hours = Math.floor(ms / (60 * 60 * 1000));
        const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
        return `${hours}h ${minutes}m`;
    }

    async cleanupGuildData(guildId) {
        this.logger.info(`Cleaning up data for guild ${guildId}`);
        
        const keys = await this.redis.keys(`voice:${guildId}:*`);
        if (keys.length > 0) {
            await this.redis.del(...keys);
        }
        
        await this.prisma.serverConfig.delete({
            where: { guildId }
        }).catch(() => {});
        
        await this.configManager.clearCache(guildId);
    }

    async start() {
        const token = process.env.DISCORD_TOKEN;
        if (!token) {
            console.error('DISCORD_TOKEN environment variable not set');
            process.exit(1);
        }
        
        await new Promise((resolve) => {
            if (this.redis.status === 'ready') {
                resolve();
            } else {
                this.redis.once('ready', resolve);
            }
        });
        
        await this.client.login(token);
    }

    async shutdown() {
        if (this.logger) {
            this.logger.info('Shutting down bot');
        } else {
            console.log('Shutting down bot');
        }
        
        for (const task of this.client.scheduledTasks.values()) {
            task.stop();
        }
        
        this.client.destroy();
        
        await this.prisma.$disconnect();
        
        this.redis.disconnect();
        
        if (this.logger) {
            this.logger.info('Shutdown complete');
        } else {
            console.log('Shutdown complete');
        }
    }
}

module.exports = VoiceMonitorBot;