import { CPU, InstructionRequest } from './cpu';

const preferredFrameRate = 60;
const CPU_FREQ_NTSC = 1789772.5; //1789772.72727272d;
// var CPU_FREQ_PAL = 1773447.4;

export class APU {

    private square1: ChannelSquare
    private square2: ChannelSquare
    private triangle: ChannelTriangle
    private noise: ChannelNoise
    private dmc: ChannelDM

    // UNUSED frameIrqCounter: number
    frameIrqCounterMax: number
    initCounter: number
    channelEnableValue: number

    sampleRate: number

    lengthLookup: number[]
    dmcFreqLookup: number[]
    noiseWavelengthLookup: number[]
    square_table: number[]
    tnd_table: number[]

    frameIrqEnabled: boolean
    frameIrqActive: boolean
    // UNUSED frameClockNow: number
    startedPlaying: boolean
    recordOutput: boolean
    initingHardware: boolean

    masterFrameCounter: number
    derivedFrameCounter: number
    countSequence: number
    sampleTimer: number
    frameTime: number
    sampleTimerMax: number
    sampleCount: number
    triValue: number

    smpSquare1: number
    smpSquare2: number
    smpTriangle: number
    smpDmc: number
    accCount: number

    // DC removal vars:
    prevSample: number
    smpAccum: number

    // DAC range:
    dacRange: number
    dcValue: number

    // Master volume:
    masterVolume: number

    // Stereo positioning:
    posSquare1: number
    posSquare2: number
    posTriangle: number
    posNoise: number
    posDMC: number

    extraCycles: number

    maxSample: number
    minSample: number

    // Panning:
    panning: number[]

    constructor(
        public cpu: CPU,
        private onAudioSample: (sample: number) => void
    ) {

        this.square1 = new ChannelSquare(this, true);
        this.square2 = new ChannelSquare(this, false);
        this.triangle = new ChannelTriangle(this);
        this.noise = new ChannelNoise(this);
        this.dmc = new ChannelDM(this);


        // UNUSED this.frameIrqCounter = 0;
        this.frameIrqCounterMax = 4;
        this.initCounter = 2048;
        this.sampleRate = 44100;

        this.lengthLookup = null;
        this.dmcFreqLookup = null;
        this.noiseWavelengthLookup = null;
        this.square_table = null;
        this.tnd_table = null;

        this.frameIrqEnabled = false;
        this.frameIrqActive = false;
        // UNUSED this.frameClockNow = null;
        this.startedPlaying=false;
        this.recordOutput = false;
        this.initingHardware = false;

        this.masterFrameCounter = 0;
        this.derivedFrameCounter = 0;
        this.countSequence = 0;
        this.sampleTimer = 0;
        this.frameTime = Math.floor(
            (14915.0 * preferredFrameRate) / 60.0
        );
        this.sampleTimerMax = Math.floor(
            (1024.0 * CPU_FREQ_NTSC * preferredFrameRate) / (this.sampleRate * 60.0)
        );
        this.sampleCount = 0;
        this.triValue = 0;

        this.accCount = 0;
        this.smpSquare1 = 0;
        this.smpSquare2 = 0;
        this.smpTriangle = 0;
        this.smpDmc = 0;

        // DC removal vars:
        this.prevSample = 0;
        this.smpAccum = 0;

        // DAC range:
        this.dacRange = 0;
        this.dcValue = 0;

        // Master volume:
        this.masterVolume = 256;

        // Stereo positioning:
        this.posSquare1 = null;
        this.posSquare2 = null;
        this.posTriangle = null;
        this.posNoise = null;
        this.posDMC = null;

        this.extraCycles = null;

        this.maxSample = -500000;
        this.minSample = 500000;

        // Panning:
        this.panning = [80, 170, 100, 150, 128];
        this.setPanning(this.panning);

        // Initialize lookup tables:
        this.initLengthLookup();
        this.initDmcFrequencyLookup();
        this.initNoiseWavelengthLookup();
        this.initDACtables();

        // Init sound registers:
        for (var i = 0; i < 0x14; i++) {
            if (i === 0x10) {
                this.writeReg(0x4010, 0x10);
            }
            else {
                this.writeReg(0x4000 + i, 0);
            }
        }

        this.updateChannelEnable(0);
    }

    readReg(address: number): number {
        // Read 0x4015:
        var tmp = 0;
        tmp |= (this.square1.getLengthStatus()   );
        tmp |= (this.square2.getLengthStatus() <<1);
        tmp |= (this.triangle.getLengthStatus()<<2);
        tmp |= (this.noise.getLengthStatus()   <<3);
        tmp |= (this.dmc.getLengthStatus()     <<4);
        tmp |= (((this.frameIrqActive && this.frameIrqEnabled)? 1 : 0) << 6);
        tmp |= (this.dmc.getIrqStatus()        <<7);

        this.frameIrqActive = false;
        this.dmc.irqGenerated = false;

        return tmp & 0xFFFF;
    }

