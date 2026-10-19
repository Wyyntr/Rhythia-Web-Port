const utf8 = new TextDecoder('utf-8');

/** Little-endian reader for the binary map formats. */
export class BinaryReader {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get length(): number {
    return this.bytes.length;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  seek(offset: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.bytes.length) {
      throw new RangeError(`Invalid offset ${offset} (file is ${this.bytes.length} bytes)`);
    }
    this.offset = offset;
  }

  skip(count: number): void {
    this.need(count);
    this.offset += count;
  }

  read(count: number): Uint8Array {
    this.need(count);
    const out = this.bytes.subarray(this.offset, this.offset + count);
    this.offset += count;
    return out;
  }

  u8(): number {
    this.need(1);
    return this.bytes[this.offset++]!;
  }

  u16(): number {
    this.need(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  u32(): number {
    this.need(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  u64(): number {
    this.need(8);
    const value = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError(`64-bit value ${value} is too large`);
    }
    return Number(value);
  }

  f32(): number {
    this.need(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  f64(): number {
    this.need(8);
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  utf8(count: number): string {
    return utf8.decode(this.read(count));
  }

  string16(): string {
    return this.utf8(this.u16());
  }

  string32(): string {
    return this.utf8(this.u32());
  }

  /** Reads a newline-terminated UTF-8 string (used by the v1 format). */
  line(): string {
    let end = this.offset;
    while (end < this.bytes.length && this.bytes[end] !== 0x0a) {
      end++;
    }
    const text = utf8.decode(this.bytes.subarray(this.offset, end)).replace(/\r$/, '');
    this.offset = Math.min(end + 1, this.bytes.length);
    return text;
  }

  private need(count: number): void {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(`Invalid read length ${count}`);
    }
    if (this.offset + count > this.bytes.length) {
      throw new RangeError(
        `Unexpected end of file at byte ${this.offset} (needed ${count} more, file is ${this.bytes.length} bytes)`,
      );
    }
  }
}
