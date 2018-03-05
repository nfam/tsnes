import { Rom, MirroringType } from './rom';
import { Controller } from './controller';
import { CPU, InstructionRequest } from './cpu';
import { PPU } from './ppu';
import { APU } from './apu';

function copy(src: any[], srcPos: number, dest: any, destPos: number, length: number) {
    for (let i = 0; i < length; i += 1) {
        dest[destPos + i] = src[srcPos + i];
    }
}

export class Mapper {

    protected static readonly serializable = [
        'joy1StrobeState',
        'joy2StrobeState',
        'joypadLastWrite'
    ];

    get serializable(): string[] {
        return Mapper.serializable;
    }

    joy1StrobeState: number
    joy2StrobeState: number
    joypadLastWrite: number
    mousePressed: boolean
    mouseX: number | null
    mouseY: number | null

    constructor(
        protected cpu: CPU,
        protected ppu: PPU,
        protected apu: APU,
        private controller: Controller,
        protected rom: Rom
    ) {
        this.joy1StrobeState = 0;
        this.joy2StrobeState = 0;
        this.joypadLastWrite = 0;
        this.mousePressed = false;
        this.mouseX = null;
        this.mouseY = null;
    }

    static romSupported(rom: Rom): boolean {
        return mappers[rom.mapperType] !== undefined
    }

    static create(cpu: CPU, ppu: PPU, apu: APU, controller: Controller, rom: Rom): Mapper {
        let mapper = new mappers[rom.mapperType](cpu, ppu, apu, controller, rom);
        mapper.loadROM();
        return mapper;
    }

    write(address: number, value: number): void {
        if (address < 0x2000) {
            // Mirroring of RAM:
            this.cpu.mem[address & 0x7FF] = value;
        }
        else if (address > 0x4017) {
            this.cpu.mem[address] = value;
            if (address >= 0x6000 && address < 0x8000) {
                // Write to SaveRAM. Store in file:
                // TODO: not yet
                //if(!=null)
                //    this.rom.writeBatteryRam(address,value);
            }
        }
        else if (address > 0x2007 && address < 0x4000) {
            this.regWrite(0x2000 + (address & 0x7), value);
        }
        else {
            this.regWrite(address, value);
        }
    }

    writelow(address: number, value: number): void {
        if (address < 0x2000) {
            // Mirroring of RAM:
            this.cpu.mem[address & 0x7FF] = value;
        }
        else if (address > 0x4017) {
            this.cpu.mem[address] = value;
        }
        else if (address > 0x2007 && address < 0x4000) {
            this.regWrite(0x2000 + (address & 0x7), value);
        }
        else {
            this.regWrite(address, value);
        }
    }

    load(address: number): number {
        // Wrap around:
        address &= 0xFFFF;

        // Check address range:
        if (address > 0x4017) {
            // ROM:
            return this.cpu.mem[address];
        }
        else if (address >= 0x2000) {
            // I/O Ports.
            return this.regLoad(address);
        }
        else {
            // RAM (mirrored)
            return this.cpu.mem[address & 0x7FF];
        }
    }