    writeReg(address: number, value: number) {
        if (address >= 0x4000 && address < 0x4004) {
            // Square Wave 1 Control
            this.square1.writeReg(address, value);
            // console.log('Square Write');
        }
        else if (address >= 0x4004 && address < 0x4008) {
            // Square 2 Control
            this.square2.writeReg(address, value);
        }
        else if (address >= 0x4008 && address < 0x400C) {
            // Triangle Control
            this.triangle.writeReg(address, value);
        }
        else if (address >= 0x400C && address <= 0x400F) {
            // Noise Control
            this.noise.writeReg(address, value);
        }
        else if (address === 0x4010) {
            // DMC Play mode & DMA frequency
            this.dmc.writeReg(address, value);
        }
        else if (address === 0x4011) {
            // DMC Delta Counter
            this.dmc.writeReg(address, value);
        }
        else if (address === 0x4012) {
            // DMC Play code starting address
            this.dmc.writeReg(address, value);
        }
        else if (address === 0x4013) {
            // DMC Play code length
            this.dmc.writeReg(address, value);
        }
        else if (address === 0x4015) {
            // Channel enable
            this.updateChannelEnable(value);

            if (value !== 0 && this.initCounter > 0) {
                // Start hardware initialization
                this.initingHardware = true;
            }

            // DMC/IRQ Status
            this.dmc.writeReg(address, value);
        }
        else if (address === 0x4017) {
            // Frame counter control
            this.countSequence = (value>>7)&1;
            this.masterFrameCounter = 0;
            this.frameIrqActive = false;

            if (((value>>6)&0x1)===0) {
                this.frameIrqEnabled = true;
            }
            else {
                this.frameIrqEnabled = false;
            }

            if (this.countSequence === 0) {
                // NTSC:
                this.frameIrqCounterMax = 4;
                this.derivedFrameCounter = 4;
            }
            else {
                // PAL:
                this.frameIrqCounterMax = 5;
                this.derivedFrameCounter = 0;
                this.frameCounterTick();
            }
        }
    }

    // Updates channel enable status.
    // This is done on writes to the
    // channel enable register (0x4015),
    // and when the user enables/disables channels
    // in the GUI.
    updateChannelEnable(value: number) {
        this.channelEnableValue = value&0xFFFF;
        this.square1.setEnabled((value&1) !== 0);
        this.square2.setEnabled((value&2) !== 0);
        this.triangle.setEnabled((value&4) !== 0);
        this.noise.setEnabled((value&8) !== 0);
        this.dmc.setEnabled((value&16) !== 0);
    }

    // Clocks the frame counter. It should be clocked at
    // twice the cpu speed, so the cycles will be
    // divided by 2 for those counters that are
    // clocked at cpu speed.
    clockFrameCounter(nCycles: number) {
        if (this.initCounter > 0) {
            if (this.initingHardware) {
                this.initCounter -= nCycles;
                if (this.initCounter <= 0) {
                    this.initingHardware = false;
                }
                return;
            }
        }

        // Don't process ticks beyond next sampling:
        nCycles += this.extraCycles;
        var maxCycles = this.sampleTimerMax-this.sampleTimer;
        if ((nCycles<<10) > maxCycles) {
            this.extraCycles = ((nCycles<<10) - maxCycles)>>10;
            nCycles -= this.extraCycles;
        }
        else {
            this.extraCycles = 0;
        }

        var dmc = this.dmc;
        var triangle = this.triangle;
        var square1 = this.square1;
        var square2 = this.square2;
        var noise = this.noise;

        // Clock DMC:
        if (dmc.isEnabled) {

            dmc.shiftCounter-=(nCycles<<3);
            while(dmc.shiftCounter<=0 && dmc.dmaFrequency>0) {
                dmc.shiftCounter += dmc.dmaFrequency;
                dmc.clockDmc();
            }

        }

        // Clock Triangle channel Prog timer:
        if (triangle.progTimerMax>0) {

            triangle.progTimerCount -= nCycles;
            while(triangle.progTimerCount <= 0) {

                triangle.progTimerCount += triangle.progTimerMax+1;
                if (triangle.linearCounter>0 && triangle.lengthCounter>0) {

                    triangle.triangleCounter++;
                    triangle.triangleCounter &= 0x1F;

                    if (triangle.isEnabled) {
                        // Normal value.
                        if (triangle.triangleCounter>=0x10) {
                            triangle.sampleValue = (triangle.triangleCounter&0xF);
                        }
                        // Inverted value.
                        else {
                            triangle.sampleValue = (0xF - (triangle.triangleCounter&0xF));
                        }
                        triangle.sampleValue <<= 4;
                    }
                }
            }
        }

        // Clock Square channel 1 Prog timer:
        square1.progTimerCount -= nCycles;
        if (square1.progTimerCount <= 0) {

            square1.progTimerCount += (square1.progTimerMax+1)<<1;

            square1.squareCounter++;
            square1.squareCounter&=0x7;
            square1.updateSampleValue();

        }

        // Clock Square channel 2 Prog timer:
        square2.progTimerCount -= nCycles;
        if (square2.progTimerCount <= 0) {

            square2.progTimerCount += (square2.progTimerMax+1)<<1;

            square2.squareCounter++;
            square2.squareCounter&=0x7;
            square2.updateSampleValue();

        }

        // Clock noise channel Prog timer:
        var acc_c = nCycles;

        // Do all cycles at once:
        if (noise.progTimerCount-acc_c > 0) {
            noise.progTimerCount -= acc_c;
            noise.accCount       += acc_c;
            noise.accValue       += acc_c * noise.sampleValue;
        }
        else {
            // Slow-step:
            while((acc_c--) > 0) {
                if (--noise.progTimerCount <= 0 && noise.progTimerMax>0) {
                    // Update noise shift register:
                    noise.shiftReg <<= 1;
                    noise.tmp = (((noise.shiftReg << (noise.randomMode===0?1:6)) ^ noise.shiftReg) & 0x8000 );

                    // Sample value must be 0.
                    if (noise.tmp !== 0) {
                        noise.shiftReg |= 0x01;
                        noise.randomBit = 0;
                        noise.sampleValue = 0;
                    }
                    // Find sample value:
                    else {
                        noise.randomBit = 1;
                        if (noise.isEnabled && noise.lengthCounter>0) {
                            noise.sampleValue = noise.masterVolume;
                        }
                        else {
                            noise.sampleValue = 0;
                        }
                    }
                    noise.progTimerCount += noise.progTimerMax;
                }

                noise.accValue += noise.sampleValue;
                noise.accCount++;

            }
        }

        // Frame IRQ handling:
        if (this.frameIrqEnabled && this.frameIrqActive) {
            this.cpu.requestIrq(InstructionRequest.NORMAL);
        }

        // Clock frame counter at double CPU speed:
        this.masterFrameCounter += (nCycles<<1);
        if (this.masterFrameCounter >= this.frameTime) {
            // 240Hz tick:
            this.masterFrameCounter -= this.frameTime;
            this.frameCounterTick();
        }

        // Accumulate sample value:
        this.accSample(nCycles);

        // Clock sample timer:
        this.sampleTimer += nCycles<<10;
        if (this.sampleTimer>=this.sampleTimerMax) {
            // Sample channels:
            this.sample();
            this.sampleTimer -= this.sampleTimerMax;
        }
    }

