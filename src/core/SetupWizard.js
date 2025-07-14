const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, UserSelectMenuBuilder, ChannelType } = require('discord.js');

class SetupWizard {
    constructor(client) {
        this.client = client;
        this.steps = [
            'welcome',
            'trackingRole',
            'reportRecipients', 
            'commandPermissions',
            'excludedChannels',
            'sessionSettings',
            'weeklyReports',
            'timezone',
            'review'
        ];
        
        this.timezones = [
            { label: 'UTC-12:00 (Baker Island)', value: 'UTC-12' },
            { label: 'UTC-11:00 (American Samoa)', value: 'UTC-11' },
            { label: 'UTC-10:00 (Hawaii)', value: 'UTC-10' },
            { label: 'UTC-09:00 (Alaska)', value: 'UTC-9' },
            { label: 'UTC-08:00 (Pacific Time)', value: 'UTC-8' },
            { label: 'UTC-07:00 (Mountain Time)', value: 'UTC-7' },
            { label: 'UTC-06:00 (Central Time)', value: 'UTC-6' },
            { label: 'UTC-05:00 (Eastern Time)', value: 'UTC-5' },
            { label: 'UTC-04:00 (Atlantic Time)', value: 'UTC-4' },
            { label: 'UTC-03:00 (Argentina)', value: 'UTC-3' },
            { label: 'UTC-02:00 (Mid-Atlantic)', value: 'UTC-2' },
            { label: 'UTC-01:00 (Azores)', value: 'UTC-1' },
            { label: 'UTC+00:00 (London)', value: 'UTC+0' },
            { label: 'UTC+01:00 (Berlin)', value: 'UTC+1' },
            { label: 'UTC+02:00 (Cairo)', value: 'UTC+2' },
            { label: 'UTC+03:00 (Moscow)', value: 'UTC+3' },
            { label: 'UTC+04:00 (Dubai)', value: 'UTC+4' },
            { label: 'UTC+05:00 (Pakistan)', value: 'UTC+5' },
            { label: 'UTC+05:30 (India)', value: 'UTC+5.5' },
            { label: 'UTC+06:00 (Bangladesh)', value: 'UTC+6' },
            { label: 'UTC+07:00 (Bangkok)', value: 'UTC+7' },
            { label: 'UTC+08:00 (Singapore)', value: 'UTC+8' },
            { label: 'UTC+09:00 (Tokyo)', value: 'UTC+9' },
            { label: 'UTC+10:00 (Sydney)', value: 'UTC+10' },
            { label: 'UTC+11:00 (Solomon Islands)', value: 'UTC+11' },
            { label: 'UTC+12:00 (New Zealand)', value: 'UTC+12' }
        ];
        
        this.timezonePages = [];
        for (let i = 0; i < this.timezones.length; i += 10) {
            this.timezonePages.push(this.timezones.slice(i, i + 10));
        }
    }

    async handleInteraction(interaction) {
        const customId = interaction.customId;
        const [action, ...params] = customId.split('_');
        
        if (action !== 'setup') return false;
        
        const setupKey = `setup:${interaction.guildId}:${interaction.user.id}`;
        const stateData = await this.client.redis.get(setupKey);
        
        if (!stateData) {
            await interaction.reply({ 
                content: 'Setup session expired. Please run `/setup` again.', 
                ephemeral: true 
            });
            return true;
        }
        
        const state = JSON.parse(stateData);
        
        switch (params[0]) {
            case 'start':
                await this.showTrackingRole(interaction, state);
                break;
            case 'cancel':
                await this.cancelSetup(interaction, setupKey);
                break;
            case 'back':
                await this.goBack(interaction, state);
                break;
            case 'role':
                await this.handleRoleSelection(interaction, state);
                break;
            case 'recipients':
                await this.handleRecipientSelection(interaction, state);
                break;
            case 'permissions':
                await this.handlePermissionSelection(interaction, state);
                break;
            case 'excluded':
                await this.handleExcludedChannels(interaction, state);
                break;
            case 'session':
                await this.handleSessionSettings(interaction, state);
                break;
            case 'weekly':
                await this.handleWeeklyReports(interaction, state);
                break;
            case 'timezone':
                await this.handleTimezone(interaction, state);
                break;
            case 'confirm':
                await this.confirmSetup(interaction, state);
                break;
        }
        
        return true;
    }