    regLoad(address: number): number {
        switch (address >> 12) { // use fourth nibble (0xF000)
            case 0:
                break;

            case 1:
                break;

            case 2:
                // Fall through to case 3
            case 3:
                // PPU Registers
                switch (address & 0x7) {
                    case 0x0:
                        // 0x2000:
                        // PPU Control Register 1.
                        // (the value is stored both
                        // in main memory and in the
                        // PPU as flags):
                        // (not in the real NES)
                        return this.cpu.mem[0x2000];

                    case 0x1:
                        // 0x2001:
                        // PPU Control Register 2.
                        // (the value is stored both
                        // in main memory and in the
                        // PPU as flags):
                        // (not in the real NES)
                        return this.cpu.mem[0x2001];

                    case 0x2:
                        // 0x2002:
                        // PPU Status Register.
                        // The value is stored in
                        // main memory in addition
                        // to as flags in the PPU.
                        // (not in the real NES)
                        return this.ppu.readStatusRegister();

                    case 0x3:
                        return 0;

                    case 0x4:
                        // 0x2004:
                        // Sprite Memory read.
                        return this.ppu.sramLoad();
                    case 0x5:
                        return 0;

                    case 0x6:
                        return 0;

                    case 0x7:
                        // 0x2007:
                        // VRAM read:
                        return this.ppu.vramLoad();
                }
                break;
            case 4:
                // Sound+Joypad registers
                switch (address - 0x4015) {
                    case 0:
                        // 0x4015:
                        // Sound channel enable, DMC Status
                        return this.apu.readReg(address);

                    case 1:
                        // 0x4016:
                        // Joystick 1 + Strobe
                        return this.joy1Read();

                    case 2:
                        // 0x4017:
                        // Joystick 2 + Strobe
                        if (this.mousePressed) {

                            // Check for white pixel nearby:
                            var sx = Math.max(0, this.mouseX - 4);
                            var ex = Math.min(256, this.mouseX + 4);
                            var sy = Math.max(0, this.mouseY - 4);
                            var ey = Math.min(240, this.mouseY + 4);
                            var w = 0;

                            for (var y=sy; y<ey; y++) {
                                for (var x=sx; x<ex; x++) {

                                    if (this.ppu.buffer[(y<<8)+x] == 0xFFFFFF) {
                                        w |= 0x1<<3;
                                        console.debug("Clicked on white!");
                                        break;
                                    }
                                }
                            }

                            w |= (this.mousePressed?(0x1<<4):0);
                            return (this.joy2Read()|w) & 0xFFFF;
                        }
                        else {
                            return this.joy2Read();
                        }

                }
                break;
        }
        return 0;
    }

    regWrite(address: number, value: number): void {
        switch (address) {
            case 0x2000:
                // PPU Control register 1
                this.cpu.mem[address] = value;
                this.ppu.updateControlReg1(value);
                break;

            case 0x2001:
                // PPU Control register 2
                this.cpu.mem[address] = value;
                this.ppu.updateControlReg2(value);
                break;

            case 0x2003:
                // Set Sprite RAM address:
                this.ppu.writeSRAMAddress(value);
                break;

            case 0x2004:
                // Write to Sprite RAM:
                this.ppu.sramWrite(value);
                break;

            case 0x2005:
                // Screen Scroll offsets:
                this.ppu.scrollWrite(value);
                break;

            case 0x2006:
                // Set VRAM address:
                this.ppu.writeVRAMAddress(value);
                break;

            case 0x2007:
                // Write to VRAM:
                this.ppu.vramWrite(value);
                break;

            case 0x4014:
                // Sprite Memory DMA Access
                this.ppu.sramDMA(value);
                break;

            case 0x4015:
                // Sound Channel Switch, DMC Status
                this.apu.writeReg(address, value);
                break;

            case 0x4016:
                // Joystick 1 + Strobe
                if ((value&1) === 0 && (this.joypadLastWrite&1) === 1) {
                    this.joy1StrobeState = 0;
                    this.joy2StrobeState = 0;
                }
                this.joypadLastWrite = value;
                break;

            case 0x4017:
                // Sound channel frame sequencer:
                this.apu.writeReg(address, value);
                break;

            default:
                // Sound registers
                // console.log("write to sound reg");
                if (address >= 0x4000 && address <= 0x4017) {
                    this.apu.writeReg(address,value);
                }

        }
    }

    joy1Read(): number {
        var ret;

        switch (this.joy1StrobeState) {
            case 0:
            case 1:
            case 2:
            case 3:
            case 4:
            case 5:
            case 6:
            case 7:
                ret = this.controller.state1[this.joy1StrobeState];
                break;
            case 8:
            case 9:
            case 10:
            case 11:
            case 12:
            case 13:
            case 14:
            case 15:
            case 16:
            case 17:
            case 18:
                ret = 0;
                break;
            case 19:
                ret = 1;
                break;
            default:
                ret = 0;
        }

        this.joy1StrobeState++;
        if (this.joy1StrobeState == 24) {
            this.joy1StrobeState = 0;
        }

        return ret;
    }

    joy2Read(): number {
        var ret;

        switch (this.joy2StrobeState) {
            case 0:
            case 1:
            case 2:
            case 3:
            case 4:
            case 5:
            case 6:
            case 7:
                ret = this.controller.state2[this.joy2StrobeState];
                break;
            case 8:
            case 9:
            case 10:
            case 11:
            case 12:
            case 13:
            case 14:
            case 15:
            case 16:
            case 17:
            case 18:
                ret = 0;
                break;
            case 19:
                ret = 1;
                break;
            default:
                ret = 0;
        }

        this.joy2StrobeState++;
        if (this.joy2StrobeState == 24) {
            this.joy2StrobeState = 0;
        }

        return ret;
    }