    accSample(cycles: number) {
        // Special treatment for triangle channel - need to interpolate.
        if (this.triangle.sampleCondition) {
            this.triValue = Math.floor((this.triangle.progTimerCount << 4) /
                    (this.triangle.progTimerMax + 1));
            if (this.triValue > 16) {
                this.triValue = 16;
            }
            if (this.triangle.triangleCounter >= 16) {
                this.triValue = 16 - this.triValue;
            }

            // Add non-interpolated sample value:
            this.triValue += this.triangle.sampleValue;
        }

        // Now sample normally:
        if (cycles === 2) {
            this.smpTriangle += this.triValue                << 1;
            this.smpDmc      += this.dmc.sample         << 1;
            this.smpSquare1  += this.square1.sampleValue    << 1;
            this.smpSquare2  += this.square2.sampleValue    << 1;
            this.accCount    += 2;
        }
        else if (cycles === 4) {
            this.smpTriangle += this.triValue                << 2;
            this.smpDmc      += this.dmc.sample         << 2;
            this.smpSquare1  += this.square1.sampleValue    << 2;
            this.smpSquare2  += this.square2.sampleValue    << 2;
            this.accCount    += 4;
        }
        else {
            this.smpTriangle += cycles * this.triValue;
            this.smpDmc      += cycles * this.dmc.sample;
            this.smpSquare1  += cycles * this.square1.sampleValue;
            this.smpSquare2  += cycles * this.square2.sampleValue;
            this.accCount    += cycles;
        }
    }

    frameCounterTick() {

        this.derivedFrameCounter++;
        if (this.derivedFrameCounter >= this.frameIrqCounterMax) {
            this.derivedFrameCounter = 0;
        }

        if (this.derivedFrameCounter===1 || this.derivedFrameCounter===3) {

            // Clock length & sweep:
            this.triangle.clockLengthCounter();
            this.square1.clockLengthCounter();
            this.square2.clockLengthCounter();
            this.noise.clockLengthCounter();
            this.square1.clockSweep();
            this.square2.clockSweep();

        }

        if (this.derivedFrameCounter >= 0 && this.derivedFrameCounter < 4) {

            // Clock linear & decay:
            this.square1.clockEnvDecay();
            this.square2.clockEnvDecay();
            this.noise.clockEnvDecay();
            this.triangle.clockLinearCounter();

        }

        if (this.derivedFrameCounter === 3 && this.countSequence===0) {

            // Enable IRQ:
            this.frameIrqActive = true;

        }


        // End of 240Hz tick

    }

