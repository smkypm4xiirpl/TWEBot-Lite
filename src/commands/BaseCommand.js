/** Kontrak semua command. Subclass wajib mengimplementasikan `execute`. */
export class BaseCommand {
  /**
   * @param {object} definition
   * @param {boolean} [definition.ownerOnly]       Hanya owner yang boleh memakai.
   * @param {boolean} [definition.alwaysAvailable] Tetap jalan di grup yang dinonaktifkan (khusus owner).
   */
  constructor({ name, aliases = [], description, ownerOnly = false, alwaysAvailable = false }) {
    this.name = name;
    this.aliases = Object.freeze([...aliases]);
    this.description = description;
    this.ownerOnly = ownerOnly;
    this.alwaysAvailable = alwaysAvailable;
  }

  // eslint-disable-next-line no-unused-vars
  async execute(ctx, args) {
    throw new Error(`${this.constructor.name}.execute() belum diimplementasikan.`);
  }
}