    loadROM(): void {

        // Load ROM into memory:
        this.loadPRGROM();

        // Load CHR-ROM:
        this.loadCHRROM();

        // Load Battery RAM (if present):
        this.loadBatteryRam();

        // Reset IRQ:
        //nes.getCpu().doResetInterrupt();
        this.cpu.requestIrq(InstructionRequest.RESET);
    }

    loadPRGROM(): void {
        if (this.rom.romCount > 1) {
            // Load the two first banks into memory.
            this.loadRomBank(0, 0x8000);
            this.loadRomBank(1, 0xC000);
        }
        else {
            // Load the one bank into both memory locations:
            this.loadRomBank(0, 0x8000);
            this.loadRomBank(0, 0xC000);
        }
    }

    loadCHRROM(): void {
        // console.log("Loading CHR ROM..");
        if (this.rom.vromCount > 0) {
            if (this.rom.vromCount == 1) {
                this.loadVromBank(0,0x0000);
                this.loadVromBank(0,0x1000);
            }
            else {
                this.loadVromBank(0,0x0000);
                this.loadVromBank(1,0x1000);
            }
        }
        else {
            //System.out.println("There aren't any CHR-ROM banks..");
        }
    }

    loadBatteryRam(): void {
        /* TODO batteryRam from boolean to Array?

        if (this.rom.batteryRam) {
            var ram = this.rom.batteryRam;
            if (ram !== null && ram.length == 0x2000) {
                // Load Battery RAM into memory:
                copy(ram, 0, this.cpu.mem, 0x6000, 0x2000);
            }
        }*/
    }

    loadRomBank(bank: number, address: number): void {
        // Loads a ROM bank into the specified address.
        bank %= this.rom.romCount;
        //var data = this.rom.rom[bank];
        //cpuMem.write(address,data,data.length);
        copy(this.rom.rom[bank], 0, this.cpu.mem, address, 16384);
    }

    loadVromBank(bank: number, address: number): void {
        if (this.rom.vromCount === 0) {
            return;
        }
        this.ppu.triggerRendering();

        copy(this.rom.vrom[bank % this.rom.vromCount],
            0, this.ppu.vramMem, address, 4096);

        var vromTile = this.rom.vromTile[bank % this.rom.vromCount];
        copy(vromTile, 0, this.ppu.ptTile,address >> 4, 256);
    }

    load32kRomBank(bank: number, address: number): void {
        this.loadRomBank((bank*2) % this.rom.romCount, address);
        this.loadRomBank((bank*2+1) % this.rom.romCount, address+16384);
    }

    load8kVromBank(bank4kStart: number, address: number): void {
        if (this.rom.vromCount === 0) {
            return;
        }
        this.ppu.triggerRendering();

        this.loadVromBank((bank4kStart) % this.rom.vromCount, address);
        this.loadVromBank((bank4kStart + 1) % this.rom.vromCount,
                address + 4096);
    }

    load1kVromBank(bank1k: number, address: number): void {
        if (this.rom.vromCount === 0) {
            return;
        }
        this.ppu.triggerRendering();

        var bank4k = Math.floor(bank1k / 4) % this.rom.vromCount;
        var bankoffset = (bank1k % 4) * 1024;
        copy(this.rom.vrom[bank4k], 0,
            this.ppu.vramMem, bankoffset, 1024);

        // Update tiles:
        var vromTile = this.rom.vromTile[bank4k];
        var baseIndex = address >> 4;
        for (var i = 0; i < 64; i++) {
            this.ppu.ptTile[baseIndex+i] = vromTile[((bank1k%4) << 6) + i];
        }
    }

    load2kVromBank(bank2k: number, address: number): void {
        if (this.rom.vromCount === 0) {
            return;
        }
        this.ppu.triggerRendering();

        var bank4k = Math.floor(bank2k / 2) % this.rom.vromCount;
        var bankoffset = (bank2k % 2) * 2048;
        copy(this.rom.vrom[bank4k], bankoffset,
            this.ppu.vramMem, address, 2048);

        // Update tiles:
        var vromTile = this.rom.vromTile[bank4k];
        var baseIndex = address >> 4;
        for (var i = 0; i < 128; i++) {
            this.ppu.ptTile[baseIndex+i] = vromTile[((bank2k%2) << 7) + i];
        }
    }