    // Samples the channels, mixes the output together,
    // writes to buffer and (if enabled) file.
    sample() {
        var sq_index, tnd_index;

        if (this.accCount > 0) {

            this.smpSquare1 <<= 4;
            this.smpSquare1 = Math.floor(this.smpSquare1 / this.accCount);

            this.smpSquare2 <<= 4;
            this.smpSquare2 = Math.floor(this.smpSquare2 / this.accCount);

            this.smpTriangle = Math.floor(this.smpTriangle / this.accCount);

            this.smpDmc <<= 4;
            this.smpDmc = Math.floor(this.smpDmc / this.accCount);

            this.accCount = 0;
        }
        else {
            this.smpSquare1 = this.square1.sampleValue << 4;
            this.smpSquare2 = this.square2.sampleValue << 4;
            this.smpTriangle = this.triangle.sampleValue;
            this.smpDmc = this.dmc.sample << 4;
        }

        var smpNoise = Math.floor((this.noise.accValue << 4) /
                this.noise.accCount);
        this.noise.accValue = smpNoise >> 4;
        this.noise.accCount = 1;

        sq_index  = (
                this.smpSquare1 * this.posSquare1 +
                this.smpSquare2 * this.posSquare2
            ) >> 8;
        tnd_index = (
                3 * this.smpTriangle * this.posTriangle +
                (smpNoise<<1) * this.posNoise + this.smpDmc *
                this.posDMC
            ) >> 8;
        if (sq_index >= this.square_table.length) {
            sq_index  = this.square_table.length-1;
        }
        if (tnd_index >= this.tnd_table.length) {
            tnd_index = this.tnd_table.length - 1;
        }
        var sampleValue = this.square_table[sq_index] +
                this.tnd_table[tnd_index] - this.dcValue;

        // Remove DC from left channel:
        var smpDiffL = sampleValue - this.prevSample;
        this.prevSample += smpDiffL;
        this.smpAccum += smpDiffL - (this.smpAccum >> 10);
        sampleValue = this.smpAccum;

        // Write:
        if (sampleValue > this.maxSample) {
            this.maxSample = sampleValue;
        }
        if (sampleValue < this.minSample) {
            this.minSample = sampleValue;
        }

        // output
        this.onAudioSample(sampleValue / 32768);

        // Reset sampled values:
        this.smpSquare1 = 0;
        this.smpSquare2 = 0;
        this.smpTriangle = 0;
        this.smpDmc = 0;
    }

    getLengthMax(value: number): number {
        return this.lengthLookup[value >> 3];
    }

    getDmcFrequency(value: number): number {
        if (value >= 0 && value < 0x10) {
            return this.dmcFreqLookup[value];
        }
        return 0;
    }

    getNoiseWaveLength(value: number): number {
        if (value >= 0 && value < 0x10) {
            return this.noiseWavelengthLookup[value];
        }
        return 0;
    }

    setPanning(pos: number[]) {
        for (var i = 0; i < 5; i++) {
            this.panning[i] = pos[i];
        }
        this.updateStereoPos();
    }

    setMasterVolume(value: number) {
        if (value < 0) {
            value = 0;
        }
        if (value > 256) {
            value = 256;
        }
        this.masterVolume = value;
        this.updateStereoPos();
    }

    updateStereoPos() {
        this.posSquare1 = (this.panning[0] * this.masterVolume) >> 8;
        this.posSquare2 = (this.panning[1] * this.masterVolume) >> 8;
        this.posTriangle = (this.panning[2] * this.masterVolume) >> 8;
        this.posNoise = (this.panning[3] * this.masterVolume) >> 8;
        this.posDMC = (this.panning[4] * this.masterVolume) >> 8;
    }

    initLengthLookup() {

        this.lengthLookup = [
            0x0A, 0xFE,
            0x14, 0x02,
            0x28, 0x04,
            0x50, 0x06,
            0xA0, 0x08,
            0x3C, 0x0A,
            0x0E, 0x0C,
            0x1A, 0x0E,
            0x0C, 0x10,
            0x18, 0x12,
            0x30, 0x14,
            0x60, 0x16,
            0xC0, 0x18,
            0x48, 0x1A,
            0x10, 0x1C,
            0x20, 0x1E
        ];
    }

    initDmcFrequencyLookup() {

        this.dmcFreqLookup = new Array(16);

        this.dmcFreqLookup[0x0] = 0xD60;
        this.dmcFreqLookup[0x1] = 0xBE0;
        this.dmcFreqLookup[0x2] = 0xAA0;
        this.dmcFreqLookup[0x3] = 0xA00;
        this.dmcFreqLookup[0x4] = 0x8F0;
        this.dmcFreqLookup[0x5] = 0x7F0;
        this.dmcFreqLookup[0x6] = 0x710;
        this.dmcFreqLookup[0x7] = 0x6B0;
        this.dmcFreqLookup[0x8] = 0x5F0;
        this.dmcFreqLookup[0x9] = 0x500;
        this.dmcFreqLookup[0xA] = 0x470;
        this.dmcFreqLookup[0xB] = 0x400;
        this.dmcFreqLookup[0xC] = 0x350;
        this.dmcFreqLookup[0xD] = 0x2A0;
        this.dmcFreqLookup[0xE] = 0x240;
        this.dmcFreqLookup[0xF] = 0x1B0;
        //for(int i=0;i<16;i++)dmcFreqLookup[i]/=8;

    }

