const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('devaudit')
        .setDescription('Developer: Audit voice activity for anomalous patterns')
        .setDMPermission(false),
    
    isDev: true,
    
    async execute(interaction, client) {
        if (interaction.user.id !== process.env.DEVELOPER_ID) {
            return interaction.reply({ 
                content: 'This command is restricted to the bot developer.', 
                flags: MessageFlags.Ephemeral 
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        
        const guilds = Array.from(client.guilds.cache.values())
            .sort((a, b) => b.memberCount - a.memberCount)
            .slice(0, 25);
        
        if (guilds.length === 0) {
            return interaction.editReply('No servers found.');
        }

        const options = guilds.map(guild => ({
            label: guild.name.substring(0, 100),
            description: `${guild.memberCount} members`,
            value: guild.id
        }));

        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('devaudit_guild')
                    .setPlaceholder('Select a server')
                    .addOptions(options)
            );

        const embed = new EmbedBuilder()
            .setTitle('🔍 Developer Audit Tool')
            .setDescription('Select a server to audit for suspicious patterns')
            .setColor(0xFF0088)
            .setTimestamp();

        await interaction.editReply({ 
            embeds: [embed], 
            components: [row] 
        });
    },

    async handleSelectMenu(interaction, client) {
        const [action, type, ...params] = interaction.customId.split('_');
        
        if (action !== 'devaudit') return false;
        
        if (interaction.user.id !== process.env.DEVELOPER_ID) {
            await interaction.reply({
                content: '❌ Unauthorized',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }
        
        try {
            await interaction.deferUpdate();
            
            if (type === 'guild') {
                const selectedGuildId = interaction.values[0];
                const selectedGuild = client.guilds.cache.get(selectedGuildId);
                
                if (!selectedGuild) {
                    await interaction.editReply({ 
                        content: 'Server not found.', 
                        embeds: [], 
                        components: [] 
                    });
                    return true;
                }

                const daysRow = new ActionRowBuilder()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId(`devaudit_days_${selectedGuildId}`)
                            .setPlaceholder('Select time period')
                            .addOptions([
                                { label: '7 days', value: '7' },
                                { label: '14 days', value: '14' },
                                { label: '30 days', value: '30' }
                            ])
                    );

                const embed = new EmbedBuilder()
                    .setTitle('🔍 Developer Audit Tool')
                    .setDescription(`Server: **${selectedGuild.name}**\n\nSelect the time period to analyze`)
                    .setColor(0xFF0088)
                    .setTimestamp();

                await interaction.editReply({ 
                    embeds: [embed], 
                    components: [daysRow] 
                });
                
            } else if (type === 'days') {
                const selectedGuildId = params[0];
                const days = parseInt(interaction.values[0]);
                const selectedGuild = client.guilds.cache.get(selectedGuildId);
                
                if (!selectedGuild) {
                    await interaction.editReply({ 
                        content: 'Server not found.', 
                        embeds: [], 
                        components: [] 
                    });
                    return true;
                }

                const config = await client.configManager.getServerConfig(selectedGuildId);
                
                if (!config) {
                    await interaction.editReply({ 
                        content: `Server "${selectedGuild.name}" is not configured.`, 
                        embeds: [], 
                        components: [] 
                    });
                    return true;
                }

                const suspicious = await client.sessionManager.getSuspiciousUsers(selectedGuildId, days);
                
                if (suspicious.length === 0) {
                    const cleanEmbed = new EmbedBuilder()
                        .setTitle('🔍 No Suspicious Activity Detected')
                        .setDescription(`No suspicious patterns found in **${selectedGuild.name}** over the last ${days} days.`)
                        .setColor(0x00FF88)
                        .setTimestamp()
                        .setThumbnail(selectedGuild.iconURL())
                        .addFields({
                            name: '✅ Clean Report',
                            value: 'All users appear to have normal voice activity patterns.'
                        });
                        
                    await interaction.editReply({ embeds: [cleanEmbed], components: [] });
                    return true;
                }
                
                const embeds = [];
                let currentEmbed = new EmbedBuilder()
                    .setTitle(`🚨 Suspicious Activity Report - ${selectedGuild.name}`)
                    .setDescription(`Found ${suspicious.length} users with suspicious patterns over ${days} days`)
                    .setColor(0xFF9900)
                    .setTimestamp()
                    .setThumbnail(selectedGuild.iconURL());
                
                let fieldCount = 0;
                
                for (const user of suspicious) {
                    const flagList = user.flags.map(f => {
                        const emoji = {
                            'excessive_daily': '📅',
                            'always_muted': '🔇',
                            'excessive_average': '📊'
                        }[f.type] || '⚠️';
                        return `${emoji} ${f.detail}`;
                    }).join('\n');
                    
                    const stats = `**Total Time:** ${this.formatDuration(user.stats.totalTime)}\n` +
                                 `**Sessions:** ${user.stats.sessionCount}\n` +
                                 (user.stats.avgMutePercentage > 0 ? `**Avg Muted:** ${user.stats.avgMutePercentage}%\n` : '') +
                                 `**Avg Daily:** ${user.stats.avgDailyHours}h`;
                    
                    const fieldValue = `${flagList}\n\n${stats}`;
                    
                    if (fieldCount >= 20 || (currentEmbed.data.fields?.reduce((acc, f) => acc + f.name.length + f.value.length, 0) || 0) + fieldValue.length > 5500) {
                        embeds.push(currentEmbed);
                        currentEmbed = new EmbedBuilder()
                            .setTitle('🚨 Suspicious Activity (continued)')
                            .setColor(0xFF9900)
                            .setTimestamp();
                        fieldCount = 0;
                    }
                    
                    currentEmbed.addFields({
                        name: `${user.displayName} (${user.userId})`,
                        value: fieldValue,
                        inline: true
                    });
                    fieldCount++;
                }
                
                if (fieldCount > 0) {
                    embeds.push(currentEmbed);
                }
                
                const summaryEmbed = new EmbedBuilder()
                    .setTitle('📊 Summary')
                    .setColor(0x0099FF)
                    .setTimestamp()
                    .addFields(
                        {
                            name: 'Server Info',
                            value: `**Name:** ${selectedGuild.name}\n**ID:** ${selectedGuildId}\n**Members:** ${selectedGuild.memberCount}`,
                            inline: true
                        },
                        {
                            name: 'Anti-Cheat Status',
                            value: config.antiCheatEnabled 
                                ? `✅ Enabled\nMin Users: ${config.minUsersInChannel}` 
                                : '❌ Disabled',
                            inline: true
                        },
                        {
                            name: 'Detection Criteria',
                            value: '• 20+ hour days\n• 100% muted time\n• 16+ hour daily average',
                            inline: true
                        },
                        {
                            name: 'Recommendation',
                            value: suspicious.length > 5 
                                ? '⚠️ High number of suspicious users detected. Consider investigating further.' 
                                : '📋 Review individual cases for potential action.',
                            inline: false
                        }
                    );
                
                embeds.push(summaryEmbed);
                
                await interaction.editReply({ embeds: embeds.slice(0, 10), components: [] });
                
                for (let i = 10; i < embeds.length; i += 10) {
                    await interaction.followUp({ 
                        embeds: embeds.slice(i, i + 10), 
                        flags: MessageFlags.Ephemeral 
                    });
                }
            }
        } catch (error) {
            client.logger.error('Error in devaudit handleSelectMenu', error, {
                guild: interaction.guild,
                user: interaction.user,
                command: 'devaudit',
                type: type,
                params: params
            });
            
            const embed = new EmbedBuilder()
                .setTitle('❌ Error')
                .setDescription('An unexpected error occurred.')
                .setColor(0xFF0000)
                .setTimestamp()
                .addFields({
                    name: '🔧 Error Details',
                    value: `\`\`\`${error.message}\`\`\``
                });
                
            try {
                await interaction.editReply({ embeds: [embed], components: [] });
            } catch (editError) {
                client.logger.error('Failed to edit reply', editError);
            }
        }
        
        return true;
    },
    
    formatDuration(ms) {
        const hours = Math.floor(ms / (60 * 60 * 1000));
        const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
        return `${hours}h ${minutes}m`;
    }
};