describe('Bot End-to-End', () => {
    let bot;
    
    beforeEach(() => {
        jest.clearAllMocks();
    });
    
    afterEach(async () => {
        if (bot && bot.shutdown) {
            await bot.shutdown();
        }
    });
    
    test('bot starts and connects successfully', async () => {
        const { VoiceMonitorBot } = require('../../src/bot');
        bot = new VoiceMonitorBot();
        
        bot.client.login = jest.fn().mockResolvedValue(true);
        bot.client.once = jest.fn((event, handler) => {
            if (event === 'ready') {
                setTimeout(() => handler(), 100);
            }
        });
        
        const startPromise = bot.start();
        await global.testUtils.sleep(200);
        
        expect(bot.client.login).toHaveBeenCalledWith('test-token');
    });
    
    test('bot handles guild join', async () => {
        const { VoiceMonitorBot } = require('../../src/bot');
        
        const bot = Object.create(VoiceMonitorBot.prototype);
        
        bot.prisma = {
            serverConfig: {
                create: jest.fn().mockResolvedValue(true)
            }
        };
        bot.configManager = {
            refreshCache: jest.fn().mockResolvedValue({
                guildId: '999',
                trackingRoleName: 'Voice Active',
                excludedChannelIds: []
            })
        };
        bot.scheduleWeeklyReport = jest.fn();
        bot.setupGuild = jest.fn();
        
        const mockGuild = {
            id: '999',
            name: 'New Server',
            systemChannel: {
                send: jest.fn().mockResolvedValue(true)
            },
            commands: {
                set: jest.fn().mockResolvedValue(true)
            }
        };
        
        await bot.onGuildCreate(mockGuild);
        
        expect(bot.prisma.serverConfig.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                guildId: '999',
                trackingRoleName: 'Voice Active',
                excludedChannelIds: []
            })
        });
        
        expect(mockGuild.systemChannel.send).toHaveBeenCalledWith({
            embeds: expect.arrayContaining([
                expect.objectContaining({
                    data: expect.objectContaining({
                        title: expect.stringContaining('Thanks for adding')
                    })
                })
            ])
        });
    });
});