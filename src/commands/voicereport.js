const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('voicereport')
        .setDescription('Generate a voice activity report')
        .addIntegerOption(option =>
            option.setName('days')
                .setDescription('Number of days to report on')
                .setRequired(true)
                .addChoices(
                    { name: '7 days', value: 7 },
                    { name: '14 days', value: 14 },
                    { name: '21 days', value: 21 },
                    { name: '30 days', value: 30 }
                ))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false),
    
    async execute(interaction, client) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        
        const days = interaction.options.getInteger('days');
        const guildId = interaction.guildId;
        
        const config = await client.configManager.getServerConfig(guildId);
        if (!config) {
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Not Configured')
                .setDescription('This server is not configured. Use `/setup` to configure the bot.')
                .setColor(0xFF0000)
                .setTimestamp()
                .setThumbnail('https://static.staticwars.com/quaggans/404.jpg');
            
            return interaction.editReply({
                embeds: [errorEmbed]
            });
        }
        
        const member = interaction.member;
        const hasPermission = member.permissions.has(PermissionFlagsBits.ManageGuild) ||
                              (config.commandRoleId && member.roles.cache.has(config.commandRoleId));
        
        if (!hasPermission) {
            const permissionEmbed = new EmbedBuilder()
                .setTitle('❌ Insufficient Permissions')
                .setDescription('You do not have permission to use this command.')
                .setColor(0xFF0000)
                .setTimestamp()
                .setThumbnail('https://static.staticwars.com/quaggans/404.jpg');
            
            return interaction.editReply({
                embeds: [permissionEmbed]
            });
        }
        
        if (config.reportChannelId && interaction.channelId !== config.reportChannelId) {
            const channelEmbed = new EmbedBuilder()
                .setTitle('❌ Wrong Channel')
                .setDescription(`This command can only be used in <#${config.reportChannelId}>`)
                .setColor(0xFF0000)
                .setTimestamp()
                .setThumbnail('https://static.staticwars.com/quaggans/404.jpg');
            
            return interaction.editReply({
                embeds: [channelEmbed]
            });
        }
        
        try {
            await client.generateAndSendReport(guildId, days);
            
            await interaction.editReply({
                content: `✅ ${days}-day voice activity report has been sent to the configured recipients.`
            });
        } catch (error) {
            client.logger.error('Error generating report', error, {
                guild: interaction.guild,
                command: 'voicereport'
            });
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Report Generation Error')
                .setDescription('An error occurred while generating the report. Please try again later.')
                .setColor(0xFF0000)
                .setTimestamp()
                .setThumbnail('https://static.staticwars.com/quaggans/404.jpg')
                .addFields({
                    name: '🔧 Support',
                    value: 'If this issue persists, please contact **jtaw.5649** on Discord.',
                    inline: false
                });
            
            await interaction.editReply({
                embeds: [errorEmbed]
            });
        }
    }
};