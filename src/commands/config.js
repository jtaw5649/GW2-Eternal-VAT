const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('View or reset bot configuration')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false),
    
    async execute(interaction, client) {
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('config_view')
                    .setLabel('View Config')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('📋'),
                new ButtonBuilder()
                    .setCustomId('config_reset')
                    .setLabel('Reset Config')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔄')
            );
        
        const embed = new EmbedBuilder()
            .setTitle('⚙️ Configuration Menu')
            .setDescription('Choose an action:')
            .setColor(0x0099FF)
            .setTimestamp();
        
        const response = await interaction.reply({ 
                    embeds: [embed], 
                    components: [row], 
                    flags: MessageFlags.Ephemeral 
                });
        
        try {
            const confirmation = await response.awaitMessageComponent({ 
                time: 60000 
            });
            
            if (confirmation.customId === 'config_view') {
                await this.viewConfig(confirmation, client);
            } else if (confirmation.customId === 'config_reset') {
                await this.resetConfig(confirmation, client);
            }
        } catch (e) {
            const timeoutEmbed = new EmbedBuilder()
                .setTitle('⏱️ Menu Timed Out')
                .setDescription('Configuration menu timed out.')
                .setColor(0x808080)
                .setTimestamp()
                .setThumbnail('https://static.staticwars.com/quaggans/404.jpg');
            
            await interaction.editReply({ 
                embeds: [timeoutEmbed], 
                components: [] 
            });
        }
    },
    
    async viewConfig(interaction, client) {
        await interaction.deferUpdate();
        
        const config = await client.prisma.serverConfig.findUnique({
            where: { guildId: interaction.guildId }
        });
        
        if (!config) {
            const embed = new EmbedBuilder()
                .setTitle('❌ Not Configured')
                .setDescription('This server has not been configured yet.\nUse `/setup` to configure the bot.')
                .setColor(0xFF0000)
                .setTimestamp()
                .setThumbnail('https://static.staticwars.com/quaggans/404.jpg');
            
            return interaction.editReply({ embeds: [embed], components: [] });
        }
        
        const guild = interaction.guild;
        const embed = new EmbedBuilder()
            .setTitle('📋 Server Configuration')
            .setColor(0x00FF88)
            .setTimestamp()
            .setThumbnail(guild.iconURL());
        
        const excludedChannels = config.excludedChannelIds && config.excludedChannelIds.length > 0
            ? config.excludedChannelIds.map(id => `<#${id}>`).join(', ')
            : 'None';
        
        embed.addFields({
            name: '🎯 Tracking Settings',
            value: `**Role:** ${config.trackingRoleName}\n` +
                   `**Excluded Channels:** ${excludedChannels}\n` +
                   `**Min Session:** ${config.minSessionMinutes} minutes\n` +
                   `**Rejoin Window:** ${config.rejoinWindowMinutes} minutes`,
            inline: false
        });
        
        const reportChannels = config.reportRecipients
            .filter(r => r.startsWith('c:'))
            .map(r => `<#${r.substring(2)}>`);
        const reportUsers = config.reportRecipients
            .filter(r => !r.startsWith('c:'))
            .map(r => `<@${r}>`);
        
        embed.addFields({
            name: '📊 Report Settings',
            value: `**Channels:** ${reportChannels.length > 0 ? reportChannels.join(', ') : 'None'}\n` +
                   `**Users:** ${reportUsers.length > 0 ? reportUsers.join(', ') : 'None'}\n` +
                   `**Weekly Reports:** ${config.weeklyReportEnabled ? 'Enabled' : 'Disabled'}\n` +
                   `**Report Day:** ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][config.weeklyReportDay]}\n` +
                   `**Report Time:** ${config.weeklyReportHour}:00`,
            inline: false
        });
        
        embed.addFields({
            name: '🔒 Permission Settings',
            value: `**Command Role:** ${config.commandRoleId ? `<@&${config.commandRoleId}>` : 'Admin Only'}\n` +
                   `**Command Channel:** ${config.reportChannelId ? `<#${config.reportChannelId}>` : 'Any Channel'}`,
            inline: false
        });
        
        const activeCount = await client.redis.keys(`voice:${interaction.guildId}:active:*`);
        const completedCount = await client.redis.zcard(`voice:${interaction.guildId}:completed`);
        
        embed.addFields({
            name: '📈 Statistics',
            value: `**Active Sessions:** ${activeCount.length}\n` +
                   `**Completed Sessions:** ${completedCount}\n` +
                   `**Config Updated:** ${new Date(config.updatedAt).toLocaleDateString()}`,
            inline: false
        });
        
        await interaction.editReply({ embeds: [embed], components: [] });
    },
    
    async resetConfig(interaction, client) {
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('confirm_reset')
                    .setLabel('Confirm Reset')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('cancel_reset')
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
            );
        
        const embed = new EmbedBuilder()
            .setTitle('⚠️ Reset Configuration?')
            .setDescription('This will reset all settings to defaults.\n\n**This action cannot be undone.**')
            .setColor(0xFFAA00)
            .setTimestamp();
        
        await interaction.update({ 
            embeds: [embed], 
            components: [row]
        });
        
        try {
            const confirmation = await interaction.message.awaitMessageComponent({ 
                time: 30000 
            });
            
            if (confirmation.customId === 'confirm_reset') {
                await client.prisma.serverConfig.update({
                    where: { guildId: interaction.guildId },
                    data: {
                        trackingRoleName: 'Voice Active',
                        commandRoleId: null,
                        reportChannelId: null,
                        reportRecipients: [],
                        excludedChannelIds: [],
                        minSessionMinutes: 20,
                        rejoinWindowMinutes: 20,
                        weeklyReportEnabled: true,
                        weeklyReportDay: 0,
                        weeklyReportHour: 9
                    }
                });
                
                await client.configManager.clearCache(interaction.guildId);
                
                const task = client.scheduledTasks.get(interaction.guildId);
                if (task) {
                    task.stop();
                    client.scheduledTasks.delete(interaction.guildId);
                }
                
                const successEmbed = new EmbedBuilder()
                    .setTitle('✅ Configuration Reset')
                    .setDescription('All settings have been reset to defaults.\nUse `/setup` to reconfigure.')
                    .setColor(0x00FF88)
                    .setTimestamp();
                
                await confirmation.update({ 
                    embeds: [successEmbed], 
                    components: [] 
                });
            } else {
                const cancelEmbed = new EmbedBuilder()
                    .setTitle('❌ Reset Cancelled')
                    .setDescription('Configuration reset has been cancelled.')
                    .setColor(0xFF0000)
                    .setTimestamp()
                    .setThumbnail('https://static.staticwars.com/quaggans/404.jpg');
                
                await confirmation.update({ 
                    embeds: [cancelEmbed], 
                    components: [] 
                });
            }
        } catch (e) {
            const timeoutEmbed = new EmbedBuilder()
                .setTitle('⏱️ Reset Timed Out')
                .setDescription('Configuration reset timed out.')
                .setColor(0x808080)
                .setTimestamp()
                .setThumbnail('https://static.staticwars.com/quaggans/404.jpg');
            
            await interaction.editReply({ 
                embeds: [timeoutEmbed], 
                components: [] 
            });
        }
    }
};