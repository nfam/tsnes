import { Rom } from './rom';
import { System, Output } from './system';
import { ControllerButton } from './controller';

/* export */ export class Emulator {
    
    private system: System = null
    private rom: Rom = null
    onsample: (sample: number) => void = null
    onerror: (error: Error) => void = null

    load(data: ArrayBuffer): void {
        if (this.system) {
            this.system = null;
        }
        let rom = new Rom(data);
        if (System.romSupported(rom)) {
            this.rom = rom;
            this.system = new System(this.rom, this.onsample, this.onerror);
        }
        else {
            throw new Error('This ROM uses a unsupported mapper: '+rom.mapperType);
        }
    }

    reset(): void {
        if (this.rom) {
            this.system = new System(this.rom, this.onsample, this.onerror);
        }
    }

    buttonDown(player: 1|2, button: ControllerButton) {
         if (this.system) {
            this.system.buttonDown(player, button);
         }
    }

    buttonUp(player: 1|2, button: ControllerButton) {
        if (this.system) {
            this.system.buttonUp(player, button);
        }
    }

    frame(): boolean {
        if (this.system) {
            if (this.system.frame()) {
                return true;
            }
            else {
                this.system = null;
                return false;
            }
        }
        else {
            return false;
        }
    }

    pull(): Output {
        return this.system ? this.system.pull() : null;
    }
}