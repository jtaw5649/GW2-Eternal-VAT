const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, UserSelectMenuBuilder, MessageFlags, ChannelType, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Interactive setup wizard for the bot')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),
    
    async execute(interaction, client) {
        const setupKey = `setup:${interaction.guildId}:${interaction.user.id}`;
        const initialState = {
            step: 1,
            guildId: interaction.guildId,
            userId: interaction.user.id,
            config: {},
            timestamp: Date.now()
        };
        
        await client.redis.setex(setupKey, 1200, JSON.stringify(initialState));
        
        const embed = new EmbedBuilder()
            .setTitle('🛠️ GW2 Eternal VAT Setup Wizard')
            .setDescription('Welcome to the interactive setup wizard.\n\nI\'ll guide you through configuring the bot step by step.')
            .setColor(0x00FF88)
            .addFields(
                { name: 'What we\'ll configure:', value: 
                    '• Tracking role for members\n' +
                    '• Report recipients (channels/users)\n' +
                    '• Command permissions\n' +
                    '• Excluded voice channels\n' +
                    '• Weekly report settings\n' +
                    '• Server timezone'
                }
            )
            .setFooter({ text: 'This wizard will timeout after 20 minutes' });
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`setup_start_${interaction.guildId}`)
                    .setLabel('Start Setup')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('▶️'),
                new ButtonBuilder()
                    .setCustomId(`setup_cancel_${interaction.guildId}`)
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
            );
        
        await interaction.reply({ 
            embeds: [embed], 
            components: [row], 
            flags: MessageFlags.Ephemeral 
        });
    }
};