    load8kRomBank(bank8k: number, address: number): void {
        var bank16k = Math.floor(bank8k / 2) % this.rom.romCount;
        var offset = (bank8k % 2) * 8192;

        //this.cpu.mem.write(address,this.rom.rom[bank16k],offset,8192);
        copy(this.rom.rom[bank16k], offset,
                  this.cpu.mem, address, 8192);
    }

    clockIrqCounter(): void {
        // Does nothing. This is used by the MMC3 mapper.
    }

    latchAccess(address: number): void {
        // Does nothing. This is used by MMC2.
    }
}

var mappers: typeof Mapper[] = [];
mappers[0] = Mapper;

class Mapper1 extends Mapper {

    protected static readonly serializable = Mapper.serializable.concat(
        'regBuffer',
        'regBufferCounter',

        // Register 0:
        'mirroring',
        'oneScreenMirroring',
        'prgSwitchingArea',
        'prgSwitchingSize',
        'vromSwitchingSize',

        // Register 1:
        'romSelectionReg0',

        // Register 2:
        'romSelectionReg1',

        // Register 3:
        'romBankSelect'
    );

    get serializable(): string[] {
        return Mapper.serializable;
    }

    // 5-bit buffer:
    regBuffer = 0;
    regBufferCounter = 0;

    // Register 0:
    mirroring = 0;
    oneScreenMirroring = 0;
    prgSwitchingArea = 1;
    prgSwitchingSize = 1;
    vromSwitchingSize = 0;

    // Register 1:
    romSelectionReg0 = 0;

    // Register 2:
    romSelectionReg1 = 0;

    // Register 3:
    romBankSelect = 0;

    constructor(
        cpu: CPU,
        ppu: PPU,
        apu: APU,
        controller: Controller,
        rom: Rom
    ) {
        super(cpu, ppu, apu, controller, rom);

        // 5-bit buffer:
        this.regBuffer = 0;
        this.regBufferCounter = 0;

        // Register 0:
        this.mirroring = 0;
        this.oneScreenMirroring = 0;
        this.prgSwitchingArea = 1;
        this.prgSwitchingSize = 1;
        this.vromSwitchingSize = 0;

        // Register 1:
        this.romSelectionReg0 = 0;

        // Register 2:
        this.romSelectionReg1 = 0;

        // Register 3:
        this.romBankSelect = 0;
    }

    write(address: number, value: number): void {
        if (address < 0x8000) {
            super.write(address, value);
            return;
        }

        // See what should be done with the written value:
        if ((value & 128) !== 0) {

            // Reset buffering:
            this.regBufferCounter = 0;
            this.regBuffer = 0;

            // Reset register:
            if (this.getRegNumber(address) === 0) {

                this.prgSwitchingArea = 1;
                this.prgSwitchingSize = 1;

            }
        }
        else {

            // Continue buffering:
            //regBuffer = (regBuffer & (0xFF-(1<<regBufferCounter))) | ((value & (1<<regBufferCounter))<<regBufferCounter);
            this.regBuffer = (this.regBuffer & (0xFF - (1 << this.regBufferCounter))) | ((value & 1) << this.regBufferCounter);
            this.regBufferCounter++;

            if (this.regBufferCounter == 5) {
                // Use the buffered value:
                this.setReg(this.getRegNumber(address), this.regBuffer);

                // Reset buffer:
                this.regBuffer = 0;
                this.regBufferCounter = 0;
            }
        }
    }

