const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('devreport')
        .setDescription('Developer: Generate report for any server')
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
        
        const days = interaction.options.getInteger('days');
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
                    .setCustomId('devreport_select')
                    .setPlaceholder('Select a server')
                    .addOptions(options)
            );

        const embed = new EmbedBuilder()
            .setTitle('🔧 Developer Report Generator')
            .setDescription(`Select a server to generate a ${days}-day report`)
            .setColor(0xFF0088)
            .setTimestamp();

        const response = await interaction.editReply({ 
            embeds: [embed], 
            components: [row] 
        });

        try {
            const selection = await response.awaitMessageComponent({ 
                time: 60000 
            });

            if (selection.customId === 'devreport_select') {
                await selection.deferUpdate();
                
                const selectedGuildId = selection.values[0];
                const selectedGuild = client.guilds.cache.get(selectedGuildId);
                
                if (!selectedGuild) {
                    return interaction.editReply({ 
                        content: 'Server not found.', 
                        embeds: [], 
                        components: [] 
                    });
                }

                const config = await client.configManager.getServerConfig(selectedGuildId);
                
                if (!config) {
                    return interaction.editReply({ 
                        content: `Server "${selectedGuild.name}" is not configured.`, 
                        embeds: [], 
                        components: [] 
                    });
                }

                const report = await client.generateReport(selectedGuild, config, days);
                
                const infoEmbed = new EmbedBuilder()
                    .setTitle('📊 Developer Report Generated')
                    .setDescription(`Generated ${days}-day report for **${selectedGuild.name}**`)
                    .setColor(0x00FF88)
                    .setTimestamp()
                    .addFields(
                        { name: 'Server ID', value: selectedGuildId, inline: true },
                        { name: 'Members', value: selectedGuild.memberCount.toString(), inline: true },
                        { name: 'Tracking Role', value: config.trackingRoleName, inline: true }
                    );

                await interaction.editReply({ 
                    embeds: [infoEmbed], 
                    components: [] 
                });

                await interaction.followUp({ 
                    embeds: [report]
                });
            }
        } catch (e) {
            if (e.code === 'InteractionCollectorError') {
                await interaction.editReply({ 
                    content: 'Selection timed out.', 
                    embeds: [], 
                    components: [] 
                });
            } else {
                throw e;
            }
        }
    }
};