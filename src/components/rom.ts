import { Tile } from './ppu';

export enum MirroringType {
    vertical = 0,
    horizontal = 1,
    fourScreen = 2,
    singleScreen = 3,
    singleScreen2 = 4,
    singleScreen3 = 5,
    singleScreen4 = 6,
    chrRom = 7
}

export class Rom {

    public rom: number[][];
    public vrom: number[][];
    public vromTile: Tile[][];

    public header: number[];
    public romCount: number;
    public vromCount: number;
    public mirroring: 0 | 1;
    public batteryRam: boolean;
    public trainer: boolean;
    public fourScreen: boolean;
    public mapperType: number;

    constructor(data: ArrayBuffer) {
        let i: number;
        let j: number;
        let v: number;

        const bytes = new Uint8Array(data, 0, data.byteLength);
        if (bytes.length < 4 ||
            bytes[0] !== 0x4E ||
            bytes[1] !== 0x45 ||
            bytes[2] !== 0x53 ||
            bytes[3] !== 0x1A
        ) {
            throw new Error('Not a valid NES rom.');
        }

        this.header = new Array(16);
        for (i = 0; i < 16; i += 1) {
            this.header[i] = bytes[i] & 0xFF;
        }

        this.romCount = this.header[4];
        if (this.romCount < 1) {
            throw new Error('No rom in this bank.');
        }

        this.vromCount = this.header[5] * 2; // Get the number of 4kB banks, not 8kB
        this.mirroring = (this.header[6] & 1) !== 0 ? 1 : 0;
        this.batteryRam = (this.header[6] & 2) !== 0;
        this.trainer = (this.header[6] & 4) !== 0;
        this.fourScreen = (this.header[6] & 8) !== 0;
        this.mapperType = (this.header[6] >> 4) | (this.header[7] & 0xF0);

        // Check whether byte 8-15 are zero's:
        let foundError = false;
        for (i = 8; i < 16; i += 1) {
            if (this.header[i] !== 0) {
                foundError = true;
                break;
            }
        }
        if (foundError) {
            this.mapperType &= 0xF; // Ignore byte 7
        }

        // Load PRG-ROM banks:
        this.rom = new Array(this.romCount);
        let offset = 16;
        for (i = 0; i < this.romCount; i += 1) {
            this.rom[i] = new Array(16384);
            for (j = 0; j < 16384; j += 1) {
                if (offset + j >= bytes.length) {
                    break;
                }
                this.rom[i][j] = bytes[offset + j];
            }
            offset += 16384;
        }

        // Load CHR-ROM banks:
        this.vrom = new Array(this.vromCount);
        for (i = 0; i < this.vromCount; i += 1) {
            this.vrom[i] = new Array(4096);
            for (j = 0; j < 4096; j += 1) {
                if (offset + j >= bytes.length) {
                    break;
                }
                this.vrom[i][j] = bytes[offset + j];
            }
            offset += 4096;
        }

        // Create VROM tiles:
        this.vromTile = new Array(this.vromCount);
        for (i = 0; i < this.vromCount; i += 1) {
            this.vromTile[i] = new Array(256);
            for (j = 0; j < 256; j += 1) {
                this.vromTile[i][j] = new Tile();
            }
        }

        // Convert CHR-ROM banks to tiles:
        let tileIndex;
        let leftOver;
        for (v = 0; v < this.vromCount; v += 1) {
            for (i = 0; i < 4096; i += 1) {
                tileIndex = i >> 4;
                leftOver = i % 16;
                if (leftOver < 8) {
                    this.vromTile[v][tileIndex].setScanline(
                        leftOver,
                        this.vrom[v][i],
                        this.vrom[v][i + 8]
                    );
                }
                else {
                    this.vromTile[v][tileIndex].setScanline(
                        leftOver - 8,
                        this.vrom[v][i - 8],
                        this.vrom[v][i]
                    );
                }
            }
        }
    }

    get mirroringType(): MirroringType {
        if (this.fourScreen) {
            return MirroringType.fourScreen;
        }
        if (this.mirroring === 0) {
            return MirroringType.horizontal;
        }
        return MirroringType.vertical;
    }
}
