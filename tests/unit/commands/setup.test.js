const { createTestInteraction } = require('../../setup');
const setupCommand = require('../../../backup/setup');

describe('Setup Command', () => {
    let interaction;
    let client;
    
    beforeEach(() => {
        client = {
            prisma: {
                serverConfig: {
                    findUnique: jest.fn(),
                    create: jest.fn(),
                    update: jest.fn()
                }
            },
            configManager: {
                refreshCache: jest.fn()
            },
            scheduleWeeklyReport: jest.fn(),
            scheduledTasks: new Map()
        };
    });
    
    test('creates config if none exists', async () => {
        interaction = createTestInteraction('setup');
        client.prisma.serverConfig.findUnique.mockResolvedValue(null);
        client.prisma.serverConfig.create.mockResolvedValue({
            guildId: '1234567890',
            trackingRoleName: 'Voice Active'
        });
        
        await setupCommand.execute(interaction, client);
        
        expect(client.prisma.serverConfig.create).toHaveBeenCalled();
        expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    });
    
    test('updates tracking role', async () => {
        const mockRole = { id: '999', name: 'Active Members' };
        interaction = createTestInteraction('setup', { role: mockRole });
        interaction.options.getRole.mockReturnValue(mockRole);
        
        client.prisma.serverConfig.findUnique.mockResolvedValue({
            guildId: '1234567890',
            reportRecipients: []
        });
        
        await setupCommand.execute(interaction, client);
        
        expect(client.prisma.serverConfig.update).toHaveBeenCalledWith({
            where: { guildId: '1234567890' },
            data: expect.objectContaining({
                trackingRoleName: 'Active Members'
            })
        });
    });
    
    test('updates report channel', async () => {
        const mockChannel = { id: '888', name: 'reports' };
        interaction = createTestInteraction('setup', { channel: mockChannel });
        interaction.options.getChannel.mockReturnValue(mockChannel);
        
        client.prisma.serverConfig.findUnique.mockResolvedValue({
            guildId: '1234567890',
            reportRecipients: ['111']
        });
        
        await setupCommand.execute(interaction, client);
        
        expect(client.prisma.serverConfig.update).toHaveBeenCalledWith({
            where: { guildId: '1234567890' },
            data: expect.objectContaining({
                reportRecipients: expect.arrayContaining(['c:888'])
            })
        });
    });
    
    test('toggles weekly reports', async () => {
        interaction = createTestInteraction('setup', { boolean: false });
        interaction.options.getBoolean.mockReturnValue(false);
        
        client.prisma.serverConfig.findUnique.mockResolvedValue({
            guildId: '1234567890',
            weeklyReportEnabled: true,
            reportRecipients: []
        });
        
        const mockTask = { stop: jest.fn() };
        client.scheduledTasks.set('1234567890', mockTask);
        
        await setupCommand.execute(interaction, client);
        
        expect(mockTask.stop).toHaveBeenCalled();
        expect(client.scheduledTasks.has('1234567890')).toBe(false);
    });
});