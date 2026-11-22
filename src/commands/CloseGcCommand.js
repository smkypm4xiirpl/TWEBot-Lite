import { GroupSettingCommand } from './GroupSettingCommand.js';

/**
 * Command .closegc: Menutup grup sehingga hanya admin yang dapat mengirim pesan.
 * Aliases: closegc, tutup, closegroup.
 */
export class CloseGcCommand extends GroupSettingCommand {
  constructor({ owners = null, logger = null } = {}) {
    super({
      name: 'closegc',
      aliases: ['tutup', 'closegroup', 'gcclose', 'gctutup', 'close'],
      description: 'Tutup grup: hanya admin yang dapat mengirim pesan',
      targetSetting: 'announcement',
      owners,
      logger,
    });
  }
}
