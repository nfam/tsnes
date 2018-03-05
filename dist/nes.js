var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
(function (factory) {
    if (typeof module === "object" && typeof module.exports === "object") {
        var v = factory(require, exports);
        if (v !== undefined) module.exports = v;
    }
    else if (typeof define === "function" && define.amd) {
        define(["require", "exports"], factory);
    }
})(function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var preferredFrameRate = 60;
    var CPU_FREQ_NTSC = 1789772.5;
    var APU = /** @class */ (function () {
        function APU(cpu, onAudioSample) {
            this.cpu = cpu;
            this.onAudioSample = onAudioSample;
            this.square1 = new ChannelSquare(this, true);
            this.square2 = new ChannelSquare(this, false);
            this.triangle = new ChannelTriangle(this);
            this.noise = new ChannelNoise(this);
            this.dmc = new ChannelDM(this);
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
            this.startedPlaying = false;
            this.recordOutput = false;
            this.initingHardware = false;
            this.masterFrameCounter = 0;
            this.derivedFrameCounter = 0;
            this.countSequence = 0;
            this.sampleTimer = 0;
            this.frameTime = Math.floor((14915.0 * preferredFrameRate) / 60.0);
            this.sampleTimerMax = Math.floor((1024.0 * CPU_FREQ_NTSC * preferredFrameRate) / (this.sampleRate * 60.0));
            this.sampleCount = 0;
            this.triValue = 0;
            this.accCount = 0;
            this.smpSquare1 = 0;
            this.smpSquare2 = 0;
            this.smpTriangle = 0;
            this.smpDmc = 0;
            this.prevSample = 0;
            this.smpAccum = 0;
            this.dacRange = 0;
            this.dcValue = 0;
            this.masterVolume = 256;
            this.posSquare1 = null;
            this.posSquare2 = null;
            this.posTriangle = null;
            this.posNoise = null;
            this.posDMC = null;
            this.extraCycles = null;
            this.maxSample = -500000;
            this.minSample = 500000;
            this.panning = [80, 170, 100, 150, 128];
            this.setPanning(this.panning);
            this.initLengthLookup();
            this.initDmcFrequencyLookup();
            this.initNoiseWavelengthLookup();
            this.initDACtables();
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
        APU.prototype.readReg = function (address) {
            var tmp = 0;
            tmp |= (this.square1.getLengthStatus());
            tmp |= (this.square2.getLengthStatus() << 1);
            tmp |= (this.triangle.getLengthStatus() << 2);
            tmp |= (this.noise.getLengthStatus() << 3);
            tmp |= (this.dmc.getLengthStatus() << 4);
            tmp |= (((this.frameIrqActive && this.frameIrqEnabled) ? 1 : 0) << 6);
            tmp |= (this.dmc.getIrqStatus() << 7);
            this.frameIrqActive = false;
            this.dmc.irqGenerated = false;
            return tmp & 0xFFFF;
        };
        APU.prototype.writeReg = function (address, value) {
            if (address >= 0x4000 && address < 0x4004) {
                this.square1.writeReg(address, value);
            }
            else if (address >= 0x4004 && address < 0x4008) {
                this.square2.writeReg(address, value);
            }
            else if (address >= 0x4008 && address < 0x400C) {
                this.triangle.writeReg(address, value);
            }
            else if (address >= 0x400C && address <= 0x400F) {
                this.noise.writeReg(address, value);
            }
            else if (address === 0x4010) {
                this.dmc.writeReg(address, value);
            }
            else if (address === 0x4011) {
                this.dmc.writeReg(address, value);
            }
            else if (address === 0x4012) {
                this.dmc.writeReg(address, value);
            }
            else if (address === 0x4013) {
                this.dmc.writeReg(address, value);
            }
            else if (address === 0x4015) {
                this.updateChannelEnable(value);
                if (value !== 0 && this.initCounter > 0) {
                    this.initingHardware = true;
                }
                this.dmc.writeReg(address, value);
            }
            else if (address === 0x4017) {
                this.countSequence = (value >> 7) & 1;
                this.masterFrameCounter = 0;
                this.frameIrqActive = false;
                if (((value >> 6) & 0x1) === 0) {
                    this.frameIrqEnabled = true;
                }
                else {
                    this.frameIrqEnabled = false;
                }
                if (this.countSequence === 0) {
                    this.frameIrqCounterMax = 4;
                    this.derivedFrameCounter = 4;
                }
                else {
                    this.frameIrqCounterMax = 5;
                    this.derivedFrameCounter = 0;
                    this.frameCounterTick();
                }
            }
        };
        APU.prototype.updateChannelEnable = function (value) {
            this.channelEnableValue = value & 0xFFFF;
            this.square1.setEnabled((value & 1) !== 0);
            this.square2.setEnabled((value & 2) !== 0);
            this.triangle.setEnabled((value & 4) !== 0);
            this.noise.setEnabled((value & 8) !== 0);
            this.dmc.setEnabled((value & 16) !== 0);
        };
        APU.prototype.clockFrameCounter = function (nCycles) {
            if (this.initCounter > 0) {
                if (this.initingHardware) {
                    this.initCounter -= nCycles;
                    if (this.initCounter <= 0) {
                        this.initingHardware = false;
                    }
                    return;
                }
            }
            nCycles += this.extraCycles;
            var maxCycles = this.sampleTimerMax - this.sampleTimer;
            if ((nCycles << 10) > maxCycles) {
                this.extraCycles = ((nCycles << 10) - maxCycles) >> 10;
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
            if (dmc.isEnabled) {
                dmc.shiftCounter -= (nCycles << 3);
                while (dmc.shiftCounter <= 0 && dmc.dmaFrequency > 0) {
                    dmc.shiftCounter += dmc.dmaFrequency;
                    dmc.clockDmc();
                }
            }
            if (triangle.progTimerMax > 0) {
                triangle.progTimerCount -= nCycles;
                while (triangle.progTimerCount <= 0) {
                    triangle.progTimerCount += triangle.progTimerMax + 1;
                    if (triangle.linearCounter > 0 && triangle.lengthCounter > 0) {
                        triangle.triangleCounter++;
                        triangle.triangleCounter &= 0x1F;
                        if (triangle.isEnabled) {
                            if (triangle.triangleCounter >= 0x10) {
                                triangle.sampleValue = (triangle.triangleCounter & 0xF);
                            }
                            else {
                                triangle.sampleValue = (0xF - (triangle.triangleCounter & 0xF));
                            }
                            triangle.sampleValue <<= 4;
                        }
                    }
                }
            }
            square1.progTimerCount -= nCycles;
            if (square1.progTimerCount <= 0) {
                square1.progTimerCount += (square1.progTimerMax + 1) << 1;
                square1.squareCounter++;
                square1.squareCounter &= 0x7;
                square1.updateSampleValue();
            }
            square2.progTimerCount -= nCycles;
            if (square2.progTimerCount <= 0) {
                square2.progTimerCount += (square2.progTimerMax + 1) << 1;
                square2.squareCounter++;
                square2.squareCounter &= 0x7;
                square2.updateSampleValue();
            }
            var acc_c = nCycles;
            if (noise.progTimerCount - acc_c > 0) {
                noise.progTimerCount -= acc_c;
                noise.accCount += acc_c;
                noise.accValue += acc_c * noise.sampleValue;
            }
            else {
                while ((acc_c--) > 0) {
                    if (--noise.progTimerCount <= 0 && noise.progTimerMax > 0) {
                        noise.shiftReg <<= 1;
                        noise.tmp = (((noise.shiftReg << (noise.randomMode === 0 ? 1 : 6)) ^ noise.shiftReg) & 0x8000);
                        if (noise.tmp !== 0) {
                            noise.shiftReg |= 0x01;
                            noise.randomBit = 0;
                            noise.sampleValue = 0;
                        }
                        else {
                            noise.randomBit = 1;
                            if (noise.isEnabled && noise.lengthCounter > 0) {
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
            if (this.frameIrqEnabled && this.frameIrqActive) {
                this.cpu.requestIrq(InstructionRequest.NORMAL);
            }
            this.masterFrameCounter += (nCycles << 1);
            if (this.masterFrameCounter >= this.frameTime) {
                this.masterFrameCounter -= this.frameTime;
                this.frameCounterTick();
            }
            this.accSample(nCycles);
            this.sampleTimer += nCycles << 10;
            if (this.sampleTimer >= this.sampleTimerMax) {
                this.sample();
                this.sampleTimer -= this.sampleTimerMax;
            }
        };
        APU.prototype.accSample = function (cycles) {
            if (this.triangle.sampleCondition) {
                this.triValue = Math.floor((this.triangle.progTimerCount << 4) /
                    (this.triangle.progTimerMax + 1));
                if (this.triValue > 16) {
                    this.triValue = 16;
                }
                if (this.triangle.triangleCounter >= 16) {
                    this.triValue = 16 - this.triValue;
                }
                this.triValue += this.triangle.sampleValue;
            }
            if (cycles === 2) {
                this.smpTriangle += this.triValue << 1;
                this.smpDmc += this.dmc.sample << 1;
                this.smpSquare1 += this.square1.sampleValue << 1;
                this.smpSquare2 += this.square2.sampleValue << 1;
                this.accCount += 2;
            }
            else if (cycles === 4) {
                this.smpTriangle += this.triValue << 2;
                this.smpDmc += this.dmc.sample << 2;
                this.smpSquare1 += this.square1.sampleValue << 2;
                this.smpSquare2 += this.square2.sampleValue << 2;
                this.accCount += 4;
            }
            else {
                this.smpTriangle += cycles * this.triValue;
                this.smpDmc += cycles * this.dmc.sample;
                this.smpSquare1 += cycles * this.square1.sampleValue;
                this.smpSquare2 += cycles * this.square2.sampleValue;
                this.accCount += cycles;
            }
        };
        APU.prototype.frameCounterTick = function () {
            this.derivedFrameCounter++;
            if (this.derivedFrameCounter >= this.frameIrqCounterMax) {
                this.derivedFrameCounter = 0;
            }
            if (this.derivedFrameCounter === 1 || this.derivedFrameCounter === 3) {
                this.triangle.clockLengthCounter();
                this.square1.clockLengthCounter();
                this.square2.clockLengthCounter();
                this.noise.clockLengthCounter();
                this.square1.clockSweep();
                this.square2.clockSweep();
            }
            if (this.derivedFrameCounter >= 0 && this.derivedFrameCounter < 4) {
                this.square1.clockEnvDecay();
                this.square2.clockEnvDecay();
                this.noise.clockEnvDecay();
                this.triangle.clockLinearCounter();
            }
            if (this.derivedFrameCounter === 3 && this.countSequence === 0) {
                this.frameIrqActive = true;
            }
        };
        APU.prototype.sample = function () {
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
            sq_index = (this.smpSquare1 * this.posSquare1 +
                this.smpSquare2 * this.posSquare2) >> 8;
            tnd_index = (3 * this.smpTriangle * this.posTriangle +
                (smpNoise << 1) * this.posNoise + this.smpDmc *
                this.posDMC) >> 8;
            if (sq_index >= this.square_table.length) {
                sq_index = this.square_table.length - 1;
            }
            if (tnd_index >= this.tnd_table.length) {
                tnd_index = this.tnd_table.length - 1;
            }
            var sampleValue = this.square_table[sq_index] +
                this.tnd_table[tnd_index] - this.dcValue;
            var smpDiffL = sampleValue - this.prevSample;
            this.prevSample += smpDiffL;
            this.smpAccum += smpDiffL - (this.smpAccum >> 10);
            sampleValue = this.smpAccum;
            if (sampleValue > this.maxSample) {
                this.maxSample = sampleValue;
            }
            if (sampleValue < this.minSample) {
                this.minSample = sampleValue;
            }
            this.onAudioSample(sampleValue / 32768);
            this.smpSquare1 = 0;
            this.smpSquare2 = 0;
            this.smpTriangle = 0;
            this.smpDmc = 0;
        };
        APU.prototype.getLengthMax = function (value) {
            return this.lengthLookup[value >> 3];
        };
        APU.prototype.getDmcFrequency = function (value) {
            if (value >= 0 && value < 0x10) {
                return this.dmcFreqLookup[value];
            }
            return 0;
        };
        APU.prototype.getNoiseWaveLength = function (value) {
            if (value >= 0 && value < 0x10) {
                return this.noiseWavelengthLookup[value];
            }
            return 0;
        };
        APU.prototype.setPanning = function (pos) {
            for (var i = 0; i < 5; i++) {
                this.panning[i] = pos[i];
            }
            this.updateStereoPos();
        };
        APU.prototype.setMasterVolume = function (value) {
            if (value < 0) {
                value = 0;
            }
            if (value > 256) {
                value = 256;
            }
            this.masterVolume = value;
            this.updateStereoPos();
        };
        APU.prototype.updateStereoPos = function () {
            this.posSquare1 = (this.panning[0] * this.masterVolume) >> 8;
            this.posSquare2 = (this.panning[1] * this.masterVolume) >> 8;
            this.posTriangle = (this.panning[2] * this.masterVolume) >> 8;
            this.posNoise = (this.panning[3] * this.masterVolume) >> 8;
            this.posDMC = (this.panning[4] * this.masterVolume) >> 8;
        };
        APU.prototype.initLengthLookup = function () {
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
        };
        APU.prototype.initDmcFrequencyLookup = function () {
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
        };
        APU.prototype.initNoiseWavelengthLookup = function () {
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
        };
        APU.prototype.initDACtables = function () {
            var value, ival, i;
            var max_sqr = 0;
            var max_tnd = 0;
            this.square_table = new Array(32 * 16);
            this.tnd_table = new Array(204 * 16);
            for (i = 0; i < 32 * 16; i++) {
                value = 95.52 / (8128.0 / (i / 16.0) + 100.0);
                value *= 0.98411;
                value *= 50000.0;
                ival = Math.floor(value);
                this.square_table[i] = ival;
                if (ival > max_sqr) {
                    max_sqr = ival;
                }
            }
            for (i = 0; i < 204 * 16; i++) {
                value = 163.67 / (24329.0 / (i / 16.0) + 100.0);
                value *= 0.98411;
                value *= 50000.0;
                ival = Math.floor(value);
                this.tnd_table[i] = ival;
                if (ival > max_tnd) {
                    max_tnd = ival;
                }
            }
            this.dacRange = max_sqr + max_tnd;
            this.dcValue = this.dacRange / 2;
        };
        return APU;
    }());
    var PlayMode;
    (function (PlayMode) {
        PlayMode[PlayMode["NORMAL"] = 0] = "NORMAL";
        PlayMode[PlayMode["LOOP"] = 1] = "LOOP";
        PlayMode[PlayMode["IRQ"] = 2] = "IRQ";
    })(PlayMode || (PlayMode = {}));
    var ChannelDM = /** @class */ (function () {
        function ChannelDM(apu) {
            this.apu = apu;
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
        ChannelDM.prototype.clockDmc = function () {
            if (this.hasSample) {
                if ((this.data & 1) === 0) {
                    if (this.deltaCounter > 0) {
                        this.deltaCounter--;
                    }
                }
                else {
                    if (this.deltaCounter < 63) {
                        this.deltaCounter++;
                    }
                }
                this.sample = this.isEnabled ? (this.deltaCounter << 1) + this.dacLsb : 0;
                this.data >>= 1;
            }
            this.dmaCounter--;
            if (this.dmaCounter <= 0) {
                this.hasSample = false;
                this.endOfSample();
                this.dmaCounter = 8;
            }
            if (this.irqGenerated) {
                this.apu.cpu.requestIrq(InstructionRequest.NORMAL);
            }
        };
        ChannelDM.prototype.endOfSample = function () {
            if (this.playLengthCounter === 0 && this.playMode === PlayMode.LOOP) {
                this.playAddress = this.playStartAddress;
                this.playLengthCounter = this.playLength;
            }
            if (this.playLengthCounter > 0) {
                this.nextSample();
                if (this.playLengthCounter === 0) {
                    if (this.playMode === PlayMode.IRQ) {
                        this.irqGenerated = true;
                    }
                }
            }
        };
        ChannelDM.prototype.nextSample = function () {
            this.data = this.apu.cpu.mapper.load(this.playAddress);
            this.apu.cpu.haltCycles(4);
            this.playLengthCounter--;
            this.playAddress++;
            if (this.playAddress > 0xFFFF) {
                this.playAddress = 0x8000;
            }
            this.hasSample = true;
        };
        ChannelDM.prototype.writeReg = function (address, value) {
            if (address === 0x4010) {
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
                this.deltaCounter = (value >> 1) & 63;
                this.dacLsb = value & 1;
                this.sample = ((this.deltaCounter << 1) + this.dacLsb);
            }
            else if (address === 0x4012) {
                this.playStartAddress = (value << 6) | 0x0C000;
                this.playAddress = this.playStartAddress;
                this.reg4012 = value;
            }
            else if (address === 0x4013) {
                this.playLength = (value << 4) + 1;
                this.playLengthCounter = this.playLength;
                this.reg4013 = value;
            }
            else if (address === 0x4015) {
                if (((value >> 4) & 1) === 0) {
                    this.playLengthCounter = 0;
                }
                else {
                    this.playAddress = this.playStartAddress;
                    this.playLengthCounter = this.playLength;
                }
                this.irqGenerated = false;
            }
        };
        ChannelDM.prototype.setEnabled = function (value) {
            if ((!this.isEnabled) && value) {
                this.playLengthCounter = this.playLength;
            }
            this.isEnabled = value;
        };
        ChannelDM.prototype.getLengthStatus = function () {
            return ((this.playLengthCounter === 0 || !this.isEnabled) ? 0 : 1);
        };
        ChannelDM.prototype.getIrqStatus = function () {
            return (this.irqGenerated ? 1 : 0);
        };
        return ChannelDM;
    }());
    var ChannelNoise = /** @class */ (function () {
        function ChannelNoise(apu) {
            this.apu = apu;
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
            this.shiftReg = 1;
            this.randomBit = 0;
            this.randomMode = 0;
            this.sampleValue = 0;
            this.accValue = 0;
            this.accCount = 1;
            this.tmp = 0;
        }
        ChannelNoise.prototype.clockLengthCounter = function () {
            if (this.lengthCounterEnable && this.lengthCounter > 0) {
                this.lengthCounter--;
                if (this.lengthCounter === 0) {
                    this.updateSampleValue();
                }
            }
        };
        ChannelNoise.prototype.clockEnvDecay = function () {
            if (this.envReset) {
                this.envReset = false;
                this.envDecayCounter = this.envDecayRate + 1;
                this.envVolume = 0xF;
            }
            else if (--this.envDecayCounter <= 0) {
                this.envDecayCounter = this.envDecayRate + 1;
                if (this.envVolume > 0) {
                    this.envVolume--;
                }
                else {
                    this.envVolume = this.envDecayLoopEnable ? 0xF : 0;
                }
            }
            this.masterVolume = this.envDecayDisable ? this.envDecayRate : this.envVolume;
            this.updateSampleValue();
        };
        ChannelNoise.prototype.updateSampleValue = function () {
            if (this.isEnabled && this.lengthCounter > 0) {
                this.sampleValue = this.randomBit * this.masterVolume;
            }
        };
        ChannelNoise.prototype.writeReg = function (address, value) {
            if (address === 0x400C) {
                this.envDecayDisable = ((value & 0x10) !== 0);
                this.envDecayRate = value & 0xF;
                this.envDecayLoopEnable = ((value & 0x20) !== 0);
                this.lengthCounterEnable = ((value & 0x20) === 0);
                this.masterVolume = this.envDecayDisable ? this.envDecayRate : this.envVolume;
            }
            else if (address === 0x400E) {
                this.progTimerMax = this.apu.getNoiseWaveLength(value & 0xF);
                this.randomMode = value >> 7;
            }
            else if (address === 0x400F) {
                this.lengthCounter = this.apu.getLengthMax(value & 248);
                this.envReset = true;
            }
        };
        ChannelNoise.prototype.setEnabled = function (value) {
            this.isEnabled = value;
            if (!value) {
                this.lengthCounter = 0;
            }
            this.updateSampleValue();
        };
        ChannelNoise.prototype.getLengthStatus = function () {
            return ((this.lengthCounter === 0 || !this.isEnabled) ? 0 : 1);
        };
        return ChannelNoise;
    }());
    var ChannelSquare = /** @class */ (function () {
        function ChannelSquare(apu, sqr1) {
            this.apu = apu;
            this.sqr1 = sqr1;
            this.dutyLookup = [
                0, 1, 0, 0, 0, 0, 0, 0,
                0, 1, 1, 0, 0, 0, 0, 0,
                0, 1, 1, 1, 1, 0, 0, 0,
                1, 0, 0, 1, 1, 1, 1, 1
            ];
            this.impLookup = [
                1, -1, 0, 0, 0, 0, 0, 0,
                1, 0, -1, 0, 0, 0, 0, 0,
                1, 0, 0, 0, -1, 0, 0, 0,
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
        ChannelSquare.prototype.clockLengthCounter = function () {
            if (this.lengthCounterEnable && this.lengthCounter > 0) {
                this.lengthCounter -= 1;
                if (this.lengthCounter === 0) {
                    this.updateSampleValue();
                }
            }
        };
        ChannelSquare.prototype.clockEnvDecay = function () {
            if (this.envReset) {
                this.envReset = false;
                this.envDecayCounter = this.envDecayRate + 1;
                this.envVolume = 0xF;
            }
            else if ((--this.envDecayCounter) <= 0) {
                this.envDecayCounter = this.envDecayRate + 1;
                if (this.envVolume > 0) {
                    this.envVolume -= 1;
                }
                else {
                    this.envVolume = this.envDecayLoopEnable ? 0xF : 0;
                }
            }
            this.masterVolume = this.envDecayDisable ? this.envDecayRate : this.envVolume;
            this.updateSampleValue();
        };
        ChannelSquare.prototype.clockSweep = function () {
            this.sweepCounter -= 1;
            if (this.sweepCounter <= 0) {
                this.sweepCounter = this.sweepCounterMax + 1;
                if (this.sweepActive && this.sweepShiftAmount > 0 && this.progTimerMax > 7) {
                    this.sweepCarry = false;
                    if (this.sweepMode === 0) {
                        this.progTimerMax += (this.progTimerMax >> this.sweepShiftAmount);
                        if (this.progTimerMax > 4095) {
                            this.progTimerMax = 4095;
                            this.sweepCarry = true;
                        }
                    }
                    else {
                        this.progTimerMax = this.progTimerMax - ((this.progTimerMax >> this.sweepShiftAmount) - (this.sqr1 ? 1 : 0));
                    }
                }
            }
            if (this.updateSweepPeriod) {
                this.updateSweepPeriod = false;
                this.sweepCounter = this.sweepCounterMax + 1;
            }
        };
        ChannelSquare.prototype.updateSampleValue = function () {
            if (this.isEnabled && this.lengthCounter > 0 && this.progTimerMax > 7) {
                if (this.sweepMode === 0 && (this.progTimerMax + (this.progTimerMax >> this.sweepShiftAmount)) > 4095) {
                    this.sampleValue = 0;
                }
                else {
                    this.sampleValue = this.masterVolume * this.dutyLookup[(this.dutyMode << 3) + this.squareCounter];
                }
            }
            else {
                this.sampleValue = 0;
            }
        };
        ChannelSquare.prototype.writeReg = function (address, value) {
            var addrAdd = (this.sqr1 ? 0 : 4);
            if (address === 0x4000 + addrAdd) {
                this.envDecayDisable = ((value & 0x10) !== 0);
                this.envDecayRate = value & 0xF;
                this.envDecayLoopEnable = ((value & 0x20) !== 0);
                this.dutyMode = (value >> 6) & 0x3;
                this.lengthCounterEnable = ((value & 0x20) === 0);
                this.masterVolume = this.envDecayDisable ? this.envDecayRate : this.envVolume;
                this.updateSampleValue();
            }
            else if (address === 0x4001 + addrAdd) {
                this.sweepActive = ((value & 0x80) !== 0);
                this.sweepCounterMax = ((value >> 4) & 7);
                this.sweepMode = (value >> 3) & 1;
                this.sweepShiftAmount = value & 7;
                this.updateSweepPeriod = true;
            }
            else if (address === 0x4002 + addrAdd) {
                this.progTimerMax &= 0x700;
                this.progTimerMax |= value;
            }
            else if (address === 0x4003 + addrAdd) {
                this.progTimerMax &= 0xFF;
                this.progTimerMax |= ((value & 0x7) << 8);
                if (this.isEnabled) {
                    this.lengthCounter = this.apu.getLengthMax(value & 0xF8);
                }
                this.envReset = true;
            }
        };
        ChannelSquare.prototype.setEnabled = function (value) {
            this.isEnabled = value;
            if (!value) {
                this.lengthCounter = 0;
            }
            this.updateSampleValue();
        };
        ChannelSquare.prototype.getLengthStatus = function () {
            return ((this.lengthCounter === 0 || !this.isEnabled) ? 0 : 1);
        };
        return ChannelSquare;
    }());
    var ChannelTriangle = /** @class */ (function () {
        function ChannelTriangle(apu) {
            this.apu = apu;
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
        ChannelTriangle.prototype.clockLengthCounter = function () {
            if (this.lengthCounterEnable && this.lengthCounter > 0) {
                this.lengthCounter -= 1;
                if (this.lengthCounter === 0) {
                    this.updateSampleCondition();
                }
            }
        };
        ChannelTriangle.prototype.clockLinearCounter = function () {
            if (this.lcHalt) {
                this.linearCounter = this.lcLoadValue;
                this.updateSampleCondition();
            }
            else if (this.linearCounter > 0) {
                this.linearCounter -= 1;
                this.updateSampleCondition();
            }
            if (!this.lcControl) {
                this.lcHalt = false;
            }
        };
        ChannelTriangle.prototype.getLengthStatus = function () {
            return ((this.lengthCounter === 0 || !this.isEnabled) ? 0 : 1);
        };
        ChannelTriangle.prototype.readReg = function (address) {
            return 0;
        };
        ChannelTriangle.prototype.writeReg = function (address, value) {
            if (address === 0x4008) {
                this.lcControl = (value & 0x80) !== 0;
                this.lcLoadValue = value & 0x7F;
                this.lengthCounterEnable = !this.lcControl;
            }
            else if (address === 0x400A) {
                this.progTimerMax &= 0x700;
                this.progTimerMax |= value;
            }
            else if (address === 0x400B) {
                this.progTimerMax &= 0xFF;
                this.progTimerMax |= ((value & 0x07) << 8);
                this.lengthCounter = this.apu.getLengthMax(value & 0xF8);
                this.lcHalt = true;
            }
            this.updateSampleCondition();
        };
        ChannelTriangle.prototype.clockProgrammableTimer = function (nCycles) {
            if (this.progTimerMax > 0) {
                this.progTimerCount += nCycles;
                while (this.progTimerMax > 0 &&
                    this.progTimerCount >= this.progTimerMax) {
                    this.progTimerCount -= this.progTimerMax;
                    if (this.isEnabled && this.lengthCounter > 0 &&
                        this.linearCounter > 0) {
                        this.clockTriangleGenerator();
                    }
                }
            }
        };
        ChannelTriangle.prototype.clockTriangleGenerator = function () {
            this.triangleCounter += 1;
            this.triangleCounter &= 0x1F;
        };
        ChannelTriangle.prototype.setEnabled = function (value) {
            this.isEnabled = value;
            if (!value) {
                this.lengthCounter = 0;
            }
            this.updateSampleCondition();
        };
        ChannelTriangle.prototype.updateSampleCondition = function () {
            this.sampleCondition = this.isEnabled &&
                this.progTimerMax > 7 &&
                this.linearCounter > 0 &&
                this.lengthCounter > 0;
        };
        return ChannelTriangle;
    }());
    /* export */ var Speaker = /** @class */ (function () {
        function Speaker() {
            this.buffer = [];
        }
        Speaker.prototype.close = function () {
            if (this.processor) {
                this.processor.disconnect(this.context.destination);
                this.processor = null;
            }
            if (this.context) {
                this.context.close();
                this.context = null;
            }
        };
        Speaker.prototype.push = function (sample) {
            if (this.proccessorReady()) {
                var samples = Array.isArray(sample) ? sample : [sample];
                for (var i = 0; i < samples.length; i += 1) {
                    this.buffer.push(samples[i]);
                }
            }
        };
        Speaker.prototype.play = function (samples) {
            if (this.contextReady()) {
                var buffer = this.context.createBuffer(1, samples.length, this.context.sampleRate);
                var channel = buffer.getChannelData(0);
                for (var i = 0; i < samples.length; i += 1) {
                    channel[i] = samples[i];
                }
                var source = this.context.createBufferSource();
                source.buffer = buffer;
                source.connect(this.context.destination);
                source.start();
            }
        };
        Speaker.prototype.onaudioprocess = function (event) {
            var chanel = event.outputBuffer.getChannelData(0);
            if (this.onbufferunderrun && this.buffer.length < chanel.length) {
                this.onbufferunderrun(this.buffer.length, chanel.length);
            }
            while (this.buffer.length > chanel.length * 2) {
                this.buffer = this.buffer.slice(chanel.length);
            }
            var size = Math.min(this.buffer.length, chanel.length);
            for (var i = 0; i < size; i++) {
                chanel[i] = this.buffer[i];
            }
            this.buffer = this.buffer.slice(size);
        };
        Speaker.prototype.contextReady = function () {
            if (this.context) {
                return true;
            }
            else if (window) {
                var AudioContext_1 = window.AudioContext || window.webkitAudioContext;
                if (AudioContext_1) {
                    this.context = new AudioContext_1();
                    return true;
                }
                else {
                    return false;
                }
            }
            else {
                return false;
            }
        };
        Speaker.prototype.proccessorReady = function () {
            if (this.processor) {
                return true;
            }
            else if (this.contextReady()) {
                this.buffer = [];
                this.processor = this.context.createScriptProcessor(1024, 1, 1);
                this.processor.onaudioprocess = this.onaudioprocess.bind(this);
                this.processor.connect(this.context.destination);
            }
            else {
                return false;
            }
        };
        return Speaker;
    }());
    exports.Speaker = Speaker;
    var ControllerButtonKey;
    (function (ControllerButtonKey) {
        ControllerButtonKey[ControllerButtonKey["a"] = 0] = "a";
        ControllerButtonKey[ControllerButtonKey["b"] = 1] = "b";
        ControllerButtonKey[ControllerButtonKey["select"] = 2] = "select";
        ControllerButtonKey[ControllerButtonKey["start"] = 3] = "start";
        ControllerButtonKey[ControllerButtonKey["up"] = 4] = "up";
        ControllerButtonKey[ControllerButtonKey["down"] = 5] = "down";
        ControllerButtonKey[ControllerButtonKey["left"] = 6] = "left";
        ControllerButtonKey[ControllerButtonKey["right"] = 7] = "right";
    })(ControllerButtonKey || (ControllerButtonKey = {}));
    var ControllerButtonState;
    (function (ControllerButtonState) {
        ControllerButtonState[ControllerButtonState["down"] = 65] = "down";
        ControllerButtonState[ControllerButtonState["up"] = 64] = "up";
    })(ControllerButtonState || (ControllerButtonState = {}));
    function tickJoycon(joycon, key) {
        if (joycon.turbo[key]) {
            if (joycon.firing[key]) {
                joycon.state[key] = joycon.state[key] === ControllerButtonState.down
                    ? ControllerButtonState.up
                    : ControllerButtonState.down;
            }
            else {
                joycon.firing[key] = true;
                joycon.state[key] = ControllerButtonState.down;
            }
        }
        else if (joycon.firing[key]) {
            joycon.firing[key] = false;
            joycon.state[key] = ControllerButtonState.up;
        }
    }
    var Controller = /** @class */ (function () {
        function Controller() {
            this.tickedOn = 0;
            this.p1 = {
                state: [],
                turbo: {},
                firing: {}
            };
            this.p2 = {
                state: [],
                turbo: {},
                firing: {}
            };
            this.buttonMaps = {
                a: { key: ControllerButtonKey.a, turbo: false },
                A: { key: ControllerButtonKey.a, turbo: true },
                b: { key: ControllerButtonKey.b, turbo: false },
                B: { key: ControllerButtonKey.b, turbo: true },
                select: { key: ControllerButtonKey.select, turbo: false },
                start: { key: ControllerButtonKey.start, turbo: false },
                u: { key: ControllerButtonKey.up, turbo: false },
                d: { key: ControllerButtonKey.down, turbo: false },
                l: { key: ControllerButtonKey.left, turbo: false },
                r: { key: ControllerButtonKey.right, turbo: false }
            };
            for (var i = 0; i < 8; i += 1) {
                this.state1[i] = ControllerButtonState.up;
                this.state1[i] = ControllerButtonState.up;
                this.p1.turbo[i] = false;
                this.p2.firing[i] = false;
            }
        }
        Object.defineProperty(Controller.prototype, "state1", {
            get: function () {
                return this.p1.state;
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(Controller.prototype, "state2", {
            get: function () {
                return this.p2.state;
            },
            enumerable: true,
            configurable: true
        });
        Controller.prototype.frame = function () {
            var now = Date.now();
            if (now - this.tickedOn > 50) {
                for (var i = 0; i < 8; i += 1) {
                    tickJoycon(this.p1, i);
                    tickJoycon(this.p2, i);
                }
                this.tickedOn = now;
            }
        };
        Controller.prototype.buttonDown = function (player, button) {
            var m = this.buttonMaps[button];
            if (!m) {
                return;
            }
            if (player === 1) {
                if (m.turbo) {
                    this.p1.turbo[m.key] = true;
                }
                else {
                    this.p1.state[m.key] = ControllerButtonState.down;
                }
            }
            else if (player === 2) {
                if (m.turbo) {
                    this.p2.turbo[m.key] = true;
                }
                else {
                    this.p2.state[m.key] = ControllerButtonState.down;
                }
            }
        };
        Controller.prototype.buttonUp = function (player, button) {
            var m = this.buttonMaps[button];
            if (!m) {
                return;
            }
            if (player === 1) {
                if (m.turbo) {
                    this.p1.turbo[m.key] = false;
                }
                else {
                    this.p1.state[m.key] = ControllerButtonState.up;
                }
            }
            else if (player === 2) {
                if (m.turbo) {
                    this.p2.turbo[m.key] = false;
                }
                else {
                    this.p2.state[m.key] = ControllerButtonState.up;
                }
            }
        };
        return Controller;
    }());
    var InstructionRequest;
    (function (InstructionRequest) {
        InstructionRequest[InstructionRequest["NORMAL"] = 0] = "NORMAL";
        InstructionRequest[InstructionRequest["NMI"] = 1] = "NMI";
        InstructionRequest[InstructionRequest["RESET"] = 2] = "RESET";
    })(InstructionRequest || (InstructionRequest = {}));
    var CPU = /** @class */ (function () {
        function CPU(mapper) {
            this.mapper = mapper;
            this.mem = new Array(0x10000);
            for (var i = 0; i < 0x2000; i += 1) {
                this.mem[i] = 0xFF;
            }
            for (var i = 0; i < 4; i += 1) {
                var offset = i * 0x800;
                this.mem[offset + 0x008] = 0xF7;
                this.mem[offset + 0x009] = 0xEF;
                this.mem[offset + 0x00A] = 0xDF;
                this.mem[offset + 0x00F] = 0xBF;
            }
            for (var i = 0x2001; i < this.mem.length; i += 1) {
                this.mem[i] = 0;
            }
            this.REG_ACC = 0;
            this.REG_X = 0;
            this.REG_Y = 0;
            this.REG_SP = 0x01FF;
            this.REG_PC = 0x8000 - 1;
            this.REG_PC_NEW = 0x8000 - 1;
            this.REG_STATUS = 0x28;
            this.setStatus(0x28);
            this.F_CARRY = 0;
            this.F_DECIMAL = 0;
            this.F_INTERRUPT = 1;
            this.F_INTERRUPT_NEW = 1;
            this.F_OVERFLOW = 0;
            this.F_SIGN = 0;
            this.F_ZERO = 1;
            this.F_NOTUSED = 1;
            this.F_NOTUSED_NEW = 1;
            this.F_BRK = 1;
            this.F_BRK_NEW = 1;
            this.cyclesToHalt = 0;
            this.crash = false;
            this.irqRequested = false;
            this.irqType = null;
        }
        Object.defineProperty(CPU.prototype, "serializable", {
            get: function () {
                return CPU.serializable;
            },
            enumerable: true,
            configurable: true
        });
        CPU.prototype.emulate = function () {
            var temp;
            var add;
            if (this.irqRequested) {
                temp =
                    (this.F_CARRY) |
                        ((this.F_ZERO === 0 ? 1 : 0) << 1) |
                        (this.F_INTERRUPT << 2) |
                        (this.F_DECIMAL << 3) |
                        (this.F_BRK << 4) |
                        (this.F_NOTUSED << 5) |
                        (this.F_OVERFLOW << 6) |
                        (this.F_SIGN << 7);
                this.REG_PC_NEW = this.REG_PC;
                this.F_INTERRUPT_NEW = this.F_INTERRUPT;
                switch (this.irqType) {
                    case 0: {
                        if (this.F_INTERRUPT != 0) {
                            break;
                        }
                        this.doIrq(temp);
                        break;
                    }
                    case 1: {
                        this.doNonMaskableInterrupt(temp);
                        break;
                    }
                    case 2: {
                        this.doResetInterrupt();
                        break;
                    }
                }
                this.REG_PC = this.REG_PC_NEW;
                this.F_INTERRUPT = this.F_INTERRUPT_NEW;
                this.F_BRK = this.F_BRK_NEW;
                this.irqRequested = false;
            }
            var opinf = Operation.opdata[this.mapper.load(this.REG_PC + 1)];
            var cycleCount = (opinf >> 24);
            var cycleAdd = 0;
            var addrMode = (opinf >> 8) & 0xFF;
            var opaddr = this.REG_PC;
            this.REG_PC += ((opinf >> 16) & 0xFF);
            var addr = 0;
            switch (addrMode) {
                case 0: {
                    addr = this.load(opaddr + 2);
                    break;
                }
                case 1: {
                    addr = this.load(opaddr + 2);
                    if (addr < 0x80) {
                        addr += this.REG_PC;
                    }
                    else {
                        addr += this.REG_PC - 256;
                    }
                    break;
                }
                case 2: {
                    break;
                }
                case 3: {
                    addr = this.load16bit(opaddr + 2);
                    break;
                }
                case 4: {
                    addr = this.REG_ACC;
                    break;
                }
                case 5: {
                    addr = this.REG_PC;
                    break;
                }
                case 6: {
                    addr = (this.load(opaddr + 2) + this.REG_X) & 0xFF;
                    break;
                }
                case 7: {
                    addr = (this.load(opaddr + 2) + this.REG_Y) & 0xFF;
                    break;
                }
                case 8: {
                    addr = this.load16bit(opaddr + 2);
                    if ((addr & 0xFF00) != ((addr + this.REG_X) & 0xFF00)) {
                        cycleAdd = 1;
                    }
                    addr += this.REG_X;
                    break;
                }
                case 9: {
                    addr = this.load16bit(opaddr + 2);
                    if ((addr & 0xFF00) != ((addr + this.REG_Y) & 0xFF00)) {
                        cycleAdd = 1;
                    }
                    addr += this.REG_Y;
                    break;
                }
                case 10: {
                    addr = this.load(opaddr + 2);
                    if ((addr & 0xFF00) != ((addr + this.REG_X) & 0xFF00)) {
                        cycleAdd = 1;
                    }
                    addr += this.REG_X;
                    addr &= 0xFF;
                    addr = this.load16bit(addr);
                    break;
                }
                case 11: {
                    addr = this.load16bit(this.load(opaddr + 2));
                    if ((addr & 0xFF00) != ((addr + this.REG_Y) & 0xFF00)) {
                        cycleAdd = 1;
                    }
                    addr += this.REG_Y;
                    break;
                }
                case 12: {
                    addr = this.load16bit(opaddr + 2);
                    if (addr < 0x1FFF) {
                        addr = this.mem[addr] + (this.mem[(addr & 0xFF00) | (((addr & 0xFF) + 1) & 0xFF)] << 8);
                    }
                    else {
                        addr = this.mapper.load(addr) + (this.mapper.load((addr & 0xFF00) | (((addr & 0xFF) + 1) & 0xFF)) << 8);
                    }
                    break;
                }
            }
            addr &= 0xFFFF;
            switch (opinf & 0xFF) {
                case 0: {
                    temp = this.REG_ACC + this.load(addr) + this.F_CARRY;
                    this.F_OVERFLOW = ((!(((this.REG_ACC ^ this.load(addr)) & 0x80) != 0) && (((this.REG_ACC ^ temp) & 0x80)) != 0) ? 1 : 0);
                    this.F_CARRY = (temp > 255 ? 1 : 0);
                    this.F_SIGN = (temp >> 7) & 1;
                    this.F_ZERO = temp & 0xFF;
                    this.REG_ACC = (temp & 255);
                    cycleCount += cycleAdd;
                    break;
                }
                case 1: {
                    this.REG_ACC = this.REG_ACC & this.load(addr);
                    this.F_SIGN = (this.REG_ACC >> 7) & 1;
                    this.F_ZERO = this.REG_ACC;
                    if (addrMode != 11)
                        cycleCount += cycleAdd;
                    break;
                }
                case 2: {
                    if (addrMode == 4) {
                        this.F_CARRY = (this.REG_ACC >> 7) & 1;
                        this.REG_ACC = (this.REG_ACC << 1) & 255;
                        this.F_SIGN = (this.REG_ACC >> 7) & 1;
                        this.F_ZERO = this.REG_ACC;
                    }
                    else {
                        temp = this.load(addr);
                        this.F_CARRY = (temp >> 7) & 1;
                        temp = (temp << 1) & 255;
                        this.F_SIGN = (temp >> 7) & 1;
                        this.F_ZERO = temp;
                        this.write(addr, temp);
                    }
                    break;
                }
                case 3: {
                    if (this.F_CARRY == 0) {
                        cycleCount += ((opaddr & 0xFF00) != (addr & 0xFF00) ? 2 : 1);
                        this.REG_PC = addr;
                    }
                    break;
                }
                case 4: {
                    if (this.F_CARRY == 1) {
                        cycleCount += ((opaddr & 0xFF00) != (addr & 0xFF00) ? 2 : 1);
                        this.REG_PC = addr;
                    }
                    break;
                }
                case 5: {
                    if (this.F_ZERO == 0) {
                        cycleCount += ((opaddr & 0xFF00) != (addr & 0xFF00) ? 2 : 1);
                        this.REG_PC = addr;
                    }
                    break;
                }
                case 6: {
                    temp = this.load(addr);
                    this.F_SIGN = (temp >> 7) & 1;
                    this.F_OVERFLOW = (temp >> 6) & 1;
                    temp &= this.REG_ACC;
                    this.F_ZERO = temp;
                    break;
                }
                case 7: {
                    if (this.F_SIGN == 1) {
                        cycleCount++;
                        this.REG_PC = addr;
                    }
                    break;
                }
                case 8: {
                    if (this.F_ZERO != 0) {
                        cycleCount += ((opaddr & 0xFF00) != (addr & 0xFF00) ? 2 : 1);
                        this.REG_PC = addr;
                    }
                    break;
                }
                case 9: {
                    if (this.F_SIGN == 0) {
                        cycleCount += ((opaddr & 0xFF00) != (addr & 0xFF00) ? 2 : 1);
                        this.REG_PC = addr;
                    }
                    break;
                }
                case 10: {
                    this.REG_PC += 2;
                    this.push((this.REG_PC >> 8) & 255);
                    this.push(this.REG_PC & 255);
                    this.F_BRK = 1;
                    this.push((this.F_CARRY) |
                        ((this.F_ZERO == 0 ? 1 : 0) << 1) |
                        (this.F_INTERRUPT << 2) |
                        (this.F_DECIMAL << 3) |
                        (this.F_BRK << 4) |
                        (this.F_NOTUSED << 5) |
                        (this.F_OVERFLOW << 6) |
                        (this.F_SIGN << 7));
                    this.F_INTERRUPT = 1;
                    this.REG_PC = this.load16bit(0xFFFE);
                    this.REG_PC--;
                    break;
                }
                case 11: {
                    if (this.F_OVERFLOW == 0) {
                        cycleCount += ((opaddr & 0xFF00) != (addr & 0xFF00) ? 2 : 1);
                        this.REG_PC = addr;
                    }
                    break;
                }
                case 12: {
                    if (this.F_OVERFLOW == 1) {
                        cycleCount += ((opaddr & 0xFF00) != (addr & 0xFF00) ? 2 : 1);
                        this.REG_PC = addr;
                    }
                    break;
                }
                case 13: {
                    this.F_CARRY = 0;
                    break;
                }
                case 14: {
                    this.F_DECIMAL = 0;
                    break;
                }
                case 15: {
                    this.F_INTERRUPT = 0;
                    break;
                }
                case 16: {
                    this.F_OVERFLOW = 0;
                    break;
                }
                case 17: {
                    temp = this.REG_ACC - this.load(addr);
                    this.F_CARRY = (temp >= 0 ? 1 : 0);
                    this.F_SIGN = (temp >> 7) & 1;
                    this.F_ZERO = temp & 0xFF;
                    cycleCount += cycleAdd;
                    break;
                }
                case 18: {
                    temp = this.REG_X - this.load(addr);
                    this.F_CARRY = (temp >= 0 ? 1 : 0);
                    this.F_SIGN = (temp >> 7) & 1;
                    this.F_ZERO = temp & 0xFF;
                    break;
                }
                case 19: {
                    temp = this.REG_Y - this.load(addr);
                    this.F_CARRY = (temp >= 0 ? 1 : 0);
                    this.F_SIGN = (temp >> 7) & 1;
                    this.F_ZERO = temp & 0xFF;
                    break;
                }
                case 20: {
                    temp = (this.load(addr) - 1) & 0xFF;
                    this.F_SIGN = (temp >> 7) & 1;
                    this.F_ZERO = temp;
                    this.write(addr, temp);
                    break;
                }
                case 21: {
                    this.REG_X = (this.REG_X - 1) & 0xFF;
                    this.F_SIGN = (this.REG_X >> 7) & 1;
                    this.F_ZERO = this.REG_X;
                    break;
                }
                case 22: {
                    this.REG_Y = (this.REG_Y - 1) & 0xFF;
                    this.F_SIGN = (this.REG_Y >> 7) & 1;
                    this.F_ZERO = this.REG_Y;
                    break;
                }
                case 23: {
                    this.REG_ACC = (this.load(addr) ^ this.REG_ACC) & 0xFF;
                    this.F_SIGN = (this.REG_ACC >> 7) & 1;
                    this.F_ZERO = this.REG_ACC;
                    cycleCount += cycleAdd;
                    break;
                }
                case 24: {
                    temp = (this.load(addr) + 1) & 0xFF;
                    this.F_SIGN = (temp >> 7) & 1;
                    this.F_ZERO = temp;
                    this.write(addr, temp & 0xFF);
                    break;
                }
                case 25: {
                    this.REG_X = (this.REG_X + 1) & 0xFF;
                    this.F_SIGN = (this.REG_X >> 7) & 1;
                    this.F_ZERO = this.REG_X;
                    break;
                }
                case 26: {
                    this.REG_Y++;
                    this.REG_Y &= 0xFF;
                    this.F_SIGN = (this.REG_Y >> 7) & 1;
                    this.F_ZERO = this.REG_Y;
                    break;
                }
                case 27: {
                    this.REG_PC = addr - 1;
                    break;
                }
                case 28: {
                    this.push((this.REG_PC >> 8) & 255);
                    this.push(this.REG_PC & 255);
                    this.REG_PC = addr - 1;
                    break;
                }
                case 29: {
                    this.REG_ACC = this.load(addr);
                    this.F_SIGN = (this.REG_ACC >> 7) & 1;
                    this.F_ZERO = this.REG_ACC;
                    cycleCount += cycleAdd;
                    break;
                }
                case 30: {
                    this.REG_X = this.load(addr);
                    this.F_SIGN = (this.REG_X >> 7) & 1;
                    this.F_ZERO = this.REG_X;
                    cycleCount += cycleAdd;
                    break;
                }
                case 31: {
                    this.REG_Y = this.load(addr);
                    this.F_SIGN = (this.REG_Y >> 7) & 1;
                    this.F_ZERO = this.REG_Y;
                    cycleCount += cycleAdd;
                    break;
                }
                case 32: {
                    if (addrMode == 4) {
                        temp = (this.REG_ACC & 0xFF);
                        this.F_CARRY = temp & 1;
                        temp >>= 1;
                        this.REG_ACC = temp;
                    }
                    else {
                        temp = this.load(addr) & 0xFF;
                        this.F_CARRY = temp & 1;
                        temp >>= 1;
                        this.write(addr, temp);
                    }
                    this.F_SIGN = 0;
                    this.F_ZERO = temp;
                    break;
                }
                case 33: {
                    break;
                }
                case 34: {
                    temp = (this.load(addr) | this.REG_ACC) & 255;
                    this.F_SIGN = (temp >> 7) & 1;
                    this.F_ZERO = temp;
                    this.REG_ACC = temp;
                    if (addrMode != 11)
                        cycleCount += cycleAdd;
                    break;
                }
                case 35: {
                    this.push(this.REG_ACC);
                    break;
                }
                case 36: {
                    this.F_BRK = 1;
                    this.push((this.F_CARRY) |
                        ((this.F_ZERO == 0 ? 1 : 0) << 1) |
                        (this.F_INTERRUPT << 2) |
                        (this.F_DECIMAL << 3) |
                        (this.F_BRK << 4) |
                        (this.F_NOTUSED << 5) |
                        (this.F_OVERFLOW << 6) |
                        (this.F_SIGN << 7));
                    break;
                }
                case 37: {
                    this.REG_ACC = this.pull();
                    this.F_SIGN = (this.REG_ACC >> 7) & 1;
                    this.F_ZERO = this.REG_ACC;
                    break;
                }
                case 38: {
                    temp = this.pull();
                    this.F_CARRY = (temp) & 1;
                    this.F_ZERO = (((temp >> 1) & 1) == 1) ? 0 : 1;
                    this.F_INTERRUPT = (temp >> 2) & 1;
                    this.F_DECIMAL = (temp >> 3) & 1;
                    this.F_BRK = (temp >> 4) & 1;
                    this.F_NOTUSED = (temp >> 5) & 1;
                    this.F_OVERFLOW = (temp >> 6) & 1;
                    this.F_SIGN = (temp >> 7) & 1;
                    this.F_NOTUSED = 1;
                    break;
                }
                case 39: {
                    if (addrMode == 4) {
                        temp = this.REG_ACC;
                        add = this.F_CARRY;
                        this.F_CARRY = (temp >> 7) & 1;
                        temp = ((temp << 1) & 0xFF) + add;
                        this.REG_ACC = temp;
                    }
                    else {
                        temp = this.load(addr);
                        add = this.F_CARRY;
                        this.F_CARRY = (temp >> 7) & 1;
                        temp = ((temp << 1) & 0xFF) + add;
                        this.write(addr, temp);
                    }
                    this.F_SIGN = (temp >> 7) & 1;
                    this.F_ZERO = temp;
                    break;
                }
                case 40: {
                    if (addrMode == 4) {
                        add = this.F_CARRY << 7;
                        this.F_CARRY = this.REG_ACC & 1;
                        temp = (this.REG_ACC >> 1) + add;
                        this.REG_ACC = temp;
                    }
                    else {
                        temp = this.load(addr);
                        add = this.F_CARRY << 7;
                        this.F_CARRY = temp & 1;
                        temp = (temp >> 1) + add;
                        this.write(addr, temp);
                    }
                    this.F_SIGN = (temp >> 7) & 1;
                    this.F_ZERO = temp;
                    break;
                }
                case 41: {
                    temp = this.pull();
                    this.F_CARRY = (temp) & 1;
                    this.F_ZERO = ((temp >> 1) & 1) == 0 ? 1 : 0;
                    this.F_INTERRUPT = (temp >> 2) & 1;
                    this.F_DECIMAL = (temp >> 3) & 1;
                    this.F_BRK = (temp >> 4) & 1;
                    this.F_NOTUSED = (temp >> 5) & 1;
                    this.F_OVERFLOW = (temp >> 6) & 1;
                    this.F_SIGN = (temp >> 7) & 1;
                    this.REG_PC = this.pull();
                    this.REG_PC += (this.pull() << 8);
                    if (this.REG_PC == 0xFFFF) {
                        return;
                    }
                    this.REG_PC--;
                    this.F_NOTUSED = 1;
                    break;
                }
                case 42: {
                    this.REG_PC = this.pull();
                    this.REG_PC += (this.pull() << 8);
                    if (this.REG_PC == 0xFFFF) {
                        return;
                    }
                    break;
                }
                case 43: {
                    temp = this.REG_ACC - this.load(addr) - (1 - this.F_CARRY);
                    this.F_SIGN = (temp >> 7) & 1;
                    this.F_ZERO = temp & 0xFF;
                    this.F_OVERFLOW = ((((this.REG_ACC ^ temp) & 0x80) != 0 && ((this.REG_ACC ^ this.load(addr)) & 0x80) != 0) ? 1 : 0);
                    this.F_CARRY = (temp < 0 ? 0 : 1);
                    this.REG_ACC = (temp & 0xFF);
                    if (addrMode != 11)
                        cycleCount += cycleAdd;
                    break;
                }
                case 44: {
                    this.F_CARRY = 1;
                    break;
                }
                case 45: {
                    this.F_DECIMAL = 1;
                    break;
                }
                case 46: {
                    this.F_INTERRUPT = 1;
                    break;
                }
                case 47: {
                    this.write(addr, this.REG_ACC);
                    break;
                }
                case 48: {
                    this.write(addr, this.REG_X);
                    break;
                }
                case 49: {
                    this.write(addr, this.REG_Y);
                    break;
                }
                case 50: {
                    this.REG_X = this.REG_ACC;
                    this.F_SIGN = (this.REG_ACC >> 7) & 1;
                    this.F_ZERO = this.REG_ACC;
                    break;
                }
                case 51: {
                    this.REG_Y = this.REG_ACC;
                    this.F_SIGN = (this.REG_ACC >> 7) & 1;
                    this.F_ZERO = this.REG_ACC;
                    break;
                }
                case 52: {
                    this.REG_X = (this.REG_SP - 0x0100);
                    this.F_SIGN = (this.REG_SP >> 7) & 1;
                    this.F_ZERO = this.REG_X;
                    break;
                }
                case 53: {
                    this.REG_ACC = this.REG_X;
                    this.F_SIGN = (this.REG_X >> 7) & 1;
                    this.F_ZERO = this.REG_X;
                    break;
                }
                case 54: {
                    this.REG_SP = (this.REG_X + 0x0100);
                    this.stackWrap();
                    break;
                }
                case 55: {
                    this.REG_ACC = this.REG_Y;
                    this.F_SIGN = (this.REG_Y >> 7) & 1;
                    this.F_ZERO = this.REG_Y;
                    break;
                }
                default: {
                    throw new Error('Game crashed, invalid opcode at address $' + opaddr.toString(16));
                }
            }
            return cycleCount;
        };
        CPU.prototype.load = function (addr) {
            if (addr < 0x2000) {
                return this.mem[addr & 0x7FF];
            }
            else {
                return this.mapper.load(addr);
            }
        };
        CPU.prototype.load16bit = function (addr) {
            if (addr < 0x1FFF) {
                return this.mem[addr & 0x7FF] | (this.mem[(addr + 1) & 0x7FF] << 8);
            }
            else {
                return this.mapper.load(addr) | (this.mapper.load(addr + 1) << 8);
            }
        };
        CPU.prototype.write = function (addr, val) {
            if (addr < 0x2000) {
                this.mem[addr & 0x7FF] = val;
            }
            else {
                this.mapper.write(addr, val);
            }
        };
        CPU.prototype.requestIrq = function (type) {
            if (this.irqRequested) {
                if (type == InstructionRequest.NORMAL) {
                    return;
                }
            }
            this.irqRequested = true;
            this.irqType = type;
        };
        CPU.prototype.push = function (value) {
            this.mapper.write(this.REG_SP, value);
            this.REG_SP--;
            this.REG_SP = 0x0100 | (this.REG_SP & 0xFF);
        };
        CPU.prototype.stackWrap = function () {
            this.REG_SP = 0x0100 | (this.REG_SP & 0xFF);
        };
        CPU.prototype.pull = function () {
            this.REG_SP++;
            this.REG_SP = 0x0100 | (this.REG_SP & 0xFF);
            return this.mapper.load(this.REG_SP);
        };
        CPU.prototype.pageCrossed = function (addr1, addr2) {
            return ((addr1 & 0xFF00) != (addr2 & 0xFF00));
        };
        CPU.prototype.haltCycles = function (cycles) {
            this.cyclesToHalt += cycles;
        };
        CPU.prototype.doNonMaskableInterrupt = function (status) {
            if ((this.mapper.load(0x2000) & 128) != 0) {
                this.REG_PC_NEW++;
                this.push((this.REG_PC_NEW >> 8) & 0xFF);
                this.push(this.REG_PC_NEW & 0xFF);
                this.push(status);
                this.REG_PC_NEW = this.mapper.load(0xFFFA) | (this.mapper.load(0xFFFB) << 8);
                this.REG_PC_NEW--;
            }
        };
        CPU.prototype.doResetInterrupt = function () {
            this.REG_PC_NEW = this.mapper.load(0xFFFC) | (this.mapper.load(0xFFFD) << 8);
            this.REG_PC_NEW--;
        };
        CPU.prototype.doIrq = function (status) {
            this.REG_PC_NEW++;
            this.push((this.REG_PC_NEW >> 8) & 0xFF);
            this.push(this.REG_PC_NEW & 0xFF);
            this.push(status);
            this.F_INTERRUPT_NEW = 1;
            this.F_BRK_NEW = 0;
            this.REG_PC_NEW = this.mapper.load(0xFFFE) | (this.mapper.load(0xFFFF) << 8);
            this.REG_PC_NEW--;
        };
        CPU.prototype.getStatus = function () {
            return (this.F_CARRY)
                | (this.F_ZERO << 1)
                | (this.F_INTERRUPT << 2)
                | (this.F_DECIMAL << 3)
                | (this.F_BRK << 4)
                | (this.F_NOTUSED << 5)
                | (this.F_OVERFLOW << 6)
                | (this.F_SIGN << 7);
        };
        CPU.prototype.setStatus = function (st) {
            this.F_CARRY = (st) & 1;
            this.F_ZERO = (st >> 1) & 1;
            this.F_INTERRUPT = (st >> 2) & 1;
            this.F_DECIMAL = (st >> 3) & 1;
            this.F_BRK = (st >> 4) & 1;
            this.F_NOTUSED = (st >> 5) & 1;
            this.F_OVERFLOW = (st >> 6) & 1;
            this.F_SIGN = (st >> 7) & 1;
        };
        CPU.serializable = [
            'mem', 'cyclesToHalt', 'irqRequested', 'irqType',
            'REG_ACC', 'REG_X', 'REG_Y', 'REG_SP', 'REG_PC', 'REG_PC_NEW',
            'REG_STATUS',
            'F_CARRY', 'F_DECIMAL', 'F_INTERRUPT', 'F_INTERRUPT_NEW', 'F_OVERFLOW',
            'F_SIGN', 'F_ZERO', 'F_NOTUSED', 'F_NOTUSED_NEW', 'F_BRK', 'F_BRK_NEW'
        ];
        return CPU;
    }());
    var Operation;
    (function (Operation) {
        var Instruction;
        (function (Instruction) {
            Instruction[Instruction["ADC"] = 0] = "ADC";
            Instruction[Instruction["AND"] = 1] = "AND";
            Instruction[Instruction["ASL"] = 2] = "ASL";
            Instruction[Instruction["BCC"] = 3] = "BCC";
            Instruction[Instruction["BCS"] = 4] = "BCS";
            Instruction[Instruction["BEQ"] = 5] = "BEQ";
            Instruction[Instruction["BIT"] = 6] = "BIT";
            Instruction[Instruction["BMI"] = 7] = "BMI";
            Instruction[Instruction["BNE"] = 8] = "BNE";
            Instruction[Instruction["BPL"] = 9] = "BPL";
            Instruction[Instruction["BRK"] = 10] = "BRK";
            Instruction[Instruction["BVC"] = 11] = "BVC";
            Instruction[Instruction["BVS"] = 12] = "BVS";
            Instruction[Instruction["CLC"] = 13] = "CLC";
            Instruction[Instruction["CLD"] = 14] = "CLD";
            Instruction[Instruction["CLI"] = 15] = "CLI";
            Instruction[Instruction["CLV"] = 16] = "CLV";
            Instruction[Instruction["CMP"] = 17] = "CMP";
            Instruction[Instruction["CPX"] = 18] = "CPX";
            Instruction[Instruction["CPY"] = 19] = "CPY";
            Instruction[Instruction["DEC"] = 20] = "DEC";
            Instruction[Instruction["DEX"] = 21] = "DEX";
            Instruction[Instruction["DEY"] = 22] = "DEY";
            Instruction[Instruction["EOR"] = 23] = "EOR";
            Instruction[Instruction["INC"] = 24] = "INC";
            Instruction[Instruction["INX"] = 25] = "INX";
            Instruction[Instruction["INY"] = 26] = "INY";
            Instruction[Instruction["JMP"] = 27] = "JMP";
            Instruction[Instruction["JSR"] = 28] = "JSR";
            Instruction[Instruction["LDA"] = 29] = "LDA";
            Instruction[Instruction["LDX"] = 30] = "LDX";
            Instruction[Instruction["LDY"] = 31] = "LDY";
            Instruction[Instruction["LSR"] = 32] = "LSR";
            Instruction[Instruction["NOP"] = 33] = "NOP";
            Instruction[Instruction["ORA"] = 34] = "ORA";
            Instruction[Instruction["PHA"] = 35] = "PHA";
            Instruction[Instruction["PHP"] = 36] = "PHP";
            Instruction[Instruction["PLA"] = 37] = "PLA";
            Instruction[Instruction["PLP"] = 38] = "PLP";
            Instruction[Instruction["ROL"] = 39] = "ROL";
            Instruction[Instruction["ROR"] = 40] = "ROR";
            Instruction[Instruction["RTI"] = 41] = "RTI";
            Instruction[Instruction["RTS"] = 42] = "RTS";
            Instruction[Instruction["SBC"] = 43] = "SBC";
            Instruction[Instruction["SEC"] = 44] = "SEC";
            Instruction[Instruction["SED"] = 45] = "SED";
            Instruction[Instruction["SEI"] = 46] = "SEI";
            Instruction[Instruction["STA"] = 47] = "STA";
            Instruction[Instruction["STX"] = 48] = "STX";
            Instruction[Instruction["STY"] = 49] = "STY";
            Instruction[Instruction["TAX"] = 50] = "TAX";
            Instruction[Instruction["TAY"] = 51] = "TAY";
            Instruction[Instruction["TSX"] = 52] = "TSX";
            Instruction[Instruction["TXA"] = 53] = "TXA";
            Instruction[Instruction["TXS"] = 54] = "TXS";
            Instruction[Instruction["TYA"] = 55] = "TYA";
            Instruction[Instruction["DUMMY"] = 56] = "DUMMY";
        })(Instruction || (Instruction = {}));
        var Address;
        (function (Address) {
            Address[Address["ZP"] = 0] = "ZP";
            Address[Address["REL"] = 1] = "REL";
            Address[Address["IMP"] = 2] = "IMP";
            Address[Address["ABS"] = 3] = "ABS";
            Address[Address["ACC"] = 4] = "ACC";
            Address[Address["IMM"] = 5] = "IMM";
            Address[Address["ZPX"] = 6] = "ZPX";
            Address[Address["ZPY"] = 7] = "ZPY";
            Address[Address["ABSX"] = 8] = "ABSX";
            Address[Address["ABSY"] = 9] = "ABSY";
            Address[Address["PREIDXIND"] = 10] = "PREIDXIND";
            Address[Address["POSTIDXIND"] = 11] = "POSTIDXIND";
            Address[Address["INDABS"] = 12] = "INDABS";
        })(Address || (Address = {}));
        var cycTable = [
            7, 6, 2, 8, 3, 3, 5, 5, 3, 2, 2, 2, 4, 4, 6, 6,
            2, 5, 2, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7,
            6, 6, 2, 8, 3, 3, 5, 5, 4, 2, 2, 2, 4, 4, 6, 6,
            2, 5, 2, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7,
            6, 6, 2, 8, 3, 3, 5, 5, 3, 2, 2, 2, 3, 4, 6, 6,
            2, 5, 2, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7,
            6, 6, 2, 8, 3, 3, 5, 5, 4, 2, 2, 2, 5, 4, 6, 6,
            2, 5, 2, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7,
            2, 6, 2, 6, 3, 3, 3, 3, 2, 2, 2, 2, 4, 4, 4, 4,
            2, 6, 2, 6, 4, 4, 4, 4, 2, 5, 2, 5, 5, 5, 5, 5,
            2, 6, 2, 6, 3, 3, 3, 3, 2, 2, 2, 2, 4, 4, 4, 4,
            2, 5, 2, 5, 4, 4, 4, 4, 2, 4, 2, 4, 4, 4, 4, 4,
            2, 6, 2, 8, 3, 3, 5, 5, 2, 2, 2, 2, 4, 4, 6, 6,
            2, 5, 2, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7,
            2, 6, 3, 8, 3, 3, 5, 5, 2, 2, 2, 2, 4, 4, 6, 6,
            2, 5, 2, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7
        ];
        Operation.opdata = new Array(256);
        function setOp(inst, op, addr, size, cycles) {
            Operation.opdata[op] =
                ((inst & 0xFF)) |
                    ((addr & 0xFF) << 8) |
                    ((size & 0xFF) << 16) |
                    ((cycles & 0xFF) << 24);
        }
        for (var i = 0; i < 256; i++)
            Operation.opdata[i] = 0xFF;
        setOp(Instruction.ADC, 0x69, Address.IMM, 2, 2);
        setOp(Instruction.ADC, 0x65, Address.ZP, 2, 3);
        setOp(Instruction.ADC, 0x75, Address.ZPX, 2, 4);
        setOp(Instruction.ADC, 0x6D, Address.ABS, 3, 4);
        setOp(Instruction.ADC, 0x7D, Address.ABSX, 3, 4);
        setOp(Instruction.ADC, 0x79, Address.ABSY, 3, 4);
        setOp(Instruction.ADC, 0x61, Address.PREIDXIND, 2, 6);
        setOp(Instruction.ADC, 0x71, Address.POSTIDXIND, 2, 5);
        setOp(Instruction.AND, 0x29, Address.IMM, 2, 2);
        setOp(Instruction.AND, 0x25, Address.ZP, 2, 3);
        setOp(Instruction.AND, 0x35, Address.ZPX, 2, 4);
        setOp(Instruction.AND, 0x2D, Address.ABS, 3, 4);
        setOp(Instruction.AND, 0x3D, Address.ABSX, 3, 4);
        setOp(Instruction.AND, 0x39, Address.ABSY, 3, 4);
        setOp(Instruction.AND, 0x21, Address.PREIDXIND, 2, 6);
        setOp(Instruction.AND, 0x31, Address.POSTIDXIND, 2, 5);
        setOp(Instruction.ASL, 0x0A, Address.ACC, 1, 2);
        setOp(Instruction.ASL, 0x06, Address.ZP, 2, 5);
        setOp(Instruction.ASL, 0x16, Address.ZPX, 2, 6);
        setOp(Instruction.ASL, 0x0E, Address.ABS, 3, 6);
        setOp(Instruction.ASL, 0x1E, Address.ABSX, 3, 7);
        setOp(Instruction.BCC, 0x90, Address.REL, 2, 2);
        setOp(Instruction.BCS, 0xB0, Address.REL, 2, 2);
        setOp(Instruction.BEQ, 0xF0, Address.REL, 2, 2);
        setOp(Instruction.BIT, 0x24, Address.ZP, 2, 3);
        setOp(Instruction.BIT, 0x2C, Address.ABS, 3, 4);
        setOp(Instruction.BMI, 0x30, Address.REL, 2, 2);
        setOp(Instruction.BNE, 0xD0, Address.REL, 2, 2);
        setOp(Instruction.BPL, 0x10, Address.REL, 2, 2);
        setOp(Instruction.BRK, 0x00, Address.IMP, 1, 7);
        setOp(Instruction.BVC, 0x50, Address.REL, 2, 2);
        setOp(Instruction.BVS, 0x70, Address.REL, 2, 2);
        setOp(Instruction.CLC, 0x18, Address.IMP, 1, 2);
        setOp(Instruction.CLD, 0xD8, Address.IMP, 1, 2);
        setOp(Instruction.CLI, 0x58, Address.IMP, 1, 2);
        setOp(Instruction.CLV, 0xB8, Address.IMP, 1, 2);
        setOp(Instruction.CMP, 0xC9, Address.IMM, 2, 2);
        setOp(Instruction.CMP, 0xC5, Address.ZP, 2, 3);
        setOp(Instruction.CMP, 0xD5, Address.ZPX, 2, 4);
        setOp(Instruction.CMP, 0xCD, Address.ABS, 3, 4);
        setOp(Instruction.CMP, 0xDD, Address.ABSX, 3, 4);
        setOp(Instruction.CMP, 0xD9, Address.ABSY, 3, 4);
        setOp(Instruction.CMP, 0xC1, Address.PREIDXIND, 2, 6);
        setOp(Instruction.CMP, 0xD1, Address.POSTIDXIND, 2, 5);
        setOp(Instruction.CPX, 0xE0, Address.IMM, 2, 2);
        setOp(Instruction.CPX, 0xE4, Address.ZP, 2, 3);
        setOp(Instruction.CPX, 0xEC, Address.ABS, 3, 4);
        setOp(Instruction.CPY, 0xC0, Address.IMM, 2, 2);
        setOp(Instruction.CPY, 0xC4, Address.ZP, 2, 3);
        setOp(Instruction.CPY, 0xCC, Address.ABS, 3, 4);
        setOp(Instruction.DEC, 0xC6, Address.ZP, 2, 5);
        setOp(Instruction.DEC, 0xD6, Address.ZPX, 2, 6);
        setOp(Instruction.DEC, 0xCE, Address.ABS, 3, 6);
        setOp(Instruction.DEC, 0xDE, Address.ABSX, 3, 7);
        setOp(Instruction.DEX, 0xCA, Address.IMP, 1, 2);
        setOp(Instruction.DEY, 0x88, Address.IMP, 1, 2);
        setOp(Instruction.EOR, 0x49, Address.IMM, 2, 2);
        setOp(Instruction.EOR, 0x45, Address.ZP, 2, 3);
        setOp(Instruction.EOR, 0x55, Address.ZPX, 2, 4);
        setOp(Instruction.EOR, 0x4D, Address.ABS, 3, 4);
        setOp(Instruction.EOR, 0x5D, Address.ABSX, 3, 4);
        setOp(Instruction.EOR, 0x59, Address.ABSY, 3, 4);
        setOp(Instruction.EOR, 0x41, Address.PREIDXIND, 2, 6);
        setOp(Instruction.EOR, 0x51, Address.POSTIDXIND, 2, 5);
        setOp(Instruction.INC, 0xE6, Address.ZP, 2, 5);
        setOp(Instruction.INC, 0xF6, Address.ZPX, 2, 6);
        setOp(Instruction.INC, 0xEE, Address.ABS, 3, 6);
        setOp(Instruction.INC, 0xFE, Address.ABSX, 3, 7);
        setOp(Instruction.INX, 0xE8, Address.IMP, 1, 2);
        setOp(Instruction.INY, 0xC8, Address.IMP, 1, 2);
        setOp(Instruction.JMP, 0x4C, Address.ABS, 3, 3);
        setOp(Instruction.JMP, 0x6C, Address.INDABS, 3, 5);
        setOp(Instruction.JSR, 0x20, Address.ABS, 3, 6);
        setOp(Instruction.LDA, 0xA9, Address.IMM, 2, 2);
        setOp(Instruction.LDA, 0xA5, Address.ZP, 2, 3);
        setOp(Instruction.LDA, 0xB5, Address.ZPX, 2, 4);
        setOp(Instruction.LDA, 0xAD, Address.ABS, 3, 4);
        setOp(Instruction.LDA, 0xBD, Address.ABSX, 3, 4);
        setOp(Instruction.LDA, 0xB9, Address.ABSY, 3, 4);
        setOp(Instruction.LDA, 0xA1, Address.PREIDXIND, 2, 6);
        setOp(Instruction.LDA, 0xB1, Address.POSTIDXIND, 2, 5);
        setOp(Instruction.LDX, 0xA2, Address.IMM, 2, 2);
        setOp(Instruction.LDX, 0xA6, Address.ZP, 2, 3);
        setOp(Instruction.LDX, 0xB6, Address.ZPY, 2, 4);
        setOp(Instruction.LDX, 0xAE, Address.ABS, 3, 4);
        setOp(Instruction.LDX, 0xBE, Address.ABSY, 3, 4);
        setOp(Instruction.LDY, 0xA0, Address.IMM, 2, 2);
        setOp(Instruction.LDY, 0xA4, Address.ZP, 2, 3);
        setOp(Instruction.LDY, 0xB4, Address.ZPX, 2, 4);
        setOp(Instruction.LDY, 0xAC, Address.ABS, 3, 4);
        setOp(Instruction.LDY, 0xBC, Address.ABSX, 3, 4);
        setOp(Instruction.LSR, 0x4A, Address.ACC, 1, 2);
        setOp(Instruction.LSR, 0x46, Address.ZP, 2, 5);
        setOp(Instruction.LSR, 0x56, Address.ZPX, 2, 6);
        setOp(Instruction.LSR, 0x4E, Address.ABS, 3, 6);
        setOp(Instruction.LSR, 0x5E, Address.ABSX, 3, 7);
        setOp(Instruction.NOP, 0xEA, Address.IMP, 1, 2);
        setOp(Instruction.ORA, 0x09, Address.IMM, 2, 2);
        setOp(Instruction.ORA, 0x05, Address.ZP, 2, 3);
        setOp(Instruction.ORA, 0x15, Address.ZPX, 2, 4);
        setOp(Instruction.ORA, 0x0D, Address.ABS, 3, 4);
        setOp(Instruction.ORA, 0x1D, Address.ABSX, 3, 4);
        setOp(Instruction.ORA, 0x19, Address.ABSY, 3, 4);
        setOp(Instruction.ORA, 0x01, Address.PREIDXIND, 2, 6);
        setOp(Instruction.ORA, 0x11, Address.POSTIDXIND, 2, 5);
        setOp(Instruction.PHA, 0x48, Address.IMP, 1, 3);
        setOp(Instruction.PHP, 0x08, Address.IMP, 1, 3);
        setOp(Instruction.PLA, 0x68, Address.IMP, 1, 4);
        setOp(Instruction.PLP, 0x28, Address.IMP, 1, 4);
        setOp(Instruction.ROL, 0x2A, Address.ACC, 1, 2);
        setOp(Instruction.ROL, 0x26, Address.ZP, 2, 5);
        setOp(Instruction.ROL, 0x36, Address.ZPX, 2, 6);
        setOp(Instruction.ROL, 0x2E, Address.ABS, 3, 6);
        setOp(Instruction.ROL, 0x3E, Address.ABSX, 3, 7);
        setOp(Instruction.ROR, 0x6A, Address.ACC, 1, 2);
        setOp(Instruction.ROR, 0x66, Address.ZP, 2, 5);
        setOp(Instruction.ROR, 0x76, Address.ZPX, 2, 6);
        setOp(Instruction.ROR, 0x6E, Address.ABS, 3, 6);
        setOp(Instruction.ROR, 0x7E, Address.ABSX, 3, 7);
        setOp(Instruction.RTI, 0x40, Address.IMP, 1, 6);
        setOp(Instruction.RTS, 0x60, Address.IMP, 1, 6);
        setOp(Instruction.SBC, 0xE9, Address.IMM, 2, 2);
        setOp(Instruction.SBC, 0xE5, Address.ZP, 2, 3);
        setOp(Instruction.SBC, 0xF5, Address.ZPX, 2, 4);
        setOp(Instruction.SBC, 0xED, Address.ABS, 3, 4);
        setOp(Instruction.SBC, 0xFD, Address.ABSX, 3, 4);
        setOp(Instruction.SBC, 0xF9, Address.ABSY, 3, 4);
        setOp(Instruction.SBC, 0xE1, Address.PREIDXIND, 2, 6);
        setOp(Instruction.SBC, 0xF1, Address.POSTIDXIND, 2, 5);
        setOp(Instruction.SEC, 0x38, Address.IMP, 1, 2);
        setOp(Instruction.SED, 0xF8, Address.IMP, 1, 2);
        setOp(Instruction.SEI, 0x78, Address.IMP, 1, 2);
        setOp(Instruction.STA, 0x85, Address.ZP, 2, 3);
        setOp(Instruction.STA, 0x95, Address.ZPX, 2, 4);
        setOp(Instruction.STA, 0x8D, Address.ABS, 3, 4);
        setOp(Instruction.STA, 0x9D, Address.ABSX, 3, 5);
        setOp(Instruction.STA, 0x99, Address.ABSY, 3, 5);
        setOp(Instruction.STA, 0x81, Address.PREIDXIND, 2, 6);
        setOp(Instruction.STA, 0x91, Address.POSTIDXIND, 2, 6);
        setOp(Instruction.STX, 0x86, Address.ZP, 2, 3);
        setOp(Instruction.STX, 0x96, Address.ZPY, 2, 4);
        setOp(Instruction.STX, 0x8E, Address.ABS, 3, 4);
        setOp(Instruction.STY, 0x84, Address.ZP, 2, 3);
        setOp(Instruction.STY, 0x94, Address.ZPX, 2, 4);
        setOp(Instruction.STY, 0x8C, Address.ABS, 3, 4);
        setOp(Instruction.TAX, 0xAA, Address.IMP, 1, 2);
        setOp(Instruction.TAY, 0xA8, Address.IMP, 1, 2);
        setOp(Instruction.TSX, 0xBA, Address.IMP, 1, 2);
        setOp(Instruction.TXA, 0x8A, Address.IMP, 1, 2);
        setOp(Instruction.TXS, 0x9A, Address.IMP, 1, 2);
        setOp(Instruction.TYA, 0x98, Address.IMP, 1, 2);
    })(Operation || (Operation = {}));
    var Instruction;
    (function (Instruction) {
        Instruction[Instruction["ADC"] = 0] = "ADC";
        Instruction[Instruction["AND"] = 1] = "AND";
        Instruction[Instruction["ASL"] = 2] = "ASL";
        Instruction[Instruction["BCC"] = 3] = "BCC";
        Instruction[Instruction["BCS"] = 4] = "BCS";
        Instruction[Instruction["BEQ"] = 5] = "BEQ";
        Instruction[Instruction["BIT"] = 6] = "BIT";
        Instruction[Instruction["BMI"] = 7] = "BMI";
        Instruction[Instruction["BNE"] = 8] = "BNE";
        Instruction[Instruction["BPL"] = 9] = "BPL";
        Instruction[Instruction["BRK"] = 10] = "BRK";
        Instruction[Instruction["BVC"] = 11] = "BVC";
        Instruction[Instruction["BVS"] = 12] = "BVS";
        Instruction[Instruction["CLC"] = 13] = "CLC";
        Instruction[Instruction["CLD"] = 14] = "CLD";
        Instruction[Instruction["CLI"] = 15] = "CLI";
        Instruction[Instruction["CLV"] = 16] = "CLV";
        Instruction[Instruction["CMP"] = 17] = "CMP";
        Instruction[Instruction["CPX"] = 18] = "CPX";
        Instruction[Instruction["CPY"] = 19] = "CPY";
        Instruction[Instruction["DEC"] = 20] = "DEC";
        Instruction[Instruction["DEX"] = 21] = "DEX";
        Instruction[Instruction["DEY"] = 22] = "DEY";
        Instruction[Instruction["EOR"] = 23] = "EOR";
        Instruction[Instruction["INC"] = 24] = "INC";
        Instruction[Instruction["INX"] = 25] = "INX";
        Instruction[Instruction["INY"] = 26] = "INY";
        Instruction[Instruction["JMP"] = 27] = "JMP";
        Instruction[Instruction["JSR"] = 28] = "JSR";
        Instruction[Instruction["LDA"] = 29] = "LDA";
        Instruction[Instruction["LDX"] = 30] = "LDX";
        Instruction[Instruction["LDY"] = 31] = "LDY";
        Instruction[Instruction["LSR"] = 32] = "LSR";
        Instruction[Instruction["NOP"] = 33] = "NOP";
        Instruction[Instruction["ORA"] = 34] = "ORA";
        Instruction[Instruction["PHA"] = 35] = "PHA";
        Instruction[Instruction["PHP"] = 36] = "PHP";
        Instruction[Instruction["PLA"] = 37] = "PLA";
        Instruction[Instruction["PLP"] = 38] = "PLP";
        Instruction[Instruction["ROL"] = 39] = "ROL";
        Instruction[Instruction["ROR"] = 40] = "ROR";
        Instruction[Instruction["RTI"] = 41] = "RTI";
        Instruction[Instruction["RTS"] = 42] = "RTS";
        Instruction[Instruction["SBC"] = 43] = "SBC";
        Instruction[Instruction["SEC"] = 44] = "SEC";
        Instruction[Instruction["SED"] = 45] = "SED";
        Instruction[Instruction["SEI"] = 46] = "SEI";
        Instruction[Instruction["STA"] = 47] = "STA";
        Instruction[Instruction["STX"] = 48] = "STX";
        Instruction[Instruction["STY"] = 49] = "STY";
        Instruction[Instruction["TAX"] = 50] = "TAX";
        Instruction[Instruction["TAY"] = 51] = "TAY";
        Instruction[Instruction["TSX"] = 52] = "TSX";
        Instruction[Instruction["TXA"] = 53] = "TXA";
        Instruction[Instruction["TXS"] = 54] = "TXS";
        Instruction[Instruction["TYA"] = 55] = "TYA";
        Instruction[Instruction["DUMMY"] = 56] = "DUMMY";
    })(Instruction || (Instruction = {}));
    var Address;
    (function (Address) {
        Address[Address["ZP"] = 0] = "ZP";
        Address[Address["REL"] = 1] = "REL";
        Address[Address["IMP"] = 2] = "IMP";
        Address[Address["ABS"] = 3] = "ABS";
        Address[Address["ACC"] = 4] = "ACC";
        Address[Address["IMM"] = 5] = "IMM";
        Address[Address["ZPX"] = 6] = "ZPX";
        Address[Address["ZPY"] = 7] = "ZPY";
        Address[Address["ABSX"] = 8] = "ABSX";
        Address[Address["ABSY"] = 9] = "ABSY";
        Address[Address["PREIDXIND"] = 10] = "PREIDXIND";
        Address[Address["POSTIDXIND"] = 11] = "POSTIDXIND";
        Address[Address["INDABS"] = 12] = "INDABS";
    })(Address || (Address = {}));
    var Emulator = /** @class */ (function () {
        function Emulator() {
            this.system = null;
            this.rom = null;
            this.onsample = null;
            this.onerror = null;
        }
        Emulator.prototype.load = function (data) {
            if (this.system) {
                this.system = null;
            }
            var rom = new Rom(data);
            if (System.romSupported(rom)) {
                this.rom = rom;
                this.system = new System(this.rom, this.onsample, this.onerror);
            }
            else {
                throw new Error('This ROM uses a unsupported mapper: ' + rom.mapperType);
            }
        };
        Emulator.prototype.reset = function () {
            if (this.rom) {
                this.system = new System(this.rom, this.onsample, this.onerror);
            }
        };
        Emulator.prototype.buttonDown = function (player, button) {
            if (this.system) {
                this.system.buttonDown(player, button);
            }
        };
        Emulator.prototype.buttonUp = function (player, button) {
            if (this.system) {
                this.system.buttonUp(player, button);
            }
        };
        Emulator.prototype.frame = function () {
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
        };
        Emulator.prototype.pull = function () {
            return this.system ? this.system.pull() : null;
        };
        return Emulator;
    }());
    exports.Emulator = Emulator;
    function copy(src, srcPos, dest, destPos, length) {
        for (var i = 0; i < length; i += 1) {
            dest[destPos + i] = src[srcPos + i];
        }
    }
    var Mapper = /** @class */ (function () {
        function Mapper(cpu, ppu, apu, controller, rom) {
            this.cpu = cpu;
            this.ppu = ppu;
            this.apu = apu;
            this.controller = controller;
            this.rom = rom;
            this.joy1StrobeState = 0;
            this.joy2StrobeState = 0;
            this.joypadLastWrite = 0;
            this.mousePressed = false;
            this.mouseX = null;
            this.mouseY = null;
        }
        Object.defineProperty(Mapper.prototype, "serializable", {
            get: function () {
                return Mapper.serializable;
            },
            enumerable: true,
            configurable: true
        });
        Mapper.romSupported = function (rom) {
            return mappers[rom.mapperType] !== undefined;
        };
        Mapper.create = function (cpu, ppu, apu, controller, rom) {
            var mapper = new mappers[rom.mapperType](cpu, ppu, apu, controller, rom);
            mapper.loadROM();
            return mapper;
        };
        Mapper.prototype.write = function (address, value) {
            if (address < 0x2000) {
                this.cpu.mem[address & 0x7FF] = value;
            }
            else if (address > 0x4017) {
                this.cpu.mem[address] = value;
                if (address >= 0x6000 && address < 0x8000) {
                }
            }
            else if (address > 0x2007 && address < 0x4000) {
                this.regWrite(0x2000 + (address & 0x7), value);
            }
            else {
                this.regWrite(address, value);
            }
        };
        Mapper.prototype.writelow = function (address, value) {
            if (address < 0x2000) {
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
        };
        Mapper.prototype.load = function (address) {
            address &= 0xFFFF;
            if (address > 0x4017) {
                return this.cpu.mem[address];
            }
            else if (address >= 0x2000) {
                return this.regLoad(address);
            }
            else {
                return this.cpu.mem[address & 0x7FF];
            }
        };
        Mapper.prototype.regLoad = function (address) {
            switch (address >> 12) {
                case 0:
                    break;
                case 1:
                    break;
                case 2:
                case 3:
                    switch (address & 0x7) {
                        case 0x0:
                            return this.cpu.mem[0x2000];
                        case 0x1:
                            return this.cpu.mem[0x2001];
                        case 0x2:
                            return this.ppu.readStatusRegister();
                        case 0x3:
                            return 0;
                        case 0x4:
                            return this.ppu.sramLoad();
                        case 0x5:
                            return 0;
                        case 0x6:
                            return 0;
                        case 0x7:
                            return this.ppu.vramLoad();
                    }
                    break;
                case 4:
                    switch (address - 0x4015) {
                        case 0:
                            return this.apu.readReg(address);
                        case 1:
                            return this.joy1Read();
                        case 2:
                            if (this.mousePressed) {
                                var sx = Math.max(0, this.mouseX - 4);
                                var ex = Math.min(256, this.mouseX + 4);
                                var sy = Math.max(0, this.mouseY - 4);
                                var ey = Math.min(240, this.mouseY + 4);
                                var w = 0;
                                for (var y = sy; y < ey; y++) {
                                    for (var x = sx; x < ex; x++) {
                                        if (this.ppu.buffer[(y << 8) + x] == 0xFFFFFF) {
                                            w |= 0x1 << 3;
                                            console.debug("Clicked on white!");
                                            break;
                                        }
                                    }
                                }
                                w |= (this.mousePressed ? (0x1 << 4) : 0);
                                return (this.joy2Read() | w) & 0xFFFF;
                            }
                            else {
                                return this.joy2Read();
                            }
                    }
                    break;
            }
            return 0;
        };
        Mapper.prototype.regWrite = function (address, value) {
            switch (address) {
                case 0x2000:
                    this.cpu.mem[address] = value;
                    this.ppu.updateControlReg1(value);
                    break;
                case 0x2001:
                    this.cpu.mem[address] = value;
                    this.ppu.updateControlReg2(value);
                    break;
                case 0x2003:
                    this.ppu.writeSRAMAddress(value);
                    break;
                case 0x2004:
                    this.ppu.sramWrite(value);
                    break;
                case 0x2005:
                    this.ppu.scrollWrite(value);
                    break;
                case 0x2006:
                    this.ppu.writeVRAMAddress(value);
                    break;
                case 0x2007:
                    this.ppu.vramWrite(value);
                    break;
                case 0x4014:
                    this.ppu.sramDMA(value);
                    break;
                case 0x4015:
                    this.apu.writeReg(address, value);
                    break;
                case 0x4016:
                    if ((value & 1) === 0 && (this.joypadLastWrite & 1) === 1) {
                        this.joy1StrobeState = 0;
                        this.joy2StrobeState = 0;
                    }
                    this.joypadLastWrite = value;
                    break;
                case 0x4017:
                    this.apu.writeReg(address, value);
                    break;
                default:
                    if (address >= 0x4000 && address <= 0x4017) {
                        this.apu.writeReg(address, value);
                    }
            }
        };
        Mapper.prototype.joy1Read = function () {
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
        };
        Mapper.prototype.joy2Read = function () {
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
        };
        Mapper.prototype.loadROM = function () {
            this.loadPRGROM();
            this.loadCHRROM();
            this.loadBatteryRam();
            this.cpu.requestIrq(InstructionRequest.RESET);
        };
        Mapper.prototype.loadPRGROM = function () {
            if (this.rom.romCount > 1) {
                this.loadRomBank(0, 0x8000);
                this.loadRomBank(1, 0xC000);
            }
            else {
                this.loadRomBank(0, 0x8000);
                this.loadRomBank(0, 0xC000);
            }
        };
        Mapper.prototype.loadCHRROM = function () {
            if (this.rom.vromCount > 0) {
                if (this.rom.vromCount == 1) {
                    this.loadVromBank(0, 0x0000);
                    this.loadVromBank(0, 0x1000);
                }
                else {
                    this.loadVromBank(0, 0x0000);
                    this.loadVromBank(1, 0x1000);
                }
            }
            else {
            }
        };
        Mapper.prototype.loadBatteryRam = function () {
        };
        Mapper.prototype.loadRomBank = function (bank, address) {
            bank %= this.rom.romCount;
            copy(this.rom.rom[bank], 0, this.cpu.mem, address, 16384);
        };
        Mapper.prototype.loadVromBank = function (bank, address) {
            if (this.rom.vromCount === 0) {
                return;
            }
            this.ppu.triggerRendering();
            copy(this.rom.vrom[bank % this.rom.vromCount], 0, this.ppu.vramMem, address, 4096);
            var vromTile = this.rom.vromTile[bank % this.rom.vromCount];
            copy(vromTile, 0, this.ppu.ptTile, address >> 4, 256);
        };
        Mapper.prototype.load32kRomBank = function (bank, address) {
            this.loadRomBank((bank * 2) % this.rom.romCount, address);
            this.loadRomBank((bank * 2 + 1) % this.rom.romCount, address + 16384);
        };
        Mapper.prototype.load8kVromBank = function (bank4kStart, address) {
            if (this.rom.vromCount === 0) {
                return;
            }
            this.ppu.triggerRendering();
            this.loadVromBank((bank4kStart) % this.rom.vromCount, address);
            this.loadVromBank((bank4kStart + 1) % this.rom.vromCount, address + 4096);
        };
        Mapper.prototype.load1kVromBank = function (bank1k, address) {
            if (this.rom.vromCount === 0) {
                return;
            }
            this.ppu.triggerRendering();
            var bank4k = Math.floor(bank1k / 4) % this.rom.vromCount;
            var bankoffset = (bank1k % 4) * 1024;
            copy(this.rom.vrom[bank4k], 0, this.ppu.vramMem, bankoffset, 1024);
            var vromTile = this.rom.vromTile[bank4k];
            var baseIndex = address >> 4;
            for (var i = 0; i < 64; i++) {
                this.ppu.ptTile[baseIndex + i] = vromTile[((bank1k % 4) << 6) + i];
            }
        };
        Mapper.prototype.load2kVromBank = function (bank2k, address) {
            if (this.rom.vromCount === 0) {
                return;
            }
            this.ppu.triggerRendering();
            var bank4k = Math.floor(bank2k / 2) % this.rom.vromCount;
            var bankoffset = (bank2k % 2) * 2048;
            copy(this.rom.vrom[bank4k], bankoffset, this.ppu.vramMem, address, 2048);
            var vromTile = this.rom.vromTile[bank4k];
            var baseIndex = address >> 4;
            for (var i = 0; i < 128; i++) {
                this.ppu.ptTile[baseIndex + i] = vromTile[((bank2k % 2) << 7) + i];
            }
        };
        Mapper.prototype.load8kRomBank = function (bank8k, address) {
            var bank16k = Math.floor(bank8k / 2) % this.rom.romCount;
            var offset = (bank8k % 2) * 8192;
            copy(this.rom.rom[bank16k], offset, this.cpu.mem, address, 8192);
        };
        Mapper.prototype.clockIrqCounter = function () {
        };
        Mapper.prototype.latchAccess = function (address) {
        };
        Mapper.serializable = [
            'joy1StrobeState',
            'joy2StrobeState',
            'joypadLastWrite'
        ];
        return Mapper;
    }());
    var mappers = [];
    mappers[0] = Mapper;
    var Mapper1 = /** @class */ (function (_super) {
        __extends(Mapper1, _super);
        function Mapper1(cpu, ppu, apu, controller, rom) {
            var _this = _super.call(this, cpu, ppu, apu, controller, rom) || this;
            _this.regBuffer = 0;
            _this.regBufferCounter = 0;
            _this.mirroring = 0;
            _this.oneScreenMirroring = 0;
            _this.prgSwitchingArea = 1;
            _this.prgSwitchingSize = 1;
            _this.vromSwitchingSize = 0;
            _this.romSelectionReg0 = 0;
            _this.romSelectionReg1 = 0;
            _this.romBankSelect = 0;
            _this.regBuffer = 0;
            _this.regBufferCounter = 0;
            _this.mirroring = 0;
            _this.oneScreenMirroring = 0;
            _this.prgSwitchingArea = 1;
            _this.prgSwitchingSize = 1;
            _this.vromSwitchingSize = 0;
            _this.romSelectionReg0 = 0;
            _this.romSelectionReg1 = 0;
            _this.romBankSelect = 0;
            return _this;
        }
        Object.defineProperty(Mapper1.prototype, "serializable", {
            get: function () {
                return Mapper.serializable;
            },
            enumerable: true,
            configurable: true
        });
        Mapper1.prototype.write = function (address, value) {
            if (address < 0x8000) {
                _super.prototype.write.call(this, address, value);
                return;
            }
            if ((value & 128) !== 0) {
                this.regBufferCounter = 0;
                this.regBuffer = 0;
                if (this.getRegNumber(address) === 0) {
                    this.prgSwitchingArea = 1;
                    this.prgSwitchingSize = 1;
                }
            }
            else {
                this.regBuffer = (this.regBuffer & (0xFF - (1 << this.regBufferCounter))) | ((value & 1) << this.regBufferCounter);
                this.regBufferCounter++;
                if (this.regBufferCounter == 5) {
                    this.setReg(this.getRegNumber(address), this.regBuffer);
                    this.regBuffer = 0;
                    this.regBufferCounter = 0;
                }
            }
        };
        Mapper1.prototype.setReg = function (reg, value) {
            var tmp;
            switch (reg) {
                case 0:
                    tmp = value & 3;
                    if (tmp !== this.mirroring) {
                        this.mirroring = tmp;
                        if ((this.mirroring & 2) === 0) {
                            this.ppu.setMirroring(MirroringType.singleScreen);
                        }
                        else if ((this.mirroring & 1) !== 0) {
                            this.ppu.setMirroring(MirroringType.horizontal);
                        }
                        else {
                            this.ppu.setMirroring(MirroringType.vertical);
                        }
                    }
                    this.prgSwitchingArea = (value >> 2) & 1;
                    this.prgSwitchingSize = (value >> 3) & 1;
                    this.vromSwitchingSize = (value >> 4) & 1;
                    break;
                case 1:
                    this.romSelectionReg0 = (value >> 4) & 1;
                    if (this.rom.vromCount > 0) {
                        if (this.vromSwitchingSize === 0) {
                            if (this.romSelectionReg0 === 0) {
                                this.load8kVromBank((value & 0xF), 0x0000);
                            }
                            else {
                                this.load8kVromBank(Math.floor(this.rom.vromCount / 2) + (value & 0xF), 0x0000);
                            }
                        }
                        else {
                            if (this.romSelectionReg0 === 0) {
                                this.loadVromBank((value & 0xF), 0x0000);
                            }
                            else {
                                this.loadVromBank(Math.floor(this.rom.vromCount / 2) + (value & 0xF), 0x0000);
                            }
                        }
                    }
                    break;
                case 2:
                    this.romSelectionReg1 = (value >> 4) & 1;
                    if (this.rom.vromCount > 0) {
                        if (this.vromSwitchingSize === 1) {
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
                    tmp = value & 0xF;
                    var bank;
                    var baseBank = 0;
                    if (this.rom.romCount >= 32) {
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
                        if (this.romSelectionReg0 === 1) {
                            baseBank = 8;
                        }
                    }
                    if (this.prgSwitchingSize === 0) {
                        bank = baseBank + (value & 0xF);
                        this.load32kRomBank(bank, 0x8000);
                    }
                    else {
                        bank = baseBank * 2 + (value & 0xF);
                        if (this.prgSwitchingArea === 0) {
                            this.loadRomBank(bank, 0xC000);
                        }
                        else {
                            this.loadRomBank(bank, 0x8000);
                        }
                    }
            }
        };
        Mapper1.prototype.getRegNumber = function (address) {
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
        };
        Mapper1.prototype.loadROM = function () {
            this.loadRomBank(0, 0x8000);
            this.loadRomBank(this.rom.romCount - 1, 0xC000);
            this.loadCHRROM();
            this.loadBatteryRam();
            this.cpu.requestIrq(InstructionRequest.RESET);
        };
        Mapper1.prototype.switchLowHighPrgRom = function (oldSetting) {
        };
        Mapper1.prototype.switch16to32 = function () {
        };
        Mapper1.prototype.switch32to16 = function () {
        };
        Mapper1.serializable = Mapper.serializable.concat('regBuffer', 'regBufferCounter', 'mirroring', 'oneScreenMirroring', 'prgSwitchingArea', 'prgSwitchingSize', 'vromSwitchingSize', 'romSelectionReg0', 'romSelectionReg1', 'romBankSelect');
        return Mapper1;
    }(Mapper));
    mappers[1] = Mapper1;
    var Mapper2 = /** @class */ (function (_super) {
        __extends(Mapper2, _super);
        function Mapper2() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        Mapper2.prototype.write = function (address, value) {
            if (address < 0x8000) {
                _super.prototype.write.call(this, address, value);
            }
            else {
                this.loadRomBank(value, 0x8000);
            }
        };
        Mapper2.prototype.loadROM = function () {
            this.loadRomBank(0, 0x8000);
            this.loadRomBank(this.rom.romCount - 1, 0xC000);
            this.loadCHRROM();
            this.cpu.requestIrq(InstructionRequest.RESET);
        };
        return Mapper2;
    }(Mapper));
    mappers[2] = Mapper2;
    var Mapper3 = /** @class */ (function (_super) {
        __extends(Mapper3, _super);
        function Mapper3() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        Mapper3.prototype.write = function (address, value) {
            if (address < 0x8000) {
                _super.prototype.write.call(this, address, value);
            }
            else {
                var bank = (value % (this.rom.romCount / 2)) * 2;
                this.loadVromBank(bank, 0x0000);
                this.loadVromBank(bank + 1, 0x1000);
                this.load8kVromBank(value * 2, 0x0000);
            }
        };
        return Mapper3;
    }(Mapper));
    mappers[3] = Mapper3;
    var Mapper4 = /** @class */ (function (_super) {
        __extends(Mapper4, _super);
        function Mapper4() {
            var _this = _super !== null && _super.apply(this, arguments) || this;
            _this.CMD_SEL_2_1K_VROM_0000 = 0;
            _this.CMD_SEL_2_1K_VROM_0800 = 1;
            _this.CMD_SEL_1K_VROM_1000 = 2;
            _this.CMD_SEL_1K_VROM_1400 = 3;
            _this.CMD_SEL_1K_VROM_1800 = 4;
            _this.CMD_SEL_1K_VROM_1C00 = 5;
            _this.CMD_SEL_ROM_PAGE1 = 6;
            _this.CMD_SEL_ROM_PAGE2 = 7;
            _this.command = 0;
            _this.prgAddressSelect = 0;
            _this.chrAddressSelect = 0;
            _this.pageNumber = 0;
            _this.irqCounter = 0;
            _this.irqLatchValue = 0;
            _this.irqEnable = 0;
            _this.prgAddressChanged = false;
            return _this;
        }
        Object.defineProperty(Mapper4.prototype, "serializable", {
            get: function () {
                return Mapper.serializable;
            },
            enumerable: true,
            configurable: true
        });
        Mapper4.prototype.write = function (address, value) {
            if (address < 0x8000) {
                _super.prototype.write.call(this, address, value);
                return;
            }
            switch (address) {
                case 0x8000:
                    this.command = value & 7;
                    var tmp = (value >> 6) & 1;
                    if (tmp != this.prgAddressSelect) {
                        this.prgAddressChanged = true;
                    }
                    this.prgAddressSelect = tmp;
                    this.chrAddressSelect = (value >> 7) & 1;
                    break;
                case 0x8001:
                    this.executeCommand(this.command, value);
                    break;
                case 0xA000:
                    if ((value & 1) !== 0) {
                        this.ppu.setMirroring(MirroringType.horizontal);
                    }
                    else {
                        this.ppu.setMirroring(MirroringType.vertical);
                    }
                    break;
                case 0xA001:
                    break;
                case 0xC000:
                    this.irqCounter = value;
                    break;
                case 0xC001:
                    this.irqLatchValue = value;
                    break;
                case 0xE000:
                    this.irqEnable = 0;
                    break;
                case 0xE001:
                    this.irqEnable = 1;
                    break;
                default:
            }
        };
        Mapper4.prototype.executeCommand = function (cmd, arg) {
            switch (cmd) {
                case this.CMD_SEL_2_1K_VROM_0000:
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
                    if (this.chrAddressSelect === 0) {
                        this.load1kVromBank(arg, 0x1000);
                    }
                    else {
                        this.load1kVromBank(arg, 0x0000);
                    }
                    break;
                case this.CMD_SEL_1K_VROM_1400:
                    if (this.chrAddressSelect === 0) {
                        this.load1kVromBank(arg, 0x1400);
                    }
                    else {
                        this.load1kVromBank(arg, 0x0400);
                    }
                    break;
                case this.CMD_SEL_1K_VROM_1800:
                    if (this.chrAddressSelect === 0) {
                        this.load1kVromBank(arg, 0x1800);
                    }
                    else {
                        this.load1kVromBank(arg, 0x0800);
                    }
                    break;
                case this.CMD_SEL_1K_VROM_1C00:
                    if (this.chrAddressSelect === 0) {
                        this.load1kVromBank(arg, 0x1C00);
                    }
                    else {
                        this.load1kVromBank(arg, 0x0C00);
                    }
                    break;
                case this.CMD_SEL_ROM_PAGE1:
                    if (this.prgAddressChanged) {
                        if (this.prgAddressSelect === 0) {
                            this.load8kRomBank(((this.rom.romCount - 1) * 2), 0xC000);
                        }
                        else {
                            this.load8kRomBank(((this.rom.romCount - 1) * 2), 0x8000);
                        }
                        this.prgAddressChanged = false;
                    }
                    if (this.prgAddressSelect === 0) {
                        this.load8kRomBank(arg, 0x8000);
                    }
                    else {
                        this.load8kRomBank(arg, 0xC000);
                    }
                    break;
                case this.CMD_SEL_ROM_PAGE2:
                    this.load8kRomBank(arg, 0xA000);
                    if (this.prgAddressChanged) {
                        if (this.prgAddressSelect === 0) {
                            this.load8kRomBank(((this.rom.romCount - 1) * 2), 0xC000);
                        }
                        else {
                            this.load8kRomBank(((this.rom.romCount - 1) * 2), 0x8000);
                        }
                        this.prgAddressChanged = false;
                    }
            }
        };
        Mapper4.prototype.loadROM = function () {
            this.load8kRomBank(((this.rom.romCount - 1) * 2), 0xC000);
            this.load8kRomBank(((this.rom.romCount - 1) * 2) + 1, 0xE000);
            this.load8kRomBank(0, 0x8000);
            this.load8kRomBank(1, 0xA000);
            this.loadCHRROM();
            this.loadBatteryRam();
            this.cpu.requestIrq(InstructionRequest.RESET);
        };
        ;
        Mapper4.prototype.clockIrqCounter = function () {
            if (this.irqEnable == 1) {
                this.irqCounter--;
                if (this.irqCounter < 0) {
                    this.cpu.requestIrq(InstructionRequest.NORMAL);
                    this.irqCounter = this.irqLatchValue;
                }
            }
        };
        Mapper4.serializable = Mapper.serializable.concat('command', 'prgAddressSelect', 'chrAddressSelect', 'pageNumber', 'irqCounter', 'irqLatchValue', 'irqEnable', 'prgAddressChanged');
        return Mapper4;
    }(Mapper));
    mappers[4] = Mapper4;
    var Mapper66 = /** @class */ (function (_super) {
        __extends(Mapper66, _super);
        function Mapper66() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        Mapper66.prototype.write = function (address, value) {
            if (address < 0x8000) {
                _super.prototype.write.call(this, address, value);
            }
            else {
                this.load32kRomBank((value >> 4) & 3, 0x8000);
                this.load8kVromBank((value & 3) * 2, 0x0000);
            }
        };
        return Mapper66;
    }(Mapper));
    mappers[66] = Mapper66;
    var StatusFlag;
    (function (StatusFlag) {
        StatusFlag[StatusFlag["VRAMWRITE"] = 4] = "VRAMWRITE";
        StatusFlag[StatusFlag["SLSPRITECOUNT"] = 5] = "SLSPRITECOUNT";
        StatusFlag[StatusFlag["SPRITE0HIT"] = 6] = "SPRITE0HIT";
        StatusFlag[StatusFlag["VBLANK"] = 7] = "VBLANK";
    })(StatusFlag || (StatusFlag = {}));
    var PPU = /** @class */ (function () {
        function PPU(cpu, writeFrame) {
            this.cpu = cpu;
            this.writeFrame = writeFrame;
            this.showSpr0Hit = false;
            this.clipToTvSize = true;
            this.vramMem = new Array(0x8000);
            this.spriteMem = new Array(0x100);
            for (var i = 0; i < this.vramMem.length; i += 1) {
                this.vramMem[i] = 0;
            }
            for (var i = 0; i < this.spriteMem.length; i += 1) {
                this.spriteMem[i] = 0;
            }
            this.vramAddress = null;
            this.vramTmpAddress = null;
            this.vramBufferedReadValue = 0;
            this.firstWrite = true;
            this.sramAddress = 0;
            this.currentMirroring = -1;
            this.requestEndFrame = false;
            this.nmiOk = false;
            this.dummyCycleToggle = false;
            this.validTileData = false;
            this.nmiCounter = 0;
            this.scanlineAlreadyRendered = null;
            this.f_nmiOnVblank = 0;
            this.f_spriteSize = 0;
            this.f_bgPatternTable = 0;
            this.f_spPatternTable = 0;
            this.f_addrInc = 0;
            this.f_nTblAddress = 0;
            this.f_color = 0;
            this.f_spVisibility = 0;
            this.f_bgVisibility = 0;
            this.f_spClipping = 0;
            this.f_bgClipping = 0;
            this.f_dispType = 0;
            this.cntFV = 0;
            this.cntV = 0;
            this.cntH = 0;
            this.cntVT = 0;
            this.cntHT = 0;
            this.regFV = 0;
            this.regV = 0;
            this.regH = 0;
            this.regVT = 0;
            this.regHT = 0;
            this.regFH = 0;
            this.regS = 0;
            this.curNt = null;
            this.attrib = new Array(32);
            this.buffer = new Array(256 * 240);
            this.bgbuffer = new Array(256 * 240);
            this.pixrendered = new Array(256 * 240);
            this.scantile = new Array(32);
            this.scanline = 0;
            this.lastRenderedScanline = -1;
            this.curX = 0;
            this.sprX = new Array(64);
            this.sprY = new Array(64);
            this.sprTile = new Array(64);
            this.sprCol = new Array(64);
            this.vertFlip = new Array(64);
            this.horiFlip = new Array(64);
            this.bgPriority = new Array(64);
            this.spr0HitX = 0;
            this.spr0HitY = 0;
            this.hitSpr0 = false;
            this.sprPalette = new Array(16);
            this.imgPalette = new Array(16);
            this.ptTile = new Array(512);
            for (var i = 0; i < 512; i += 1) {
                this.ptTile[i] = new Tile();
            }
            this.ntable1 = new Array(4);
            this.currentMirroring = -1;
            this.nameTable = new Array(4);
            for (var i = 0; i < 4; i += 1) {
                this.nameTable[i] = new NameTable(32, 32, "Nt" + i);
            }
            this.vramMirrorTable = new Array(0x8000);
            for (var i = 0; i < 0x8000; i += 1) {
                this.vramMirrorTable[i] = i;
            }
            this.palTable = new PaletteTable();
            this.palTable.loadNTSCPalette();
            this.updateControlReg1(0);
            this.updateControlReg2(0);
        }
        Object.defineProperty(PPU.prototype, "serializable", {
            get: function () {
                return PPU.serializable;
            },
            enumerable: true,
            configurable: true
        });
        PPU.prototype.setMirroring = function (mirroring) {
            if (mirroring == this.currentMirroring) {
                return;
            }
            this.currentMirroring = mirroring;
            this.triggerRendering();
            if (this.vramMirrorTable === null) {
                this.vramMirrorTable = new Array(0x8000);
            }
            for (var i = 0; i < 0x8000; i += 1) {
                this.vramMirrorTable[i] = i;
            }
            this.defineMirrorRegion(0x3f20, 0x3f00, 0x20);
            this.defineMirrorRegion(0x3f40, 0x3f00, 0x20);
            this.defineMirrorRegion(0x3f80, 0x3f00, 0x20);
            this.defineMirrorRegion(0x3fc0, 0x3f00, 0x20);
            this.defineMirrorRegion(0x3000, 0x2000, 0xf00);
            this.defineMirrorRegion(0x4000, 0x0000, 0x4000);
            if (mirroring == MirroringType.horizontal) {
                this.ntable1[0] = 0;
                this.ntable1[1] = 0;
                this.ntable1[2] = 1;
                this.ntable1[3] = 1;
                this.defineMirrorRegion(0x2400, 0x2000, 0x400);
                this.defineMirrorRegion(0x2c00, 0x2800, 0x400);
            }
            else if (mirroring == MirroringType.vertical) {
                this.ntable1[0] = 0;
                this.ntable1[1] = 1;
                this.ntable1[2] = 0;
                this.ntable1[3] = 1;
                this.defineMirrorRegion(0x2800, 0x2000, 0x400);
                this.defineMirrorRegion(0x2c00, 0x2400, 0x400);
            }
            else if (mirroring == MirroringType.singleScreen) {
                this.ntable1[0] = 0;
                this.ntable1[1] = 0;
                this.ntable1[2] = 0;
                this.ntable1[3] = 0;
                this.defineMirrorRegion(0x2400, 0x2000, 0x400);
                this.defineMirrorRegion(0x2800, 0x2000, 0x400);
                this.defineMirrorRegion(0x2c00, 0x2000, 0x400);
            }
            else if (mirroring == MirroringType.singleScreen2) {
                this.ntable1[0] = 1;
                this.ntable1[1] = 1;
                this.ntable1[2] = 1;
                this.ntable1[3] = 1;
                this.defineMirrorRegion(0x2400, 0x2400, 0x400);
                this.defineMirrorRegion(0x2800, 0x2400, 0x400);
                this.defineMirrorRegion(0x2c00, 0x2400, 0x400);
            }
            else {
                this.ntable1[0] = 0;
                this.ntable1[1] = 1;
                this.ntable1[2] = 2;
                this.ntable1[3] = 3;
            }
        };
        PPU.prototype.defineMirrorRegion = function (fromStart, toStart, size) {
            for (var i = 0; i < size; i += 1) {
                this.vramMirrorTable[fromStart + i] = toStart + i;
            }
        };
        PPU.prototype.startVBlank = function () {
            this.cpu.requestIrq(InstructionRequest.NMI);
            if (this.lastRenderedScanline < 239) {
                this.renderFramePartially(this.lastRenderedScanline + 1, 240 - this.lastRenderedScanline);
            }
            this.endFrame();
            this.lastRenderedScanline = -1;
        };
        PPU.prototype.endScanline = function () {
            switch (this.scanline) {
                case 19:
                    if (this.dummyCycleToggle) {
                        this.curX = 1;
                        this.dummyCycleToggle = !this.dummyCycleToggle;
                    }
                    break;
                case 20:
                    this.setStatusFlag(StatusFlag.VBLANK, false);
                    this.setStatusFlag(StatusFlag.SPRITE0HIT, false);
                    this.hitSpr0 = false;
                    this.spr0HitX = -1;
                    this.spr0HitY = -1;
                    if (this.f_bgVisibility == 1 || this.f_spVisibility == 1) {
                        this.cntFV = this.regFV;
                        this.cntV = this.regV;
                        this.cntH = this.regH;
                        this.cntVT = this.regVT;
                        this.cntHT = this.regHT;
                        if (this.f_bgVisibility == 1) {
                            this.renderBgScanline(false, 0);
                        }
                    }
                    if (this.f_bgVisibility == 1 && this.f_spVisibility == 1) {
                        this.checkSprite0(0);
                    }
                    if (this.f_bgVisibility == 1 || this.f_spVisibility == 1) {
                        this.cpu.mapper.clockIrqCounter();
                    }
                    break;
                case 261:
                    this.setStatusFlag(StatusFlag.VBLANK, true);
                    this.requestEndFrame = true;
                    this.nmiCounter = 9;
                    this.scanline = -1;
                    break;
                default:
                    if (this.scanline >= 21 && this.scanline <= 260) {
                        if (this.f_bgVisibility == 1) {
                            if (!this.scanlineAlreadyRendered) {
                                this.cntHT = this.regHT;
                                this.cntH = this.regH;
                                this.renderBgScanline(true, this.scanline + 1 - 21);
                            }
                            this.scanlineAlreadyRendered = false;
                            if (!this.hitSpr0 && this.f_spVisibility == 1) {
                                if (this.sprX[0] >= -7 &&
                                    this.sprX[0] < 256 &&
                                    this.sprY[0] + 1 <= (this.scanline - 20) &&
                                    (this.sprY[0] + 1 + (this.f_spriteSize === 0 ? 8 : 16)) >= (this.scanline - 20)) {
                                    if (this.checkSprite0(this.scanline - 20)) {
                                        this.hitSpr0 = true;
                                    }
                                }
                            }
                        }
                        if (this.f_bgVisibility == 1 || this.f_spVisibility == 1) {
                            this.cpu.mapper.clockIrqCounter();
                        }
                    }
            }
            this.scanline += 1;
            this.regsToAddress();
            this.cntsToAddress();
        };
        PPU.prototype.startFrame = function () {
            var bgColor = 0;
            if (this.f_dispType === 0) {
                bgColor = this.imgPalette[0];
            }
            else {
                switch (this.f_color) {
                    case 0:
                        bgColor = 0x00000;
                        break;
                    case 1:
                        bgColor = 0x00FF00;
                        break;
                    case 2:
                        bgColor = 0xFF0000;
                        break;
                    case 3:
                        bgColor = 0x000000;
                        break;
                    case 4:
                        bgColor = 0x0000FF;
                        break;
                    default:
                        bgColor = 0x0;
                }
            }
            var buffer = this.buffer;
            var i;
            for (i = 0; i < 256 * 240; i += 1) {
                buffer[i] = bgColor;
            }
            var pixrendered = this.pixrendered;
            for (i = 0; i < pixrendered.length; i += 1) {
                pixrendered[i] = 65;
            }
        };
        PPU.prototype.endFrame = function () {
            var i;
            var x;
            var y;
            var buffer = this.buffer;
            if (this.showSpr0Hit) {
                if (this.sprX[0] >= 0 && this.sprX[0] < 256 &&
                    this.sprY[0] >= 0 && this.sprY[0] < 240) {
                    for (i = 0; i < 256; i += 1) {
                        buffer[(this.sprY[0] << 8) + i] = 0xFF5555;
                    }
                    for (i = 0; i < 240; i += 1) {
                        buffer[(i << 8) + this.sprX[0]] = 0xFF5555;
                    }
                }
                if (this.spr0HitX >= 0 && this.spr0HitX < 256 &&
                    this.spr0HitY >= 0 && this.spr0HitY < 240) {
                    for (i = 0; i < 256; i += 1) {
                        buffer[(this.spr0HitY << 8) + i] = 0x55FF55;
                    }
                    for (i = 0; i < 256; i += 1) {
                        buffer[(i << 8) + this.spr0HitX] = 0x55FF55;
                    }
                }
            }
            if (this.clipToTvSize || this.f_bgClipping === 0 || this.f_spClipping === 0) {
                for (y = 0; y < 240; y += 1) {
                    for (x = 0; x < 8; x += 1) {
                        buffer[(y << 8) + x] = 0;
                    }
                }
            }
            if (this.clipToTvSize) {
                for (y = 0; y < 240; y += 1) {
                    for (x = 0; x < 8; x += 1) {
                        buffer[(y << 8) + 255 - x] = 0;
                    }
                }
            }
            if (this.clipToTvSize) {
                for (y = 0; y < 240; y += 1) {
                    for (x = 0; x < 8; x += 1) {
                        buffer[(y << 8) + x] = 0;
                        buffer[((239 - y) << 8) + x] = 0;
                    }
                }
            }
            this.writeFrame(buffer);
        };
        PPU.prototype.updateControlReg1 = function (value) {
            this.triggerRendering();
            this.f_nmiOnVblank = (value >> 7) & 1;
            this.f_spriteSize = (value >> 5) & 1;
            this.f_bgPatternTable = (value >> 4) & 1;
            this.f_spPatternTable = (value >> 3) & 1;
            this.f_addrInc = (value >> 2) & 1;
            this.f_nTblAddress = value & 3;
            this.regV = (value >> 1) & 1;
            this.regH = value & 1;
            this.regS = (value >> 4) & 1;
        };
        PPU.prototype.updateControlReg2 = function (value) {
            this.triggerRendering();
            this.f_color = (value >> 5) & 7;
            this.f_spVisibility = (value >> 4) & 1;
            this.f_bgVisibility = (value >> 3) & 1;
            this.f_spClipping = (value >> 2) & 1;
            this.f_bgClipping = (value >> 1) & 1;
            this.f_dispType = value & 1;
            if (this.f_dispType === 0) {
                this.palTable.setEmphasis(this.f_color);
            }
            this.updatePalettes();
        };
        PPU.prototype.setStatusFlag = function (flag, value) {
            var n = 1 << flag;
            this.cpu.mem[0x2002] =
                ((this.cpu.mem[0x2002] & (255 - n)) | (value ? n : 0));
        };
        PPU.prototype.readStatusRegister = function () {
            var tmp = this.cpu.mem[0x2002];
            this.firstWrite = true;
            this.setStatusFlag(StatusFlag.VBLANK, false);
            return tmp;
        };
        PPU.prototype.writeSRAMAddress = function (address) {
            this.sramAddress = address;
        };
        PPU.prototype.sramLoad = function () {
            return this.spriteMem[this.sramAddress];
        };
        PPU.prototype.sramWrite = function (value) {
            this.spriteMem[this.sramAddress] = value;
            this.spriteRamWriteUpdate(this.sramAddress, value);
            this.sramAddress++;
            this.sramAddress %= 0x100;
        };
        PPU.prototype.scrollWrite = function (value) {
            this.triggerRendering();
            if (this.firstWrite) {
                this.regHT = (value >> 3) & 31;
                this.regFH = value & 7;
            }
            else {
                this.regFV = value & 7;
                this.regVT = (value >> 3) & 31;
            }
            this.firstWrite = !this.firstWrite;
        };
        PPU.prototype.writeVRAMAddress = function (address) {
            if (this.firstWrite) {
                this.regFV = (address >> 4) & 3;
                this.regV = (address >> 3) & 1;
                this.regH = (address >> 2) & 1;
                this.regVT = (this.regVT & 7) | ((address & 3) << 3);
            }
            else {
                this.triggerRendering();
                this.regVT = (this.regVT & 24) | ((address >> 5) & 7);
                this.regHT = address & 31;
                this.cntFV = this.regFV;
                this.cntV = this.regV;
                this.cntH = this.regH;
                this.cntVT = this.regVT;
                this.cntHT = this.regHT;
                this.checkSprite0(this.scanline - 20);
            }
            this.firstWrite = !this.firstWrite;
            this.cntsToAddress();
            if (this.vramAddress < 0x2000) {
                this.cpu.mapper.latchAccess(this.vramAddress);
            }
        };
        PPU.prototype.vramLoad = function () {
            var tmp;
            this.cntsToAddress();
            this.regsToAddress();
            if (this.vramAddress <= 0x3EFF) {
                tmp = this.vramBufferedReadValue;
                if (this.vramAddress < 0x2000) {
                    this.vramBufferedReadValue = this.vramMem[this.vramAddress];
                }
                else {
                    this.vramBufferedReadValue = this.mirroredLoad(this.vramAddress);
                }
                if (this.vramAddress < 0x2000) {
                    this.cpu.mapper.latchAccess(this.vramAddress);
                }
                this.vramAddress += (this.f_addrInc == 1 ? 32 : 1);
                this.cntsFromAddress();
                this.regsFromAddress();
                return tmp;
            }
            tmp = this.mirroredLoad(this.vramAddress);
            this.vramAddress += (this.f_addrInc == 1 ? 32 : 1);
            this.cntsFromAddress();
            this.regsFromAddress();
            return tmp;
        };
        PPU.prototype.vramWrite = function (value) {
            this.triggerRendering();
            this.cntsToAddress();
            this.regsToAddress();
            if (this.vramAddress >= 0x2000) {
                this.mirroredWrite(this.vramAddress, value);
            }
            else {
                this.writeMem(this.vramAddress, value);
                this.cpu.mapper.latchAccess(this.vramAddress);
            }
            this.vramAddress += (this.f_addrInc == 1 ? 32 : 1);
            this.regsFromAddress();
            this.cntsFromAddress();
        };
        PPU.prototype.sramDMA = function (value) {
            var baseAddress = value * 0x100;
            var data;
            for (var i = this.sramAddress; i < 256; i++) {
                data = this.cpu.mem[baseAddress + i];
                this.spriteMem[i] = data;
                this.spriteRamWriteUpdate(i, data);
            }
            this.cpu.haltCycles(513);
        };
        PPU.prototype.regsFromAddress = function () {
            var address = (this.vramTmpAddress >> 8) & 0xFF;
            this.regFV = (address >> 4) & 7;
            this.regV = (address >> 3) & 1;
            this.regH = (address >> 2) & 1;
            this.regVT = (this.regVT & 7) | ((address & 3) << 3);
            address = this.vramTmpAddress & 0xFF;
            this.regVT = (this.regVT & 24) | ((address >> 5) & 7);
            this.regHT = address & 31;
        };
        PPU.prototype.cntsFromAddress = function () {
            var address = (this.vramAddress >> 8) & 0xFF;
            this.cntFV = (address >> 4) & 3;
            this.cntV = (address >> 3) & 1;
            this.cntH = (address >> 2) & 1;
            this.cntVT = (this.cntVT & 7) | ((address & 3) << 3);
            address = this.vramAddress & 0xFF;
            this.cntVT = (this.cntVT & 24) | ((address >> 5) & 7);
            this.cntHT = address & 31;
        };
        PPU.prototype.regsToAddress = function () {
            var b1 = (this.regFV & 7) << 4;
            b1 |= (this.regV & 1) << 3;
            b1 |= (this.regH & 1) << 2;
            b1 |= (this.regVT >> 3) & 3;
            var b2 = (this.regVT & 7) << 5;
            b2 |= this.regHT & 31;
            this.vramTmpAddress = ((b1 << 8) | b2) & 0x7FFF;
        };
        PPU.prototype.cntsToAddress = function () {
            var b1 = (this.cntFV & 7) << 4;
            b1 |= (this.cntV & 1) << 3;
            b1 |= (this.cntH & 1) << 2;
            b1 |= (this.cntVT >> 3) & 3;
            var b2 = (this.cntVT & 7) << 5;
            b2 |= this.cntHT & 31;
            this.vramAddress = ((b1 << 8) | b2) & 0x7FFF;
        };
        PPU.prototype.incTileCounter = function (count) {
            for (var i = count; i !== 0; i--) {
                this.cntHT++;
                if (this.cntHT == 32) {
                    this.cntHT = 0;
                    this.cntVT++;
                    if (this.cntVT >= 30) {
                        this.cntH++;
                        if (this.cntH == 2) {
                            this.cntH = 0;
                            this.cntV++;
                            if (this.cntV == 2) {
                                this.cntV = 0;
                                this.cntFV++;
                                this.cntFV &= 0x7;
                            }
                        }
                    }
                }
            }
        };
        PPU.prototype.mirroredLoad = function (address) {
            return this.vramMem[this.vramMirrorTable[address]];
        };
        PPU.prototype.mirroredWrite = function (address, value) {
            if (address >= 0x3f00 && address < 0x3f20) {
                if (address == 0x3F00 || address == 0x3F10) {
                    this.writeMem(0x3F00, value);
                    this.writeMem(0x3F10, value);
                }
                else if (address == 0x3F04 || address == 0x3F14) {
                    this.writeMem(0x3F04, value);
                    this.writeMem(0x3F14, value);
                }
                else if (address == 0x3F08 || address == 0x3F18) {
                    this.writeMem(0x3F08, value);
                    this.writeMem(0x3F18, value);
                }
                else if (address == 0x3F0C || address == 0x3F1C) {
                    this.writeMem(0x3F0C, value);
                    this.writeMem(0x3F1C, value);
                }
                else {
                    this.writeMem(address, value);
                }
            }
            else {
                if (address < this.vramMirrorTable.length) {
                    this.writeMem(this.vramMirrorTable[address], value);
                }
                else {
                    alert("Invalid VRAM address: " + address.toString(16));
                }
            }
        };
        PPU.prototype.triggerRendering = function () {
            if (this.scanline >= 21 && this.scanline <= 260) {
                this.renderFramePartially(this.lastRenderedScanline + 1, this.scanline - 21 - this.lastRenderedScanline);
                this.lastRenderedScanline = this.scanline - 21;
            }
        };
        PPU.prototype.renderFramePartially = function (startScan, scanCount) {
            if (this.f_spVisibility == 1) {
                this.renderSpritesPartially(startScan, scanCount, true);
            }
            if (this.f_bgVisibility == 1) {
                var si = startScan << 8;
                var ei = (startScan + scanCount) << 8;
                if (ei > 0xF000) {
                    ei = 0xF000;
                }
                var buffer = this.buffer;
                var bgbuffer = this.bgbuffer;
                var pixrendered = this.pixrendered;
                for (var destIndex = si; destIndex < ei; destIndex++) {
                    if (pixrendered[destIndex] > 0xFF) {
                        buffer[destIndex] = bgbuffer[destIndex];
                    }
                }
            }
            if (this.f_spVisibility == 1) {
                this.renderSpritesPartially(startScan, scanCount, false);
            }
            this.validTileData = false;
        };
        PPU.prototype.renderBgScanline = function (bgbuffer, scan) {
            var baseTile = (this.regS === 0 ? 0 : 256);
            var destIndex = (scan << 8) - this.regFH;
            this.curNt = this.ntable1[this.cntV + this.cntV + this.cntH];
            this.cntHT = this.regHT;
            this.cntH = this.regH;
            this.curNt = this.ntable1[this.cntV + this.cntV + this.cntH];
            if (scan < 240 && (scan - this.cntFV) >= 0) {
                var tscanoffset = this.cntFV << 3;
                var scantile = this.scantile;
                var attrib = this.attrib;
                var ptTile = this.ptTile;
                var nameTable = this.nameTable;
                var imgPalette = this.imgPalette;
                var pixrendered = this.pixrendered;
                var targetBuffer = bgbuffer ? this.bgbuffer : this.buffer;
                var t, tpix, att, col;
                for (var tile = 0; tile < 32; tile++) {
                    if (scan >= 0) {
                        if (this.validTileData) {
                            t = scantile[tile];
                            if (typeof t === 'undefined') {
                                continue;
                            }
                            tpix = t.pix;
                            att = attrib[tile];
                        }
                        else {
                            t = ptTile[baseTile + nameTable[this.curNt].getTileIndex(this.cntHT, this.cntVT)];
                            if (typeof t === 'undefined') {
                                continue;
                            }
                            tpix = t.pix;
                            att = nameTable[this.curNt].getAttrib(this.cntHT, this.cntVT);
                            scantile[tile] = t;
                            attrib[tile] = att;
                        }
                        var sx = 0;
                        var x = (tile << 3) - this.regFH;
                        if (x > -8) {
                            if (x < 0) {
                                destIndex -= x;
                                sx = -x;
                            }
                            if (t.opaque[this.cntFV]) {
                                for (; sx < 8; sx++) {
                                    targetBuffer[destIndex] = imgPalette[tpix[tscanoffset + sx] + att];
                                    pixrendered[destIndex] |= 256;
                                    destIndex++;
                                }
                            }
                            else {
                                for (; sx < 8; sx++) {
                                    col = tpix[tscanoffset + sx];
                                    if (col !== 0) {
                                        targetBuffer[destIndex] = imgPalette[col + att];
                                        pixrendered[destIndex] |= 256;
                                    }
                                    destIndex++;
                                }
                            }
                        }
                    }
                    if (++this.cntHT == 32) {
                        this.cntHT = 0;
                        this.cntH++;
                        this.cntH %= 2;
                        this.curNt = this.ntable1[(this.cntV << 1) + this.cntH];
                    }
                }
                this.validTileData = true;
            }
            this.cntFV++;
            if (this.cntFV == 8) {
                this.cntFV = 0;
                this.cntVT++;
                if (this.cntVT == 30) {
                    this.cntVT = 0;
                    this.cntV++;
                    this.cntV %= 2;
                    this.curNt = this.ntable1[(this.cntV << 1) + this.cntH];
                }
                else if (this.cntVT == 32) {
                    this.cntVT = 0;
                }
                this.validTileData = false;
            }
        };
        PPU.prototype.renderSpritesPartially = function (startscan, scancount, bgPri) {
            if (this.f_spVisibility === 1) {
                for (var i = 0; i < 64; i++) {
                    if (this.bgPriority[i] == bgPri && this.sprX[i] >= 0 &&
                        this.sprX[i] < 256 && this.sprY[i] + 8 >= startscan &&
                        this.sprY[i] < startscan + scancount) {
                        if (this.f_spriteSize === 0) {
                            var srcy1 = 0;
                            var srcy2 = 8;
                            if (this.sprY[i] < startscan) {
                                srcy1 = startscan - this.sprY[i] - 1;
                            }
                            if (this.sprY[i] + 8 > startscan + scancount) {
                                srcy2 = startscan + scancount - this.sprY[i] + 1;
                            }
                            if (this.f_spPatternTable === 0) {
                                this.ptTile[this.sprTile[i]].render(this.buffer, 0, srcy1, 8, srcy2, this.sprX[i], this.sprY[i] + 1, this.sprCol[i], this.sprPalette, this.horiFlip[i], this.vertFlip[i], i, this.pixrendered);
                            }
                            else {
                                this.ptTile[this.sprTile[i] + 256].render(this.buffer, 0, srcy1, 8, srcy2, this.sprX[i], this.sprY[i] + 1, this.sprCol[i], this.sprPalette, this.horiFlip[i], this.vertFlip[i], i, this.pixrendered);
                            }
                        }
                        else {
                            var top = this.sprTile[i];
                            if ((top & 1) !== 0) {
                                top = this.sprTile[i] - 1 + 256;
                            }
                            var srcy1 = 0;
                            var srcy2 = 8;
                            if (this.sprY[i] < startscan) {
                                srcy1 = startscan - this.sprY[i] - 1;
                            }
                            if (this.sprY[i] + 8 > startscan + scancount) {
                                srcy2 = startscan + scancount - this.sprY[i];
                            }
                            this.ptTile[top + (this.vertFlip[i] ? 1 : 0)].render(this.buffer, 0, srcy1, 8, srcy2, this.sprX[i], this.sprY[i] + 1, this.sprCol[i], this.sprPalette, this.horiFlip[i], this.vertFlip[i], i, this.pixrendered);
                            srcy1 = 0;
                            srcy2 = 8;
                            if (this.sprY[i] + 8 < startscan) {
                                srcy1 = startscan - (this.sprY[i] + 8 + 1);
                            }
                            if (this.sprY[i] + 16 > startscan + scancount) {
                                srcy2 = startscan + scancount - (this.sprY[i] + 8);
                            }
                            this.ptTile[top + (this.vertFlip[i] ? 0 : 1)].render(this.buffer, 0, srcy1, 8, srcy2, this.sprX[i], this.sprY[i] + 1 + 8, this.sprCol[i], this.sprPalette, this.horiFlip[i], this.vertFlip[i], i, this.pixrendered);
                        }
                    }
                }
            }
        };
        PPU.prototype.checkSprite0 = function (scan) {
            this.spr0HitX = -1;
            this.spr0HitY = -1;
            var toffset;
            var tIndexAdd = (this.f_spPatternTable === 0 ? 0 : 256);
            var x, y, t, i;
            var bufferIndex;
            var col;
            var bgPri;
            x = this.sprX[0];
            y = this.sprY[0] + 1;
            if (this.f_spriteSize === 0) {
                if (y <= scan && y + 8 > scan && x >= -7 && x < 256) {
                    t = this.ptTile[this.sprTile[0] + tIndexAdd];
                    col = this.sprCol[0];
                    bgPri = this.bgPriority[0];
                    if (this.vertFlip[0]) {
                        toffset = 7 - (scan - y);
                    }
                    else {
                        toffset = scan - y;
                    }
                    toffset *= 8;
                    bufferIndex = scan * 256 + x;
                    if (this.horiFlip[0]) {
                        for (i = 7; i >= 0; i--) {
                            if (x >= 0 && x < 256) {
                                if (bufferIndex >= 0 && bufferIndex < 61440 &&
                                    this.pixrendered[bufferIndex] !== 0) {
                                    if (t.pix[toffset + i] !== 0) {
                                        this.spr0HitX = bufferIndex % 256;
                                        this.spr0HitY = scan;
                                        return true;
                                    }
                                }
                            }
                            x++;
                            bufferIndex++;
                        }
                    }
                    else {
                        for (i = 0; i < 8; i++) {
                            if (x >= 0 && x < 256) {
                                if (bufferIndex >= 0 && bufferIndex < 61440 &&
                                    this.pixrendered[bufferIndex] !== 0) {
                                    if (t.pix[toffset + i] !== 0) {
                                        this.spr0HitX = bufferIndex % 256;
                                        this.spr0HitY = scan;
                                        return true;
                                    }
                                }
                            }
                            x++;
                            bufferIndex++;
                        }
                    }
                }
            }
            else {
                if (y <= scan && y + 16 > scan && x >= -7 && x < 256) {
                    if (this.vertFlip[0]) {
                        toffset = 15 - (scan - y);
                    }
                    else {
                        toffset = scan - y;
                    }
                    if (toffset < 8) {
                        t = this.ptTile[this.sprTile[0] + (this.vertFlip[0] ? 1 : 0) + ((this.sprTile[0] & 1) !== 0 ? 255 : 0)];
                    }
                    else {
                        t = this.ptTile[this.sprTile[0] + (this.vertFlip[0] ? 0 : 1) + ((this.sprTile[0] & 1) !== 0 ? 255 : 0)];
                        if (this.vertFlip[0]) {
                            toffset = 15 - toffset;
                        }
                        else {
                            toffset -= 8;
                        }
                    }
                    toffset *= 8;
                    col = this.sprCol[0];
                    bgPri = this.bgPriority[0];
                    bufferIndex = scan * 256 + x;
                    if (this.horiFlip[0]) {
                        for (i = 7; i >= 0; i--) {
                            if (x >= 0 && x < 256) {
                                if (bufferIndex >= 0 && bufferIndex < 61440 && this.pixrendered[bufferIndex] !== 0) {
                                    if (t.pix[toffset + i] !== 0) {
                                        this.spr0HitX = bufferIndex % 256;
                                        this.spr0HitY = scan;
                                        return true;
                                    }
                                }
                            }
                            x++;
                            bufferIndex++;
                        }
                    }
                    else {
                        for (i = 0; i < 8; i++) {
                            if (x >= 0 && x < 256) {
                                if (bufferIndex >= 0 && bufferIndex < 61440 && this.pixrendered[bufferIndex] !== 0) {
                                    if (t.pix[toffset + i] !== 0) {
                                        this.spr0HitX = bufferIndex % 256;
                                        this.spr0HitY = scan;
                                        return true;
                                    }
                                }
                            }
                            x++;
                            bufferIndex++;
                        }
                    }
                }
            }
            return false;
        };
        PPU.prototype.writeMem = function (address, value) {
            this.vramMem[address] = value;
            if (address < 0x2000) {
                this.vramMem[address] = value;
                this.patternWrite(address, value);
            }
            else if (address >= 0x2000 && address < 0x23c0) {
                this.nameTableWrite(this.ntable1[0], address - 0x2000, value);
            }
            else if (address >= 0x23c0 && address < 0x2400) {
                this.attribTableWrite(this.ntable1[0], address - 0x23c0, value);
            }
            else if (address >= 0x2400 && address < 0x27c0) {
                this.nameTableWrite(this.ntable1[1], address - 0x2400, value);
            }
            else if (address >= 0x27c0 && address < 0x2800) {
                this.attribTableWrite(this.ntable1[1], address - 0x27c0, value);
            }
            else if (address >= 0x2800 && address < 0x2bc0) {
                this.nameTableWrite(this.ntable1[2], address - 0x2800, value);
            }
            else if (address >= 0x2bc0 && address < 0x2c00) {
                this.attribTableWrite(this.ntable1[2], address - 0x2bc0, value);
            }
            else if (address >= 0x2c00 && address < 0x2fc0) {
                this.nameTableWrite(this.ntable1[3], address - 0x2c00, value);
            }
            else if (address >= 0x2fc0 && address < 0x3000) {
                this.attribTableWrite(this.ntable1[3], address - 0x2fc0, value);
            }
            else if (address >= 0x3f00 && address < 0x3f20) {
                this.updatePalettes();
            }
        };
        PPU.prototype.updatePalettes = function () {
            var i;
            for (i = 0; i < 16; i++) {
                if (this.f_dispType === 0) {
                    this.imgPalette[i] = this.palTable.getEntry(this.vramMem[0x3f00 + i] & 63);
                }
                else {
                    this.imgPalette[i] = this.palTable.getEntry(this.vramMem[0x3f00 + i] & 32);
                }
            }
            for (i = 0; i < 16; i++) {
                if (this.f_dispType === 0) {
                    this.sprPalette[i] = this.palTable.getEntry(this.vramMem[0x3f10 + i] & 63);
                }
                else {
                    this.sprPalette[i] = this.palTable.getEntry(this.vramMem[0x3f10 + i] & 32);
                }
            }
        };
        PPU.prototype.patternWrite = function (address, value) {
            var tileIndex = Math.floor(address / 16);
            var leftOver = address % 16;
            if (leftOver < 8) {
                this.ptTile[tileIndex].setScanline(leftOver, value, this.vramMem[address + 8]);
            }
            else {
                this.ptTile[tileIndex].setScanline(leftOver - 8, this.vramMem[address - 8], value);
            }
        };
        PPU.prototype.nameTableWrite = function (index, address, value) {
            this.nameTable[index].tile[address] = value;
            this.checkSprite0(this.scanline - 20);
        };
        PPU.prototype.attribTableWrite = function (index, address, value) {
            this.nameTable[index].writeAttrib(address, value);
        };
        PPU.prototype.spriteRamWriteUpdate = function (address, value) {
            var tIndex = Math.floor(address / 4);
            if (tIndex === 0) {
                this.checkSprite0(this.scanline - 20);
            }
            if (address % 4 === 0) {
                this.sprY[tIndex] = value;
            }
            else if (address % 4 == 1) {
                this.sprTile[tIndex] = value;
            }
            else if (address % 4 == 2) {
                this.vertFlip[tIndex] = ((value & 0x80) !== 0);
                this.horiFlip[tIndex] = ((value & 0x40) !== 0);
                this.bgPriority[tIndex] = ((value & 0x20) !== 0);
                this.sprCol[tIndex] = (value & 3) << 2;
            }
            else if (address % 4 == 3) {
                this.sprX[tIndex] = value;
            }
        };
        PPU.prototype.doNMI = function () {
            this.setStatusFlag(StatusFlag.VBLANK, true);
            this.cpu.requestIrq(InstructionRequest.NMI);
        };
        PPU.serializable = [
            'vramMem', 'spriteMem',
            'cntFV', 'cntV', 'cntH', 'cntVT', 'cntHT',
            'regFV', 'regV', 'regH', 'regVT', 'regHT', 'regFH', 'regS',
            'vramAddress', 'vramTmpAddress',
            'f_nmiOnVblank', 'f_spriteSize', 'f_bgPatternTable', 'f_spPatternTable',
            'f_addrInc', 'f_nTblAddress', 'f_color', 'f_spVisibility',
            'f_bgVisibility', 'f_spClipping', 'f_bgClipping', 'f_dispType',
            'vramBufferedReadValue', 'firstWrite',
            'currentMirroring', 'vramMirrorTable', 'ntable1',
            'sramAddress',
            'hitSpr0',
            'sprPalette', 'imgPalette',
            'curX', 'scanline', 'lastRenderedScanline', 'curNt', 'scantile',
            'attrib', 'buffer', 'bgbuffer', 'pixrendered',
            'requestEndFrame', 'nmiOk', 'dummyCycleToggle', 'nmiCounter',
            'validTileData', 'scanlineAlreadyRendered'
        ];
        return PPU;
    }());
    ;
    var NameTable = /** @class */ (function () {
        function NameTable(width, height, name) {
            this.width = width;
            this.height = height;
            this.name = name;
            this.tile = new Array(width * height);
            this.attrib = new Array(width * height);
            for (var i = 0; i < width * height; i += 1) {
                this.tile[i] = 0;
                this.attrib[i] = 0;
            }
        }
        Object.defineProperty(NameTable.prototype, "serializable", {
            get: function () {
                return NameTable.serializable;
            },
            enumerable: true,
            configurable: true
        });
        NameTable.prototype.getTileIndex = function (x, y) {
            return this.tile[y * this.width + x];
        };
        NameTable.prototype.getAttrib = function (x, y) {
            return this.attrib[y * this.width + x];
        };
        NameTable.prototype.writeAttrib = function (index, value) {
            var basex = (index % 8) * 4;
            var basey = Math.floor(index / 8) * 4;
            var add;
            var tx, ty;
            var attindex;
            for (var sqy = 0; sqy < 2; sqy++) {
                for (var sqx = 0; sqx < 2; sqx++) {
                    add = (value >> (2 * (sqy * 2 + sqx))) & 3;
                    for (var y = 0; y < 2; y++) {
                        for (var x = 0; x < 2; x++) {
                            tx = basex + sqx * 2 + x;
                            ty = basey + sqy * 2 + y;
                            attindex = ty * this.width + tx;
                            this.attrib[ty * this.width + tx] = (add << 2) & 12;
                        }
                    }
                }
            }
        };
        NameTable.serializable = [
            'tile',
            'attrib'
        ];
        return NameTable;
    }());
    var PaletteTable = /** @class */ (function () {
        function PaletteTable() {
            this.curTable = new Array(64);
            this.emphTable = new Array(8);
            this.currentEmph = -1;
        }
        PaletteTable.prototype.loadNTSCPalette = function () {
            this.curTable = [0x525252, 0xB40000, 0xA00000, 0xB1003D, 0x740069, 0x00005B, 0x00005F, 0x001840, 0x002F10, 0x084A08, 0x006700, 0x124200, 0x6D2800, 0x000000, 0x000000, 0x000000, 0xC4D5E7, 0xFF4000, 0xDC0E22, 0xFF476B, 0xD7009F, 0x680AD7, 0x0019BC, 0x0054B1, 0x006A5B, 0x008C03, 0x00AB00, 0x2C8800, 0xA47200, 0x000000, 0x000000, 0x000000, 0xF8F8F8, 0xFFAB3C, 0xFF7981, 0xFF5BC5, 0xFF48F2, 0xDF49FF, 0x476DFF, 0x00B4F7, 0x00E0FF, 0x00E375, 0x03F42B, 0x78B82E, 0xE5E218, 0x787878, 0x000000, 0x000000, 0xFFFFFF, 0xFFF2BE, 0xF8B8B8, 0xF8B8D8, 0xFFB6FF, 0xFFC3FF, 0xC7D1FF, 0x9ADAFF, 0x88EDF8, 0x83FFDD, 0xB8F8B8, 0xF5F8AC, 0xFFFFB0, 0xF8D8F8, 0x000000, 0x000000];
            this.makeTables();
            this.setEmphasis(0);
        };
        PaletteTable.prototype.loadPALPalette = function () {
            this.curTable = [0x525252, 0xB40000, 0xA00000, 0xB1003D, 0x740069, 0x00005B, 0x00005F, 0x001840, 0x002F10, 0x084A08, 0x006700, 0x124200, 0x6D2800, 0x000000, 0x000000, 0x000000, 0xC4D5E7, 0xFF4000, 0xDC0E22, 0xFF476B, 0xD7009F, 0x680AD7, 0x0019BC, 0x0054B1, 0x006A5B, 0x008C03, 0x00AB00, 0x2C8800, 0xA47200, 0x000000, 0x000000, 0x000000, 0xF8F8F8, 0xFFAB3C, 0xFF7981, 0xFF5BC5, 0xFF48F2, 0xDF49FF, 0x476DFF, 0x00B4F7, 0x00E0FF, 0x00E375, 0x03F42B, 0x78B82E, 0xE5E218, 0x787878, 0x000000, 0x000000, 0xFFFFFF, 0xFFF2BE, 0xF8B8B8, 0xF8B8D8, 0xFFB6FF, 0xFFC3FF, 0xC7D1FF, 0x9ADAFF, 0x88EDF8, 0x83FFDD, 0xB8F8B8, 0xF5F8AC, 0xFFFFB0, 0xF8D8F8, 0x000000, 0x000000];
            this.makeTables();
            this.setEmphasis(0);
        };
        PaletteTable.prototype.makeTables = function () {
            var r, g, b, col, i, rFactor, gFactor, bFactor;
            for (var emph = 0; emph < 8; emph++) {
                rFactor = 1.0;
                gFactor = 1.0;
                bFactor = 1.0;
                if ((emph & 1) !== 0) {
                    rFactor = 0.75;
                    bFactor = 0.75;
                }
                if ((emph & 2) !== 0) {
                    rFactor = 0.75;
                    gFactor = 0.75;
                }
                if ((emph & 4) !== 0) {
                    gFactor = 0.75;
                    bFactor = 0.75;
                }
                this.emphTable[emph] = new Array(64);
                for (i = 0; i < 64; i++) {
                    col = this.curTable[i];
                    r = Math.floor(this.getRed(col) * rFactor);
                    g = Math.floor(this.getGreen(col) * gFactor);
                    b = Math.floor(this.getBlue(col) * bFactor);
                    this.emphTable[emph][i] = this.getRgb(r, g, b);
                }
            }
        };
        PaletteTable.prototype.setEmphasis = function (emph) {
            if (emph != this.currentEmph) {
                this.currentEmph = emph;
                for (var i = 0; i < 64; i++) {
                    this.curTable[i] = this.emphTable[emph][i];
                }
            }
        };
        PaletteTable.prototype.getEntry = function (yiq) {
            return this.curTable[yiq];
        };
        PaletteTable.prototype.getRed = function (rgb) {
            return (rgb >> 16) & 0xFF;
        };
        PaletteTable.prototype.getGreen = function (rgb) {
            return (rgb >> 8) & 0xFF;
        };
        PaletteTable.prototype.getBlue = function (rgb) {
            return rgb & 0xFF;
        };
        PaletteTable.prototype.getRgb = function (r, g, b) {
            return ((r << 16) | (g << 8) | (b));
        };
        PaletteTable.prototype.loadDefaultPalette = function () {
            this.curTable[0] = this.getRgb(117, 117, 117);
            this.curTable[1] = this.getRgb(39, 27, 143);
            this.curTable[2] = this.getRgb(0, 0, 171);
            this.curTable[3] = this.getRgb(71, 0, 159);
            this.curTable[4] = this.getRgb(143, 0, 119);
            this.curTable[5] = this.getRgb(171, 0, 19);
            this.curTable[6] = this.getRgb(167, 0, 0);
            this.curTable[7] = this.getRgb(127, 11, 0);
            this.curTable[8] = this.getRgb(67, 47, 0);
            this.curTable[9] = this.getRgb(0, 71, 0);
            this.curTable[10] = this.getRgb(0, 81, 0);
            this.curTable[11] = this.getRgb(0, 63, 23);
            this.curTable[12] = this.getRgb(27, 63, 95);
            this.curTable[13] = this.getRgb(0, 0, 0);
            this.curTable[14] = this.getRgb(0, 0, 0);
            this.curTable[15] = this.getRgb(0, 0, 0);
            this.curTable[16] = this.getRgb(188, 188, 188);
            this.curTable[17] = this.getRgb(0, 115, 239);
            this.curTable[18] = this.getRgb(35, 59, 239);
            this.curTable[19] = this.getRgb(131, 0, 243);
            this.curTable[20] = this.getRgb(191, 0, 191);
            this.curTable[21] = this.getRgb(231, 0, 91);
            this.curTable[22] = this.getRgb(219, 43, 0);
            this.curTable[23] = this.getRgb(203, 79, 15);
            this.curTable[24] = this.getRgb(139, 115, 0);
            this.curTable[25] = this.getRgb(0, 151, 0);
            this.curTable[26] = this.getRgb(0, 171, 0);
            this.curTable[27] = this.getRgb(0, 147, 59);
            this.curTable[28] = this.getRgb(0, 131, 139);
            this.curTable[29] = this.getRgb(0, 0, 0);
            this.curTable[30] = this.getRgb(0, 0, 0);
            this.curTable[31] = this.getRgb(0, 0, 0);
            this.curTable[32] = this.getRgb(255, 255, 255);
            this.curTable[33] = this.getRgb(63, 191, 255);
            this.curTable[34] = this.getRgb(95, 151, 255);
            this.curTable[35] = this.getRgb(167, 139, 253);
            this.curTable[36] = this.getRgb(247, 123, 255);
            this.curTable[37] = this.getRgb(255, 119, 183);
            this.curTable[38] = this.getRgb(255, 119, 99);
            this.curTable[39] = this.getRgb(255, 155, 59);
            this.curTable[40] = this.getRgb(243, 191, 63);
            this.curTable[41] = this.getRgb(131, 211, 19);
            this.curTable[42] = this.getRgb(79, 223, 75);
            this.curTable[43] = this.getRgb(88, 248, 152);
            this.curTable[44] = this.getRgb(0, 235, 219);
            this.curTable[45] = this.getRgb(0, 0, 0);
            this.curTable[46] = this.getRgb(0, 0, 0);
            this.curTable[47] = this.getRgb(0, 0, 0);
            this.curTable[48] = this.getRgb(255, 255, 255);
            this.curTable[49] = this.getRgb(171, 231, 255);
            this.curTable[50] = this.getRgb(199, 215, 255);
            this.curTable[51] = this.getRgb(215, 203, 255);
            this.curTable[52] = this.getRgb(255, 199, 255);
            this.curTable[53] = this.getRgb(255, 199, 219);
            this.curTable[54] = this.getRgb(255, 191, 179);
            this.curTable[55] = this.getRgb(255, 219, 171);
            this.curTable[56] = this.getRgb(255, 231, 163);
            this.curTable[57] = this.getRgb(227, 255, 163);
            this.curTable[58] = this.getRgb(171, 243, 191);
            this.curTable[59] = this.getRgb(179, 255, 207);
            this.curTable[60] = this.getRgb(159, 255, 243);
            this.curTable[61] = this.getRgb(0, 0, 0);
            this.curTable[62] = this.getRgb(0, 0, 0);
            this.curTable[63] = this.getRgb(0, 0, 0);
            this.makeTables();
            this.setEmphasis(0);
        };
        return PaletteTable;
    }());
    var Tile = /** @class */ (function () {
        function Tile() {
            this.pix = new Array(64);
            this.opaque = new Array(8);
            this.initialized = false;
            this.fbIndex = null;
            this.tIndex = null;
            this.x = null;
            this.y = null;
            this.w = null;
            this.h = null;
            this.incX = null;
            this.incY = null;
            this.palIndex = null;
            this.tpri = null;
            this.c = null;
        }
        Object.defineProperty(Tile.prototype, "serializable", {
            get: function () {
                return Tile.serializable;
            },
            enumerable: true,
            configurable: true
        });
        Tile.prototype.setBuffer = function (scanline) {
            for (this.y = 0; this.y < 8; this.y += 1) {
                this.setScanline(this.y, scanline[this.y], scanline[this.y + 8]);
            }
        };
        Tile.prototype.setScanline = function (sline, b1, b2) {
            this.initialized = true;
            this.tIndex = sline << 3;
            for (this.x = 0; this.x < 8; this.x += 1) {
                this.pix[this.tIndex + this.x] = ((b1 >> (7 - this.x)) & 1) + (((b2 >> (7 - this.x)) & 1) << 1);
                if (this.pix[this.tIndex + this.x] === 0) {
                    this.opaque[sline] = false;
                }
            }
        };
        Tile.prototype.render = function (buffer, srcx1, srcy1, srcx2, srcy2, dx, dy, palAdd, palette, flipHorizontal, flipVertical, pri, priTable) {
            if (dx < -7 || dx >= 256 || dy < -7 || dy >= 240) {
                return;
            }
            this.w = srcx2 - srcx1;
            this.h = srcy2 - srcy1;
            if (dx < 0) {
                srcx1 -= dx;
            }
            if (dx + srcx2 >= 256) {
                srcx2 = 256 - dx;
            }
            if (dy < 0) {
                srcy1 -= dy;
            }
            if (dy + srcy2 >= 240) {
                srcy2 = 240 - dy;
            }
            if (!flipHorizontal && !flipVertical) {
                this.fbIndex = (dy << 8) + dx;
                this.tIndex = 0;
                for (this.y = 0; this.y < 8; this.y += 1) {
                    for (this.x = 0; this.x < 8; this.x += 1) {
                        if (this.x >= srcx1 && this.x < srcx2 && this.y >= srcy1 && this.y < srcy2) {
                            this.palIndex = this.pix[this.tIndex];
                            this.tpri = priTable[this.fbIndex];
                            if (this.palIndex !== 0 && pri <= (this.tpri & 0xFF)) {
                                buffer[this.fbIndex] = palette[this.palIndex + palAdd];
                                this.tpri = (this.tpri & 0xF00) | pri;
                                priTable[this.fbIndex] = this.tpri;
                            }
                        }
                        this.fbIndex += 1;
                        this.tIndex += 1;
                    }
                    this.fbIndex -= 8;
                    this.fbIndex += 256;
                }
            }
            else if (flipHorizontal && !flipVertical) {
                this.fbIndex = (dy << 8) + dx;
                this.tIndex = 7;
                for (this.y = 0; this.y < 8; this.y++) {
                    for (this.x = 0; this.x < 8; this.x++) {
                        if (this.x >= srcx1 && this.x < srcx2 && this.y >= srcy1 && this.y < srcy2) {
                            this.palIndex = this.pix[this.tIndex];
                            this.tpri = priTable[this.fbIndex];
                            if (this.palIndex !== 0 && pri <= (this.tpri & 0xFF)) {
                                buffer[this.fbIndex] = palette[this.palIndex + palAdd];
                                this.tpri = (this.tpri & 0xF00) | pri;
                                priTable[this.fbIndex] = this.tpri;
                            }
                        }
                        this.fbIndex++;
                        this.tIndex--;
                    }
                    this.fbIndex -= 8;
                    this.fbIndex += 256;
                    this.tIndex += 16;
                }
            }
            else if (flipVertical && !flipHorizontal) {
                this.fbIndex = (dy << 8) + dx;
                this.tIndex = 56;
                for (this.y = 0; this.y < 8; this.y++) {
                    for (this.x = 0; this.x < 8; this.x++) {
                        if (this.x >= srcx1 && this.x < srcx2 && this.y >= srcy1 && this.y < srcy2) {
                            this.palIndex = this.pix[this.tIndex];
                            this.tpri = priTable[this.fbIndex];
                            if (this.palIndex !== 0 && pri <= (this.tpri & 0xFF)) {
                                buffer[this.fbIndex] = palette[this.palIndex + palAdd];
                                this.tpri = (this.tpri & 0xF00) | pri;
                                priTable[this.fbIndex] = this.tpri;
                            }
                        }
                        this.fbIndex++;
                        this.tIndex++;
                    }
                    this.fbIndex -= 8;
                    this.fbIndex += 256;
                    this.tIndex -= 16;
                }
            }
            else {
                this.fbIndex = (dy << 8) + dx;
                this.tIndex = 63;
                for (this.y = 0; this.y < 8; this.y++) {
                    for (this.x = 0; this.x < 8; this.x++) {
                        if (this.x >= srcx1 && this.x < srcx2 && this.y >= srcy1 && this.y < srcy2) {
                            this.palIndex = this.pix[this.tIndex];
                            this.tpri = priTable[this.fbIndex];
                            if (this.palIndex !== 0 && pri <= (this.tpri & 0xFF)) {
                                buffer[this.fbIndex] = palette[this.palIndex + palAdd];
                                this.tpri = (this.tpri & 0xF00) | pri;
                                priTable[this.fbIndex] = this.tpri;
                            }
                        }
                        this.fbIndex++;
                        this.tIndex--;
                    }
                    this.fbIndex -= 8;
                    this.fbIndex += 256;
                }
            }
        };
        Tile.prototype.isTransparent = function (x, y) {
            return (this.pix[(y << 3) + x] === 0);
        };
        Tile.serializable = [
            'opaque',
            'pix'
        ];
        return Tile;
    }());
    var MirroringType;
    (function (MirroringType) {
        MirroringType[MirroringType["vertical"] = 0] = "vertical";
        MirroringType[MirroringType["horizontal"] = 1] = "horizontal";
        MirroringType[MirroringType["fourScreen"] = 2] = "fourScreen";
        MirroringType[MirroringType["singleScreen"] = 3] = "singleScreen";
        MirroringType[MirroringType["singleScreen2"] = 4] = "singleScreen2";
        MirroringType[MirroringType["singleScreen3"] = 5] = "singleScreen3";
        MirroringType[MirroringType["singleScreen4"] = 6] = "singleScreen4";
        MirroringType[MirroringType["chrRom"] = 7] = "chrRom";
    })(MirroringType || (MirroringType = {}));
    var Rom = /** @class */ (function () {
        function Rom(data) {
            var i;
            var j;
            var v;
            var bytes = new Uint8Array(data, 0, data.byteLength);
            if (bytes.length < 4 ||
                bytes[0] !== 0x4E ||
                bytes[1] !== 0x45 ||
                bytes[2] !== 0x53 ||
                bytes[3] !== 0x1A) {
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
            this.vromCount = this.header[5] * 2;
            this.mirroring = (this.header[6] & 1) !== 0 ? 1 : 0;
            this.batteryRam = (this.header[6] & 2) !== 0;
            this.trainer = (this.header[6] & 4) !== 0;
            this.fourScreen = (this.header[6] & 8) !== 0;
            this.mapperType = (this.header[6] >> 4) | (this.header[7] & 0xF0);
            var foundError = false;
            for (i = 8; i < 16; i += 1) {
                if (this.header[i] !== 0) {
                    foundError = true;
                    break;
                }
            }
            if (foundError) {
                this.mapperType &= 0xF;
            }
            this.rom = new Array(this.romCount);
            var offset = 16;
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
            this.vromTile = new Array(this.vromCount);
            for (i = 0; i < this.vromCount; i += 1) {
                this.vromTile[i] = new Array(256);
                for (j = 0; j < 256; j += 1) {
                    this.vromTile[i][j] = new Tile();
                }
            }
            var tileIndex;
            var leftOver;
            for (v = 0; v < this.vromCount; v += 1) {
                for (i = 0; i < 4096; i += 1) {
                    tileIndex = i >> 4;
                    leftOver = i % 16;
                    if (leftOver < 8) {
                        this.vromTile[v][tileIndex].setScanline(leftOver, this.vrom[v][i], this.vrom[v][i + 8]);
                    }
                    else {
                        this.vromTile[v][tileIndex].setScanline(leftOver - 8, this.vrom[v][i - 8], this.vrom[v][i]);
                    }
                }
            }
        }
        Object.defineProperty(Rom.prototype, "mirroringType", {
            get: function () {
                if (this.fourScreen) {
                    return MirroringType.fourScreen;
                }
                if (this.mirroring === 0) {
                    return MirroringType.horizontal;
                }
                return MirroringType.vertical;
            },
            enumerable: true,
            configurable: true
        });
        return Rom;
    }());
    var System = /** @class */ (function () {
        function System(rom, onsample, onerror) {
            var _this = this;
            this.onsample = onsample;
            this.onerror = onerror;
            this.videoBuffer = new Array(256 * 240);
            this.audioBuffer = [];
            this.cpu = new CPU(null);
            this.ppu = new PPU(this.cpu, function (buffer) {
                for (var i = 0; i < 256 * 240; i += 1) {
                    _this.videoBuffer[i] = buffer[i];
                }
            });
            this.apu = new APU(this.cpu, function (sample) {
                _this.audioBuffer.push(sample);
                if (_this.onsample) {
                    _this.onsample(sample);
                }
            });
            this.controller = new Controller();
            this.cpu.mapper = Mapper.create(this.cpu, this.ppu, this.apu, this.controller, rom);
            this.ppu.setMirroring(rom.mirroringType);
        }
        System.romSupported = function (rom) {
            return Mapper.romSupported(rom);
        };
        System.prototype.buttonDown = function (player, button) {
            this.controller.buttonDown(player, button);
        };
        System.prototype.buttonUp = function (player, button) {
            this.controller.buttonUp(player, button);
        };
        System.prototype.frame = function () {
            this.controller.frame();
            this.ppu.startFrame();
            var cycles = 0;
            var cpu = this.cpu;
            var ppu = this.ppu;
            var apu = this.apu;
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
                        ppu.scanline - 21 === ppu.spr0HitY) {
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
        };
        System.prototype.pull = function () {
            var audio = this.audioBuffer;
            this.audioBuffer = [];
            return {
                video: this.videoBuffer,
                audio: audio
            };
        };
        return System;
    }());
});
