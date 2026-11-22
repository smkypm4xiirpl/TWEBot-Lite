import { GroupSettingCommand } from './GroupSettingCommand.js';

/**
 * Command .opengc: Membuka grup sehingga seluruh member dapat mengirim pesan.
 * Aliases: opengc, buka, opengroup.
 */
export class OpenGcCommand extends GroupSettingCommand {
  constructor({ owners = null, logger = null } = {}) {
    super({
      name: 'opengc',
      aliases: ['buka', 'opengroup', 'gcopen', 'gcbuka', 'open'],
      description: 'Buka grup: semua member dapat mengirim pesan',
      targetSetting: 'not_announcement',
      owners,
      logger,
    });
  }
}