    setReg(reg: number, value: number): void {
        var tmp;

        switch (reg) {
            case 0:
                // Mirroring:
                tmp = value & 3;
                if (tmp !== this.mirroring) {
                    // Set mirroring:
                    this.mirroring = tmp;
                    if ((this.mirroring & 2) === 0) {
                        // SingleScreen mirroring overrides the other setting:
                        this.ppu.setMirroring(MirroringType.singleScreen);
                    }
                    // Not overridden by SingleScreen mirroring.
                    else if ((this.mirroring & 1) !== 0) {
                        this.ppu.setMirroring(MirroringType.horizontal);
                    }
                    else {
                        this.ppu.setMirroring(MirroringType.vertical);
                    }
                }

                // PRG Switching Area;
                this.prgSwitchingArea = (value >> 2) & 1;

                // PRG Switching Size:
                this.prgSwitchingSize = (value >> 3) & 1;

                // VROM Switching Size:
                this.vromSwitchingSize = (value >> 4) & 1;

                break;

            case 1:
                // ROM selection:
                this.romSelectionReg0 = (value >> 4) & 1;

                // Check whether the cart has VROM:
                if (this.rom.vromCount > 0) {

                    // Select VROM bank at 0x0000:
                    if (this.vromSwitchingSize === 0) {

                        // Swap 8kB VROM:
                        if (this.romSelectionReg0 === 0) {
                            this.load8kVromBank((value & 0xF), 0x0000);
                        }
                        else {
                            this.load8kVromBank( Math.floor(this.rom.vromCount/2) + (value & 0xF), 0x0000);
                        }

                    }
                    else {
                        // Swap 4kB VROM:
                        if (this.romSelectionReg0 === 0) {
                            this.loadVromBank((value & 0xF), 0x0000);
                        }
                        else {
                            this.loadVromBank( Math.floor(this.rom.vromCount/2) + (value & 0xF), 0x0000);
                        }
                    }
                }

                break;

            case 2:
                // ROM selection:
                this.romSelectionReg1 = (value >> 4) & 1;

                // Check whether the cart has VROM:
                if (this.rom.vromCount > 0) {

                    // Select VROM bank at 0x1000:
                    if (this.vromSwitchingSize === 1) {
                        // Swap 4kB of VROM:
                        if (this.romSelectionReg1 === 0) {
                            this.loadVromBank((value & 0xF), 0x1000);
                        }
                        else {
                            this.loadVromBank(Math.floor(this.rom.vromCount / 2) + (value & 0xF), 0x1000);
                        }
                    }
                }
                break;

            default:
                // Select ROM bank:
                // -------------------------
                tmp = value & 0xF;
                var bank;
                var baseBank = 0;

                if (this.rom.romCount >= 32) {
                    // 1024 kB cart
                    if (this.vromSwitchingSize === 0) {
                        if (this.romSelectionReg0 === 1) {
                            baseBank = 16;
                        }
                    }
                    else {
                        baseBank = (this.romSelectionReg0
                                    | (this.romSelectionReg1 << 1)) << 3;
                    }
                }
                else if (this.rom.romCount >= 16) {
                    // 512 kB cart
                    if (this.romSelectionReg0 === 1) {
                        baseBank = 8;
                    }
                }

                if (this.prgSwitchingSize === 0) {
                    // 32kB
                    bank = baseBank + (value & 0xF);
                    this.load32kRomBank(bank, 0x8000);
                }
                else {
                    // 16kB
                    bank = baseBank * 2 + (value & 0xF);
                    if (this.prgSwitchingArea === 0) {
                        this.loadRomBank(bank, 0xC000);
                    }
                    else {
                        this.loadRomBank(bank, 0x8000);
                    }
                }
        }
    }

    // Returns the register number from the address written to:
    getRegNumber(address: number): number {
        if (address >= 0x8000 && address <= 0x9FFF) {
            return 0;
        }
        else if (address >= 0xA000 && address <= 0xBFFF) {
            return 1;
        }
        else if (address >= 0xC000 && address <= 0xDFFF) {
            return 2;
        }
        else {
            return 3;
        }
    }

    loadROM(): void {
        // Load PRG-ROM:
        this.loadRomBank(0, 0x8000);                //   First ROM bank..
        this.loadRomBank(this.rom.romCount - 1, 0xC000); // ..and last ROM bank.

        // Load CHR-ROM:
        this.loadCHRROM();

        // Load Battery RAM (if present):
        this.loadBatteryRam();

        // Do Reset-Interrupt:
        this.cpu.requestIrq(InstructionRequest.RESET);
    }

    switchLowHighPrgRom(oldSetting: any): void {
        // TODO
    }

    switch16to32(): void {
        // TODO
    }

    switch32to16(): void {
        // TODO
    }
}
mappers[1] = Mapper1;

class Mapper2 extends Mapper {
    write(address: number, value: number): void {
        if (address < 0x8000) {
            super.write(address, value);
        }
        else {
            // This is a ROM bank select command.
            // Swap in the given ROM bank at 0x8000:
            this.loadRomBank(value, 0x8000);
        }
    }