    initNoiseWavelengthLookup() {

        this.noiseWavelengthLookup = new Array(16);

        this.noiseWavelengthLookup[0x0] = 0x004;
        this.noiseWavelengthLookup[0x1] = 0x008;
        this.noiseWavelengthLookup[0x2] = 0x010;
        this.noiseWavelengthLookup[0x3] = 0x020;
        this.noiseWavelengthLookup[0x4] = 0x040;
        this.noiseWavelengthLookup[0x5] = 0x060;
        this.noiseWavelengthLookup[0x6] = 0x080;
        this.noiseWavelengthLookup[0x7] = 0x0A0;
        this.noiseWavelengthLookup[0x8] = 0x0CA;
        this.noiseWavelengthLookup[0x9] = 0x0FE;
        this.noiseWavelengthLookup[0xA] = 0x17C;
        this.noiseWavelengthLookup[0xB] = 0x1FC;
        this.noiseWavelengthLookup[0xC] = 0x2FA;
        this.noiseWavelengthLookup[0xD] = 0x3F8;
        this.noiseWavelengthLookup[0xE] = 0x7F2;
        this.noiseWavelengthLookup[0xF] = 0xFE4;

    }

    initDACtables() {
        var value, ival, i;
        var max_sqr = 0;
        var max_tnd = 0;

        this.square_table = new Array(32*16);
        this.tnd_table = new Array(204*16);

        for (i = 0; i < 32 * 16; i++) {
            value = 95.52 / (8128.0 / (i/16.0) + 100.0);
            value *= 0.98411;
            value *= 50000.0;
            ival = Math.floor(value);

            this.square_table[i] = ival;
            if (ival > max_sqr) {
                max_sqr = ival;
            }
        }

        for (i = 0; i < 204 * 16; i++) {
            value = 163.67 / (24329.0 / (i/16.0) + 100.0);
            value *= 0.98411;
            value *= 50000.0;
            ival = Math.floor(value);

            this.tnd_table[i] = ival;
            if (ival > max_tnd) {
                max_tnd = ival;
            }

        }

        this.dacRange = max_sqr+max_tnd;
        this.dcValue = this.dacRange/2;

    }
}

enum PlayMode {
    NORMAL = 0,
    LOOP = 1,
    IRQ = 2
}

class ChannelDM {

    isEnabled: boolean
    hasSample: boolean
    irqGenerated: boolean
    playMode: PlayMode
    dmaFrequency: number
    dmaCounter: number
    deltaCounter: number
    playStartAddress: number
    playAddress: number
    playLength: number
    playLengthCounter: number
    shiftCounter: number
    reg4012: number
    reg4013: number
    sample: number
    dacLsb: number
    data: number

    constructor(private apu: APU) {

        this.isEnabled = false;
        this.hasSample = false;
        this.irqGenerated = false;
        this.playMode = PlayMode.NORMAL;
        this.dmaFrequency = 0;
        this.dmaCounter = 0;
        this.deltaCounter = 0;
        this.playStartAddress = 0;
        this.playAddress = 0;
        this.playLength = 0;
        this.playLengthCounter = 0;
        this.sample = 0;
        this.dacLsb = 0;
        this.shiftCounter = 0;
        this.reg4012 = 0;
        this.reg4013 = 0;
        this.data = 0;
    }

    clockDmc() {

        // Only alter DAC value if the sample buffer has data:
        if(this.hasSample) {

            if ((this.data & 1) === 0) {

                // Decrement delta:
                if(this.deltaCounter>0) {
                    this.deltaCounter--;
                }
            }
            else {
                // Increment delta:
                if (this.deltaCounter < 63) {
                    this.deltaCounter++;
                }
            }

            // Update sample value:
            this.sample = this.isEnabled ? (this.deltaCounter << 1) + this.dacLsb : 0;

            // Update shift register:
            this.data >>= 1;

        }

        this.dmaCounter--;
        if (this.dmaCounter <= 0) {

            // No more sample bits.
            this.hasSample = false;
            this.endOfSample();
            this.dmaCounter = 8;

        }

        if (this.irqGenerated) {
            this.apu.cpu.requestIrq(InstructionRequest.NORMAL);
        }

    }

    endOfSample() {
        if (this.playLengthCounter === 0 && this.playMode === PlayMode.LOOP) {

            // Start from beginning of sample:
            this.playAddress = this.playStartAddress;
            this.playLengthCounter = this.playLength;

        }

        if (this.playLengthCounter > 0) {

            // Fetch next sample:
            this.nextSample();

            if (this.playLengthCounter === 0) {

                // Last byte of sample fetched, generate IRQ:
                if (this.playMode === PlayMode.IRQ) {

                    // Generate IRQ:
                    this.irqGenerated = true;

                }

            }

        }

    }

    nextSample() {
        // Fetch byte:
        this.data = this.apu.cpu.mapper.load(this.playAddress);
        this.apu.cpu.haltCycles(4);

        this.playLengthCounter--;
        this.playAddress++;
        if (this.playAddress > 0xFFFF) {
            this.playAddress = 0x8000;
        }

        this.hasSample = true;
    }

