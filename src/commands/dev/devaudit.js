const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('devaudit')
        .setDescription('Developer: Audit voice activity for anomalous patterns')
        .addStringOption(option =>
            option.setName('guild')
                .setDescription('Guild ID to check (leave empty for current guild)')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('days')
                .setDescription('Number of days to analyze')
                .setRequired(false)
                .addChoices(
                    { name: '7 days', value: 7 },
                    { name: '14 days', value: 14 },
                    { name: '30 days', value: 30 }
                ))
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
        
        const guildId = interaction.options.getString('guild') || interaction.guildId;
        const days = interaction.options.getInteger('days') || 7;
        
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            return interaction.editReply('Guild not found.');
        }
        
        const config = await client.configManager.getServerConfig(guildId);
        if (!config) {
            return interaction.editReply(`Guild "${guild.name}" is not configured.`);
        }
        
        try {
            const suspicious = await client.sessionManager.getSuspiciousUsers(guildId, days);
            
            if (suspicious.length === 0) {
                const embed = new EmbedBuilder()
                    .setTitle('🔍 No Suspicious Activity Detected')
                    .setDescription(`No suspicious patterns found in **${guild.name}** over the last ${days} days.`)
                    .setColor(0x00FF88)
                    .setTimestamp()
                    .addFields({
                        name: '✅ Clean Report',
                        value: 'All users appear to have normal voice activity patterns.'
                    });
                    
                return interaction.editReply({ embeds: [embed] });
            }
            
            const embeds = [];
            let currentEmbed = new EmbedBuilder()
                .setTitle(`🚨 Suspicious Activity Report - ${guild.name}`)
                .setDescription(`Found ${suspicious.length} users with suspicious patterns over ${days} days`)
                .setColor(0xFF9900)
                .setTimestamp();
            
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
                             `**Avg Muted:** ${user.stats.avgMutePercentage}%\n` +
                             `**Avg Daily:** ${user.stats.avgDailyHours}h`;
                
                const fieldValue = `${flagList}\n\n${stats}`;
                
                if (fieldCount >= 20 || (currentEmbed.data.fields?.reduce((acc, f) => acc + f.name.length + f.value.length, 0) || 0) + fieldValue.length > 5500) {
                    embeds.push(currentEmbed);
                    currentEmbed = new EmbedBuilder()
                        .setTitle(`🚨 Suspicious Activity (continued)`)
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
                        name: 'Detection Criteria',
                        value: '• 20+ hour days\n• 100% muted time\n• 16+ hour daily average',
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
                        name: 'Recommendation',
                        value: suspicious.length > 5 
                            ? '⚠️ High number of suspicious users detected. Consider investigating further.' 
                            : '📋 Review individual cases for potential action.',
                        inline: false
                    }
                );
            
            embeds.push(summaryEmbed);
            
            await interaction.editReply({ embeds: embeds.slice(0, 10) });
            
            for (let i = 10; i < embeds.length; i += 10) {
                await interaction.followUp({ 
                    embeds: embeds.slice(i, i + 10), 
                    flags: MessageFlags.Ephemeral 
                });
            }
            
        } catch (error) {
            client.logger.error('Error generating suspicious activity report', error, {
                guild: guild,
                command: 'devsuspicious'
            });
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Error')
                .setDescription('Failed to generate suspicious activity report.')
                .setColor(0xFF0000)
                .setTimestamp()
                .addFields({
                    name: 'Error Details',
                    value: `\`\`\`${error.message}\`\`\``
                });
                
            await interaction.editReply({ embeds: [errorEmbed] });
        }
    },
    
    formatDuration(ms) {
        const hours = Math.floor(ms / (60 * 60 * 1000));
        const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
        return `${hours}h ${minutes}m`;
    }
};