    loadROM() {
        // Load PRG-ROM:
        this.loadRomBank(0, 0x8000);
        this.loadRomBank(this.rom.romCount - 1, 0xC000);

        // Load CHR-ROM:
        this.loadCHRROM();

        // Do Reset-Interrupt:
        this.cpu.requestIrq(InstructionRequest.RESET);
    }
}
mappers[2] = Mapper2;

class Mapper3 extends Mapper {
    write(address: number, value: number): void {
        if (address < 0x8000) {
            super.write(address, value);
        }
        else {
            // This is a VROM bank select command.
            // Swap in the given VROM bank at 0x0000:
            var bank = (value % (this.rom.romCount / 2)) * 2;
            this.loadVromBank(bank, 0x0000);
            this.loadVromBank(bank + 1, 0x1000);
            this.load8kVromBank(value * 2, 0x0000);
        }
    }
}
mappers[3] = Mapper3;

class Mapper4 extends Mapper {
    CMD_SEL_2_1K_VROM_0000 = 0;
    CMD_SEL_2_1K_VROM_0800 = 1;
    CMD_SEL_1K_VROM_1000 = 2;
    CMD_SEL_1K_VROM_1400 = 3;
    CMD_SEL_1K_VROM_1800 = 4;
    CMD_SEL_1K_VROM_1C00 = 5;
    CMD_SEL_ROM_PAGE1 = 6;
    CMD_SEL_ROM_PAGE2 = 7;

    protected static readonly serializable = Mapper.serializable.concat(
        'command',
        'prgAddressSelect',
        'chrAddressSelect',
        'pageNumber',
        'irqCounter',
        'irqLatchValue',
        'irqEnable',
        'prgAddressChanged'
    );

    get serializable(): string[] {
        return Mapper.serializable;
    }

    command = 0;
    prgAddressSelect = 0;
    chrAddressSelect = 0;
    pageNumber = 0;
    irqCounter = 0;
    irqLatchValue = 0;
    irqEnable = 0;
    prgAddressChanged = false;

    write(address: number, value: number): void {
        if (address < 0x8000) {
            super.write(address, value);
            return;
        }

        switch (address) {
            case 0x8000:
                // Command/Address Select register
                this.command = value & 7;
                var tmp = (value >> 6) & 1;
                if (tmp != this.prgAddressSelect) {
                    this.prgAddressChanged = true;
                }
                this.prgAddressSelect = tmp;
                this.chrAddressSelect = (value >> 7) & 1;
                break;

            case 0x8001:
                // Page number for command
                this.executeCommand(this.command, value);
                break;

            case 0xA000:
                // Mirroring select
                if ((value & 1) !== 0) {
                    this.ppu.setMirroring(
                        MirroringType.horizontal
                    );
                }
                else {
                    this.ppu.setMirroring(MirroringType.vertical);
                }
                break;

            case 0xA001:
                // SaveRAM Toggle
                // TODO
                //nes.getRom().setSaveState((value&1)!=0);
                break;

            case 0xC000:
                // IRQ Counter register
                this.irqCounter = value;
                //nes.ppu.mapperIrqCounter = 0;
                break;

            case 0xC001:
                // IRQ Latch register
                this.irqLatchValue = value;
                break;

            case 0xE000:
                // IRQ Control Reg 0 (disable)
                //irqCounter = irqLatchValue;
                this.irqEnable = 0;
                break;

            case 0xE001:
                // IRQ Control Reg 1 (enable)
                this.irqEnable = 1;
                break;

            default:
                // Not a MMC3 register.
                // The game has probably crashed,
                // since it tries to write to ROM..
                // IGNORE.
        }
    }