    writeReg(address: number, value: number) {
        if (address === 0x4010) {

            // Play mode, DMA Frequency
            if ((value >> 6) === 0) {
                this.playMode = PlayMode.NORMAL;
            }
            else if (((value >> 6) & 1) === 1) {
                this.playMode = PlayMode.LOOP;
            }
            else if ((value >> 6) === 2) {
                this.playMode = PlayMode.IRQ;
            }

            if ((value & 0x80) === 0) {
                this.irqGenerated = false;
            }

            this.dmaFrequency = this.apu.getDmcFrequency(value & 0xF);

        }
        else if (address === 0x4011) {

            // Delta counter load register:
            this.deltaCounter = (value >> 1) & 63;
            this.dacLsb = value & 1;
            this.sample = ((this.deltaCounter << 1) + this.dacLsb); // update sample value

        }
        else if (address === 0x4012) {

            // DMA address load register
            this.playStartAddress = (value << 6) | 0x0C000;
            this.playAddress = this.playStartAddress;
            this.reg4012 = value;

        }
        else if (address === 0x4013) {

            // Length of play code
            this.playLength = (value << 4) + 1;
            this.playLengthCounter = this.playLength;
            this.reg4013 = value;

        }
        else if (address === 0x4015) {

            // DMC/IRQ Status
            if (((value >> 4) & 1) === 0) {
                // Disable:
                this.playLengthCounter = 0;
            }
            else {
                // Restart:
                this.playAddress = this.playStartAddress;
                this.playLengthCounter = this.playLength;
            }
            this.irqGenerated = false;
        }
    }

    setEnabled(value: boolean) {
        if ((!this.isEnabled) && value) {
            this.playLengthCounter = this.playLength;
        }
        this.isEnabled = value;
    }

    getLengthStatus(): number {
        return ((this.playLengthCounter === 0 || !this.isEnabled) ? 0 : 1);
    }

    getIrqStatus(): number {
        return (this.irqGenerated ? 1 : 0);
    }
}

class ChannelNoise {

    progTimerCount: number
    progTimerMax: number
    isEnabled: boolean
    lengthCounter: number
    lengthCounterEnable: boolean
    envReset: boolean
    envDecayDisable: boolean
    envDecayLoopEnable: boolean
    shiftNow: boolean
    envDecayRate: number
    envDecayCounter: number
    envVolume: number
    masterVolume: number
    shiftReg: number;
    randomBit: number
    randomMode: number
    sampleValue: number
    accValue: number
    accCount: number
    tmp: number

    constructor(private apu: APU) {
        this.progTimerCount = 0;
        this.progTimerMax = 0;
        this.isEnabled = false;
        this.lengthCounter = 0;
        this.lengthCounterEnable = false;
        this.envReset = false;
        this.envDecayDisable = false;
        this.envDecayLoopEnable = false;
        this.shiftNow = false;
        this.envDecayRate = 0;
        this.envDecayCounter = 0;
        this.envVolume = 0;
        this.masterVolume = 0;
        this.shiftReg = 1; // or 1<<14;
        this.randomBit = 0;
        this.randomMode = 0;
        this.sampleValue = 0;
        this.accValue=0;
        this.accCount=1;
        this.tmp = 0;
    }

    clockLengthCounter() {
        if (this.lengthCounterEnable && this.lengthCounter>0) {
            this.lengthCounter--;
            if (this.lengthCounter === 0) {
                this.updateSampleValue();
            }
        }
    }

    clockEnvDecay() {
        if(this.envReset) {
            // Reset envelope:
            this.envReset = false;
            this.envDecayCounter = this.envDecayRate + 1;
            this.envVolume = 0xF;
        }
        else if (--this.envDecayCounter <= 0) {
            // Normal handling:
            this.envDecayCounter = this.envDecayRate + 1;
            if(this.envVolume>0) {
                this.envVolume--;
            }
            else {
                this.envVolume = this.envDecayLoopEnable ? 0xF : 0;
            }
        }
        this.masterVolume = this.envDecayDisable ? this.envDecayRate : this.envVolume;
        this.updateSampleValue();
    }

    updateSampleValue() {
        if (this.isEnabled && this.lengthCounter>0) {
            this.sampleValue = this.randomBit * this.masterVolume;
        }
    }

    writeReg(address: number, value: number) {
        if(address === 0x400C) {
            // Volume/Envelope decay:
            this.envDecayDisable = ((value&0x10) !== 0);
            this.envDecayRate = value&0xF;
            this.envDecayLoopEnable = ((value&0x20) !== 0);
            this.lengthCounterEnable = ((value&0x20)===0);
            this.masterVolume = this.envDecayDisable?this.envDecayRate:this.envVolume;
        }
        else if (address === 0x400E) {
            // Programmable timer:
            this.progTimerMax = this.apu.getNoiseWaveLength(value&0xF);
            this.randomMode = value>>7;
        }
        else if (address === 0x400F) {
            // Length counter
            this.lengthCounter = this.apu.getLengthMax(value&248);
            this.envReset = true;
        }
        // Update:
        //updateSampleValue();
    }

