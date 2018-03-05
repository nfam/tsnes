import { Rom } from './rom';
import { Mapper } from './mapper';
import { CPU } from './cpu';
import { Controller, ControllerButton } from './controller';
import { APU } from './apu';
import { PPU, StatusFlag } from './ppu';

export class System {

    private controller: Controller;
    private cpu: CPU;
    private ppu: PPU;
    private apu: APU;

    private videoBuffer: number[];
    private audioBuffer: number[];

    constructor(
        rom: Rom,
        private onsample?: (sample: number) => void,
        private onerror?: (error: Error) => void
    ) {
        this.videoBuffer = new Array(256 * 240);
        this.audioBuffer = [];

        this.cpu = new CPU(null); // will set latter
        this.ppu = new PPU(this.cpu, (buffer) => {
            for (let i = 0; i < 256 * 240; i += 1) {
                this.videoBuffer[i] = buffer[i];
            }
        });
        this.apu = new APU(this.cpu, (sample) => {
            this.audioBuffer.push(sample);
            if (this.onsample) {
                this.onsample(sample);
            }
        });
        this.controller = new Controller();
        this.cpu.mapper = Mapper.create(this.cpu, this.ppu, this.apu, this.controller, rom);
        this.ppu.setMirroring(rom.mirroringType);
    }

    public static romSupported(rom: Rom): boolean {
        return Mapper.romSupported(rom);
    }

    public buttonDown(player: 1|2, button: ControllerButton) {
        this.controller.buttonDown(player, button);
    }

    public buttonUp(player: 1|2, button: ControllerButton) {
        this.controller.buttonUp(player, button);
    }

    public frame(): boolean {
        this.controller.frame();
        this.ppu.startFrame();
        let cycles = 0;
        const cpu = this.cpu;
        const ppu = this.ppu;
        const apu = this.apu;

        FRAMELOOP: for (;;) {
            if (cpu.cyclesToHalt === 0) {
                try {
                    cycles = cpu.emulate();
                }
                catch (error) {
                    if (this.onerror) {
                        this.onerror(error);
                    }
                    return false;
                }
                apu.clockFrameCounter(cycles);
                cycles *= 3;
            }
            else {
                if (cpu.cyclesToHalt > 8) {
                    cycles = 24;
                    apu.clockFrameCounter(8);
                    cpu.cyclesToHalt -= 8;
                }
                else {
                    cycles = cpu.cyclesToHalt * 3;
                    apu.clockFrameCounter(cpu.cyclesToHalt);
                    cpu.cyclesToHalt = 0;
                }
            }

            for (; cycles > 0; cycles -= 1) {
                if (ppu.curX === ppu.spr0HitX &&
                    ppu.f_spVisibility === 1 &&
                    ppu.scanline - 21 === ppu.spr0HitY
                ) {
                    // Set sprite 0 hit flag:
                    ppu.setStatusFlag(StatusFlag.SPRITE0HIT, true);
                }

                if (ppu.requestEndFrame) {
                    ppu.nmiCounter -= 1;
                    if (ppu.nmiCounter === 0) {
                        ppu.requestEndFrame = false;
                        ppu.startVBlank();
                        break FRAMELOOP;
                    }
                }

                ppu.curX += 1;
                if (ppu.curX === 341) {
                    ppu.curX = 0;
                    ppu.endScanline();
                }
            }
        }
        return true;
    }

    public pull(): Output {
        const audio = this.audioBuffer;
        this.audioBuffer = [];
        return {
            video: this.videoBuffer,
            audio: audio
        };
    }
}

/* export */ export interface Output {
    video: number[]
    audio: number[]
}