    executeCommand(cmd: number, arg: number) {
        switch (cmd) {
            case this.CMD_SEL_2_1K_VROM_0000:
                // Select 2 1KB VROM pages at 0x0000:
                if (this.chrAddressSelect === 0) {
                    this.load1kVromBank(arg, 0x0000);
                    this.load1kVromBank(arg + 1, 0x0400);
                }
                else {
                    this.load1kVromBank(arg, 0x1000);
                    this.load1kVromBank(arg + 1, 0x1400);
                }
                break;

            case this.CMD_SEL_2_1K_VROM_0800:
                // Select 2 1KB VROM pages at 0x0800:
                if (this.chrAddressSelect === 0) {
                    this.load1kVromBank(arg, 0x0800);
                    this.load1kVromBank(arg + 1, 0x0C00);
                }
                else {
                    this.load1kVromBank(arg, 0x1800);
                    this.load1kVromBank(arg + 1, 0x1C00);
                }
                break;

            case this.CMD_SEL_1K_VROM_1000:
                // Select 1K VROM Page at 0x1000:
                if (this.chrAddressSelect === 0) {
                    this.load1kVromBank(arg, 0x1000);
                }
                else {
                    this.load1kVromBank(arg, 0x0000);
                }
                break;

            case this.CMD_SEL_1K_VROM_1400:
                // Select 1K VROM Page at 0x1400:
                if (this.chrAddressSelect === 0) {
                    this.load1kVromBank(arg, 0x1400);
                }
                else {
                    this.load1kVromBank(arg, 0x0400);
                }
                break;

            case this.CMD_SEL_1K_VROM_1800:
                // Select 1K VROM Page at 0x1800:
                if (this.chrAddressSelect === 0) {
                    this.load1kVromBank(arg, 0x1800);
                }
                else {
                    this.load1kVromBank(arg, 0x0800);
                }
                break;

            case this.CMD_SEL_1K_VROM_1C00:
                // Select 1K VROM Page at 0x1C00:
                if (this.chrAddressSelect === 0) {
                    this.load1kVromBank(arg, 0x1C00);
                }
                else {
                    this.load1kVromBank(arg, 0x0C00);
                }
                break;

            case this.CMD_SEL_ROM_PAGE1:
                if (this.prgAddressChanged) {
                    // Load the two hardwired banks:
                    if (this.prgAddressSelect === 0) {
                        this.load8kRomBank(
                            ((this.rom.romCount - 1) * 2),
                            0xC000
                        );
                    }
                    else {
                        this.load8kRomBank(
                            ((this.rom.romCount - 1) * 2),
                            0x8000
                        );
                    }
                    this.prgAddressChanged = false;
                }

                // Select first switchable ROM page:
                if (this.prgAddressSelect === 0) {
                    this.load8kRomBank(arg, 0x8000);
                }
                else {
                    this.load8kRomBank(arg, 0xC000);
                }
                break;

            case this.CMD_SEL_ROM_PAGE2:
                // Select second switchable ROM page:
                this.load8kRomBank(arg, 0xA000);

                // hardwire appropriate bank:
                if (this.prgAddressChanged) {
                    // Load the two hardwired banks:
                    if (this.prgAddressSelect === 0) {
                        this.load8kRomBank(
                            ((this.rom.romCount - 1) * 2),
                            0xC000
                        );
                    }
                    else {
                        this.load8kRomBank(
                            ((this.rom.romCount - 1) * 2),
                            0x8000
                        );
                    }
                    this.prgAddressChanged = false;
                }
        }
    }

    loadROM() {
        // Load hardwired PRG banks (0xC000 and 0xE000):
        this.load8kRomBank(((this.rom.romCount - 1) * 2), 0xC000);
        this.load8kRomBank(((this.rom.romCount - 1) * 2) + 1, 0xE000);

        // Load swappable PRG banks (0x8000 and 0xA000):
        this.load8kRomBank(0, 0x8000);
        this.load8kRomBank(1, 0xA000);

        // Load CHR-ROM:
        this.loadCHRROM();

        // Load Battery RAM (if present):
        this.loadBatteryRam();

        // Do Reset-Interrupt:
        this.cpu.requestIrq(InstructionRequest.RESET);
    };

    clockIrqCounter() {
        if (this.irqEnable == 1) {
            this.irqCounter--;
            if (this.irqCounter < 0) {
                // Trigger IRQ:
                //nes.getCpu().doIrq();
                this.cpu.requestIrq(InstructionRequest.NORMAL);
                this.irqCounter = this.irqLatchValue;
            }
        }
    }
}
mappers[4] = Mapper4;

/**
 * Mapper 066 (GxROM)
 *
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_066
 * @example Doraemon, Dragon Power, Gumshoe, Thunder & Lightning,
 * Super Mario Bros. + Duck Hunt
 */
class Mapper66 extends Mapper {
    write(address: number, value: number): void {
        if (address < 0x8000) {
            super.write(address, value);
        }
        else {
            // Swap in the given PRG-ROM bank at 0x8000:
            this.load32kRomBank((value >> 4) & 3, 0x8000);

            // Swap in the given VROM bank at 0x0000:
            this.load8kVromBank((value & 3) * 2, 0x0000);
        }
    }
}
mappers[66] = Mapper66;