    setEnabled(value: boolean) {
        this.isEnabled = value;
        if (!value) {
            this.lengthCounter = 0;
        }
        this.updateSampleValue();
    }

    getLengthStatus() {
        return ((this.lengthCounter===0 || !this.isEnabled)?0:1);
    }
}

class ChannelSquare {
    public progTimerCount: number
    public progTimerMax: number
    public lengthCounter: number
    public squareCounter: number
    public sweepCounter: number
    public sweepCounterMax: number
    public sweepMode: number
    public sweepShiftAmount: number
    public envReset: boolean
    public envDecayRate: number
    public envDecayCounter: number
    public envVolume: number
    public masterVolume: number
    public dutyMode: number
    public sampleValue: number
    public vol: number

    public isEnabled: boolean
    public lengthCounterEnable: boolean
    public sweepActive: boolean
    public sweepCarry: boolean
    public updateSweepPeriod: boolean
    public envDecayDisable: boolean
    public envDecayLoopEnable: boolean

    public dutyLookup: number[]
    public impLookup: number[]

    constructor(private apu: APU, private sqr1: boolean) {

        this.dutyLookup = [
            0, 1, 0, 0, 0, 0, 0, 0,
            0, 1, 1, 0, 0, 0, 0, 0,
            0, 1, 1, 1, 1, 0, 0, 0,
            1, 0, 0, 1, 1, 1, 1, 1
        ];
        this.impLookup = [
            1,-1, 0, 0, 0, 0, 0, 0,
            1, 0,-1, 0, 0, 0, 0, 0,
            1, 0, 0, 0,-1, 0, 0, 0,
            -1, 0, 1, 0, 0, 0, 0, 0
        ];

        this.progTimerCount = 0;
        this.progTimerMax = 0;
        this.lengthCounter = 0;
        this.squareCounter = 0;
        this.sweepCounter = 0;
        this.sweepCounterMax = 0;
        this.sweepMode = 0;
        this.sweepShiftAmount = 0;
        this.envReset = false;
        this.envDecayRate = 0;
        this.envDecayCounter = 0;
        this.envVolume = 0;
        this.masterVolume = 0;
        this.dutyMode = 0;
        this.vol = 0;

        this.isEnabled = false;
        this.lengthCounterEnable = false;
        this.sweepActive = false;
        this.sweepCarry = false;
        this.updateSweepPeriod = false;
        this.envDecayDisable = false;
        this.envDecayLoopEnable = false;
    }

    public clockLengthCounter() {
        if (this.lengthCounterEnable && this.lengthCounter > 0) {
            this.lengthCounter -= 1;
            if (this.lengthCounter === 0) {
                this.updateSampleValue();
            }
        }
    }

    public clockEnvDecay() {
        if (this.envReset) {
            // Reset envelope:
            this.envReset = false;
            this.envDecayCounter = this.envDecayRate + 1;
            this.envVolume = 0xF;
        }
        else if ((--this.envDecayCounter) <= 0) {
            // Normal handling:
            this.envDecayCounter = this.envDecayRate + 1;
            if (this.envVolume>0) {
                this.envVolume -= 1;
            }
            else {
                this.envVolume = this.envDecayLoopEnable ? 0xF : 0;
            }
        }

        this.masterVolume = this.envDecayDisable ? this.envDecayRate : this.envVolume;
        this.updateSampleValue();
    }

    public clockSweep() {
        this.sweepCounter -= 1;
        if (this.sweepCounter <= 0) {
            this.sweepCounter = this.sweepCounterMax + 1;
            if (this.sweepActive && this.sweepShiftAmount>0 && this.progTimerMax>7) {
                // Calculate result from shifter:
                this.sweepCarry = false;
                if (this.sweepMode===0) {
                    this.progTimerMax += (this.progTimerMax>>this.sweepShiftAmount);
                    if (this.progTimerMax > 4095) {
                        this.progTimerMax = 4095;
                        this.sweepCarry = true;
                    }
                }
                else {
                    this.progTimerMax = this.progTimerMax - ((this.progTimerMax>>this.sweepShiftAmount)-(this.sqr1?1:0));
                }
            }
        }

        if (this.updateSweepPeriod) {
            this.updateSweepPeriod = false;
            this.sweepCounter = this.sweepCounterMax + 1;
        }
    }

    public updateSampleValue() {
        if (this.isEnabled && this.lengthCounter>0 && this.progTimerMax>7) {
            if (this.sweepMode===0 && (this.progTimerMax + (this.progTimerMax>>this.sweepShiftAmount)) > 4095) {
            //if (this.sweepCarry) {
                this.sampleValue = 0;
            }
            else {
                this.sampleValue = this.masterVolume*this.dutyLookup[(this.dutyMode<<3)+this.squareCounter];
            }
        }
        else {
            this.sampleValue = 0;
        }
    }