    async showTrackingRole(interaction, state) {
        state.step = 1;
        await this.saveState(state);
        
        const embed = new EmbedBuilder()
            .setTitle('Step 1: Tracking Role')
            .setDescription('Select the role that identifies members whose voice activity should be tracked.')
            .setColor(0x0099FF)
            .setFooter({ text: 'Step 1 of 8' });
        
        const row = new ActionRowBuilder()
            .addComponents(
                new RoleSelectMenuBuilder()
                    .setCustomId(`setup_role_${interaction.guildId}`)
                    .setPlaceholder('Select tracking role')
            );
        
        const buttonRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`setup_cancel_${interaction.guildId}`)
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Danger)
            );
        
        await interaction.update({ 
            embeds: [embed], 
            components: [row, buttonRow] 
        });
    }

    async handleRoleSelection(interaction, state) {
        const roleId = interaction.values[0];
        const role = interaction.guild.roles.cache.get(roleId);
        
        state.config.trackingRoleName = role.name;
        state.config.trackingRoleId = roleId;
        
        await this.saveState(state);
        await this.showReportRecipients(interaction, state);
    }

    async showReportRecipients(interaction, state) {
        state.step = 2;
        await this.saveState(state);
        
        const embed = new EmbedBuilder()
            .setTitle('Step 2: Report Recipients')
            .setDescription('Choose where voice activity reports should be sent.\nYou can select multiple channels and users.')
            .setColor(0x0099FF)
            .setFooter({ text: 'Step 2 of 8' });
        
        if (state.config.reportRecipients && state.config.reportRecipients.length > 0) {
            const recipients = state.config.reportRecipients.map(r => {
                if (r.startsWith('c:')) return `<#${r.substring(2)}>`;
                return `<@${r}>`;
            });
            embed.addFields({ name: 'Current Recipients', value: recipients.join(', ') });
        }
        
        const channelRow = new ActionRowBuilder()
            .addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId(`setup_recipients_channel_${interaction.guildId}`)
                    .setPlaceholder('Select report channels')
                    .setChannelTypes(ChannelType.GuildText)
                    .setMinValues(0)
                    .setMaxValues(5)
            );
        
        const userRow = new ActionRowBuilder()
            .addComponents(
                new UserSelectMenuBuilder()
                    .setCustomId(`setup_recipients_user_${interaction.guildId}`)
                    .setPlaceholder('Select users for DM reports')
                    .setMinValues(0)
                    .setMaxValues(5)
            );
        
        const buttonRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`setup_back_${interaction.guildId}`)
                    .setLabel('Back')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`setup_recipients_next_${interaction.guildId}`)
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`setup_cancel_${interaction.guildId}`)
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Danger)
            );
        
        await interaction.update({ 
            embeds: [embed], 
            components: [channelRow, userRow, buttonRow] 
        });
    }

    async handleRecipientSelection(interaction, state) {
        const type = interaction.customId.split('_')[2];
        
        if (type === 'channel') {
            const channels = interaction.values.map(id => `c:${id}`);
            state.config.reportChannels = channels;
        } else if (type === 'user') {
            state.config.reportUsers = interaction.values;
        } else if (type === 'next') {
            state.config.reportRecipients = [
                ...(state.config.reportChannels || []),
                ...(state.config.reportUsers || [])
            ];
            await this.saveState(state);
            await this.showCommandPermissions(interaction, state);
            return;
        }
        
        await this.saveState(state);
        await interaction.deferUpdate();
    }

    async showCommandPermissions(interaction, state) {
        state.step = 3;
        await this.saveState(state);
        
        const embed = new EmbedBuilder()
            .setTitle('Step 3: Command Permissions')
            .setDescription('Configure who can use bot commands and where.')
            .setColor(0x0099FF)
            .setFooter({ text: 'Step 3 of 8' });
        
        const roleRow = new ActionRowBuilder()
            .addComponents(
                new RoleSelectMenuBuilder()
                    .setCustomId(`setup_permissions_role_${interaction.guildId}`)
                    .setPlaceholder('Select role that can use commands (optional)')
                    .setMinValues(0)
                    .setMaxValues(1)
            );
        
        const channelRow = new ActionRowBuilder()
            .addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId(`setup_permissions_channel_${interaction.guildId}`)
                    .setPlaceholder('Restrict commands to specific channel (optional)')
                    .setChannelTypes(ChannelType.GuildText)
                    .setMinValues(0)
                    .setMaxValues(1)
            );
        
        const buttonRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`setup_back_${interaction.guildId}`)
                    .setLabel('Back')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`setup_permissions_next_${interaction.guildId}`)
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`setup_cancel_${interaction.guildId}`)
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Danger)
            );
        
        await interaction.update({ 
            embeds: [embed], 
            components: [roleRow, channelRow, buttonRow] 
        });
    }

    async handlePermissionSelection(interaction, state) {
        const type = interaction.customId.split('_')[2];
        
        if (type === 'role') {
            state.config.commandRoleId = interaction.values[0] || null;
        } else if (type === 'channel') {
            state.config.reportChannelId = interaction.values[0] || null;
        } else if (type === 'next') {
            await this.saveState(state);
            await this.showExcludedChannels(interaction, state);
            return;
        }
        
        await this.saveState(state);
        await interaction.deferUpdate();
    }

    async showExcludedChannels(interaction, state) {
        state.step = 4;
        await this.saveState(state);
        
        const embed = new EmbedBuilder()
            .setTitle('Step 4: Excluded Voice Channels')
            .setDescription('Select voice channels where activity should NOT be tracked.\n(e.g., AFK channels, music channels)')
            .setColor(0x0099FF)
            .setFooter({ text: 'Step 4 of 8' });
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId(`setup_excluded_select_${interaction.guildId}`)
                    .setPlaceholder('Select channels to exclude (optional)')
                    .setChannelTypes(ChannelType.GuildVoice)
                    .setMinValues(0)
                    .setMaxValues(10)
            );
        
        const buttonRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`setup_back_${interaction.guildId}`)
                    .setLabel('Back')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`setup_excluded_next_${interaction.guildId}`)
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`setup_cancel_${interaction.guildId}`)
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Danger)
            );
        
        await interaction.update({ 
            embeds: [embed], 
            components: [row, buttonRow] 
        });
    }

    async handleExcludedChannels(interaction, state) {
        const type = interaction.customId.split('_')[2];
        
        if (type === 'select') {
            state.config.excludedChannelIds = interaction.values;
        } else if (type === 'next') {
            await this.saveState(state);
            await this.showSessionSettings(interaction, state);
            return;
        }
        
        await this.saveState(state);
        await interaction.deferUpdate();
    }

    async showSessionSettings(interaction, state) {
        state.step = 5;
        await this.saveState(state);
        
        const embed = new EmbedBuilder()
            .setTitle('Step 5: Session Settings')
            .setDescription('Configure how voice sessions are tracked.')
            .setColor(0x0099FF)
            .setFooter({ text: 'Step 5 of 8' });
        
        embed.addFields(
            { 
                name: 'Minimum Session Duration', 
                value: 'How long someone must be in voice before it counts as activity', 
                inline: false 
            },
            { 
                name: 'Rejoin Window', 
                value: 'How long to wait before counting a new session after someone leaves', 
                inline: false 
            }
        );
        
        const minSessionRow = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`setup_session_min_${interaction.guildId}`)
                    .setPlaceholder('Select minimum session duration')
                    .addOptions([
                        { label: '5 minutes', value: '5' },
                        { label: '10 minutes', value: '10' },
                        { label: '15 minutes', value: '15' },
                        { label: '20 minutes (Default)', value: '20' },
                        { label: '30 minutes', value: '30' },
                        { label: '45 minutes', value: '45' },
                        { label: '60 minutes', value: '60' }
                    ])
            );
        
        const rejoinRow = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`setup_session_rejoin_${interaction.guildId}`)
                    .setPlaceholder('Select rejoin window')
                    .addOptions([
                        { label: '5 minutes', value: '5' },
                        { label: '10 minutes', value: '10' },
                        { label: '15 minutes', value: '15' },
                        { label: '20 minutes (Default)', value: '20' },
                        { label: '30 minutes', value: '30' }
                    ])
            );
        
        const buttonRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`setup_back_${interaction.guildId}`)
                    .setLabel('Back')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`setup_session_next_${interaction.guildId}`)
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`setup_cancel_${interaction.guildId}`)
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Danger)
            );
        
        await interaction.update({ 
            embeds: [embed], 
            components: [minSessionRow, rejoinRow, buttonRow] 
        });
    }

    async handleSessionSettings(interaction, state) {
        const type = interaction.customId.split('_')[2];
        
        if (type === 'min') {
            state.config.minSessionMinutes = parseInt(interaction.values[0]);
        } else if (type === 'rejoin') {
            state.config.rejoinWindowMinutes = parseInt(interaction.values[0]);
        } else if (type === 'next') {
            state.config.minSessionMinutes = state.config.minSessionMinutes || 20;
            state.config.rejoinWindowMinutes = state.config.rejoinWindowMinutes || 20;
            await this.saveState(state);
            await this.showWeeklyReports(interaction, state);
            return;
        }
        
        await this.saveState(state);
        await interaction.deferUpdate();
    }

    async showWeeklyReports(interaction, state) {
        state.step = 6;
        await this.saveState(state);
        
        const embed = new EmbedBuilder()
            .setTitle('Step 6: Weekly Reports')
            .setDescription('Configure automatic weekly voice activity reports.')
            .setColor(0x0099FF)
            .setFooter({ text: 'Step 6 of 8' });
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`setup_weekly_enable_${interaction.guildId}`)
                    .setLabel('Enable Weekly Reports')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId(`setup_weekly_disable_${interaction.guildId}`)
                    .setLabel('Disable Weekly Reports')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌')
            );
        
        const buttonRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`setup_back_${interaction.guildId}`)
                    .setLabel('Back')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`setup_cancel_${interaction.guildId}`)
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Danger)
            );
        
        await interaction.update({ 
            embeds: [embed], 
            components: [row, buttonRow] 
        });
    }

    async handleWeeklyReports(interaction, state) {
        const action = interaction.customId.split('_')[2];
        
        if (action === 'enable') {
            state.config.weeklyReportEnabled = true;
            state.config.weeklyReportDay = 0;
            state.config.weeklyReportHour = 9;
        } else if (action === 'disable') {
            state.config.weeklyReportEnabled = false;
        }
        
        await this.saveState(state);
        await this.showTimezone(interaction, state);
    }

    async showTimezone(interaction, state) {
        state.step = 7;
        state.timezonePage = state.timezonePage || 0;
        await this.saveState(state);
        
        const embed = new EmbedBuilder()
            .setTitle('Step 7: Server Timezone')
            .setDescription('Select your server\'s timezone for accurate report scheduling.')
            .setColor(0x0099FF)
            .setFooter({ text: `Step 7 of 8 • Page ${state.timezonePage + 1}/${this.timezonePages.length}` });
        
        const currentTime = new Date().toLocaleTimeString('en-US', { 
            timeZone: 'UTC',
            hour: '2-digit',
            minute: '2-digit'
        });
        embed.addFields({ name: 'Current UTC Time', value: currentTime });
        
        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`setup_timezone_select_${interaction.guildId}`)
                    .setPlaceholder('Select your timezone')
                    .addOptions(this.timezonePages[state.timezonePage])
            );
        
        const buttonRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`setup_back_${interaction.guildId}`)
                    .setLabel('Back')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`setup_timezone_prev_${interaction.guildId}`)
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(state.timezonePage === 0),
                new ButtonBuilder()
                    .setCustomId(`setup_timezone_next_${interaction.guildId}`)
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(state.timezonePage === this.timezonePages.length - 1),
                new ButtonBuilder()
                    .setCustomId(`setup_cancel_${interaction.guildId}`)
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Danger)
            );
        
        await interaction.update({ 
            embeds: [embed], 
            components: [row, buttonRow] 
        });
    }

    async handleTimezone(interaction, state) {
        const action = interaction.customId.split('_')[2];
        
        if (action === 'select') {
            state.config.timezone = interaction.values[0];
            await this.saveState(state);
            await this.showReview(interaction, state);
        } else if (action === 'prev') {
            state.timezonePage = Math.max(0, state.timezonePage - 1);
            await this.saveState(state);
            await this.showTimezone(interaction, state);
        } else if (action === 'next') {
            state.timezonePage = Math.min(this.timezonePages.length - 1, state.timezonePage + 1);
            await this.saveState(state);
            await this.showTimezone(interaction, state);
        }
    }

    async showReview(interaction, state) {
        state.step = 8;
        await this.saveState(state);
        
        const config = state.config;
        const embed = new EmbedBuilder()
            .setTitle('Step 8: Review Configuration')
            .setDescription('Please review your settings before confirming.')
            .setColor(0x00FF88)
            .setFooter({ text: 'Step 8 of 8' });
        
        const trackingRole = config.trackingRoleId ? `<@&${config.trackingRoleId}>` : 'Not set';
        const commandRole = config.commandRoleId ? `<@&${config.commandRoleId}>` : 'Admin only';
        const commandChannel = config.reportChannelId ? `<#${config.reportChannelId}>` : 'Any channel';
        
        const reportChannels = (config.reportChannels || []).map(id => `<#${id.substring(2)}>`);
        const reportUsers = (config.reportUsers || []).map(id => `<@${id}>`);
        const recipients = [...reportChannels, ...reportUsers].join(', ') || 'None';
        
        const excluded = config.excludedChannelIds 
            ? config.excludedChannelIds.map(id => `<#${id}>`).join(', ')
            : 'None';
        
        embed.addFields(
            { name: '🎯 Tracking Role', value: trackingRole },
            { name: '📊 Report Recipients', value: recipients },
            { name: '🔒 Command Role', value: commandRole },
            { name: '📍 Command Channel', value: commandChannel },
            { name: '🚫 Excluded Channels', value: excluded },
            { name: '⏱️ Min Session', value: `${config.minSessionMinutes || 20} minutes` },
            { name: '🔄 Rejoin Window', value: `${config.rejoinWindowMinutes || 20} minutes` },
            { name: '📅 Weekly Reports', value: config.weeklyReportEnabled ? 'Enabled' : 'Disabled' },
            { name: '🌍 Timezone', value: config.timezone || 'UTC' }
        );
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`setup_back_${interaction.guildId}`)
                    .setLabel('Back')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`setup_confirm_${interaction.guildId}`)
                    .setLabel('Confirm Setup')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId(`setup_cancel_${interaction.guildId}`)
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Danger)
            );
        
        await interaction.update({ 
            embeds: [embed], 
            components: [row] 
        });
    }

    async confirmSetup(interaction, state) {
        await interaction.deferUpdate();
        
        const config = state.config;
        const guildId = interaction.guildId;
        
        const existingConfig = await this.client.prisma.serverConfig.findUnique({
            where: { guildId }
        });
        
        const updateData = {
            trackingRoleName: config.trackingRoleName || 'Voice Active',
            commandRoleId: config.commandRoleId || null,
            reportChannelId: config.reportChannelId || null,
            reportRecipients: config.reportRecipients || [],
            excludedChannelIds: config.excludedChannelIds || [],
            minSessionMinutes: config.minSessionMinutes || 20,
            rejoinWindowMinutes: config.rejoinWindowMinutes || 20,
            weeklyReportEnabled: config.weeklyReportEnabled !== undefined ? config.weeklyReportEnabled : true,
            weeklyReportDay: 0,
            weeklyReportHour: 9,
            timezone: config.timezone || 'UTC'
        };
        
        if (existingConfig) {
            await this.client.prisma.serverConfig.update({
                where: { guildId },
                data: updateData
            });
        } else {
            await this.client.prisma.serverConfig.create({
                data: { guildId, ...updateData }
            });
        }
        
        await this.client.configManager.refreshCache(guildId);
        
        if (updateData.weeklyReportEnabled) {
            this.client.scheduleWeeklyReport(guildId, updateData);
        } else {
            const task = this.client.scheduledTasks.get(guildId);
            if (task) {
                task.stop();
                this.client.scheduledTasks.delete(guildId);
            }
        }
        
        const embed = new EmbedBuilder()
            .setTitle('✅ Setup Complete!')
            .setDescription('Your bot configuration has been saved.')
            .setColor(0x00FF88)
            .addFields(
                { name: 'Next Steps', value: 
                    '• Members with the tracking role will now be monitored\n' +
                    '• Use `/voicereport` to generate manual reports\n' +
                    '• Use `/config` to view your settings'
                }
            )
            .setTimestamp();
        
        await interaction.editReply({ 
            embeds: [embed], 
            components: [] 
        });
        
        await this.client.redis.del(`setup:${guildId}:${interaction.user.id}`);
    }

    async goBack(interaction, state) {
        const stepMap = {
            1: () => this.showTrackingRole(interaction, state),
            2: () => this.showReportRecipients(interaction, state),
            3: () => this.showCommandPermissions(interaction, state),
            4: () => this.showExcludedChannels(interaction, state),
            5: () => this.showSessionSettings(interaction, state),
            6: () => this.showWeeklyReports(interaction, state),
            7: () => this.showTimezone(interaction, state),
            8: () => this.showReview(interaction, state)
        };
        
        if (state.step > 1) {
            state.step--;
            await stepMap[state.step]();
        }
    }

    async cancelSetup(interaction, setupKey) {
        await this.client.redis.del(setupKey);
        
        const embed = new EmbedBuilder()
            .setTitle('❌ Setup Cancelled')
            .setDescription('The setup wizard has been cancelled.')
            .setColor(0xFF0000);
        
        await interaction.update({ 
            embeds: [embed], 
            components: [] 
        });
    }

    async saveState(state) {
        const setupKey = `setup:${state.guildId}:${state.userId}`;
        await this.client.redis.setex(setupKey, 1200, JSON.stringify(state));
    }
}

module.exports = SetupWizard;