    public writeReg(address: number, value: number) {
        var addrAdd = (this.sqr1?0:4);
        if (address === 0x4000 + addrAdd) {
            // Volume/Envelope decay:
            this.envDecayDisable = ((value&0x10) !== 0);
            this.envDecayRate = value & 0xF;
            this.envDecayLoopEnable = ((value&0x20) !== 0);
            this.dutyMode = (value>>6)&0x3;
            this.lengthCounterEnable = ((value&0x20)===0);
            this.masterVolume = this.envDecayDisable?this.envDecayRate:this.envVolume;
            this.updateSampleValue();
        }
        else if (address === 0x4001+addrAdd) {
            // Sweep:
            this.sweepActive = ((value&0x80) !== 0);
            this.sweepCounterMax = ((value>>4)&7);
            this.sweepMode = (value>>3)&1;
            this.sweepShiftAmount = value&7;
            this.updateSweepPeriod = true;
        }
        else if (address === 0x4002+addrAdd) {
            // Programmable timer:
            this.progTimerMax &= 0x700;
            this.progTimerMax |= value;
        }
        else if (address === 0x4003+addrAdd) {
            // Programmable timer, length counter
            this.progTimerMax &= 0xFF;
            this.progTimerMax |= ((value&0x7)<<8);
            if (this.isEnabled) {
                this.lengthCounter = this.apu.getLengthMax(value&0xF8);
            }
            this.envReset  = true;
        }
    }

    public setEnabled(value: boolean) {
        this.isEnabled = value;
        if (!value) {
            this.lengthCounter = 0;
        }
        this.updateSampleValue();
    }

    public getLengthStatus() {
        return ((this.lengthCounter === 0 || !this.isEnabled) ? 0 : 1);
    }
}

class ChannelTriangle {
    public progTimerCount: number
    public progTimerMax: number
    public triangleCounter: number
    public isEnabled: boolean
    public sampleCondition: boolean
    public lengthCounter: number
    public lengthCounterEnable: boolean
    public linearCounter: number
    public lcLoadValue: number
    public lcHalt: boolean
    public lcControl: boolean
    public tmp: number
    public sampleValue: number

    constructor(private apu: APU) {
        this.progTimerCount = 0;
        this.progTimerMax = 0;
        this.triangleCounter = 0;
        this.isEnabled = false;
        this.sampleCondition = false;
        this.lengthCounter = 0;
        this.lengthCounterEnable = false;
        this.linearCounter = 0;
        this.lcLoadValue = 0;
        this.lcHalt = true;
        this.lcControl = false;
        this.tmp = 0;
        this.sampleValue = 0xF;
    }

    public clockLengthCounter() {
        if (this.lengthCounterEnable && this.lengthCounter>0) {
            this.lengthCounter -= 1;
            if (this.lengthCounter===0) {
                this.updateSampleCondition();
            }
        }
    }

    public clockLinearCounter() {
        if (this.lcHalt) {
            // Load:
            this.linearCounter = this.lcLoadValue;
            this.updateSampleCondition();
        }
        else if (this.linearCounter > 0) {
            // Decrement:
            this.linearCounter -= 1;
            this.updateSampleCondition();
        }
        if (!this.lcControl) {
            // Clear halt flag:
            this.lcHalt = false;
        }
    }

    public getLengthStatus(): number {
        return ((this.lengthCounter === 0 || !this.isEnabled)?0:1);
    }

    public readReg(address: number): number {
        return 0;
    }

    public writeReg(address: number, value: number) {
        if (address === 0x4008) {
            // New values for linear counter:
            this.lcControl  = (value&0x80)!==0;
            this.lcLoadValue =  value&0x7F;

            // Length counter enable:
            this.lengthCounterEnable = !this.lcControl;
        }
        else if (address === 0x400A) {
            // Programmable timer:
            this.progTimerMax &= 0x700;
            this.progTimerMax |= value;

        }
        else if(address === 0x400B) {
            // Programmable timer, length counter
            this.progTimerMax &= 0xFF;
            this.progTimerMax |= ((value&0x07)<<8);
            this.lengthCounter = this.apu.getLengthMax(value&0xF8);
            this.lcHalt = true;
        }

        this.updateSampleCondition();
    }

    public clockProgrammableTimer(nCycles: number) {
        if (this.progTimerMax>0) {
            this.progTimerCount += nCycles;
            while (this.progTimerMax > 0 &&
                    this.progTimerCount >= this.progTimerMax) {
                this.progTimerCount -= this.progTimerMax;
                if (this.isEnabled && this.lengthCounter>0 &&
                        this.linearCounter > 0) {
                    this.clockTriangleGenerator();
                }
            }
        }
    }

    public clockTriangleGenerator() {
        this.triangleCounter += 1;
        this.triangleCounter &= 0x1F;
    }

    public setEnabled(value: boolean) {
        this.isEnabled = value;
        if(!value) {
            this.lengthCounter = 0;
        }
        this.updateSampleCondition();
    }

    public updateSampleCondition() {
        this.sampleCondition = this.isEnabled &&
                this.progTimerMax > 7 &&
                this.linearCounter > 0 &&
                this.lengthCounter > 0;
    }
}
